/**
 * BPMN 2.0 import: bpmn-moddle → FlowGraph (tasks → activity nodes, gateways,
 * events, lanes and pools → groups, expanded sub-processes → stage groups,
 * sequence flows → flow edges), positions from the diagram interchange, and a
 * task ↔ activity mapping table that the caller fills by id and by label.
 */
import { type Box, type EdgeRoute, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Metrics, type Positions, positionsBounds } from "../core/index.js";
import type { IdMap } from "./export.js";
import { GENERATED_TAG, gatewayLabel } from "./lite.js";
import { type ModdleElement, createModdle, flowIdOf, isType, tagOfType, wiseAttr } from "./moddle.js";

/** An activity the mapping can point at (canonical activity of a norm or a log label). */
export interface ActivityRef {
  id: string;
  label?: string;
  aliases?: string[];
}

/** One row of the task ↔ activity mapping table. */
export interface MappingRow {
  /** BPMN element id. */
  taskId: string;
  /** Node id in the imported FlowGraph (`wise:flowId` when present). */
  nodeId: string;
  label: string;
  /** BPMN type, e.g. `bpmn:UserTask`. */
  type: string;
  lane?: string;
  /** Filled by `matchActivities` or by hand. */
  activityId?: string;
  matchedBy?: "id" | "label" | "alias" | "manual";
}

export interface ImportBpmnOptions {
  /** Activities to match the tasks against (by id, then by label and aliases). */
  activities?: ActivityRef[];
  /** Read positions from the DI. Default true. */
  positions?: boolean;
  /** Use `wise:flowId` as node id when present (round trip). Default true. */
  keepIds?: boolean;
  /** Expanded sub-processes become stage groups (default) or activity nodes. */
  subProcesses?: "stage" | "activity";
  /** Label normalisation used by the matcher. */
  normalize?: (s: string) => string;
}

export interface BpmnImport {
  graph: FlowGraph;
  mapping: MappingRow[];
  positions?: Positions;
  warnings: string[];
  ids: IdMap;
  /** Id of the BPMN process the graph came from (the first one). */
  processId?: string;
}

const EVENT_TAGS: [string, string][] = [
  ["bpmn:TimerEventDefinition", "timer"],
  ["bpmn:MessageEventDefinition", "message"],
  ["bpmn:ErrorEventDefinition", "error"],
  ["bpmn:SignalEventDefinition", "signal"],
  ["bpmn:EscalationEventDefinition", "escalation"],
  ["bpmn:TerminateEventDefinition", "terminate"],
  ["bpmn:ConditionalEventDefinition", "conditional"],
];

function metricsOf(el: ModdleElement): Metrics | undefined {
  const ext = el.get("extensionElements") as ModdleElement | undefined;
  const values = (ext?.get("values") as ModdleElement[] | undefined) ?? [];
  const out: Metrics = {};
  let any = false;
  for (const v of values) {
    const type = v.$type.toLowerCase();
    if (type !== "wise:metric") continue;
    const name = (v.get("name") as string | undefined) ?? v.$attrs?.name;
    const raw = v.get("value") ?? v.$attrs?.value;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (name && Number.isFinite(value)) {
      out[name] = value;
      any = true;
    }
  }
  return any ? out : undefined;
}

function tagsOf(el: ModdleElement, derived: string[]): string[] | undefined {
  const stored = wiseAttr(el, "tags");
  const tags = stored ? stored.split(/\s+/).filter(Boolean) : [];
  const all = [...new Set([...derived, ...tags])];
  return all.length ? all : undefined;
}

