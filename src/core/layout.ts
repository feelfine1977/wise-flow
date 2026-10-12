/** Layout: ELK and Dagre, in workers or in-process, Dagre as fallback; a layout runs while somebody waits for it. */
import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import * as dagreModule from "@dagrejs/dagre";
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

/**
 * `di` marks positions read from BPMN diagram interchange, `given` positions supplied by the caller,
 * `provisional` an arrangement shown until the layout engine's result arrives.
 */
export type LayoutEngine = "elk" | "dagre" | "di" | "given" | "provisional";
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
  /** No layout replaces them: the provisional arrangement `useStableLayout` keeps when the layout is unavailable. */
  final?: boolean;
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
   * in-process (Node and browsers), where a running layout cannot be interrupted.
   */
  elkWorkerUrl?: string | URL;
  /**
   * URL of `@wise/flow/dagre-worker.min.js` as served by the application; when
   * given and `Worker` exists, Dagre runs in a Web Worker, also as the fallback.
   */
  dagreWorkerUrl?: string | URL;
  /** A prepared ELK instance, e.g. with a custom worker factory. */
  elk?: ELK;
  /** Extra ELK layout options merged over the defaults. */
  elkOptions?: Record<string, string>;
  /**
   * Milliseconds each engine run may take (ELK; Dagre in a worker). Its worker is
   * then terminated; `auto` falls back to Dagre, otherwise the layout fails. Default 20000.
   * In-process ELK is timed from when it starts and, holding the thread, is answered once done.
   */
  timeoutMs?: number;
  /**
   * Most nodes plus edges the Dagre fallback lays out on the calling thread
   * (without `dagreWorkerUrl`); above that the layout fails with
   * `LayoutUnavailableError`. Default 500.
   */
  fallbackLimit?: number;
  /**
   * Stops waiting: the layout rejects with the signal's reason, and a worker that
   * runs it for nobody else is terminated. Not part of the layout's inputs.
   * `useStableLayout` and `<ProcessMap/>` pass their own in its place.
   */
  signal?: AbortSignal;
  /**
   * Cache key; the same key returns the cached positions without recomputing,
   * whatever the graph and the other options. The caller owns the key and forgets
   * it with `clearLayoutCache(key)` when its inputs change.
   */
  cacheKey?: string;
}

/** The Dagre fallback would have run on the calling thread above `fallbackLimit`; it did not. */
export class LayoutUnavailableError extends Error {
  override name = "LayoutUnavailableError";
}

/** Default box of each node kind (`nodeSizeTokens`). */
export const DEFAULT_SIZES: Record<FlowNode["kind"], NodeSize> = nodeSizeTokens;

export function defaultNodeSize(node: FlowNode): NodeSize {
  return DEFAULT_SIZES[node.kind] ?? DEFAULT_SIZES.activity;
}

export const GROUP_PADDING = { top: 44, left: 20, bottom: 20, right: 20 };

export function sizeOf(node: FlowNode, o: LayoutOptions): NodeSize {
  const s = typeof o.nodeSize === "function" ? o.nodeSize(node) : o.nodeSize;
  return s && Number.isFinite(s.width) && Number.isFinite(s.height) ? s : defaultNodeSize(node);
}

/** A spacing, or its default where it is not a finite number. */
export const gap = (v: number | undefined, fallback: number): number => (Number.isFinite(v) ? v! : fallback);

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

export const finiteBox = (b: Box | undefined): b is Box => !!b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height);

