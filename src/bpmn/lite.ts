/** BPMN-lite: a BPMN-shaped graph in the FlowGraph vocabulary, from a directly-follows graph or a stage model. */
import {
  type AbstractOptions,
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type Metrics,
  abstract,
  hasTag,
  indexGraph,
  metric,
} from "../core/index.js";

export const START_ID = "__start";
export const END_ID = "__end";
export const TASK_TAG = "task";
export const LOOP_TAG = "loop";
export const GENERATED_TAG = "generated";

// ---------------------------------------------------------------------------
// Stage model

export interface StageActivity {
  id: string;
  label?: string;
  /** Role or resource that performs the activity; becomes a lane with `lanes: "role"`. */
  role?: string;
  /** The activity may be skipped (XOR bypass). */
  optional?: boolean;
  /** The activity may repeat (loop marker on the task). */
  loop?: boolean;
  tags?: string[];
  metrics?: Metrics;
}

export interface Stage {
  id: string;
  label?: string;
  /** Activities of the stage in process order; a string is an activity id used as label. */
  activities: (StageActivity | string)[];
  /** Default role of the stage's activities. */
  role?: string;
  /**
   * How the activities relate: a `sequence` in the listed order (default), a
   * `choice` (XOR: one of them), or `parallel` (AND: all of them, any order).
   */
  flow?: "sequence" | "choice" | "parallel";
  /** The whole stage may be skipped (XOR bypass). */
  optional?: boolean;
}

/** A process as a list of stages with their known activities, without any log. */
export interface StageModel {
  id?: string;
  label?: string;
  stages: Stage[];
}

export interface LiteFromStagesOptions {
  /** Which grouping becomes the lanes: the stages (default), the roles, or none. */
  lanes?: "stage" | "role" | "none";
  startLabel?: string;
  endLabel?: string;
}

interface Segment {
  entry: string;
  exit: string;
}

function activityOf(a: StageActivity | string): StageActivity {
  return typeof a === "string" ? { id: a, label: a } : a;
}

const XOR = "xor";
const AND = "and";

/** Label of a generated gateway from its tags: Choice / Merge (XOR), Parallel / Join (AND). */
export function gatewayLabel(tags: string[] | undefined): string {
  const and = tags?.includes(AND);
  const join = tags?.includes("join");
  return and ? (join ? "Join" : "Parallel") : join ? "Merge" : "Choice";
}

function gatewayNode(id: string, kind: "xor" | "and", role: "split" | "join", group: string | undefined): FlowNode {
  const tags = [kind, role, GENERATED_TAG];
  return { id, kind: "gateway", label: gatewayLabel(tags), group, tags };
}

function flowEdge(source: string, target: string, metrics?: Metrics, tags?: string[]): FlowEdge {
  const e: FlowEdge = { id: `${source}->${target}`, kind: "flow", source, target };
  if (metrics && Object.keys(metrics).length) e.metrics = metrics;
  if (tags && tags.length) e.tags = tags;
  return e;
}

/**
 * BPMN-lite graph from a stage model: one start event, the stages in order, one
 * end event. Gateways appear only where the model needs them: XOR split and
 * merge around a `choice` stage or an optional activity or stage, AND split and
 * join around a `parallel` stage. Lanes come from the stages or the roles.
 */