function nodeOf(el: ModdleElement, keepIds: boolean): FlowNode | undefined {
  const id = keepIds ? flowIdOf(el) : String(el.id);
  const label = (el.get("name") as string | undefined) ?? (el.get("text") as string | undefined) ?? String(el.id ?? id);
  const storedKind = wiseAttr(el, "kind") as FlowNode["kind"] | undefined;
  const metrics = metricsOf(el);
  if (isType(el, "bpmn:Gateway")) {
    const kind = isType(el, "bpmn:ParallelGateway") ? "and" : isType(el, "bpmn:InclusiveGateway") ? "or" : isType(el, "bpmn:EventBasedGateway") ? "eventBased" : isType(el, "bpmn:ComplexGateway") ? "complex" : "xor";
    const tags = tagsOf(el, [kind]);
    // Generated gateways are exported without a name; their label follows from the tags.
    const generated = !el.get("name") && tags?.includes(GENERATED_TAG);
    return { id, kind: storedKind ?? "gateway", label: generated ? gatewayLabel(tags) : label, metrics, tags };
  }
  if (isType(el, "bpmn:Event")) {
    const role = isType(el, "bpmn:StartEvent") ? "start" : isType(el, "bpmn:EndEvent") ? "end" : isType(el, "bpmn:BoundaryEvent") ? "boundary" : "intermediate";
    const derived = [role];
    if (isType(el, "bpmn:IntermediateCatchEvent")) derived.push("catch");
    for (const d of (el.get("eventDefinitions") as ModdleElement[] | undefined) ?? []) {
      const tag = EVENT_TAGS.find(([type]) => isType(d, type))?.[1];
      if (tag) derived.push(tag);
    }
    return { id, kind: storedKind ?? "event", label, metrics, tags: tagsOf(el, derived) };
  }
  if (isType(el, "bpmn:TextAnnotation")) {
    return { id, kind: storedKind ?? "note", label, metrics, tags: tagsOf(el, []) };
  }
  if (isType(el, "bpmn:Activity")) {
    const derived = ["task"];
    const tag = tagOfType(el.$type);
    if (tag !== "task") derived.push(tag);
    if (el.get("loopCharacteristics")) derived.push("loop");
    return { id, kind: storedKind ?? "activity", label, metrics, tags: tagsOf(el, derived) };
  }
  return undefined;
}

/**
 * Parse BPMN 2.0 XML into a FlowGraph. Every task-like element (tasks of all
 * types, call activities, collapsed sub-processes) becomes an activity node and
 * a row of the mapping table; lanes, pools and expanded sub-processes become
 * groups; sequence flows become flow edges with the flow's name and condition
 * in `payload`. Positions come from the DI when present.
 */
