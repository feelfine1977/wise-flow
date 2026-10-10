/**
 * Layout: ELK layered (in a Web Worker when a worker URL is given, in-process
 * otherwise), Dagre as fallback, and union layouts for stable positions across
 * compared scenes.
 */
import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { Graph as DagreGraph, layout as dagreLayout } from "@dagrejs/dagre";
import { type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, byId, indexGraph } from "./model.js";
import { layoutInputKey, resolvedSizes } from "./layout-key.js";
import { nodeSizeTokens } from "./tokens.js";

export interface XY {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeRoute {
  points: XY[];
  labelX?: number;
  labelY?: number;
}

/** `di` marks positions read from BPMN diagram interchange, `given` positions supplied by the caller. */
export type LayoutEngine = "elk" | "dagre" | "di" | "given";
export type LayoutDirection = "RIGHT" | "DOWN" | "LEFT" | "UP";

/**
 * Result of a layout. Nodes and groups live in separate maps so that a group may
 * share an id with a collapsed stage node. Coordinates are absolute (top-left).
 */
export interface Positions {
  nodes: Record<string, Box>;
  groups: Record<string, Box>;
  edges: Record<string, EdgeRoute>;
  bounds: Box;
  engine: LayoutEngine;
  direction: LayoutDirection;
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** `auto` (default) tries ELK and falls back to Dagre on failure or timeout. */
  engine?: LayoutEngine | "auto";
  direction?: LayoutDirection;
  nodeSize?: NodeSize | ((node: FlowNode) => NodeSize);
  spacing?: { node?: number; layer?: number; group?: number };
  edgeRouting?: "ORTHOGONAL" | "POLYLINE" | "SPLINES";
  /** Groups become compound nodes (default) or are ignored. */
  groups?: "compound" | "ignore";
  /** Order stage compounds along the flow direction (ELK partitioning). Default true. */
  orderStages?: boolean;
  /**
   * URL of `elkjs/lib/elk-worker.min.js` as served by the application; when given
   * and `Worker` exists, ELK runs in a Web Worker. Otherwise the bundled build runs
   * in-process (Node and browsers).
   */
  elkWorkerUrl?: string | URL;
  /** A prepared ELK instance, e.g. with a custom worker factory. */
  elk?: ELK;
  /** Extra ELK layout options merged over the defaults. */
  elkOptions?: Record<string, string>;
  /** Milliseconds before the layout falls back to Dagre. Default 20000. */
  timeoutMs?: number;
  /**
   * Cache key; the same key returns the cached positions without recomputing,
   * whatever the graph and the other options. The caller owns the key and forgets
   * it with `clearLayoutCache(key)` when its inputs change.
   */
  cacheKey?: string;
}

/** Default box of each node kind (`nodeSizeTokens`). */
export const DEFAULT_SIZES: Record<FlowNode["kind"], NodeSize> = nodeSizeTokens;

export function defaultNodeSize(node: FlowNode): NodeSize {
  return DEFAULT_SIZES[node.kind] ?? DEFAULT_SIZES.activity;
}

const GROUP_PADDING = { top: 44, left: 20, bottom: 20, right: 20 };

function sizeOf(node: FlowNode, o: LayoutOptions): NodeSize {
  if (!o.nodeSize) return defaultNodeSize(node);
  return typeof o.nodeSize === "function" ? o.nodeSize(node) : o.nodeSize;
}

/**
 * Smallest box around the given boxes. Boxes without a non-negative width and
 * height are ignored; without boxes the result is the empty box at the origin.
 */
export function unionBoxes(boxes: readonly Box[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    if (!(b.width >= 0 && b.height >= 0)) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  if (x0 === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function pointsBounds(points: XY[]): Box | null {
  if (!points.length) return null;
  let x = Infinity;
  let y = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x, y, width: x1 - x, height: y1 - y };
}

/** Bounds of nodes, groups and edge routes together. */
export function positionsBounds(p: PositionsContents): Box {
  const boxes = [...Object.values(p.nodes), ...Object.values(p.groups)];
  for (const r of Object.values(p.edges)) {
    const b = pointsBounds(r.points);
    if (b) boxes.push(b);
  }
  return unionBoxes(boxes);
}

/** What positions hold besides their bounds. */
export type PositionsContents = Pick<Positions, "nodes" | "groups" | "edges">;

/**
 * Positions from their contents: the bounds are computed from the nodes, groups
 * and edge routes, so they always match. Every function that creates or changes
 * positions builds its result here.
 */
export function createPositions(contents: PositionsContents, engine: LayoutEngine, direction: LayoutDirection): Positions {
  const { nodes, groups, edges } = contents;
  return { nodes, groups, edges, bounds: positionsBounds(contents), engine, direction };
}

// ---------------------------------------------------------------------------
// ELK

type ElkCtor = new (args?: { workerUrl?: string; workerFactory?: (url?: string) => Worker }) => ELK;

let inProcessElk: Promise<ELK> | undefined;

/** ELK instances that run in a Web Worker, by worker URL, with the number of their users. */
const workerElks = new Map<string, { elk: Promise<ELK>; users: number }>();

function unwrap(mod: unknown): ElkCtor {
  const m = mod as { default?: ElkCtor & { default?: ElkCtor } };
  const ctor = (m.default ?? mod) as ElkCtor & { default?: ElkCtor };
  return (ctor.default ?? ctor) as ElkCtor;
}

// The import specifiers are literals so that bundlers resolve them; both files
// are loaded on demand only.
const loadApiCtor = () => import("elkjs/lib/elk-api.js").then(unwrap);
const loadBundledCtor = () => import("elkjs/lib/elk.bundled.js").then(unwrap);

/** The worker URL a layout with these options runs ELK in, if any. */
function workerUrlOf(o: LayoutOptions): string | undefined {
  return !o.elk && o.elkWorkerUrl && typeof Worker !== "undefined" ? String(o.elkWorkerUrl) : undefined;
}

/** Use the worker for a URL, starting it when nobody uses it yet. */
function acquireWorker(url: string): Promise<ELK> {
  let entry = workerElks.get(url);
  if (!entry) {
    entry = { elk: loadApiCtor().then((Ctor) => new Ctor({ workerUrl: url, workerFactory: (u) => new Worker(u!) })), users: 0 };
    workerElks.set(url, entry);
  }
  entry.users++;
  return entry.elk;
}

/** Stop using the worker for a URL; the last user terminates it. */
function releaseWorker(url: string): void {
  const entry = workerElks.get(url);
  if (!entry || --entry.users > 0) return;
  workerElks.delete(url);
  entry.elk.then((elk) => elk.terminateWorker(), () => undefined);
}

interface Prepared {
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
  direction: LayoutDirection;
  useGroups: boolean;
}

function prepare(graph: FlowGraph, o: LayoutOptions): Prepared {
  const nodes = [...graph.nodes].sort(byId);
  const edges = [...graph.edges].sort(byId);
  const groupIds = new Set((graph.groups ?? []).map((g) => g.id));
  const groups = (graph.groups ?? []).filter((g) => !g.parent || groupIds.has(g.parent));
  return {
    nodes,
    edges,
    groups,
    direction: o.direction ?? "RIGHT",
    useGroups: (o.groups ?? "compound") === "compound" && groups.length > 0,
  };
}

function elkGraph(p: Prepared, o: LayoutOptions, partition: boolean): ElkNode {
  const spacing = o.spacing ?? {};
  const nodeSpacing = spacing.node ?? 28;
  const layerSpacing = spacing.layer ?? 64;
  const idx = indexGraph({ nodes: p.nodes, edges: p.edges, groups: p.groups });
  const stageOrder = new Map<string, number>();
  p.groups.filter((g) => !g.parent && g.kind === "stage").forEach((g, i) => stageOrder.set(g.id, i));

  const nodeElk = (n: FlowNode): ElkNode => {
    const s = sizeOf(n, o);
    return { id: n.id, width: s.width, height: s.height, labels: [{ text: n.label }] };
  };
  const childrenOf = (groupId: string | undefined): ElkNode[] => {
    const out: ElkNode[] = [];
    for (const g of p.groups) {
      if ((g.parent ?? undefined) !== groupId) continue;
      if (!p.useGroups) continue;
      const members = idx.members.get(g.id) ?? [];
      const sub = childrenOf(g.id);
      if (members.length === 0 && sub.length === 0) continue;
      const layoutOptions: Record<string, string> = {
        "elk.padding": `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`,
      };
      if (partition && stageOrder.has(g.id)) layoutOptions["elk.partitioning.partition"] = String(stageOrder.get(g.id));
      out.push({ id: g.id, labels: [{ text: g.label }], layoutOptions, children: sub });
    }
    for (const n of p.nodes) {
      const inGroup = p.useGroups && n.group && idx.groups.has(n.group);
      if ((inGroup ? n.group : undefined) === groupId) out.push(nodeElk(n));
    }
    return out;
  };

  const rootOptions: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.direction": p.direction,
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.spacing.nodeNode": String(nodeSpacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
    "elk.spacing.edgeNode": "24",
    "elk.spacing.componentComponent": String(spacing.group ?? 48),
    "elk.edgeRouting": o.edgeRouting ?? "POLYLINE",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
    "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
    "elk.separateConnectedComponents": "true",
    ...(partition ? { "elk.partitioning.activate": "true" } : {}),
    ...(o.elkOptions ?? {}),
  };
  const edges: ElkExtendedEdge[] = p.edges
    .filter((e) => e.source !== e.target)
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  return { id: "root", layoutOptions: rootOptions, children: childrenOf(undefined), edges };
}

function fromElk(result: ElkNode, p: Prepared): Positions {
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  const nodeIds = new Set(p.nodes.map((n) => n.id));
  const groupIds = new Set(p.groups.map((g) => g.id));
  const offsets = new Map<string, XY>([["root", { x: 0, y: 0 }]]);
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      const box = { x, y, width: child.width ?? 0, height: child.height ?? 0 };
      offsets.set(child.id, { x, y });
      if (groupIds.has(child.id) && child.children) groups[child.id] = box;
      else if (nodeIds.has(child.id)) nodes[child.id] = box;
      walk(child, x, y);
    }
  };
  walk(result, 0, 0);
  const collectEdges = (node: ElkNode) => {
    for (const e of node.edges ?? []) {
      const container = (e as { container?: string }).container ?? node.id;
      const off = offsets.get(container) ?? { x: 0, y: 0 };
      const section = e.sections?.[0];
      if (!section) continue;
      const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((pt) => ({
        x: pt.x + off.x,
        y: pt.y + off.y,
      }));
      edges[e.id] = { points: pts };
    }
    for (const child of node.children ?? []) collectEdges(child);
  };
  collectEdges(result);
  return createPositions({ nodes, groups, edges }, "elk", p.direction);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`layout timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function layoutElk(p: Prepared, o: LayoutOptions, holder?: EngineHolder): Promise<Positions> {
  const url = workerUrlOf(o);
  if (url === undefined) return runElk(o.elk ?? (await (inProcessElk ??= loadBundledCtor().then((Ctor) => new Ctor()))), p, o);
  holder?.hold(url);
  const elk = acquireWorker(url);
  try {
    return await runElk(await elk, p, o);
  } finally {
    releaseWorker(url);
  }
}

async function runElk(elk: ELK, p: Prepared, o: LayoutOptions): Promise<Positions> {
  const ms = o.timeoutMs ?? 20000;
  const partition = (o.orderStages ?? true) && p.useGroups;
  try {
    const result = await withTimeout(elk.layout(elkGraph(p, o, partition)), ms);
    return fromElk(result, p);
  } catch (err) {
    if (!partition) throw err;
    const result = await withTimeout(elk.layout(elkGraph(p, o, false)), ms);
    return fromElk(result, p);
  }
}

// ---------------------------------------------------------------------------
// Dagre

const DAGRE_DIR: Record<LayoutDirection, "LR" | "TB" | "RL" | "BT"> = { RIGHT: "LR", DOWN: "TB", LEFT: "RL", UP: "BT" };

function layoutDagre(p: Prepared, o: LayoutOptions): Positions {
  const spacing = o.spacing ?? {};
  const g = new DagreGraph({ compound: p.useGroups, multigraph: true });
  g.setGraph({
    rankdir: DAGRE_DIR[p.direction],
    nodesep: spacing.node ?? 28,
    ranksep: spacing.layer ?? 64,
    marginx: 8,
    marginy: 8,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const groupIds = new Set(p.groups.map((gr) => gr.id));
  if (p.useGroups) {
    for (const gr of p.groups) g.setNode(gr.id, { label: gr.label, clusterLabelPos: "top" });
    for (const gr of p.groups) if (gr.parent && groupIds.has(gr.parent)) g.setParent(gr.id, gr.parent);
  }
  for (const n of p.nodes) {
    const s = sizeOf(n, o);
    g.setNode(n.id, { width: s.width, height: s.height });
    if (p.useGroups && n.group && groupIds.has(n.group)) g.setParent(n.id, n.group);
  }
  for (const e of p.edges) {
    if (e.source === e.target) continue;
    g.setEdge(e.source, e.target, { minlen: 1 }, e.id);
  }
  dagreLayout(g);
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  for (const n of p.nodes) {
    const v = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!v) continue;
    nodes[n.id] = { x: v.x - v.width / 2, y: v.y - v.height / 2, width: v.width, height: v.height };
  }
  if (p.useGroups) {
    for (const gr of p.groups) {
      const v = g.node(gr.id) as { x?: number; y?: number; width?: number; height?: number } | undefined;
      if (!v || v.width === undefined || v.x === undefined) continue;
      const width = (v.width ?? 0) + GROUP_PADDING.left + GROUP_PADDING.right;
      const height = (v.height ?? 0) + GROUP_PADDING.top + GROUP_PADDING.bottom;
      groups[gr.id] = { x: v.x - width / 2, y: (v.y ?? 0) - height / 2 - (GROUP_PADDING.top - GROUP_PADDING.bottom) / 2, width, height };
    }
  }
  for (const e of p.edges) {
    if (e.source === e.target) continue;
    const v = g.edge({ v: e.source, w: e.target, name: e.id }) as { points?: XY[] } | undefined;
    if (v?.points) edges[e.id] = { points: v.points.map((pt) => ({ x: pt.x, y: pt.y })) };
  }
  return createPositions({ nodes, groups, edges }, "dagre", p.direction);
}

// ---------------------------------------------------------------------------
// Public API

/** Keeps a worker running for a scope until the scope is disposed. */
interface EngineHolder {
  hold(url: string): void;
}

/** Layouts by caller key; the caller owns them. */
const cache = new Map<string, Promise<Positions>>();
/** Counts global clears; a scope from an earlier generation forgets its layouts. */
let generation = 0;

/** Forget cached layouts: all of them (caller keys and every scope's), or one caller key. */
export function clearLayoutCache(key?: string): void {
  if (key !== undefined) {
    cache.delete(key);
    return;
  }
  cache.clear();
  generation++;
}

/** The layout kept under `key`, or a new one that is kept unless it fails. Hits move to the end. */
function remember(entries: Map<string, Promise<Positions>>, key: string, make: () => Promise<Positions>): Promise<Positions> {
  let pending = entries.get(key);
  entries.delete(key);
  pending ??= make().catch((err) => {
    if (entries.get(key) === pending) entries.delete(key);
    throw err;
  });
  entries.set(key, pending);
  return pending;
}

function run(graph: FlowGraph, options: LayoutOptions, holder?: EngineHolder): Promise<Positions> {
  const key = options.cacheKey;
  return key ? remember(cache, key, () => compute(graph, options, holder)) : compute(graph, options, holder);
}

async function compute(graph: FlowGraph, options: LayoutOptions, holder?: EngineHolder): Promise<Positions> {
  const p = prepare(graph, options);
  if (p.nodes.length === 0) {
    return createPositions({ nodes: {}, groups: {}, edges: {} }, options.engine === "dagre" ? "dagre" : "elk", p.direction);
  }
  const engine = options.engine ?? "auto";
  if (engine === "dagre") return layoutDagre(p, options);
  try {
    return await layoutElk(p, options, holder);
  } catch (err) {
    if (engine === "elk") throw err;
    return layoutDagre(p, options);
  }
}

/**
 * Lay out a graph. Positions are absolute and deterministic for the same input
 * (elements are sorted by id before the engine runs). Groups become compound nodes.
 * Without `cacheKey` nothing is kept; a worker started for this layout alone is
 * terminated when it is done.
 */
export function layout(graph: FlowGraph, options: LayoutOptions = {}): Promise<Positions> {
  return run(graph, options);
}

export interface LayoutScopeOptions {
  /** Layouts kept at most; the least recently used one goes first. Default 8. */
  maxEntries?: number;
}

/**
 * Layouts that belong to one owner, e.g. one map. Without a caller key the scope
 * keys each layout by its inputs: the nodes' ids, labels, groups and resolved
 * sizes (size callbacks count by what they return), the edges' ids and endpoints,
 * the groups' ids, kinds, labels and parents, and every other option (an `elk`
 * instance by identity). A changed graph or changed options are laid out anew;
 * returning to earlier inputs is free. Caller keys go to the shared,
 * caller-owned cache as with `layout`. ELK workers the scope starts keep running
 * until it is disposed.
 */
export interface LayoutScope {
  layout(graph: FlowGraph, options?: LayoutOptions): Promise<Positions>;
  layoutUnion(scenes: FlowGraph[], options?: LayoutOptions): Promise<Positions>;
  /** Number of layouts the scope keeps. */
  readonly size: number;
  /**
   * Forget the scope's layouts and stop its ELK workers once no other scope or
   * running layout uses them. The scope stays usable and starts empty.
   */
  dispose(): void;
}

/** Layouts keyed by the graph's nodes with resolved sizes, edges, groups and options; see `LayoutScope`. */
export function createLayoutScope(scopeOptions: LayoutScopeOptions = {}): LayoutScope {
  const maxEntries = Math.max(1, scopeOptions.maxEntries ?? 8);
  const entries = new Map<string, Promise<Positions>>();
  const held = new Set<string>();
  const holder: EngineHolder = {
    hold(url) {
      if (held.has(url)) return;
      held.add(url);
      acquireWorker(url);
    },
  };
  let seen = generation;
  const forgetIfCleared = () => {
    if (seen !== generation) entries.clear();
    seen = generation;
  };
  const scope: LayoutScope = {
    layout(graph, options = {}) {
      if (options.cacheKey) return run(graph, options, holder);
      forgetIfCleared();
      const sizes = resolvedSizes(graph, options);
      const key = layoutInputKey(graph, options, sizes);
      const pending = remember(entries, key, () => compute(graph, { ...options, nodeSize: (node) => sizes.get(node.id)! }, holder));
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(oldest);
      }
      return pending;
    },
    layoutUnion(scenes, options) {
      return scope.layout(unionGraph(scenes), options);
    },
    get size() {
      forgetIfCleared();
      return entries.size;
    },
    dispose() {
      entries.clear();
      for (const url of held) releaseWorker(url);
      held.clear();
    },
  };
  return scope;
}

/**
 * Union of several scenes on the same ids: nodes, edges and groups by id (the first
 * definition wins), so that a layout of the union serves every scene.
 */
export function unionGraph(scenes: FlowGraph[]): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const groups = new Map<string, FlowGroup>();
  for (const s of scenes) {
    for (const n of s.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    for (const e of s.edges) if (!edges.has(e.id)) edges.set(e.id, e);
    for (const g of s.groups ?? []) if (!groups.has(g.id)) groups.set(g.id, g);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], groups: [...groups.values()], meta: { union: scenes.length } };
}

/**
 * Stable layout: lay out the union of the scenes once and return its positions.
 * Every scene reads the positions of its own ids from the result, so compared
 * maps never jump. Use `filterPositions` to trim the result to one scene.
 */
export function layoutUnion(scenes: FlowGraph[], options: LayoutOptions = {}): Promise<Positions> {
  return layout(unionGraph(scenes), options);
}

/** Positions restricted to the elements of one graph, with recomputed bounds. */
export function filterPositions(positions: Positions, graph: FlowGraph): Positions {
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  for (const n of graph.nodes) if (positions.nodes[n.id]) nodes[n.id] = positions.nodes[n.id];
  for (const g of graph.groups ?? []) if (positions.groups[g.id]) groups[g.id] = positions.groups[g.id];
  for (const e of graph.edges) if (positions.edges[e.id]) edges[e.id] = positions.edges[e.id];
  return createPositions({ nodes, groups, edges }, positions.engine, positions.direction);
}

/** True when every node of `graph` has a position. */
export function coversGraph(positions: Positions, graph: FlowGraph): boolean {
  return graph.nodes.every((n) => positions.nodes[n.id] !== undefined);
}

/** Straight route between two boxes' centres, clipped to the box borders. */
export function straightRoute(a: Box, b: Box): EdgeRoute {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return { points: [clipToBox(ac, bc, a), clipToBox(bc, ac, b)] };
}

function clipToBox(from: XY, to: XY, box: Box): XY {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const hw = box.width / 2;
  const hh = box.height / 2;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: from.x + dx * t, y: from.y + dy * t };
}