export function liteFromStages(model: StageModel, options: LiteFromStagesOptions = {}): FlowGraph {
  const lanes = options.lanes ?? "stage";
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const seen = new Set<string>();
  const laneOf = (stage: Stage, a?: StageActivity): string | undefined => {
    if (lanes === "stage") return stage.id;
    if (lanes === "role") return a?.role ?? stage.role;
    return undefined;
  };
  const addNode = (n: FlowNode) => {
    if (seen.has(n.id)) throw new Error(`liteFromStages: duplicate id ${n.id}`);
    seen.add(n.id);
    nodes.push(n);
  };
  const addGroup = (id: string | undefined, label: string) => {
    if (!id || groups.some((g) => g.id === id)) return;
    groups.push({ id, kind: "lane", label });
  };

  const segments: Segment[] = [];
  let firstLane: string | undefined;
  let lastLane: string | undefined;
  for (const stage of model.stages) {
    const activities = stage.activities.map(activityOf);
    if (activities.length === 0) continue;
    const stageLane = laneOf(stage);
    if (lanes === "stage") addGroup(stage.id, stage.label ?? stage.id);
    const taskIds: string[] = [];
    for (const a of activities) {
      const lane = laneOf(stage, a);
      if (lanes === "role") addGroup(lane, lane ?? "");
      const tags = [TASK_TAG, ...(a.tags ?? [])];
      if (a.loop) tags.push(LOOP_TAG);
      addNode({ id: a.id, kind: "activity", label: a.label ?? a.id, group: lane, metrics: a.metrics, tags });
      taskIds.push(a.id);
    }
    if (firstLane === undefined) firstLane = laneOf(stage, activities[0]);
    lastLane = laneOf(stage, activities[activities.length - 1]);

    const flow = stage.flow ?? "sequence";
    let segment: Segment;
    if (flow === "sequence" || activities.length === 1) {
      const parts: Segment[] = activities.map((a) => {
        if (!a.optional) return { entry: a.id, exit: a.id };
        const lane = laneOf(stage, a);
        const split = `gw_skip_${a.id}`;
        const join = `gw_merge_${a.id}`;
        addNode(gatewayNode(split, XOR, "split", lane));
        addNode(gatewayNode(join, XOR, "join", lane));
        edges.push(flowEdge(split, a.id), flowEdge(a.id, join), flowEdge(split, join, undefined, ["skip"]));
        return { entry: split, exit: join };
      });
      for (let i = 0; i + 1 < parts.length; i++) edges.push(flowEdge(parts[i].exit, parts[i + 1].entry));
      segment = { entry: parts[0].entry, exit: parts[parts.length - 1].exit };
    } else {
      const kind = flow === "parallel" ? AND : XOR;
      const split = `gw_${stage.id}_split`;
      const join = `gw_${stage.id}_join`;
      addNode(gatewayNode(split, kind, "split", stageLane ?? laneOf(stage, activities[0])));
      addNode(gatewayNode(join, kind, "join", stageLane ?? laneOf(stage, activities[activities.length - 1])));
      for (const id of taskIds) edges.push(flowEdge(split, id), flowEdge(id, join));
      segment = { entry: split, exit: join };
    }
    if (stage.optional) {
      const split = `gw_skip_${stage.id}`;
      const join = `gw_merge_${stage.id}`;
      addNode(gatewayNode(split, XOR, "split", stageLane ?? laneOf(stage, activities[0])));
      addNode(gatewayNode(join, XOR, "join", stageLane ?? laneOf(stage, activities[activities.length - 1])));
      edges.push(flowEdge(split, segment.entry), flowEdge(segment.exit, join), flowEdge(split, join, undefined, ["skip"]));
      segment = { entry: split, exit: join };
    }
    segments.push(segment);
  }

  const start: FlowNode = { id: START_ID, kind: "event", label: options.startLabel ?? "Start", group: firstLane, tags: ["start"] };
  const end: FlowNode = { id: END_ID, kind: "event", label: options.endLabel ?? "End", group: lastLane, tags: ["end"] };
  nodes.unshift(start);
  nodes.push(end);
  // A gateway in the lane of its stage's role that no activity has.
  if (lanes === "role") for (const n of nodes) addGroup(n.group, n.group ?? "");
  if (segments.length === 0) {
    edges.push(flowEdge(START_ID, END_ID));
  } else {
    edges.push(flowEdge(START_ID, segments[0].entry));
    for (let i = 0; i + 1 < segments.length; i++) edges.push(flowEdge(segments[i].exit, segments[i + 1].entry));
    edges.push(flowEdge(segments[segments.length - 1].exit, END_ID));
  }
  return {
    nodes,
    edges,
    groups: groups.length ? groups : undefined,
    meta: { bpmnLite: true, source: "stages", label: model.label ?? model.id, stages: model.stages.map((s) => s.id) },
  };
}

// ---------------------------------------------------------------------------
// From a FlowGraph

export interface LiteFromGraphOptions {
  /** Abstraction applied before the conversion (thresholds, collapse). */
  abstraction?: AbstractOptions;
  /**
   * Emit an AND split and an AND join as a pair around concurrent branches:
   * the successors of a node, when every pair of them directly follows each
   * other in both orders (how a directly-follows relation shows concurrency),
   * each is entered only from that node or another branch and left only to one
   * common node, and that node's predecessors are exactly these branches. The
   * paths between the branches become no flows. Every other split and join
   * stays XOR. Default: XOR only.
   */
  andGateways?: boolean;
  /** Groups of the graph become lanes (default) or are dropped. */
  lanes?: "groups" | "none";
  /** Self-loop paths become a loop marker on the task (default), a sequence flow, or are dropped. */
  selfLoops?: "marker" | "flow" | "drop";
}