export async function importBpmn(xml: string, options: ImportBpmnOptions = {}): Promise<BpmnImport> {
  const keepIds = options.keepIds ?? true;
  const moddle = createModdle();
  const { rootElement, warnings: parseWarnings } = await moddle.fromXML(xml);
  const warnings = parseWarnings.map((w) => w.message);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const ids: IdMap = { toBpmn: {}, toFlow: {} };
  const elementNode = new Map<string, FlowNode>();
  const groupById = new Map<string, FlowGroup>();
  const mapping: MappingRow[] = [];
  const bpmnIdOfNode = new Map<string, string>();
  let processId: string | undefined;

  const register = (bpmnId: string, flowId: string) => {
    ids.toBpmn[flowId] = bpmnId;
    ids.toFlow[bpmnId] = flowId;
  };
  const groupIdOf = (el: ModdleElement) => (keepIds ? flowIdOf(el) : String(el.id));

  // Pools: a participant with a process becomes a pool group.
  const poolOfProcess = new Map<string, string>();
  for (const root of (rootElement.get("rootElements") as ModdleElement[]) ?? []) {
    if (!isType(root, "bpmn:Collaboration")) continue;
    for (const p of (root.get("participants") as ModdleElement[]) ?? []) {
      const gid = groupIdOf(p);
      const g: FlowGroup = { id: gid, kind: "pool", label: (p.get("name") as string | undefined) ?? gid };
      groups.push(g);
      groupById.set(gid, g);
      register(String(p.id), gid);
      const ref = p.get("processRef") as ModdleElement | undefined;
      if (ref?.id) poolOfProcess.set(String(ref.id), gid);
    }
  }

  const laneOfNode = new Map<string, string>();
  const readLanes = (laneSet: ModdleElement | undefined, parent: string | undefined) => {
    for (const lane of (laneSet?.get("lanes") as ModdleElement[] | undefined) ?? []) {
      const gid = groupIdOf(lane);
      const kind = (wiseAttr(lane, "kind") as FlowGroup["kind"] | undefined) ?? "lane";
      const g: FlowGroup = { id: gid, kind, label: (lane.get("name") as string | undefined) ?? gid, parent };
      groups.push(g);
      groupById.set(gid, g);
      register(String(lane.id), gid);
      for (const ref of (lane.get("flowNodeRef") as ModdleElement[] | undefined) ?? []) if (ref?.id) laneOfNode.set(String(ref.id), gid);
      readLanes(lane.get("childLaneSet") as ModdleElement | undefined, gid);
    }
  };

  const visit = (container: ModdleElement, parentGroup: string | undefined) => {
    for (const set of (container.get("laneSets") as ModdleElement[] | undefined) ?? []) readLanes(set, parentGroup);
    const elements = (container.get("flowElements") as ModdleElement[] | undefined) ?? [];
    for (const el of elements) {
      if (isType(el, "bpmn:SequenceFlow")) continue;
      const expanded = isType(el, "bpmn:SubProcess") && ((el.get("flowElements") as ModdleElement[] | undefined)?.length ?? 0) > 0;
      if (expanded && (options.subProcesses ?? "stage") === "stage") {
        const gid = groupIdOf(el);
        const g: FlowGroup = { id: gid, kind: "stage", label: (el.get("name") as string | undefined) ?? gid, parent: laneOfNode.get(String(el.id)) ?? parentGroup };
        groups.push(g);
        groupById.set(gid, g);
        register(String(el.id), gid);
        visit(el, gid);
        continue;
      }
      const node = nodeOf(el, keepIds);
      if (!node) continue;
      node.group = laneOfNode.get(String(el.id)) ?? parentGroup;
      nodes.push(node);
      elementNode.set(String(el.id), node);
      bpmnIdOfNode.set(node.id, String(el.id));
      register(String(el.id), node.id);
      if (isType(el, "bpmn:Activity")) {
        mapping.push({ taskId: String(el.id), nodeId: node.id, label: node.label, type: el.$type, lane: node.group });
      }
    }
    for (const el of (container.get("artifacts") as ModdleElement[] | undefined) ?? []) {
      if (!isType(el, "bpmn:TextAnnotation")) continue;
      const node = nodeOf(el, keepIds);
      if (!node) continue;
      node.group = parentGroup;
      nodes.push(node);
      elementNode.set(String(el.id), node);
      register(String(el.id), node.id);
    }
    for (const el of elements) {
      if (!isType(el, "bpmn:SequenceFlow")) continue;
      const source = elementNode.get(String((el.get("sourceRef") as ModdleElement | undefined)?.id));
      const target = elementNode.get(String((el.get("targetRef") as ModdleElement | undefined)?.id));
      if (!source || !target) {
        warnings.push(`sequence flow ${el.id} has an endpoint that is not a flow node`);
        continue;
      }
      const id = keepIds ? flowIdOf(el) : String(el.id);
      const derived: string[] = [];
      const sourceEl = el.get("sourceRef") as ModdleElement;
      if ((sourceEl.get("default") as ModdleElement | undefined)?.id === el.id) derived.push("default");
      const condition = el.get("conditionExpression") as ModdleElement | undefined;
      if (condition) derived.push("conditional");
      const payload: Record<string, unknown> = { bpmnId: el.id };
      const name = el.get("name") as string | undefined;
      if (name) payload.label = name;
      const body = condition?.get("body") as string | undefined;
      if (body) payload.condition = body;
      const storedKind = wiseAttr(el, "kind") as FlowEdge["kind"] | undefined;
      edges.push({ id, kind: storedKind ?? "flow", source: source.id, target: target.id, metrics: metricsOf(el), tags: tagsOf(el, derived), payload });
      register(String(el.id), id);
    }
    for (const el of (container.get("artifacts") as ModdleElement[] | undefined) ?? []) {
      if (!isType(el, "bpmn:Association")) continue;
      const source = elementNode.get(String((el.get("sourceRef") as ModdleElement | undefined)?.id));
      const target = elementNode.get(String((el.get("targetRef") as ModdleElement | undefined)?.id));
      if (!source || !target) continue;
      const id = keepIds ? flowIdOf(el) : String(el.id);
      edges.push({ id, kind: "flow", source: source.id, target: target.id, tags: ["association"], payload: { bpmnId: el.id } });
      register(String(el.id), id);
    }
  };

  for (const root of (rootElement.get("rootElements") as ModdleElement[]) ?? []) {
    if (!isType(root, "bpmn:Process")) continue;
    processId ??= String(root.id);
    visit(root, poolOfProcess.get(String(root.id)));
  }
  // Message flows between flow nodes of different pools.
  for (const root of (rootElement.get("rootElements") as ModdleElement[]) ?? []) {
    if (!isType(root, "bpmn:Collaboration")) continue;
    for (const mf of (root.get("messageFlows") as ModdleElement[] | undefined) ?? []) {
      const source = elementNode.get(String((mf.get("sourceRef") as ModdleElement | undefined)?.id));
      const target = elementNode.get(String((mf.get("targetRef") as ModdleElement | undefined)?.id));
      if (!source || !target) continue;
      const id = keepIds ? flowIdOf(mf) : String(mf.id);
      edges.push({ id, kind: "flow", source: source.id, target: target.id, tags: ["message"], payload: { bpmnId: mf.id, label: mf.get("name") } });
      register(String(mf.id), id);
    }
  }

  const graph: FlowGraph = {
    nodes,
    edges,
    groups: groups.length ? groups : undefined,
    meta: {
      source: "bpmn",
      bpmnLite: true,
      label: processName(rootElement),
      definitionsId: rootElement.id,
      processId,
    },
  };
  const positions = (options.positions ?? true) ? positionsFromDi(rootElement, ids) : undefined;
  const rows = options.activities ? matchActivities(mapping, options.activities, { normalize: options.normalize }) : mapping;
  return { graph, mapping: rows, positions, warnings, ids, processId };
}

