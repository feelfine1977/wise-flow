/**
 * Seeded graph families for searching tests. Each family takes a size and a
 * seed and returns the same `FlowGraph` for the same arguments; ids are
 * `n<i>` for nodes, `<source>-><target>` for edges and `g<i>` for groups, so
 * a case prints as its family, size and seed.
 *
 * `families` are valid graphs (structure, metrics and labels) and are tested
 * for their defining property; `invalidFamilies` plant defects on purpose and
 * say which, so a test can check that validation reports each one.
 */
import { type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Metrics, type Overlay, MAP_TARGET } from "../../src/index";
import { type Random, createRandom } from "./random";

export interface GraphOptions {
  /** Multiplies every count and case number, so that counts span magnitudes with the same shape. Default 1. */
  scale?: number;
  /** Sprinkle start and end events, gateways and notes among the activities. Default false: activities only. */
  mixedKinds?: boolean;
}

export type GraphFamily = (size: number, seed: number, options?: GraphOptions) => FlowGraph;

const CASES_MAX = 1000;

function count(rng: Random, max: number, scale: number): number {
  return Math.max(1, Math.round(rng.int(1, max) * scale));
}

function nodeMetrics(rng: Random, scale: number): Metrics {
  const cases = count(rng, CASES_MAX, scale);
  const m: Metrics = { cases };
  if (rng.chance(0.3)) m.events = cases + rng.int(0, cases);
  return m;
}

function edgeMetrics(rng: Random, scale: number): Metrics {
  const cases = count(rng, CASES_MAX, scale);
  const m: Metrics = { count: cases + rng.int(0, cases), cases };
  if (rng.chance(0.4)) m.medianLagHours = rng.int(1, 240);
  if (rng.chance(0.3)) m.violationShare = rng.int(0, 100) / 100;
  return m;
}

function nodeOf(i: number, rng: Random, options: GraphOptions, kind?: FlowNode["kind"]): FlowNode {
  const scale = options.scale ?? 1;
  const resolved: FlowNode["kind"] = kind ?? (options.mixedKinds ? rng.weighted([["activity", 8], ["gateway", 1], ["note", 1]] as const) : "activity");
  const node: FlowNode = { id: `n${i}`, kind: resolved, label: `${labelWord(resolved)} ${i}` };
  if (resolved === "gateway") node.tags = [rng.pick(["xor", "and", "or"])];
  if (resolved === "activity") node.metrics = nodeMetrics(rng, scale);
  return node;
}

function labelWord(kind: FlowNode["kind"]): string {
  return { activity: "Activity", gateway: "Gateway", event: "Event", note: "Note", stage: "Stage" }[kind];
}

function edgeOf(source: string, target: string, rng: Random, options: GraphOptions, kind: FlowEdge["kind"] = "follows"): FlowEdge {
  const e: FlowEdge = { id: `${source}->${target}`, kind, source, target };
  if (kind === "follows") e.metrics = edgeMetrics(rng, options.scale ?? 1);
  return e;
}

/** Collects nodes and edges; an edge with an existing id is dropped. */
class Builder {
  nodes: FlowNode[] = [];
  edges: FlowEdge[] = [];
  private ids = new Set<string>();
  constructor(
    readonly rng: Random,
    readonly options: GraphOptions,
  ) {}
  node(i: number, kind?: FlowNode["kind"]): FlowNode {
    const n = nodeOf(i, this.rng, this.options, kind);
    this.nodes.push(n);
    return n;
  }
  edge(source: string, target: string, kind?: FlowEdge["kind"]): boolean {
    const id = `${source}->${target}`;
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    this.edges.push(edgeOf(source, target, this.rng, this.options, kind));
    return true;
  }
  graph(): FlowGraph {
    return { nodes: this.nodes, edges: this.edges };
  }
}

/** Puts a start and an end event around the graph when `mixedKinds` is set: the first node gets a start, the last an end. */
function withEnds(b: Builder, first: string | undefined, last: string | undefined): FlowGraph {
  if (b.options.mixedKinds && first !== undefined && last !== undefined) {
    b.nodes.unshift({ id: "start", kind: "event", label: "Start", tags: ["start"] });
    b.nodes.push({ id: "end", kind: "event", label: "End", tags: ["end"] });
    b.edge("start", first);
    b.edge(last, "end");
  }
  return b.graph();
}

function sized(size: number): number {
  if (!Number.isInteger(size) || size < 0) throw new Error(`size must be a non-negative integer, got ${String(size)}`);
  return size;
}