/** Positions without the boxes and routes holding a number that is not finite; the same object when there is none. */
export function finitePositions(p: Positions): Positions {
  const keep = <T>(r: Record<string, T>, ok: (v: T) => boolean): Record<string, T> => {
    for (const k in r) if (!ok(r[k])) return Object.fromEntries(Object.entries(r).filter(([, v]) => ok(v)));
    return r;
  };
  const nodes = keep(p.nodes, finiteBox);
  const groups = keep(p.groups, finiteBox);
  const edges = keep(p.edges, (r) => r.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
  return nodes === p.nodes && groups === p.groups && edges === p.edges && finiteBox(p.bounds) ? p : createPositions({ nodes, groups, edges }, p.engine, p.direction);
}

// ---------------------------------------------------------------------------
// ELK

type ElkCtor = new (args?: { workerUrl?: string; workerFactory?: (url?: string) => Worker }) => ELK;

let inProcessElk: Promise<ELK> | undefined;

function unwrap(mod: unknown): ElkCtor {
  const m = mod as { default?: ElkCtor & { default?: ElkCtor } };
  const ctor = (m.default ?? mod) as ElkCtor & { default?: ElkCtor };
  return (ctor.default ?? ctor) as ElkCtor;
}

// The import specifiers are literals so that bundlers resolve them; both files
// are loaded on demand only.
const loadApiCtor = () => import("elkjs/lib/elk-api.js").then(unwrap);
const loadBundledCtor = () => import("elkjs/lib/elk.bundled.js").then(unwrap);

/** The worker URL a layout runs an engine in, if any. */
function workerUrl(url: string | URL | undefined): string | undefined {
  return url && typeof Worker !== "undefined" ? String(url) : undefined;
}

/**
 * One Web Worker, running one layout at a time: ELK's worker through ELK's API,
 * or the package's Dagre worker, which answers a `DagreInput` with `{ output }`
 * or `{ error }`. Once stopped, nothing it sends is read.
 */
interface LayoutWorker {
  elk(): Promise<ELK>;
  dagre(input: DagreInput): Promise<DagreOutput>;
  stop(): void;
}

function startWorker(url: string): LayoutWorker {
  let stopped = false;
  let elk: Promise<ELK> | undefined;
  let worker: Worker | undefined;
  let read: ((event: MessageEvent) => void) | undefined;
  const open = (reader: (event: MessageEvent) => void) => {
    read = reader;
    if (!worker) {
      worker = new Worker(url);
      worker.onmessage = (event) => stopped || read!(event);
      if (stopped) worker.terminate();
    }
    return worker;
  };
  return {
    elk: () => (elk ??= loadApiCtor().then((Ctor) => new Ctor({
      workerUrl: url,
      workerFactory: () => {
        const port = { postMessage: (message: unknown) => worker!.postMessage(message), terminate: () => worker!.terminate(), onmessage: null as ((event: MessageEvent) => void) | null };
        open((event) => port.onmessage?.(event));
        return port as unknown as Worker;
      },
    }))),
    dagre: (input) => new Promise((resolve, reject) => {
      open(({ data }: MessageEvent<{ output?: DagreOutput; error?: string }>) => (data.output ? resolve(data.output) : reject(new Error(data.error)))).postMessage(input);
    }),
    stop() {
      stopped = true;
      worker?.terminate();
    },
  };
}

/** An idle worker per URL, kept while a scope holds the URL. */
const idle = new Map<string, LayoutWorker>();
/** Number of scopes that hold each URL. */
const holders = new Map<string, number>();

function holdUrl(url: string, change: 1 | -1): void {
  const count = (holders.get(url) ?? 0) + change;
  if (count > 0) return void holders.set(url, count);
  holders.delete(url);
  idle.get(url)?.stop();
  idle.delete(url);
}

/** The worker of one layout: taken on first use, replaced after `stop`, given back at the end. */
function lease(url: string) {
  let current: LayoutWorker | undefined;
  return {
    get() {
      if (!current) {
        current = idle.get(url) ?? startWorker(url);
        idle.delete(url);
      }
      return current;
    },
    stop() {
      current?.stop();
      current = undefined;
    },
    done() {
      if (current && holders.has(url) && !idle.has(url)) idle.set(url, current);
      else current?.stop();
      current = undefined;
    },
  };
}

type Lease = ReturnType<typeof lease>;

class LayoutTimeout extends Error {}

/**
 * `promise`, unless the signal aborts or `ms` pass first: then `stop` ends the
 * run and the result rejects with the abort reason or a timeout. A run without
 * a worker is timed from its `turn`, and a result it sent first wins.
 */
function guard<T>(promise: Promise<T>, ms: number, signal: AbortSignal, stop?: () => void, turn?: Promise<unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const end = (error: unknown) => {
      clear();
      stop?.();
      reject(error);
    };
    const abort = () => end(signal.reason);
    const late = () => end(new LayoutTimeout(`layout timed out after ${ms} ms`));
    const clear = () => {
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort);
    // Timers fire at once beyond 2³¹ − 1 ms.
    void (turn ?? Promise.resolve()).then(() => done || (timer = setTimeout(stop ? late : () => (timer = setTimeout(late)), Math.min(ms, 2 ** 31 - 1))));
    promise.then((value) => (clear(), resolve(value)), (error) => (clear(), reject(error)));
  });
}