function processName(definitions: ModdleElement): string | undefined {
  for (const root of (definitions.get("rootElements") as ModdleElement[]) ?? []) {
    if (isType(root, "bpmn:Collaboration")) {
      const p = ((root.get("participants") as ModdleElement[]) ?? [])[0];
      const name = p?.get("name") as string | undefined;
      if (name) return name;
    }
  }
  for (const root of (definitions.get("rootElements") as ModdleElement[]) ?? []) {
    if (isType(root, "bpmn:Process")) {
      const name = root.get("name") as string | undefined;
      if (name) return name;
    }
  }
  return undefined;
}

/** Positions of the first BPMNDiagram of the definitions, keyed by FlowGraph ids. */
export function positionsFromDi(definitions: ModdleElement, ids: IdMap): Positions | undefined {
  const diagrams = (definitions.get("diagrams") as ModdleElement[] | undefined) ?? [];
  const plane = diagrams[0]?.get("plane") as ModdleElement | undefined;
  if (!plane) return undefined;
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  for (const p of (plane.get("planeElement") as ModdleElement[] | undefined) ?? []) {
    const target = p.get("bpmnElement") as ModdleElement | undefined;
    if (!target?.id) continue;
    const flowId = ids.toFlow[String(target.id)] ?? String(target.id);
    if (p.$type === "bpmndi:BPMNShape") {
      const b = p.get("bounds") as ModdleElement | undefined;
      if (!b) continue;
      const box: Box = { x: Number(b.get("x")), y: Number(b.get("y")), width: Number(b.get("width")), height: Number(b.get("height")) };
      const isGroup = isType(target, "bpmn:Lane") || isType(target, "bpmn:Participant") || (isType(target, "bpmn:SubProcess") && ((target.get("flowElements") as ModdleElement[] | undefined)?.length ?? 0) > 0);
      if (isGroup) groups[flowId] = box;
      else nodes[flowId] = box;
    } else if (p.$type === "bpmndi:BPMNEdge") {
      const pts = ((p.get("waypoint") as ModdleElement[] | undefined) ?? []).map((w) => ({ x: Number(w.get("x")), y: Number(w.get("y")) }));
      if (pts.length >= 2) edges[flowId] = { points: pts };
    }
  }
  if (!Object.keys(nodes).length) return undefined;
  const partial = { nodes, groups, edges };
  return { ...partial, bounds: positionsBounds(partial), engine: "di", direction: "RIGHT" };
}