/** `n0 → n1 → … → n(size-1)`: every node has at most one predecessor and one successor. */
export const chain: GraphFamily = (size, seed, options = {}) => {
  const n = sized(size);
  const b = new Builder(createRandom(seed), options);
  for (let i = 0; i < n; i++) b.node(i);
  for (let i = 1; i < n; i++) b.edge(`n${i - 1}`, `n${i}`);
  return withEnds(b, n ? "n0" : undefined, n ? `n${n - 1}` : undefined);
};

/** Layer index of each node of a layered graph: about `sqrt(size)` layers, nodes in id order. */
export function layerOf(size: number): (i: number) => number {
  const layers = Math.max(1, Math.round(Math.sqrt(size)));
  return (i) => Math.min(layers - 1, Math.floor((i * layers) / Math.max(1, size)));
}

/**
 * Layers of activities with edges only from a lower layer to a higher one:
 * acyclic, every node beyond the first layer has a predecessor in the layer
 * before it, and about half as many extra forward edges as nodes.
 */
export const layered: GraphFamily = (size, seed, options = {}) => {
  const n = sized(size);
  const rng = createRandom(seed);
  const b = new Builder(rng, options);
  const layer = layerOf(n);
  const members: number[][] = [];
  for (let i = 0; i < n; i++) {
    b.node(i);
    (members[layer(i)] ??= []).push(i);
  }
  for (let i = 0; i < n; i++) {
    const l = layer(i);
    if (l > 0) b.edge(`n${rng.pick(members[l - 1])}`, `n${i}`);
  }
  for (let k = 0; k < Math.floor(n / 2); k++) {
    const a = rng.int(0, n - 1);
    const c = rng.int(0, n - 1);
    if (layer(a) < layer(c)) b.edge(`n${a}`, `n${c}`);
  }
  return withEnds(b, n ? "n0" : undefined, n ? `n${n - 1}` : undefined);
};

/** A rooted tree: node `n0` is the root and every other node has exactly one predecessor with a smaller index. */
export const tree: GraphFamily = (size, seed, options = {}) => {
  const n = sized(size);
  const rng = createRandom(seed);
  const b = new Builder(rng, options);
  for (let i = 0; i < n; i++) {
    b.node(i);
    if (i > 0) b.edge(`n${rng.int(0, i - 1)}`, `n${i}`);
  }
  return withEnds(b, n ? "n0" : undefined, n ? `n${n - 1}` : undefined);
};

/** A ring through every node, random chords, and a self-loop on at least one node and at most a third of them. */
export const cyclic: GraphFamily = (size, seed, options = {}) => {
  const n = sized(size);
  const rng = createRandom(seed);
  const b = new Builder(rng, options);
  for (let i = 0; i < n; i++) b.node(i);
  for (let i = 0; i < n; i++) b.edge(`n${i}`, `n${(i + 1) % n}`);
  for (let k = 0; k < Math.floor(n / 2); k++) {
    const a = rng.int(0, n - 1);
    const c = rng.int(0, n - 1);
    if (a !== c) b.edge(`n${a}`, `n${c}`);
  }
  if (n) for (const i of rng.sample(Array.from({ length: n }, (_, i) => i), rng.int(1, Math.max(1, Math.ceil(n / 3))))) b.edge(`n${i}`, `n${i}`);
  return withEnds(b, n ? "n0" : undefined, n ? `n${n - 1}` : undefined);
};

/** Node `n0` is joined to every other node (in, out or both) and the other nodes only to it. */
export const hub: GraphFamily = (size, seed, options = {}) => {
  const n = sized(size);
  const rng = createRandom(seed);
  const b = new Builder(rng, options);
  for (let i = 0; i < n; i++) b.node(i);
  for (let i = 1; i < n; i++) {
    const dir = rng.weighted([["out", 2], ["in", 2], ["both", 1]] as const);
    if (dir !== "in") b.edge("n0", `n${i}`);
    if (dir !== "out") b.edge(`n${i}`, "n0");
  }
  return withEnds(b, n ? "n0" : undefined, n > 1 ? `n${n - 1}` : undefined);
};

/** How many components `components(size)` has: at least two for two nodes or more, up to a third of the nodes. */
export function componentCount(size: number, seed: number): number {
  return size < 2 ? size : createRandom(seed).int(2, Math.max(2, Math.floor(size / 3)));
}

