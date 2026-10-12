/** BPMN 2.0 XML export of a BPMN-lite graph with diagram interchange; the `wise` extension makes the round trip lossless. */
import { type Box, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Positions, createPositions, edgePoints, hasTag } from "../core/index.js";
import { finitePositions } from "../core/layout.js";
import { type BpmnLayoutOptions, POOL_ID, layoutBpmn } from "./layout.js";
import { type IdMap, createIdMap } from "./ids.js";
import { type BpmnModdleInstance, type ModdleElement, createModdle, typeOfTag } from "./moddle.js";
import { BPMN_VOCABULARY as V, eventDefinitionTypes, eventType, gatewayType, isGeneratedGateway } from "./vocabulary.js";

export type { IdMap } from "./ids.js";

export const EXPORTER_NAME = "wise-flow";
export const EXPORTER_VERSION = "0.2.0";
export const TARGET_NAMESPACE = "http://wise-workbench.org/bpmn";

export interface ExportBpmnOptions {
  /** Positions of the graph; computed with `layoutBpmn` when omitted. */
  positions?: Positions;
  layout?: BpmnLayoutOptions;
  /** Id of the definitions element. Default `Definitions_wise`. */
  id?: string;
  /** Process id and name. */
  processId?: string;
  name?: string;
  /** Pretty-print the XML. Default true. */
  format?: boolean;
  /** Write `wise:` attributes (ids, kinds, tags) and metric extension elements. Default true. */
  extension?: boolean;
  /** Wrap the process in a collaboration with one participant when the graph has lanes. Default true. */
  participant?: boolean;
}

export interface BpmnExport {
  xml: string;
  positions: Positions;
  ids: IdMap;
  /** Elements that have no BPMN counterpart (constraint edges, notes without position), labels and ids that lose characters XML 1.0 does not allow. */
  warnings: string[];
}