/** In-process ELK runs one layout after another, aborted ones included. */
let inProcessTurn: Promise<unknown> = Promise.resolve();

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
  const nodeSpacing = gap(spacing.node, 28);
  const layerSpacing = gap(spacing.layer, 64);
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
    "elk.spacing.componentComponent": String(gap(spacing.group, 48)),
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

async function layoutElk(p: Prepared, o: LayoutOptions, signal: AbortSignal, work?: Lease): Promise<Positions> {
  const ms = o.timeoutMs ?? 20000;
  const partition = (o.orderStages ?? true) && p.useGroups;
  const attempt = async (part: boolean) => {
    const elk = await (work ? work.get().elk() : o.elk ?? (inProcessElk ??= loadBundledCtor().then((Ctor) => new Ctor())));
    signal.throwIfAborted();
    if (work || o.elk) return fromElk(await guard(elk.layout(elkGraph(p, o, part)), ms, signal, work?.stop), p);
    const turn = inProcessTurn;
    const run = turn.then(() => (signal.throwIfAborted(), elk.layout(elkGraph(p, o, part))));
    inProcessTurn = run.catch(() => undefined);
    return fromElk(await guard(run, ms, signal, undefined, turn), p);
  };
  try {
    return await attempt(partition);
  } catch (err) {
    if (!partition || err instanceof LayoutTimeout || signal.aborted) throw err;
    return attempt(false);
  }
}

// ---------------------------------------------------------------------------
// Dagre

const DAGRE_DIR: Record<LayoutDirection, "LR" | "TB" | "RL" | "BT"> = { RIGHT: "LR", DOWN: "TB", LEFT: "RL", UP: "BT" };

/** A Dagre layout as plain data, so that it can cross to a worker. */
export interface DagreInput {
  graph: { rankdir: string; nodesep: number; ranksep: number; marginx: number; marginy: number };
  compound: boolean;
  /** Group id, label and parent group. */
  groups: [string, string, string?][];
  /** Node id, width, height and group. */
  nodes: [string, number, number, string?][];
  /** Edge id, source and target. */
  edges: [string, string, string][];
}

/** Centre and size of each node and group Dagre placed; the points of each edge. */
export interface DagreOutput {
  boxes: Record<string, { x: number; y: number; width?: number; height?: number }>;
  edges: Record<string, XY[]>;
}

function dagreInput(p: Prepared, o: LayoutOptions): DagreInput {
  const spacing = o.spacing ?? {};
  const groupIds = new Set(p.groups.map((gr) => gr.id));
  const nodeIds = new Set(p.nodes.map((n) => n.id));
  const inGroup = (id?: string) => (p.useGroups && id && groupIds.has(id) ? id : undefined);
  return {
    graph: { rankdir: DAGRE_DIR[p.direction], nodesep: gap(spacing.node, 28), ranksep: gap(spacing.layer, 64), marginx: 8, marginy: 8 },
    compound: p.useGroups,
    groups: p.useGroups ? p.groups.map((gr) => [gr.id, gr.label, inGroup(gr.parent)]) : [],
    nodes: p.nodes.map((n) => {
      const s = sizeOf(n, o);
      return [n.id, s.width, s.height, inGroup(n.group)];
    }),
    // Dagre would add a node without a size for a missing end.
    edges: p.edges.filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target)).map((e) => [e.id, e.source, e.target]),
  };
}

/** What the Dagre job uses of Dagre (its own types do not resolve for every consumer). */
interface DagreGraph {
  setGraph(label: object): unknown;
  setDefaultEdgeLabel(label: () => object): unknown;
  setNode(id: string, label: object): unknown;
  setParent(id: string, parent: string): unknown;
  setEdge(source: string, target: string, label: object, name: string): unknown;
  node(id: string): unknown;
  edge(edge: { v: string; w: string; name: string }): unknown;
}