/** Several chains that share no node: node `i` belongs to component `i mod k`, the count drawn first from the seed. */
export const components: GraphFamily = (size, seed, options = {}) => {
  const n = sized(size);
  const rng = createRandom(seed);
  const k = componentCount(n, seed);
  const b = new Builder(rng, options);
  for (let i = 0; i < n; i++) b.node(i);
  for (let i = k; i < n; i++) b.edge(`n${i - k}`, `n${i}`);
  return b.graph();
};

/** `layered` with every node in one of `ceil(sqrt(size))` flat stage groups, stages in layer order. */
export const stages: GraphFamily = (size, seed, options = {}) => {
  const g = layered(size, seed, options);
  const layer = layerOf(size);
  const groupCount = size ? Math.max(1, Math.round(Math.sqrt(size))) : 0;
  const groups: FlowGroup[] = Array.from({ length: groupCount }, (_, i) => ({ id: `g${i}`, kind: "stage", label: `Stage ${i}` }));
  for (const n of g.nodes) {
    const i = Number(n.id.slice(1));
    if (Number.isInteger(i)) n.group = `g${layer(i)}`;
  }
  return { ...g, groups };
};

/** `layered` with a pool of `2 … 5` lanes and every node in a lane drawn at random. */
export const lanes: GraphFamily = (size, seed, options = {}) => {
  const g = layered(size, seed, options);
  const rng = createRandom(seed + 1_000_003);
  const laneCount = rng.int(2, 5);
  const groups: FlowGroup[] = [{ id: "g0", kind: "pool", label: "Pool" }];
  for (let i = 1; i <= laneCount; i++) groups.push({ id: `g${i}`, kind: "lane", label: `Lane ${i}`, parent: "g0" });
  for (const n of g.nodes) n.group = `g${rng.int(1, laneCount)}`;
  return { ...g, groups };
};

/**
 * `stages` where every other stage holds a nested stage and a pool of two lanes
 * sits beside them with a sub-lane; nodes of a nested stage point at the
 * nested group, so the chain of parents has depth two or three.
 */
export const nested: GraphFamily = (size, seed, options = {}) => {
  const g = stages(size, seed, options);
  const rng = createRandom(seed + 2_000_003);
  const groups = [...(g.groups ?? [])];
  const top = groups.length;
  for (let i = 0; i < top; i += 2) groups.push({ id: `g${groups.length}`, kind: "stage", label: `Stage ${i}.1`, parent: `g${i}` });
  const nestedOf = new Map(groups.filter((x) => x.parent).map((x) => [x.parent!, x.id]));
  for (const n of g.nodes) {
    const inner = n.group && nestedOf.get(n.group);
    if (inner && rng.chance(0.5)) n.group = inner;
  }
  const pool = `g${groups.length}`;
  groups.push({ id: pool, kind: "pool", label: "Pool" }, { id: `${pool}a`, kind: "lane", label: "Lane A", parent: pool }, { id: `${pool}b`, kind: "lane", label: "Lane B", parent: pool }, { id: `${pool}b1`, kind: "lane", label: "Lane B.1", parent: `${pool}b` });
  return { ...g, groups };
};

export const OVERLAY_KINDS: readonly Overlay["kind"][] = ["badge", "arc", "hatch", "tint", "chip", "selfLoop"];

/**
 * `stages` of at least three nodes with one overlay of every kind on existing
 * targets: badges and hatching on nodes, a tint and a chip on a stage, a map
 * chip, a forward arc on an edge, a reverse arc on a back edge the family adds
 * (so the graph has one cycle), and a self-loop on a node.
 */