function sumMetrics(edges: FlowEdge[]): Metrics {
  const out: Metrics = {};
  let count = 0;
  let cases = 0;
  let any = false;
  for (const e of edges) {
    const c = metric(e, "count", NaN);
    const k = metric(e, "cases", NaN);
    if (Number.isFinite(c)) {
      count += c;
      any = true;
    }
    if (Number.isFinite(k)) cases += k;
  }
  if (any) out.count = count;
  if (cases > 0) out.cases = cases;
  return out;
}

/**
 * BPMN-lite graph from a directly-follows FlowGraph: activities and stages
 * become tasks, paths become sequence flows, a node with several successors gets
 * an XOR split, a node with several predecessors an XOR join (an AND pair around
 * concurrent branches with `andGateways`), start and end events are kept or
 * added, groups become lanes. Sequence flows keep the metrics of the path they
 * replace and name it in `payload.origin`.
 */
export function liteFromGraph(graph: FlowGraph, options: LiteFromGraphOptions = {}): FlowGraph {
  const base = options.abstraction ? abstract(graph, options.abstraction) : graph;
  const lanes = options.lanes ?? "groups";
  const selfLoops = options.selfLoops ?? "marker";
  const groupIds = new Set((base.groups ?? []).map((g) => g.id));

  // Nodes: tasks from activities and stages, events and gateways as they are.
  const nodes: FlowNode[] = [];
  const loops = new Map<string, FlowEdge>();
  for (const e of base.edges) if (e.source === e.target && e.kind !== "constraint") loops.set(e.source, e);
  for (const n of base.nodes) {
    if (n.kind === "note") continue;
    const group = lanes === "groups" && n.group && groupIds.has(n.group) ? n.group : undefined;
    if (n.kind === "activity" || n.kind === "stage") {
      const tags = [...new Set([TASK_TAG, ...(n.tags ?? [])])];
      const metrics: Metrics = { ...(n.metrics ?? {}) };
      const loop = loops.get(n.id);
      if (loop && selfLoops === "marker") {
        tags.push(LOOP_TAG);
        const c = metric(loop, "count", NaN);
        if (Number.isFinite(c)) metrics.loopCount = c;
      }
      nodes.push({ id: n.id, kind: n.kind, label: n.label, group, metrics: Object.keys(metrics).length ? metrics : undefined, tags });
    } else {
      nodes.push({ ...n, group });
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Edges: paths and flows between kept nodes; constraints are overlays, not flows.
  let edges: FlowEdge[] = [];
  for (const e of base.edges) {
    if (e.kind === "constraint") continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) {
      if (selfLoops !== "flow") continue;
      edges.push({ ...e, kind: "flow", payload: { origin: e.id } });
      continue;
    }
    edges.push({ ...e, kind: "flow", payload: { ...(typeof e.payload === "object" && e.payload ? e.payload : {}), origin: e.id } });
  }

  // Start and end events.
  const idx = indexGraph({ nodes, edges });
  const hasStart = nodes.some((n) => n.kind === "event" && hasTag(n, "start"));
  const hasEnd = nodes.some((n) => n.kind === "event" && hasTag(n, "end"));
  const tasks = nodes.filter((n) => n.kind !== "event");
  const pick = (dir: "in" | "out", among = tasks): FlowNode[] => {
    const degree = (n: FlowNode) => (dir === "in" ? idx.incoming : idx.outgoing).get(n.id)?.filter((e) => e.source !== e.target).length ?? 0;
    const free = among.filter((n) => degree(n) === 0);
    if (free.length) return free;
    const key = dir === "in" ? "starts" : "ends";
    const marked = among.filter((n) => metric(n, key, 0) > 0);
    if (marked.length) return marked;
    const best = [...among].sort((a, b) => metric(b, "cases", 0) - metric(a, "cases", 0) || (a.id < b.id ? -1 : 1))[0];
    return best ? [best] : [];
  };
  const link = (dir: "in" | "out", event: string, targets: FlowNode[]) => {
    for (const t of targets) {
      const count = metric(t, dir === "in" ? "starts" : "ends", NaN) || metric(t, "cases", NaN);
      const m = Number.isFinite(count) ? { count } : undefined;
      edges.push(dir === "in" ? flowEdge(event, t.id, m) : flowEdge(t.id, event, m));
    }
  };
  if (!hasStart) {
    const targets = pick("in");
    nodes.unshift({ id: START_ID, kind: "event", label: "Start", group: targets[0]?.group, tags: ["start"] });
    link("in", START_ID, targets);
  }
  if (!hasEnd) {
    const sources = pick("out");
    nodes.push({ id: END_ID, kind: "event", label: "End", group: sources[sources.length - 1]?.group, tags: ["end"] });
    link("out", END_ID, sources);
  }
  // Every node on a path from a start to an end (or a node without outgoing flows):
  // what no start reaches is entered, and what reaches no end left, through `pick`'s nodes.
  for (const dir of ["in", "out"] as const) {
    const next = new Map<string, string[]>();
    for (const e of edges) {
      const [from, to] = dir === "in" ? [e.source, e.target] : [e.target, e.source];
      (next.get(from) ?? next.set(from, []).get(from)!).push(to);
    }
    const events = nodes.filter((n) => n.kind === "event" && hasTag(n, dir === "in" ? "start" : "end"));
    const sources = new Set(edges.map((e) => e.source));
    const seen = new Set<string>();
    const reach = (from: FlowNode[]) => {
      for (const n of from) seen.add(n.id);
      for (const id of seen) for (const m of next.get(id) ?? []) seen.add(m);
    };
    reach(dir === "in" ? events : [...events, ...nodes.filter((n) => !sources.has(n.id))]);
    for (let rest = nodes.filter((n) => !seen.has(n.id)); rest.length; rest = rest.filter((n) => !seen.has(n.id))) {
      const targets = pick(dir, rest);
      link(dir, events[0].id, targets);
      reach(targets);
    }
  }
  for (const n of nodes) {
    if (n.kind === "event" && !n.group && lanes === "groups") {
      const neighbour = hasTag(n, "end")
        ? edges.filter((e) => e.target === n.id).map((e) => nodes.find((m) => m.id === e.source))
        : edges.filter((e) => e.source === n.id).map((e) => nodes.find((m) => m.id === e.target));
      n.group = neighbour.find((m) => m?.group)?.group;
    }
  }

  // Gateways where a node has several successors or predecessors.
  // A self-loop flow leaves through the node's split and returns through its join.
  const flowLoops = selfLoops === "flow";
  const adjacency = (list: FlowEdge[], loops = false) => {
    const out = new Map<string, FlowEdge[]>();
    const inc = new Map<string, FlowEdge[]>();
    for (const e of list) {
      if (e.source === e.target && !loops) continue;
      if (!out.has(e.source)) out.set(e.source, []);
      if (!inc.has(e.target)) inc.set(e.target, []);
      out.get(e.source)!.push(e);
      inc.get(e.target)!.push(e);
    }
    return [out, inc] as const;
  };
  let [out, inc] = adjacency(edges);
  const direct = new Set(edges.map((e) => `${e.source} ${e.target}`));
  const concurrent = (ids: string[]): boolean => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!direct.has(`${ids[i]} ${ids[j]}`) || !direct.has(`${ids[j]} ${ids[i]}`)) return false;
      }
    }
    return ids.length > 1;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // AND only as a pair around concurrent branches; paths between them are no flows.
  const andSplits = new Set<string>();
  const andJoins = new Set<string>();
  const interleaved = new Set<FlowEdge>();
  if (options.andGateways) {
    for (const n of nodes) {
      const branches = (out.get(n.id) ?? []).map((e) => e.target);
      if (n.kind === "gateway" || (flowLoops && loops.has(n.id)) || !concurrent(branches)) continue;
      const block = new Set(branches);
      const exits = new Set<string>();
      let entered = true;
      for (const b of branches) {
        for (const e of out.get(b)!) if (!block.has(e.target)) exits.add(e.target);
        for (const e of inc.get(b)!) if (!block.has(e.source) && e.source !== n.id) entered = false;
      }
      const [join] = exits;
      const ins = inc.get(join)!;
      if (!entered || exits.size !== 1 || join === n.id || (flowLoops && loops.has(join)) || byId.get(join)!.kind === "gateway" || block.size < branches.length || ins.length !== block.size || branches.some((b) => !ins.some((e) => e.source === b))) continue;
      andSplits.add(n.id);
      andJoins.add(join);
      for (const b of branches) for (const e of out.get(b)!) if (block.has(e.target)) interleaved.add(e);
    }
    edges = edges.filter((e) => !interleaved.has(e));
  }
  [out, inc] = adjacency(edges, flowLoops);
  const splitOf = new Map<string, string>();
  const joinOf = new Map<string, string>();
  const gateways: FlowNode[] = [];
  const glue: FlowEdge[] = [];
  for (const n of nodes) {
    if (n.kind === "gateway") continue;
    const outs = out.get(n.id) ?? [];
    if (outs.length > 1) {
      const id = `gw_split_${n.id}`;
      gateways.push(gatewayNode(id, andSplits.has(n.id) ? AND : XOR, "split", n.group));
      splitOf.set(n.id, id);
      glue.push(flowEdge(n.id, id, sumMetrics(outs)));
    }
    const ins = inc.get(n.id) ?? [];
    if (ins.length > 1) {
      const id = `gw_join_${n.id}`;
      gateways.push(gatewayNode(id, andJoins.has(n.id) ? AND : XOR, "join", n.group));
      joinOf.set(n.id, id);
      glue.push(flowEdge(id, n.id, sumMetrics(ins)));
    }
  }
  // Two edges between the same nodes become two flows: the second id gets ":1", and so on.
  const taken = new Set(edges.map((e) => e.id));
  const rerouted: FlowEdge[] = edges.map((e) => {
    const s = splitOf.get(e.source) ?? e.source;
    const t = joinOf.get(e.target) ?? e.target;
    if (s === e.source && t === e.target) return e;
    let id = `${s}->${t}`;
    for (let n = 1; taken.has(id); n++) id = `${s}->${t}:${n}`;
    taken.add(id);
    return { ...e, id, source: s, target: t };
  });

  // Order: events first where they were, gateways next to the node they belong to.
  const ordered: FlowNode[] = [];
  for (const n of nodes) {
    const join = joinOf.get(n.id);
    if (join) ordered.push(gateways.find((g) => g.id === join)!);
    ordered.push(byId.get(n.id)!);
    const split = splitOf.get(n.id);
    if (split) ordered.push(gateways.find((g) => g.id === split)!);
  }

  const groups: FlowGroup[] | undefined =
    lanes === "groups" && base.groups?.length ? base.groups.map((g) => ({ id: g.id, kind: "lane" as const, label: g.label, parent: g.parent })) : undefined;
  return {
    nodes: ordered,
    edges: [...rerouted, ...glue],
    groups,
    overlays: base.overlays,
    meta: { ...(base.meta ?? {}), bpmnLite: true, source: "graph" },
  };
}

