/**
 * Fake layout workers and engines for lifecycle tests. `FakeLayoutWorker`
 * stands in for `Worker`: at the ELK URL it speaks ELK's worker protocol, at
 * the Dagre URL the package's Dagre protocol, and it answers a layout only when
 * the test says so, also after it was terminated (a real worker could not).
 * Every answer carries a serial number in its coordinates, so a test can read
 * from any positions which answer they came from (`replyOf`) and compare the
 * inputs that answer was computed for (`layoutSignature`) with what a caller
 * asked for. `HeldEngine` is an ELK instance a caller supplies, answered the
 * same way; the module cannot interrupt it.
 */
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import type { DagreInput, DagreOutput } from "../../src/core/layout";
import type { FlowGraph, FlowNode, LayoutDirection, LayoutOptions, NodeSize, Positions } from "../../src/index";

/** The default box of an activity in the token table. */
export const ACTIVITY_SIZE: NodeSize = { width: 180, height: 64 };

/** Multiplied by the answer's serial number to give the y coordinate of every box it places. */
const REPLY_STEP = 1000;

const DIRECTION_OF_RANKDIR: Record<string, LayoutDirection> = { LR: "RIGHT", TB: "DOWN", RL: "LEFT", BT: "UP" };

/** A node as the engines see it: id, size and the group it sits in. */
type SeenNode = [id: string, width: number, height: number, group?: string];

/**
 * What the engines are given of a graph and options, as one string: the
 * direction, the two spacings, the nodes with their sizes and groups, and the
 * edges between different nodes. A fake worker computes the same string from
 * the message it receives, so the inputs of an answer can be compared with the
 * inputs of a request.
 */