export const overlaid: GraphFamily = (size, seed, options = {}) => {
  const g = stages(Math.max(3, sized(size)), seed, options);
  const rng = createRandom(seed + 3_000_003);
  const activities = g.nodes.filter((n) => n.kind === "activity");
  const nodes = activities.length ? activities : g.nodes;
  const node = () => rng.pick(nodes).id;
  const forward = rng.pick(g.edges.filter((e) => e.kind === "follows" && e.source !== e.target));
  const back = { id: `${forward.target}->${forward.source}`, kind: "follows" as const, source: forward.target, target: forward.source, metrics: { count: 3, cases: 3 } };
  const edges = g.edges.some((e) => e.id === back.id) ? g.edges : [...g.edges, back];
  const group = rng.pick(g.groups ?? []).id;
  const share = () => rng.int(0, 100) / 100;
  const overlays: Overlay[] = [
    { kind: "badge", target: node(), payload: { constraintId: "presence", constraintType: "presence", glyph: "≥1", value: share(), text: "Present" } },
    { kind: "badge", target: node(), payload: { constraintId: "once", constraintType: "singularity", glyph: "≤1", value: share() } },
    { kind: "hatch", target: node(), payload: { constraintId: "scope", constraintType: "applicability", label: "Scope", text: "Out of scope" } },
    { kind: "tint", target: group, payload: { constraintId: "balance", constraintType: "balance", value: share(), label: "Balance", text: "Above", gauge: { value: 12, threshold: 10, direction: "high" } } },
    { kind: "chip", target: group, payload: { constraintId: "late", constraintType: "lag", glyph: "◔", text: "Late" } },
    { kind: "chip", target: MAP_TARGET, payload: { constraintId: "map", text: "Scope", label: "Scope" } },
    { kind: "arc", target: forward.id, payload: { constraintId: "lag", constraintType: "lag", source: forward.source, target: forward.target, value: share(), coverage: share(), glyph: "⏱", text: "Lag" } },
    { kind: "arc", target: back.id, payload: { constraintId: "order", constraintType: "precedence", source: back.source, target: back.target, value: share(), coverage: share(), reverse: true, glyph: "⇐", text: "Reverse" } },
    { kind: "selfLoop", target: node(), payload: { constraintId: "repeat", constraintType: "singularity", value: share(), text: "Repeats" } },
  ];
  return { ...g, edges, overlays };
};

export type LabelFlavour = "long" | "german" | "rtl" | "markup";

const GERMAN = ["Prüfung der Rechnung", "Bestellung ändern", "Wareneingang prüfen", "Zahlung überweisen", "Rückfrage beim Lieferanten", "Übergabe an Buchhaltung", "Maßnahme beschließen", "Änderung übernehmen"];
const RTL = ["בדיקת חשבונית", "יצירת הזמנה", "קבלת סחורה", "אישור תשלום", "مراجعة الفاتورة", "إنشاء طلب", "استلام البضاعة", "اعتماد الدفع"];
const MARKUP = ["<b>Check</b> invoice", "Pay & close", "Order \"urgent\"", "Ship 'now'", "<script>alert(1)</script>", "a < b > c", "&amp;lt;tag&gt;", "</text><text>Break"];
const LONG_WORDS = ["Verification", "of", "the", "supplier", "invoice", "against", "the", "purchase", "order", "and", "goods", "receipt", "with", "escalation"];

/** A label of the flavour for node `i`; `long` labels have at least 200 characters. */
function labelOf(flavour: LabelFlavour, i: number, rng: Random): string {
  switch (flavour) {
    case "long": {
      let s = "";
      while (s.length < 200 + rng.int(0, 200)) s += `${rng.pick(LONG_WORDS)} `;
      return `${s.trim()} ${i}`;
    }
    case "german":
      return `${rng.pick(GERMAN)} ${i}`;
    case "rtl":
      return `${rng.pick(RTL)} ${i}`;
    case "markup":
      return `${rng.pick(MARKUP)} ${i}`;
  }
}

/** `stages` with every node and group labelled in the flavour. */
export function labelled(flavour: LabelFlavour): GraphFamily {
  return (size, seed, options = {}) => {
    const g = stages(size, seed, options);
    const rng = createRandom(seed + 4_000_003);
    g.nodes.forEach((n, i) => (n.label = labelOf(flavour, i, rng)));
    g.groups?.forEach((x, i) => (x.label = labelOf(flavour, i, rng)));
    return g;
  };
}

/** Every valid family by name; each has a test of its defining property. */
export const families = {
  chain,
  layered,
  tree,
  cyclic,
  hub,
  components,
  stages,
  lanes,
  nested,
  overlaid,
  longLabels: labelled("long"),
  germanLabels: labelled("german"),
  rtlLabels: labelled("rtl"),
  markupLabels: labelled("markup"),
} satisfies Record<string, GraphFamily>;

export type FamilyName = keyof typeof families;

// ---------------------------------------------------------------------------
// Invalid families