/**
 * Runs Dagre on an input. It reads nothing but its arguments: the package's
 * Dagre worker runs this function's source as it is.
 */
export function dagreJob(dagre: { Graph: new (options: object) => DagreGraph; layout(graph: DagreGraph): void }, input: DagreInput): DagreOutput {
  // Graphlib reads "" as no name, keeps \x00 and \x01, and keys plain objects (a prototype member would write the prototype).
  const k = (id: string) => (!id || id < "\x03" || id in Object.prototype ? "\x02" + id : id);
  const g = new dagre.Graph({ compound: input.compound, multigraph: true });
  g.setGraph(input.graph);
  g.setDefaultEdgeLabel(() => ({}));
  for (const [id, label] of input.groups) g.setNode(k(id), { label, clusterLabelPos: "top" });
  for (const [id, , parent] of input.groups) if (parent) g.setParent(k(id), k(parent));
  for (const [id, width, height, parent] of input.nodes) {
    g.setNode(k(id), { width, height });
    if (parent) g.setParent(k(id), k(parent));
  }
  for (const [id, source, target] of input.edges) g.setEdge(k(source), k(target), { minlen: 1 }, k(id));
  dagre.layout(g);
  const boxes: DagreOutput["boxes"] = {};
  const edges: DagreOutput["edges"] = {};
  for (const [id] of [...input.groups, ...input.nodes]) {
    const v = g.node(k(id)) as DagreOutput["boxes"][string] | undefined;
    if (v) boxes[id] = { x: v.x, y: v.y, width: v.width, height: v.height };
  }
  for (const [id, source, target] of input.edges) {
    const v = g.edge({ v: k(source), w: k(target), name: k(id) }) as { points?: XY[] } | undefined;
    if (v?.points) edges[id] = v.points.map((pt) => ({ x: pt.x, y: pt.y }));
  }
  return { boxes, edges };
}

function fromDagre({ boxes, edges: points }: DagreOutput, p: Prepared): Positions {
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  for (const n of p.nodes) {
    const v = boxes[n.id] as Box | undefined;
    if (v) nodes[n.id] = { x: v.x - v.width / 2, y: v.y - v.height / 2, width: v.width, height: v.height };
  }
  if (p.useGroups) {
    for (const gr of p.groups) {
      const v = boxes[gr.id];
      if (!v || v.width === undefined || v.x === undefined) continue;
      const width = v.width + GROUP_PADDING.left + GROUP_PADDING.right;
      const height = (v.height ?? 0) + GROUP_PADDING.top + GROUP_PADDING.bottom;
      groups[gr.id] = { x: v.x - width / 2, y: (v.y ?? 0) - height / 2 - (GROUP_PADDING.top - GROUP_PADDING.bottom) / 2, width, height };
    }
  }
  for (const e of p.edges) if (points[e.id]) edges[e.id] = { points: points[e.id] };
  return createPositions({ nodes, groups, edges }, "dagre", p.direction);
}

/**
 * Dagre in the Dagre worker if there is one, else on the calling thread; as a
 * fallback on the calling thread only up to `fallbackLimit` nodes plus edges.
 */
async function layoutDagre(p: Prepared, o: LayoutOptions, signal: AbortSignal, work: Lease | undefined, fallback: boolean): Promise<Positions> {
  const input = dagreInput(p, o);
  if (work) return fromDagre(await guard(work.get().dagre(input), o.timeoutMs ?? 20000, signal, work.stop), p);
  const size = p.nodes.length + p.edges.length;
  const limit = o.fallbackLimit ?? 500;
  if (fallback && size > limit) {
    throw new LayoutUnavailableError(`Dagre fallback not run on the calling thread: ${p.nodes.length} nodes and ${p.edges.length} edges exceed the limit of ${limit}`);
  }
  return fromDagre(dagreJob(dagreModule, input), p);
}

// ---------------------------------------------------------------------------
// Public API

/** A layout that runs while somebody waits for it. */
interface Job {
  positions: Promise<Positions>;
  stop: AbortController;
  waiting: number;
  done: boolean;
}