/** A character XML 1.0 does not allow (its `Char` production, read the other way round). */
const NOT_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
/** What `toXml` rewrites: a character XML 1.0 does not allow, a tab or a carriage return. */
const TO_WRITE = /[^\n\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/** An XML-safe id derived from an arbitrary id; unique against `taken`. */
export function xmlId(id: string, taken?: Set<string>, prefix = ""): string {
  let s = (id.startsWith(prefix) ? id : prefix + id).replace(/[^A-Za-z0-9_.-]+/g, "_");
  if (!/^[A-Za-z_]/.test(s)) s = `_${s}`;
  if (taken) {
    let candidate = s;
    let n = 2;
    while (taken.has(candidate)) candidate = `${s}_${n++}`;
    taken.add(candidate);
    return candidate;
  }
  return s;
}

function bpmnTypeOfNode(n: FlowNode): string {
  switch (n.kind) {
    case "event":
      return eventType(n);
    case "gateway":
      return gatewayType(n);
    case "note":
      return "bpmn:TextAnnotation";
    default: {
      const tag = V.taskTypes.find((tt) => hasTag(n, tt));
      return tag ? typeOfTag(tag) : "bpmn:Task";
    }
  }
}

function defaultKindOfType(type: string): "activity" | "gateway" | "event" | "note" {
  if (type.endsWith("Gateway")) return "gateway";
  if (type.endsWith("Event")) return "event";
  if (type === "bpmn:TextAnnotation") return "note";
  return "activity";
}

interface Ctx {
  moddle: BpmnModdleInstance;
  taken: Set<string>;
  ids: IdMap;
  extension: boolean;
  warnings: string[];
}

// Every element gets an id of its own; a FlowGraph id shared by a node, an edge or a group maps to the first.
function idFor(ctx: Ctx, flowId: string, prefix = ""): string {
  if (NOT_XML.test(flowId)) ctx.warnings.push(`id ${flowId}: characters XML 1.0 does not allow are dropped`);
  const id = xmlId(flowId ?? "", ctx.taken, prefix);
  ctx.ids.toBpmn[flowId] ??= id;
  ctx.ids.toFlow[id] = flowId;
  return id;
}

function origin(ctx: Ctx, el: ModdleElement, flowId: string, kind: string | undefined, tags: string[] | undefined, metrics: Record<string, number> | undefined): void {
  if (!ctx.extension) return;
  if (el.id !== flowId) el.set("wise:flowId", flowId);
  if (kind) el.set("wise:kind", kind);
  if (tags && tags.length) el.set("wise:tags", tags.join(" "));
  const names = Object.keys(metrics ?? {}).sort();
  if (names.length) {
    const ext = ctx.moddle.create("bpmn:ExtensionElements");
    const values = ext.get("values") as ModdleElement[];
    for (const name of names) {
      const value = metrics![name];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      values.push(ctx.moddle.create("wise:Metric", { name, value }));
    }
    if (values.length) el.set("extensionElements", ext);
  }
}

// A label as it is written: `toXml` drops what XML 1.0 does not allow, and a warning says so.
function text<T>(ctx: Ctx, label: T, id: string): T | string {
  if (typeof label !== "string") return label;
  if (NOT_XML.test(label)) ctx.warnings.push(`label of ${id}: characters XML 1.0 does not allow are dropped`);
  // The writer turns a line feed and a carriage return after it into one line feed; a character `toXml` drops keeps them apart.
  return label.replace(/\n\r/g, "\n\0\r");
}

// Tab and carriage return as references, which a conforming parser keeps; what XML 1.0 does not allow, dropped.
const toXml = (xml: string) => xml.replace(TO_WRITE, (c) => (c === "\t" ? "&#9;" : c === "\r" ? "&#13;" : ""));

function connect(source: ModdleElement, target: ModdleElement, flow: ModdleElement): void {
  (source.get("outgoing") as ModdleElement[]).push(flow);
  (target.get("incoming") as ModdleElement[]).push(flow);
}

/**
 * Serialise a BPMN-lite graph to BPMN 2.0 XML with DI. Tasks, gateways, events,
 * sequence flows and lanes map to their BPMN types (tags select sub-types such
 * as `userTask`, `and`, `timer`); constraint edges are not part of BPMN and are
 * reported in `warnings`. Ids that are not XML ids are made safe and the
 * original is kept in `wise:flowId`.
 */
export async function exportBpmn(graph: FlowGraph, options: ExportBpmnOptions = {}): Promise<BpmnExport> {
  // The DI carries two decimals; the returned positions are the ones written.
  const positions = roundPositions(finitePositions(options.positions ?? (await layoutBpmn(graph, options.layout))));
  const moddle = createModdle();
  const warnings: string[] = [];
  const ctx: Ctx = { moddle, taken: new Set(), ids: createIdMap(), extension: options.extension ?? true, warnings };
  const format = options.format ?? true;

  const definitionsId = options.id ?? "Definitions_wise";
  const processId = options.processId ?? "Process_wise";
  ctx.taken.add(definitionsId);
  ctx.taken.add(processId);
  const definitions = moddle.create("bpmn:Definitions", {
    id: definitionsId,
    targetNamespace: TARGET_NAMESPACE,
    exporter: EXPORTER_NAME,
    exporterVersion: EXPORTER_VERSION,
  });
  const rootElements = definitions.get("rootElements") as ModdleElement[];
  const process = moddle.create("bpmn:Process", { id: processId, isExecutable: false });
  if (options.name ?? graph.meta?.label) process.set("name", text(ctx, String(options.name ?? graph.meta?.label), processId));
  rootElements.push(process);
  const flowElements = process.get("flowElements") as ModdleElement[];
  const artifacts = process.get("artifacts") as ModdleElement[];

  // Flow nodes
  const elements = new Map<string, ModdleElement>();
  const nodeElements: ModdleElement[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const n of graph.nodes) {
    const type = bpmnTypeOfNode(n);
    const id = idFor(ctx, n.id);
    const el = moddle.create(type, { id });
    nodeElements.push(el);
    if (type === "bpmn:TextAnnotation") {
      el.set("text", text(ctx, n.label, n.id));
      artifacts.push(el);
    } else {
      if (!isGeneratedGateway(n)) el.set("name", text(ctx, n.label, n.id));
      if (n.kind === "event") {
        const defs = eventDefinitionTypes(n.tags ?? []);
        if (defs.length) el.set("eventDefinitions", defs.map((d) => moddle.create(d)));
      }
      if ((n.kind === "activity" || n.kind === "stage") && hasTag(n, V.loop[0])) {
        el.set("loopCharacteristics", moddle.create(V.loop[1]));
      }
      flowElements.push(el);
    }
    const kind = defaultKindOfType(type) === n.kind ? undefined : n.kind;
    origin(ctx, el, n.id, kind, n.tags, n.metrics);
    elements.set(n.id, el);
  }

  // Sequence flows
  const flows = new Map<string, ModdleElement>();
  for (const e of graph.edges) {
    if (e.kind === "constraint") {
      warnings.push(`constraint edge ${e.id} has no BPMN counterpart`);
      continue;
    }
    const source = elements.get(e.source);
    const target = elements.get(e.target);
    if (!source || !target) {
      warnings.push(`edge ${e.id} refers to a missing node`);
      continue;
    }
    if (nodeById.get(e.source)?.kind === "note" || nodeById.get(e.target)?.kind === "note") {
      const assoc = moddle.create("bpmn:Association", { id: idFor(ctx, e.id, "Association_"), sourceRef: source, targetRef: target });
      artifacts.push(assoc);
      flows.set(e.id, assoc);
      continue;
    }
    const id = idFor(ctx, e.id, "Flow_");
    const flow = moddle.create("bpmn:SequenceFlow", { id, sourceRef: source, targetRef: target });
    const payload = typeof e.payload === "object" && e.payload ? (e.payload as Record<string, unknown>) : {};
    if (typeof payload.label === "string" && payload.label) flow.set("name", text(ctx, payload.label, e.id));
    if (typeof payload.condition === "string" && payload.condition) {
      flow.set("conditionExpression", moddle.create("bpmn:FormalExpression", { body: text(ctx, payload.condition, e.id) }));
    }
    if (hasTag(e, V.defaultFlow)) source.set("default", flow);
    connect(source, target, flow);
    flowElements.push(flow);
    origin(ctx, flow, e.id, e.kind === "flow" ? undefined : e.kind, e.tags, e.metrics);
    flows.set(e.id, flow);
  }

  // Lanes and pool
  const groups = (graph.groups ?? []).filter((g) => g.kind !== "pool" || g.parent);
  const pools = (graph.groups ?? []).filter((g) => g.kind === "pool" && !g.parent);
  const laneElements = new Map<string, ModdleElement>();
  let participant: ModdleElement | undefined;
  let collaboration: ModdleElement | undefined;
  const wantParticipant = (options.participant ?? true) && (groups.length > 0 || pools.length > 0);
  if (wantParticipant) {
    collaboration = moddle.create("bpmn:Collaboration", { id: xmlId("Collaboration_wise", ctx.taken) });
    const pool = pools[0];
    const pid = pool ? idFor(ctx, pool.id, "Participant_") : xmlId("Participant_wise", ctx.taken);
    participant = moddle.create("bpmn:Participant", { id: pid, processRef: process });
    participant.set("name", text(ctx, pool?.label ?? options.name ?? (typeof graph.meta?.label === "string" ? graph.meta.label : "Process"), pool?.id ?? pid));
    if (pool) origin(ctx, participant, pool.id, undefined, undefined, undefined);
    if (pools.length > 1) warnings.push(`only the first pool group is exported as a participant; ${pools.length - 1} more treated as lanes`);
    (collaboration.get("participants") as ModdleElement[]).push(participant);
    rootElements.unshift(collaboration);
  }
  const laneGroups: FlowGroup[] = [...groups, ...pools.slice(1)];
  if (laneGroups.length) {
    const laneSet = moddle.create("bpmn:LaneSet", { id: xmlId("LaneSet_wise", ctx.taken) });
    (process.get("laneSets") as ModdleElement[]).push(laneSet);
    const groupIds = new Set(laneGroups.map((g) => g.id));
    const build = (g: FlowGroup): ModdleElement => {
      const lane = moddle.create("bpmn:Lane", { id: idFor(ctx, g.id, "Lane_"), name: text(ctx, g.label, g.id) });
      origin(ctx, lane, g.id, g.kind === "lane" ? undefined : g.kind, undefined, undefined);
      laneElements.set(g.id, lane);
      const children = laneGroups.filter((c) => c.parent === g.id);
      if (children.length) {
        const childSet = moddle.create("bpmn:LaneSet", { id: xmlId(`LaneSet_${g.id}`, ctx.taken) });
        lane.set("childLaneSet", childSet);
        for (const c of children) (childSet.get("lanes") as ModdleElement[]).push(build(c));
      }
      return lane;
    };
    for (const g of laneGroups) {
      const parentIsLane = g.parent && groupIds.has(g.parent);
      if (!parentIsLane) (laneSet.get("lanes") as ModdleElement[]).push(build(g));
    }
    for (const n of graph.nodes) {
      const lane = n.group ? laneElements.get(n.group) : undefined;
      const el = elements.get(n.id);
      if (lane && el && n.kind !== "note") (lane.get("flowNodeRef") as ModdleElement[]).push(el);
    }
  }

  // Diagram interchange
  const planeElement = participant && collaboration ? collaboration : process;
  const plane = moddle.create("bpmndi:BPMNPlane", { id: xmlId("Plane_wise", ctx.taken), bpmnElement: planeElement });
  const diagram = moddle.create("bpmndi:BPMNDiagram", { id: xmlId("Diagram_wise", ctx.taken), plane });
  (definitions.get("diagrams") as ModdleElement[]).push(diagram);
  const shapes = plane.get("planeElement") as ModdleElement[];
  const bounds = (b: Box) => moddle.create("dc:Bounds", { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) });
  const addShape = (el: ModdleElement, b: Box, extra: Record<string, unknown> = {}) => {
    shapes.push(moddle.create("bpmndi:BPMNShape", { id: xmlId(`${el.id}_di`, ctx.taken), bpmnElement: el, bounds: bounds(b), ...extra }));
  };
  if (participant) {
    const poolBox = pools[0] ? positions.groups[pools[0].id] : positions.groups[POOL_ID];
    addShape(participant, poolBox ?? enclosing(positions, 30), { isHorizontal: true });
  }
  for (const g of laneGroups) {
    const lane = laneElements.get(g.id);
    const b = positions.groups[g.id];
    if (lane && b) addShape(lane, b, { isHorizontal: true });
    else if (lane) warnings.push(`lane ${g.id} has no position`);
  }
  for (const [i, n] of graph.nodes.entries()) {
    const el = nodeElements[i];
    const b = positions.nodes[n.id];
    if (!b) {
      warnings.push(`node ${n.id} has no position`);
      continue;
    }
    const extra = el.$type === "bpmn:ExclusiveGateway" ? { isMarkerVisible: true } : {};
    addShape(el, b, extra);
  }
  for (const e of graph.edges) {
    const flow = flows.get(e.id);
    if (!flow) continue;
    const points = edgePoints(positions, e);
    if (!points) {
      warnings.push(`edge ${e.id} has no route`);
      continue;
    }
    shapes.push(
      moddle.create("bpmndi:BPMNEdge", {
        id: xmlId(`${flow.id}_di`, ctx.taken),
        bpmnElement: flow,
        waypoint: points.map((p) => moddle.create("dc:Point", { x: round(p.x), y: round(p.y) })),
      }),
    );
  }

  const { xml } = await moddle.toXML(definitions, { format });
  return { xml: toXml(xml), positions, ids: ctx.ids, warnings };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundBox(b: Box): Box {
  return { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) };
}