export interface PlantedDefect {
  /** What was planted. */
  kind:
    | "missing-metric"
    | "zero-metric"
    | "negative-metric"
    | "non-finite-metric"
    | "string-metric"
    | "duplicate-node-id"
    | "duplicate-edge-id"
    | "duplicate-group-id"
    | "empty-id"
    | "missing-id"
    | "dangling-source"
    | "dangling-target"
    | "unknown-group"
    | "unknown-group-parent"
    | "group-cycle"
    | "overlay-target-missing"
    | "unknown-node-kind"
    | "unknown-edge-kind";
  /** The element the defect sits on. */
  id: string;
  /** Text `validateGraph` is expected to report, or `null` when the structural validation does not look at this. */
  expect: string | null;
}

export interface InvalidCase {
  graph: FlowGraph;
  defects: PlantedDefect[];
}

export type InvalidFamily = (size: number, seed: number) => InvalidCase;

/** Base for the invalid families: a layered graph of at least four nodes, metrics on every node and edge. */
function base(size: number, seed: number): FlowGraph {
  return stages(Math.max(4, sized(size)), seed);
}

/** Some nodes without `cases`, some edges without `count` and `cases`, some without any metrics. */
export const missingMetrics: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 5_000_003);
  const defects: PlantedDefect[] = [];
  for (const n of rng.sample(graph.nodes, Math.max(1, Math.floor(graph.nodes.length / 4)))) {
    if (rng.chance()) delete n.metrics;
    else delete n.metrics!.cases;
    defects.push({ kind: "missing-metric", id: n.id, expect: null });
  }
  for (const e of rng.sample(graph.edges, Math.max(1, Math.floor(graph.edges.length / 4)))) {
    if (rng.chance()) delete e.metrics;
    else e.metrics = { medianLagHours: 4 };
    defects.push({ kind: "missing-metric", id: e.id, expect: null });
  }
  return { graph, defects };
};

function withValue(size: number, seed: number, kind: PlantedDefect["kind"], value: () => number): InvalidCase {
  const graph = base(size, seed);
  const rng = createRandom(seed + 6_000_003);
  const defects: PlantedDefect[] = [];
  for (const n of rng.sample(graph.nodes, Math.max(1, Math.floor(graph.nodes.length / 4)))) {
    n.metrics = { ...n.metrics, cases: value() };
    defects.push({ kind, id: n.id, expect: null });
  }
  for (const e of rng.sample(graph.edges, Math.max(1, Math.floor(graph.edges.length / 4)))) {
    e.metrics = { ...e.metrics, count: value(), cases: value() };
    defects.push({ kind, id: e.id, expect: null });
  }
  return { graph, defects };
}

/** `cases` and `count` of zero on a quarter of the nodes and edges. */
export const zeroMetrics: InvalidFamily = (size, seed) => withValue(size, seed, "zero-metric", () => 0);

/** Negative `cases` and `count` on a quarter of the nodes and edges. */
export const negativeMetrics: InvalidFamily = (size, seed) => {
  const rng = createRandom(seed + 7_000_003);
  return withValue(size, seed, "negative-metric", () => -rng.int(1, 1000));
};

/** `NaN`, `Infinity` and `-Infinity` as `cases` and `count` on a quarter of the nodes and edges. */
export const nonFiniteMetrics: InvalidFamily = (size, seed) => {
  const rng = createRandom(seed + 8_000_003);
  return withValue(size, seed, "non-finite-metric", () => rng.pick([NaN, Infinity, -Infinity]));
};

/** Strings where numbers belong (what a JSON backend may send); typed as numbers for the graph. */
export const stringMetrics: InvalidFamily = (size, seed) => {
  const rng = createRandom(seed + 9_000_003);
  return withValue(size, seed, "string-metric", () => rng.pick(["12", "", "many", "1e3"]) as unknown as number);
};

/** A node, an edge and a group each repeated under its own id. */
export const duplicateIds: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 10_000_003);
  const node = rng.pick(graph.nodes);
  const edge = rng.pick(graph.edges);
  const group = rng.pick(graph.groups!);
  graph.nodes.push({ ...node, label: `${node.label} again` });
  graph.edges.push({ ...edge });
  graph.groups!.push({ ...group });
  return {
    graph,
    defects: [
      { kind: "duplicate-node-id", id: node.id, expect: "duplicate node id" },
      { kind: "duplicate-edge-id", id: edge.id, expect: "duplicate edge id" },
      { kind: "duplicate-group-id", id: group.id, expect: "duplicate group id" },
    ],
  };
};