/**
 * Stage model derived from a FlowGraph with stage groups: the activities of
 * every stage in descending order of cases (or events), usable as the "known
 * activities" input when the log is not at hand.
 */
export function stageModelFromGraph(graph: FlowGraph, options: { limit?: number; label?: string } = {}): StageModel {
  const idx = indexGraph(graph);
  const stages: Stage[] = [];
  for (const g of graph.groups ?? []) {
    if (g.kind !== "stage" || g.parent) continue;
    const members = [...(idx.members.get(g.id) ?? [])]
      .filter((n) => n.kind === "activity")
      .sort((a, b) => metric(b, "cases", metric(b, "events", 0)) - metric(a, "cases", metric(a, "events", 0)) || (a.id < b.id ? -1 : 1))
      .slice(0, options.limit ?? Infinity);
    if (!members.length) continue;
    stages.push({ id: g.id, label: g.label, activities: members.map((n) => ({ id: n.id, label: n.label, metrics: n.metrics, tags: n.tags })) });
  }
  return { label: options.label ?? (typeof graph.meta?.label === "string" ? graph.meta.label : undefined), stages };
}

/** Counts of the BPMN-lite element kinds, for checks and captions. */
export function liteCounts(graph: FlowGraph): { tasks: number; gateways: number; events: number; flows: number; lanes: number } {
  return {
    tasks: graph.nodes.filter((n) => n.kind === "activity" || n.kind === "stage").length,
    gateways: graph.nodes.filter((n) => n.kind === "gateway").length,
    events: graph.nodes.filter((n) => n.kind === "event").length,
    flows: graph.edges.filter((e) => e.kind === "flow").length,
    lanes: (graph.groups ?? []).length,
  };
}