/** Positions with every coordinate rounded to two decimals, as the DI stores them. */
export function roundPositions(p: Positions): Positions {
  const nodes: Positions["nodes"] = {};
  const groups: Positions["groups"] = {};
  const edges: Positions["edges"] = {};
  for (const [id, b] of Object.entries(p.nodes)) nodes[id] = roundBox(b);
  for (const [id, b] of Object.entries(p.groups)) groups[id] = roundBox(b);
  for (const [id, r] of Object.entries(p.edges)) edges[id] = { ...r, points: r.points.map((pt) => ({ x: round(pt.x), y: round(pt.y) })) };
  return createPositions({ nodes, groups, edges }, p.engine, p.direction);
}

function enclosing(positions: Positions, margin: number): Box {
  const b = positions.bounds;
  return { x: b.x - margin, y: b.y - margin, width: b.width + 2 * margin, height: b.height + 2 * margin };
}

export interface BpmnValidation {
  ok: boolean;
  warnings: string[];
  counts: { processes: number; tasks: number; gateways: number; events: number; flows: number; lanes: number; shapes: number; edges: number };
  /** Flow nodes without a shape and sequence flows without an edge in the DI. */
  missingDi: string[];
}

/**
 * Parse BPMN 2.0 XML with bpmn-moddle and count what it contains; `ok` when the
 * parser reports no warnings and every flow node and sequence flow has DI.
 */