export function layoutSignature(graph: FlowGraph, options: LayoutOptions = {}): string {
  const size = (n: FlowNode) => (typeof options.nodeSize === "function" ? options.nodeSize(n) : options.nodeSize ?? ACTIVITY_SIZE);
  const groups = new Set((options.groups ?? "compound") === "compound" ? (graph.groups ?? []).map((g) => g.id) : []);
  return signature(
    options.direction ?? "RIGHT",
    options.spacing?.node ?? 28,
    options.spacing?.layer ?? 64,
    graph.nodes.map((n) => [n.id, size(n).width, size(n).height, n.group !== undefined && groups.has(n.group) ? n.group : undefined]),
    graph.edges.filter((e) => e.source !== e.target).map((e) => [e.source, e.target]),
  );
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function signature(direction: string, nodeGap: number | string, layerGap: number | string, nodes: SeenNode[], edges: [string, string][]): string {
  const seen = nodes.map(([id, w, h, group]) => `${id}:${w}x${h}${group === undefined ? "" : `@${group}`}`).sort(byText);
  const between = edges.map(([s, t]) => `${s}>${t}`).sort(byText);
  return `${direction} ${nodeGap}/${layerGap} | ${seen.join(",")} | ${between.join(",")}`;
}

function elkSignature(root: ElkNode): string {
  const nodes: SeenNode[] = [];
  const walk = (node: ElkNode, group: string | undefined) => {
    for (const child of node.children ?? []) {
      if (child.children) walk(child, child.id);
      else nodes.push([child.id, child.width ?? 0, child.height ?? 0, group]);
    }
  };
  walk(root, undefined);
  const o = root.layoutOptions ?? {};
  const edges = (root.edges ?? []).map((e): [string, string] => [e.sources[0], e.targets[0]]);
  return signature(o["elk.direction"], o["elk.spacing.nodeNode"], o["elk.layered.spacing.nodeNodeBetweenLayers"], nodes, edges);
}

function dagreSignature(input: DagreInput): string {
  return signature(
    DIRECTION_OF_RANKDIR[input.graph.rankdir],
    input.graph.nodesep,
    input.graph.ranksep,
    input.nodes.map(([id, w, h, group]) => [id, w, h, group]),
    input.edges.map(([, s, t]) => [s, t]),
  );
}

/** The box ELK's fake gives a group. */
const GROUP_SIZE: NodeSize = { width: 300, height: 200 };
/** Dagre's padding around a group, as the layout module adds it (`GROUP_PADDING`). */
const DAGRE_GROUP = { top: 44, left: 20, bottom: 20, right: 20 };

/**
 * The ELK graph with every element placed: children 100 apart in the order
 * given, the top level at the answer's y and nested children at 0 inside their
 * group, so every box's absolute y is the answer's; groups get one size.
 */
export function placed(graph: ElkNode, reply: number, depth = 0): ElkNode {
  return {
    ...graph,
    children: (graph.children ?? []).map((child, i) => ({
      ...placed(child, reply, depth + 1),
      ...(child.children ? { width: child.width ?? GROUP_SIZE.width, height: child.height ?? GROUP_SIZE.height } : {}),
      x: 100 * i,
      y: depth === 0 ? REPLY_STEP * reply : 0,
    })),
  };
}

/** Dagre's answer: node and group centres 100 apart, every box's top at the answer's y once the module has read it; no routes. */
function dagreAnswer(input: DagreInput, reply: number): DagreOutput {
  const boxes: DagreOutput["boxes"] = {};
  input.nodes.forEach(([id, width, height], i) => {
    boxes[id] = { x: 100 * i + width / 2, y: REPLY_STEP * reply + height / 2, width, height };
  });
  // The module pads a group and moves it up by half the difference of the top and bottom padding:
  // its top is centre − (height + top + bottom) / 2 − (top − bottom) / 2 = centre − height / 2 − top.
  input.groups.forEach(([id], i) => {
    const { width, height } = GROUP_SIZE;
    boxes[id] = { x: 100 * i + width / 2, y: REPLY_STEP * reply + height / 2 + DAGRE_GROUP.top, width, height };
  });
  return { boxes, edges: {} };
}

/**
 * The serial number of the answer the positions came from: `undefined` without
 * node boxes, `null` when the boxes do not all come from one answer.
 */
export function replyOf(positions: Positions): number | null | undefined {
  const replies = new Set(Object.values(positions.nodes).map((box) => box.y / REPLY_STEP));
  if (replies.size === 0) return undefined;
  if (replies.size > 1) return null;
  const [reply] = replies;
  return Number.isInteger(reply) ? reply : null;
}

/** A layout a fake worker or the engine received. */
export interface ReceivedLayout {
  /** The inputs it carries, as `layoutSignature` writes them. */
  signature: string;
  /** `Date.now()` when it arrived (the fake clock's time under fake timers). */
  postedAt: number;
  answered: boolean;
  /** `Date.now()` when the module read the answer or the failure; an answer sent in a task is read in a microtask after it. */
  answeredAt?: number;
  /** ELK protocol: the message id the answer must carry. */
  id?: number;
  graph?: ElkNode;
  input?: DagreInput;
}

/** Where a schedule's answers go: a fake worker, or an ELK instance the caller supplied. */
export interface AnswerSource {
  readonly kind: "elk" | "dagre" | "engine";
  /** Position in `FakeLayoutWorker.created`; -1 for the engine. */
  readonly index: number;
  readonly layouts: ReceivedLayout[];
  /** The layouts not answered yet. */
  readonly pending: number[];
  readonly terminated: boolean;
  /** Answers layout `k` with boxes that carry `reply`. */
  answer(k: number, reply: number): void;
  /** Answers layout `k` with an engine error. */
  fail(k: number): void;
}

export class FakeLayoutWorker implements AnswerSource {
  static readonly elkUrl = "https://example.test/elk-worker.min.js";
  static readonly dagreUrl = "https://example.test/dagre-worker.min.js";
  /** Every worker started since the list was last emptied, in order. */
  static created: FakeLayoutWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminated = false;
  /** Messages posted after termination; a real worker would never see them. */
  postedAfterTermination = 0;
  readonly kind: "elk" | "dagre";
  readonly layouts: ReceivedLayout[] = [];
  readonly index: number;

  constructor(readonly url: string) {
    if (url !== FakeLayoutWorker.elkUrl && url !== FakeLayoutWorker.dagreUrl) throw new Error(`unexpected worker URL ${url}`);
    this.kind = url === FakeLayoutWorker.dagreUrl ? "dagre" : "elk";
    this.index = FakeLayoutWorker.created.push(this) - 1;
  }

  /** The layouts not answered yet. */
  get pending(): number[] {
    return this.layouts.flatMap((l, k) => (l.answered ? [] : [k]));
  }

  postMessage(message: unknown): void {
    if (this.terminated) {
      this.postedAfterTermination++;
      return;
    }
    if (this.kind === "dagre") {
      const input = message as DagreInput;
      this.layouts.push({ signature: dagreSignature(input), postedAt: Date.now(), answered: false, input });
      return;
    }
    const m = message as { id: number; cmd: string; graph?: ElkNode };
    if (m.cmd === "register") this.send({ id: m.id, data: true });
    else if (m.cmd === "layout") this.layouts.push({ signature: elkSignature(m.graph!), postedAt: Date.now(), answered: false, id: m.id, graph: m.graph });
  }

  /** Answers layout `k` with boxes that carry `reply`, also after termination. */
  answer(k: number, reply: number): void {
    const l = this.layouts[k];
    l.answered = true;
    if (this.kind === "dagre") this.send({ output: dagreAnswer(l.input!, reply) }, l);
    else this.send({ id: l.id, data: placed(l.graph!, reply) }, l);
  }

  /** Answers layout `k` with an engine error. */
  fail(k: number): void {
    const l = this.layouts[k];
    l.answered = true;
    if (this.kind === "dagre") this.send({ error: "engine down" }, l);
    else this.send({ id: l.id, error: { message: "engine down" } }, l);
  }

  terminate(): void {
    this.terminated = true;
  }

  private send(data: unknown, layout?: ReceivedLayout): void {
    queueMicrotask(() => {
      if (layout) layout.answeredAt = Date.now();
      this.onmessage?.({ data });
    });
  }
}

/**
 * An ELK instance a caller supplies: its layouts finish when the test answers
 * them, with the same encoding as the workers. The layout module cannot
 * interrupt it, so a layout nobody waits for any more stays pending until the
 * test answers it, and that answer must be discarded.
 */
export class HeldEngine implements AnswerSource {
  readonly kind = "engine" as const;
  readonly index = -1;
  readonly terminated = false;
  readonly layouts: ReceivedLayout[] = [];
  /** The instance to pass as `elk`. */
  readonly elk: ELK;
  private readonly calls: { resolve: (result: ElkNode) => void; reject: (error: Error) => void }[] = [];

  constructor() {
    this.elk = {
      layout: (graph: ElkNode) =>
        new Promise<ElkNode>((resolve, reject) => {
          this.layouts.push({ signature: elkSignature(graph), postedAt: Date.now(), answered: false, graph });
          this.calls.push({ resolve, reject });
        }),
    } as unknown as ELK;
  }

  get pending(): number[] {
    return this.layouts.flatMap((l, k) => (l.answered ? [] : [k]));
  }

  answer(k: number, reply: number): void {
    const l = this.layouts[k];
    l.answered = true;
    l.answeredAt = Date.now();
    this.calls[k].resolve(placed(l.graph!, reply));
  }

  fail(k: number): void {
    const l = this.layouts[k];
    l.answered = true;
    l.answeredAt = Date.now();
    this.calls[k].reject(new Error("engine down"));
  }
}
