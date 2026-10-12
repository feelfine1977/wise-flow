/** BPMN 2.0 import: a FlowGraph, positions from the diagram interchange, and a task ↔ activity mapping table. */
import { type Box, type EdgeRoute, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Metrics, type Positions, createPositions, validateGraph } from "../core/index.js";
import { type ActivityMapping, type ActivityRenaming, type IdMap, createIdMap, createIdResolver, registerId, renameToActivities } from "./ids.js";
import { type ModdleElement, createModdle, flowIdOf, isType, tagOfType, wiseAttr } from "./moddle.js";
import { BPMN_VOCABULARY as V, eventDefinitionTag, eventTags, gatewayTag, importedGatewayLabel } from "./vocabulary.js";

export { mappingIndex } from "./ids.js";

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

function nodeOf(el: ModdleElement, id: string): FlowNode | undefined {
  const label = (el.get("name") as string | undefined) ?? (el.get("text") as string | undefined) ?? String(el.id ?? id);
  const storedKind = wiseAttr(el, "kind") as FlowNode["kind"] | undefined;
  const metrics = metricsOf(el);
  if (isType(el, "bpmn:Gateway")) {
    const tags = tagsOf(el, [gatewayTag(el)]);
    return { id, kind: storedKind ?? "gateway", label: importedGatewayLabel(el.get("name") as string | undefined, tags, label), metrics, tags };
  }
  if (isType(el, "bpmn:Event")) {
    const derived = eventTags(el);
    for (const d of (el.get("eventDefinitions") as ModdleElement[] | undefined) ?? []) {
      const tag = eventDefinitionTag(d);
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
    if (el.get("loopCharacteristics")) derived.push(V.loop[0]);
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
  const ids = createIdMap();
  // Keyed by element, as references resolve: an element may have no id.
  const elementNode = new Map<ModdleElement | undefined, FlowNode>();
  const groupById = new Map<string, FlowGroup>();
  const mapping: MappingRow[] = [];
  let processId: string | undefined;

  const register = (bpmnId: string, flowId: string) => registerId(ids, bpmnId, flowId);
  // The FlowGraph id an element gets: its own (`wise:flowId` or XML id), or the XML id without `keepIds`.
  const idOf = (el: ModdleElement) => (keepIds ? flowIdOf(el) : String(el.id));

  // Pools: a participant with a process becomes a pool group.
  const poolOfProcess = new Map<ModdleElement | undefined, string>();
  for (const root of (rootElement.get("rootElements") as ModdleElement[]) ?? []) {
    if (!isType(root, "bpmn:Collaboration")) continue;
    for (const p of (root.get("participants") as ModdleElement[]) ?? []) {
      const gid = idOf(p);
      const g: FlowGroup = { id: gid, kind: "pool", label: (p.get("name") as string | undefined) ?? gid };
      groups.push(g);
      groupById.set(gid, g);
      register(String(p.id), gid);
      poolOfProcess.set(p.get("processRef") as ModdleElement | undefined, gid);
    }
  }

  const laneOfNode = new Map<ModdleElement, string>();
  const readLanes = function* (laneSet: ModdleElement | undefined, parent: string | undefined): Nested<[ModdleElement | undefined, string | undefined]> {
    for (const lane of (laneSet?.get("lanes") as ModdleElement[] | undefined) ?? []) {
      const gid = idOf(lane);
      const kind = (wiseAttr(lane, "kind") as FlowGroup["kind"] | undefined) ?? "lane";
      const g: FlowGroup = { id: gid, kind, label: (lane.get("name") as string | undefined) ?? gid, parent };
      groups.push(g);
      groupById.set(gid, g);
      register(String(lane.id), gid);
      for (const ref of (lane.get("flowNodeRef") as ModdleElement[] | undefined) ?? []) laneOfNode.set(ref, gid);
      yield [lane.get("childLaneSet") as ModdleElement | undefined, gid];
    }
  };

  const visit = function* (container: ModdleElement, parentGroup: string | undefined): Nested<[ModdleElement, string | undefined]> {
    for (const set of (container.get("laneSets") as ModdleElement[] | undefined) ?? []) walk(readLanes, set, parentGroup);
    const elements = (container.get("flowElements") as ModdleElement[] | undefined) ?? [];
    for (const el of elements) {
      if (isType(el, "bpmn:SequenceFlow")) continue;
      const expanded = isType(el, "bpmn:SubProcess") && ((el.get("flowElements") as ModdleElement[] | undefined)?.length ?? 0) > 0;
      if (expanded && (options.subProcesses ?? "stage") === "stage") {
        const gid = idOf(el);
        const g: FlowGroup = { id: gid, kind: "stage", label: (el.get("name") as string | undefined) ?? gid, parent: laneOfNode.get(el) ?? parentGroup };
        groups.push(g);
        groupById.set(gid, g);
        register(String(el.id), gid);
        yield [el, gid];
        continue;
      }
      const node = nodeOf(el, idOf(el));
      if (!node) continue;
      node.group = laneOfNode.get(el) ?? parentGroup;
      nodes.push(node);
      elementNode.set(el, node);
      register(String(el.id), node.id);
      if (isType(el, "bpmn:Activity")) {
        mapping.push({ taskId: String(el.id), nodeId: node.id, label: node.label, type: el.$type, lane: node.group });
      }
    }
    for (const el of (container.get("artifacts") as ModdleElement[] | undefined) ?? []) {
      if (!isType(el, "bpmn:TextAnnotation")) continue;
      const node = nodeOf(el, idOf(el));
      if (!node) continue;
      node.group = parentGroup;
      nodes.push(node);
      elementNode.set(el, node);
      register(String(el.id), node.id);
    }
    for (const el of elements) {
      if (!isType(el, "bpmn:SequenceFlow")) continue;
      const sourceEl = el.get("sourceRef") as ModdleElement;
      const source = elementNode.get(sourceEl);
      const target = elementNode.get(el.get("targetRef") as ModdleElement | undefined);
      if (!source || !target) {
        warnings.push(`sequence flow ${el.id} has an endpoint that is not a flow node`);
        continue;
      }
      const id = idOf(el);
      const derived: string[] = [];
      if (sourceEl.get("default") === el) derived.push(V.defaultFlow);
      const condition = el.get("conditionExpression") as ModdleElement | undefined;
      if (condition) derived.push(V.conditionalFlow);
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
      const source = elementNode.get(el.get("sourceRef") as ModdleElement | undefined);
      const target = elementNode.get(el.get("targetRef") as ModdleElement | undefined);
      if (!source || !target) continue;
      const id = idOf(el);
      edges.push({ id, kind: "flow", source: source.id, target: target.id, tags: ["association"], payload: { bpmnId: el.id } });
      register(String(el.id), id);
    }
  };

  for (const root of (rootElement.get("rootElements") as ModdleElement[]) ?? []) {
    if (!isType(root, "bpmn:Process")) continue;
    processId ??= String(root.id);
    walk(visit, root, poolOfProcess.get(root));
  }
  // Message flows between flow nodes of different pools.
  for (const root of (rootElement.get("rootElements") as ModdleElement[]) ?? []) {
    if (!isType(root, "bpmn:Collaboration")) continue;
    for (const mf of (root.get("messageFlows") as ModdleElement[] | undefined) ?? []) {
      const source = elementNode.get(mf.get("sourceRef") as ModdleElement | undefined);
      const target = elementNode.get(mf.get("targetRef") as ModdleElement | undefined);
      if (!source || !target) continue;
      const id = idOf(mf);
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
  // What the validation rejects (two elements with one FlowGraph id) is reported.
  for (const issue of validateGraph(graph)) warnings.push(`${issue.message}: ${issue.id}`);
  const positions = (options.positions ?? true) ? positionsFromDi(rootElement, ids, warnings) : undefined;
  const rows = options.activities ? matchActivities(mapping, options.activities, { normalize: options.normalize }) : mapping;
  return { graph, mapping: rows, positions, warnings, ids, processId };
}

/** A reader that yields its nested calls; `walk` makes them on a stack of its own, as elements may nest deeper than calls. */
type Nested<A extends unknown[]> = Generator<A, void>;

function walk<A extends unknown[]>(read: (...args: A) => Nested<A>, ...args: A): void {
  const stack = [read(...args)];
  while (stack.length) {
    const step = stack[stack.length - 1].next();
    if (step.done) stack.pop();
    else stack.push(read(...step.value));
  }
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

/**
 * Positions of the first BPMNDiagram of the definitions, keyed by FlowGraph ids. Shapes and
 * routes whose numbers are not finite, or all of a diagram whose extent is not, are left out
 * and reported in `warnings`.
 */
export function positionsFromDi(definitions: ModdleElement, ids: IdMap, warnings: string[] = []): Positions | undefined {
  const diagrams = (definitions.get("diagrams") as ModdleElement[] | undefined) ?? [];
  const plane = diagrams[0]?.get("plane") as ModdleElement | undefined;
  if (!plane) return undefined;
  const resolver = createIdResolver({ ids });
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  const finite = (...ns: number[]) => ns.every(Number.isFinite);
  for (const p of (plane.get("planeElement") as ModdleElement[] | undefined) ?? []) {
    const target = p.get("bpmnElement") as ModdleElement | undefined;
    if (!target?.id) continue;
    const flowId = resolver.flowId(String(target.id));
    if (p.$type === "bpmndi:BPMNShape") {
      const b = p.get("bounds") as ModdleElement | undefined;
      if (!b) continue;
      const box: Box = { x: Number(b.get("x")), y: Number(b.get("y")), width: Number(b.get("width")), height: Number(b.get("height")) };
      if (!finite(box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height)) {
        warnings.push(`shape of ${flowId} has coordinates that are not finite numbers`);
        continue;
      }
      const isGroup = isType(target, "bpmn:Lane") || isType(target, "bpmn:Participant") || (isType(target, "bpmn:SubProcess") && ((target.get("flowElements") as ModdleElement[] | undefined)?.length ?? 0) > 0);
      if (isGroup) groups[flowId] = box;
      else nodes[flowId] = box;
    } else if (p.$type === "bpmndi:BPMNEdge") {
      const pts = ((p.get("waypoint") as ModdleElement[] | undefined) ?? []).map((w) => ({ x: Number(w.get("x")), y: Number(w.get("y")) }));
      if (!pts.every((q) => finite(q.x, q.y))) warnings.push(`route of ${flowId} has coordinates that are not finite numbers`);
      else if (pts.length >= 2) edges[flowId] = { points: pts };
    }
  }
  if (!Object.keys(nodes).length) return undefined;
  const positions = createPositions({ nodes, groups, edges }, "di", "RIGHT");
  const b = positions.bounds;
  if (finite(b.x, b.y, b.width, b.height)) return positions;
  warnings.push("the diagram's extent is not a finite number; its positions are left out");
  return undefined;
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

/**
 * Rename the mapped tasks of an imported graph to their activity ids (the ids
 * overlays and statistics use), keeping the BPMN id in `meta.bpmnIds`. Unmapped
 * tasks keep their ids. When two tasks map to one activity the first keeps the
 * activity id and the others get `<activity>#2`, `#3`, so ids stay unique.
 */
export function applyMapping(graph: FlowGraph, mapping: ActivityMapping): FlowGraph {
  return applyRenaming(graph, renameToActivities(graph.nodes.map((n) => n.id), createIdResolver({ mapping })));
}

/** Apply a renaming of node ids to a graph, as `applyMapping` does. */
export function applyRenaming(graph: FlowGraph, renaming: ActivityRenaming): FlowGraph {
  const rename = renaming.renamed;
  if (!rename.size) return graph;
  const r = renaming.toMapped;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (rename.has(n.id) ? { ...n, id: r(n.id) } : n)),
    edges: graph.edges.map((e) => (rename.has(e.source) || rename.has(e.target) ? { ...e, source: r(e.source), target: r(e.target) } : e)),
    overlays: graph.overlays?.map((o) => ({ ...o, target: r(o.target), payload: o.payload ? { ...o.payload, source: o.payload.source ? r(String(o.payload.source)) : o.payload.source, target: o.payload.target ? r(String(o.payload.target)) : o.payload.target } : o.payload })),
    meta: { ...(graph.meta ?? {}), bpmnIds: Object.fromEntries([...rename].map(([from, to]) => [to, from])) },
  };
}