export async function validateBpmn(xml: string): Promise<BpmnValidation> {
  const moddle = createModdle();
  const { rootElement, warnings } = await moddle.fromXML(xml);
  const counts = { processes: 0, tasks: 0, gateways: 0, events: 0, flows: 0, lanes: 0, shapes: 0, edges: 0 };
  const withDi = new Set<string>();
  for (const d of (rootElement.get("diagrams") as ModdleElement[] | undefined) ?? []) {
    const plane = d.get("plane") as ModdleElement | undefined;
    for (const p of (plane?.get("planeElement") as ModdleElement[] | undefined) ?? []) {
      const target = p.get("bpmnElement") as ModdleElement | undefined;
      if (target?.id) withDi.add(target.id);
      if (p.$type === "bpmndi:BPMNShape") counts.shapes++;
      else if (p.$type === "bpmndi:BPMNEdge") counts.edges++;
    }
  }
  const missingDi: string[] = [];
  // Without recursion, as the import reads: sub-processes and lanes may nest deeper than the call stack reaches.
  const sets: (ModdleElement | undefined)[] = [];
  for (const root of (rootElement.get("rootElements") as ModdleElement[] | undefined) ?? []) {
    if (root.$type !== "bpmn:Process") continue;
    counts.processes++;
    // Depth first, in the order of the file: an element, then what it holds, then its next sibling.
    const stack = [root];
    while (stack.length) {
      const el = stack.pop()!;
      if (el !== root) {
        if (el.$type === "bpmn:SequenceFlow") counts.flows++;
        else if (el.$type.endsWith("Gateway")) counts.gateways++;
        else if (el.$type.endsWith("Event")) counts.events++;
        else counts.tasks++;
        if (el.id && !withDi.has(el.id)) missingDi.push(el.id);
      }
      const inner = el.get("flowElements") as ModdleElement[] | undefined;
      if (!inner) continue;
      for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i]);
      for (const set of (el.get("laneSets") as ModdleElement[] | undefined) ?? []) sets.push(set);
    }
  }
  for (let set; sets.length; ) {
    set = sets.pop();
    for (const lane of (set?.get("lanes") as ModdleElement[] | undefined) ?? []) {
      counts.lanes++;
      sets.push(lane.get("childLaneSet") as ModdleElement | undefined);
    }
  }
  const messages = warnings.map((w) => w.message);
  return { ok: messages.length === 0 && missingDi.length === 0, warnings: messages, counts, missingDi };
}

/** The FlowGraph edges that the exporter turns into sequence flows (helper for callers that count). */
export function exportableEdges(graph: FlowGraph): FlowEdge[] {
  return graph.edges.filter((e) => e.kind !== "constraint");
}