/** A node and an edge whose id is the empty string. */
export const emptyIds: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 11_000_003);
  const other = rng.pick(graph.nodes).id;
  graph.nodes.push({ id: "", kind: "activity", label: "Nameless", metrics: { cases: 1 } });
  graph.edges.push({ id: "", kind: "follows", source: "", target: other, metrics: { count: 1, cases: 1 } });
  return {
    graph,
    defects: [
      { kind: "empty-id", id: "", expect: null },
      { kind: "empty-id", id: "", expect: null },
    ],
  };
};

/** A node and an edge without any id (a null column of a backend); typed around the model, so the id reads `undefined`. */
export const missingIds: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 15_000_003);
  const a = rng.pick(graph.nodes).id;
  const b = rng.pick(graph.nodes).id;
  const none = undefined as unknown as string;
  graph.nodes.push({ id: none, kind: "activity", label: "Unnamed", metrics: { cases: 1 } });
  graph.edges.push({ id: none, kind: "follows", source: a, target: b, metrics: { count: 1, cases: 1 } });
  return {
    graph,
    defects: [
      { kind: "missing-id", id: "undefined", expect: null },
      { kind: "missing-id", id: "undefined", expect: null },
    ],
  };
};

/** Edges whose source or target names no node. */
export const danglingEdges: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 12_000_003);
  const a = rng.pick(graph.nodes).id;
  const b = rng.pick(graph.nodes).id;
  graph.edges.push({ id: "gone->" + a, kind: "follows", source: "gone", target: a, metrics: { count: 1, cases: 1 } }, { id: b + "->gone", kind: "follows", source: b, target: "gone", metrics: { count: 1, cases: 1 } });
  return {
    graph,
    defects: [
      { kind: "dangling-source", id: "gone->" + a, expect: "edge source not found: gone" },
      { kind: "dangling-target", id: b + "->gone", expect: "edge target not found: gone" },
    ],
  };
};

/** A node in a group that does not exist, a group whose parent does not exist, and two groups that are each other's parent. */
export const brokenGroups: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 13_000_003);
  const node = rng.pick(graph.nodes);
  node.group = "nowhere";
  const groups = graph.groups!;
  groups.push({ id: "orphan", kind: "stage", label: "Orphan", parent: "nowhere" });
  groups.push({ id: "ring1", kind: "stage", label: "Ring 1", parent: "ring2" }, { id: "ring2", kind: "stage", label: "Ring 2", parent: "ring1" });
  return {
    graph,
    defects: [
      { kind: "unknown-group", id: node.id, expect: "node group not found: nowhere" },
      { kind: "unknown-group-parent", id: "orphan", expect: "group parent not found: nowhere" },
      { kind: "group-cycle", id: "ring1", expect: "group parent cycle" },
      { kind: "group-cycle", id: "ring2", expect: "group parent cycle" },
    ],
  };
};

/** Overlays of every kind on targets that do not exist. */
export const strayOverlays: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const defects: PlantedDefect[] = [];
  graph.overlays = OVERLAY_KINDS.map((kind) => {
    const target = `missing-${kind}`;
    defects.push({ kind: "overlay-target-missing", id: target, expect: `overlay target not found: ${target}` });
    return { kind, target, payload: { constraintId: kind, value: 0.5 } };
  });
  return { graph, defects };
};

/** A node and an edge of a kind the model does not know (typed around the union). */
export const unknownKinds: InvalidFamily = (size, seed) => {
  const graph = base(size, seed);
  const rng = createRandom(seed + 14_000_003);
  const a = rng.pick(graph.nodes).id;
  graph.nodes.push({ id: "odd", kind: "subprocess" as FlowNode["kind"], label: "Odd", metrics: { cases: 1 } });
  graph.edges.push({ id: `odd->${a}`, kind: "message" as FlowEdge["kind"], source: "odd", target: a });
  return {
    graph,
    defects: [
      { kind: "unknown-node-kind", id: "odd", expect: null },
      { kind: "unknown-edge-kind", id: `odd->${a}`, expect: null },
    ],
  };
};

/** Every invalid family by name: metric values that are missing or not a count, and broken structure a backend may send. */
export const invalidFamilies = {
  missingMetrics,
  zeroMetrics,
  negativeMetrics,
  nonFiniteMetrics,
  stringMetrics,
  duplicateIds,
  emptyIds,
  missingIds,
  danglingEdges,
  brokenGroups,
  strayOverlays,
  unknownKinds,
} satisfies Record<string, InvalidFamily>;

export type InvalidFamilyName = keyof typeof invalidFamilies;