function startJob(make: (signal: AbortSignal) => Promise<Positions>): Job {
  const stop = new AbortController();
  const job: Job = { positions: make(stop.signal), stop, waiting: 0, done: false };
  job.positions.then((positions) => {
    job.done = true;
    settled.set(job, positions);
  }, () => (job.done = true));
  return job;
}

/**
 * The job's positions, or the reason of the first of the signals to abort. When
 * the last caller stops waiting the job is stopped, unless it is asked for again
 * before the current task ends (a component that mounts again).
 */
function wait(job: Job, signals: (AbortSignal | undefined)[]): Promise<Positions> {
  const listened = signals.filter((s): s is AbortSignal => s !== undefined);
  // A finished layout is answered as it is; a newer request has nothing to stop.
  const known = settled.get(job);
  if (known && !listened.some((s) => s.aborted)) return Promise.resolve(known);
  job.waiting++;
  return new Promise((resolve, reject) => {
    const leave = () => listened.forEach((s) => s.removeEventListener("abort", abort));
    const abort = () => {
      leave();
      const reason = listened.find((s) => s.aborted)!.reason;
      reject(reason);
      if (--job.waiting === 0) queueMicrotask(() => job.waiting === 0 && !job.done && job.stop.abort(reason));
    };
    if (listened.some((s) => s.aborted)) return abort();
    listened.forEach((s) => s.addEventListener("abort", abort));
    job.positions.then((positions) => (leave(), resolve(positions)), (error) => (leave(), reject(error)));
  });
}

/** Layouts by caller key; the caller owns them. */
const cache = new Map<string, Job>();
/** The positions of finished layouts. */
const settled = new WeakMap<Job, Positions>();
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

/**
 * The layout kept under `key`, or a new one that is kept unless it fails or is
 * stopped. A layout that finished while its last waiter was leaving is kept
 * too: stopping it then stopped nothing. Hits move to the end.
 */
function remember(entries: Map<string, Job>, key: string, make: () => Job): Job {
  let job = entries.get(key);
  entries.delete(key);
  if (!job || (job.stop.signal.aborted && !settled.has(job))) {
    const made = (job = make());
    made.positions.catch(() => entries.get(key) === made && entries.delete(key));
  }
  entries.set(key, job);
  return job;
}

/** A job for these inputs; with a caller key, the one kept under it. */
function jobFor(graph: FlowGraph, options: LayoutOptions, held?: Set<string>): Job {
  const make = () => startJob((signal) => compute(graph, options, signal, held));
  return options.cacheKey ? remember(cache, options.cacheKey, make) : make();
}

async function compute(graph: FlowGraph, options: LayoutOptions, signal: AbortSignal, held?: Set<string>): Promise<Positions> {
  const p = prepare(graph, options);
  if (p.nodes.length === 0) {
    return createPositions({ nodes: {}, groups: {}, edges: {} }, options.engine === "dagre" ? "dagre" : "elk", p.direction);
  }
  const engine = options.engine ?? "auto";
  // The workers of this layout; a scope keeps those of each URL it used until it is disposed.
  // A supplied ELK instance replaces ELK's worker, not Dagre's.
  const [elk, dagre] = [options.elk ? undefined : options.elkWorkerUrl, options.dagreWorkerUrl].map((given) => {
    const url = workerUrl(given);
    if (url && held && !held.has(url)) {
      held.add(url);
      holdUrl(url, 1);
    }
    return url === undefined ? undefined : lease(url);
  });
  try {
    if (engine !== "dagre") {
      try {
        return await layoutElk(p, options, signal, elk);
      } catch (err) {
        if (engine === "elk" || signal.aborted) throw err;
      } finally {
        elk?.done();
      }
    }
    try {
      return await layoutDagre(p, options, signal, dagre, engine !== "dagre");
    } catch (err) {
      // ELK and then the Dagre worker failed.
      throw dagre && engine !== "dagre" && !signal.aborted ? new LayoutUnavailableError(`Neither ELK nor the Dagre worker laid out the graph: ${(err as Error).message}`) : err;
    }
  } finally {
    dagre?.done();
  }
}

/**
 * Lay out a graph. Positions are absolute and deterministic for the same input
 * (elements are sorted by id before the engine runs). Groups become compound nodes.
 * Without `cacheKey` nothing is kept; a worker started for this layout alone is
 * terminated when it is done or when `signal` aborts.
 */