// ---------------------------------------------------------------------------
// Mapping

/** Lower-case, trimmed, punctuation and separators collapsed to single spaces. */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fill the mapping table: a task matches an activity when the task id or the
 * node id equals the activity id (normalised), else when the label equals the
 * activity's label or one of its aliases (normalised). Rows already filled by
 * hand (`matchedBy: "manual"`) are kept.
 */
export function matchActivities(mapping: MappingRow[], activities: ActivityRef[], options: { normalize?: (s: string) => string } = {}): MappingRow[] {
  const norm = options.normalize ?? normalizeLabel;
  const byId = new Map<string, ActivityRef>();
  const byLabel = new Map<string, ActivityRef>();
  const byAlias = new Map<string, ActivityRef>();
  for (const a of activities) {
    byId.set(norm(a.id), a);
    if (a.label) byLabel.set(norm(a.label), a);
    for (const alias of a.aliases ?? []) byAlias.set(norm(alias), a);
  }
  return mapping.map((row) => {
    if (row.matchedBy === "manual" && row.activityId) return row;
    const id = byId.get(norm(row.nodeId)) ?? byId.get(norm(row.taskId));
    if (id) return { ...row, activityId: id.id, matchedBy: "id" };
    const label = byLabel.get(norm(row.label));
    if (label) return { ...row, activityId: label.id, matchedBy: "label" };
    const alias = byAlias.get(norm(row.label));
    if (alias) return { ...row, activityId: alias.id, matchedBy: "alias" };
    return { ...row, activityId: undefined, matchedBy: undefined };
  });
}

/** Mapping as a plain object: activity id → task node ids and the inverse. */
export function mappingIndex(mapping: MappingRow[] | Record<string, string>): { toTasks: Record<string, string[]>; toActivity: Record<string, string> } {
  const toTasks: Record<string, string[]> = {};
  const toActivity: Record<string, string> = {};
  const add = (task: string, activity: string) => {
    (toTasks[activity] ??= []).push(task);
    toActivity[task] = activity;
  };
  if (Array.isArray(mapping)) {
    for (const row of mapping) if (row.activityId) add(row.nodeId, row.activityId);
  } else {
    for (const [activity, task] of Object.entries(mapping)) add(task, activity);
  }
  return { toTasks, toActivity };
}

/**
 * Rename the mapped tasks of an imported graph to their activity ids (the ids
 * overlays and statistics use), keeping the BPMN id in `meta.bpmnIds`. Unmapped
 * tasks keep their ids. When two tasks map to one activity the first keeps the
 * activity id and the others get `<activity>#2`, `#3`, so ids stay unique.
 */
export function applyMapping(graph: FlowGraph, mapping: MappingRow[] | Record<string, string>): FlowGraph {
  const { toActivity } = mappingIndex(mapping);
  const rename = new Map<string, string>();
  const used = new Set(graph.nodes.map((n) => n.id));
  const taken = new Map<string, number>();
  for (const n of graph.nodes) {
    const activity = toActivity[n.id];
    if (!activity || activity === n.id) continue;
    const count = (taken.get(activity) ?? 0) + 1;
    taken.set(activity, count);
    let target = count === 1 ? activity : `${activity}#${count}`;
    while (used.has(target) && target !== n.id) target = `${target}_`;
    used.add(target);
    rename.set(n.id, target);
  }
  if (!rename.size) return graph;
  const r = (id: string) => rename.get(id) ?? id;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (rename.has(n.id) ? { ...n, id: r(n.id) } : n)),
    edges: graph.edges.map((e) => (rename.has(e.source) || rename.has(e.target) ? { ...e, source: r(e.source), target: r(e.target) } : e)),
    overlays: graph.overlays?.map((o) => ({ ...o, target: r(o.target), payload: o.payload ? { ...o.payload, source: o.payload.source ? r(String(o.payload.source)) : o.payload.source, target: o.payload.target ? r(String(o.payload.target)) : o.payload.target } : o.payload })),
    meta: { ...(graph.meta ?? {}), bpmnIds: Object.fromEntries([...rename].map(([from, to]) => [to, from])) },
  };
}