export function layout(graph: FlowGraph, options: LayoutOptions = {}): Promise<Positions> {
  return options.signal?.aborted ? Promise.reject(options.signal.reason) : wait(jobFor(graph, options), [options.signal]);
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
 * instance by identity, `signal` not at all). A changed graph or changed options are laid out anew;
 * returning to earlier inputs is free. Caller keys go to the shared,
 * caller-owned cache as with `layout`. ELK workers the scope starts keep running
 * until it is disposed. Each request replaces the scope's earlier one: if that
 * is still running, it rejects with an `AbortError`, and its worker is
 * terminated unless another caller still waits for it.
 */
export interface LayoutScope {
  layout(graph: FlowGraph, options?: LayoutOptions): Promise<Positions>;
  layoutUnion(scenes: FlowGraph[], options?: LayoutOptions): Promise<Positions>;
  /** Number of layouts the scope keeps. */
  readonly size: number;
  /**
   * Forget the scope's layouts, stop waiting for its latest request (which
   * rejects with an `AbortError` unless it finished) and stop its workers once
   * no other scope or running layout uses them. The scope stays usable and
   * starts empty.
   */
  dispose(): void;
}

/** Finished layouts of each scope for given inputs, without computing anything. */
const finished = new WeakMap<LayoutScope, (graph: FlowGraph, options: LayoutOptions) => Positions | undefined>();

/**
 * The positions a scope (or, with `cacheKey`, the caller-keyed cache) already
 * holds for these inputs once their layout has finished; nothing is computed.
 */
export function knownLayout(scope: LayoutScope, graph: FlowGraph, options: LayoutOptions = {}): Positions | undefined {
  const job = options.cacheKey ? cache.get(options.cacheKey) : undefined;
  return job ? settled.get(job) : finished.get(scope)?.(graph, options);
}

/** Layouts keyed by the graph's nodes with resolved sizes, edges, groups and options; see `LayoutScope`. */
export function createLayoutScope(scopeOptions: LayoutScopeOptions = {}): LayoutScope {
  const maxEntries = Math.max(1, scopeOptions.maxEntries ?? 8);
  const entries = new Map<string, Job>();
  const held = new Set<string>();
  /** The scope's latest request and what stops waiting for it when the next one comes. */
  let latest: { job: Job; replaced: AbortController } | undefined;
  const replace = (why: string, job?: Job) => {
    latest?.replaced.abort(new DOMException(why, "AbortError"));
    latest = job && { job, replaced: new AbortController() };
  };
  let seen = generation;
  const forgetIfCleared = () => {
    if (seen !== generation) entries.clear();
    seen = generation;
  };
  const scope: LayoutScope = {
    layout(graph, options = {}) {
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      let job: Job;
      if (options.cacheKey) job = jobFor(graph, options, held);
      else {
        forgetIfCleared();
        const sizes = resolvedSizes(graph, options);
        const sized = { ...options, nodeSize: (node: FlowNode) => sizes.get(node.id)! };
        job = remember(entries, layoutInputKey(graph, options, sizes), () => jobFor(graph, sized, held));
        for (const oldest of entries.keys()) {
          if (entries.size <= maxEntries) break;
          entries.delete(oldest);
        }
      }
      if (latest?.job !== job) replace("A newer layout request replaced this one.", job);
      return wait(job, [options.signal, latest!.replaced.signal]);
    },
    layoutUnion(scenes, options) {
      return scope.layout(unionGraph(scenes), options);
    },
    get size() {
      forgetIfCleared();
      return entries.size;
    },
    dispose() {
      replace("The layout scope was disposed.");
      entries.clear();
      for (const url of held) holdUrl(url, -1);
      held.clear();
    },
  };
  finished.set(scope, (graph, options) => {
    if (options.cacheKey) return undefined;
    forgetIfCleared();
    const job = entries.get(layoutInputKey(graph, options));
    return job && settled.get(job);
  });
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

/** True when every node of `graph` has a box of finite numbers. */
export function coversGraph(positions: Positions, graph: FlowGraph): boolean {
  return graph.nodes.every((n) => finiteBox(positions.nodes[n.id]));
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
