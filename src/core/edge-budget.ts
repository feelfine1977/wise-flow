/**
 * The edge budget: how many of the edges in view a map draws, resolved here
 * so that every renderer draws the same ones. The order is protected edges
 * first, then the weight (the metric the edge width reads, `count` by
 * default) descending, then the id; a budget of n draws the first n of it,
 * and every protected edge even beyond n.
 */
import type { EdgeMark } from "./element-marks.js";
import { metric } from "./model.js";
import type { FlowScene } from "./scene.js";

/** How many edges a map draws: a number, or `"all"`. */
export type EdgeBudget = number | "all";

/** The edges a map draws while its budget withholds some, and the edges its note counts. */
export interface ShownEdges {
  edges: readonly string[];
  total: number;
}

/** What keeps an edge drawn under any budget, besides an overlay mark on it (one that names it, or an arc from its source to its target). */
export interface EdgeProtection {
  selection?: { edges: readonly string[] };
  /** The element at the keyboard position. */
  focused?: string | null;
  /** Edges on a highlighted path. */
  highlighted?: ReadonlySet<string>;
}

/** The edges drawn under a budget that withholds some: positions in `scene.edgeMarks`. */
export interface EdgeSelection {
  drawn: Set<number>;
  /** The paths the note counts as shown and in view: the edges drawn and in view, and the loops. */
  shown: number;
  total: number;
  /** How many of the drawn edges every budget draws: the protected ones. */
  kept: number;
  /** The paths in view that loop on one activity (ids): drawn as loops, never withheld. */
  loops: readonly string[];
}

// Per scene: each edge's rank by weight and id, and whether a mark is on it; kept with the edge marks for the
// metric and the overlay marks they were read from.
const orders = new WeakMap<readonly EdgeMark[], { name: string; overlays: FlowScene["marks"]; rank: Int32Array; marked: Uint8Array }>();

function orderOf(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style">) {
  const marks = scene.edgeMarks;
  const name = scene.style.edgeWidth?.metric ?? "count";
  let known = orders.get(marks);
  if (known && known.name === name && known.overlays === scene.marks) return known;
  const weight = marks.map((m) => metric(m.edge, name, -Infinity));
  const sorted = marks.map((_, i) => i).sort((a, b) => weight[b] - weight[a] || (marks[a].id < marks[b].id ? -1 : 1));
  const rank = new Int32Array(marks.length);
  sorted.forEach((i, at) => (rank[i] = at));
  const arcs = new Set(scene.marks.filter((m) => m.overlay.kind === "arc").map((m) => `${m.overlay.payload?.source}\n${m.overlay.payload?.target}`));
  const named = new Set(scene.marks.map((m) => m.edgeId));
  known = { name, overlays: scene.marks, rank, marked: Uint8Array.from(marks, (m) => +(named.has(m.id) || arcs.has(`${m.edge.source}\n${m.edge.target}`))) };
  orders.set(marks, known);
  return known;
}

type BudgetScene = Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph" | "positions">;

// Per scene: the edges from a placed node to itself, by node.
const loopsByNode = new WeakMap<readonly EdgeMark[], Map<string, string[]>>();

/** The paths that loop on one activity, by activity: edges from a placed node to itself. */
export function selfLoopsOf(scene: Pick<BudgetScene, "edgeMarks" | "graph" | "positions">): Map<string, string[]> {
  let loops = loopsByNode.get(scene.edgeMarks);
  if (!loops) {
    loopsByNode.set(scene.edgeMarks, (loops = new Map()));
    for (const e of scene.graph.edges) if (e.source === e.target && scene.positions.nodes[e.source]) loops.set(e.source, [...(loops.get(e.source) ?? []), e.id]);
  }
  return loops;
}

/**
 * The edges a budget draws of those in view (all when omitted), or those a map reported; undefined when it
 * withholds none. The paths that loop on one activity in view (`loops`, all when omitted) count in both numbers.
 */
export function budgetEdges(scene: BudgetScene, budget: EdgeBudget | ShownEdges | undefined, protection: EdgeProtection = {}, inView?: readonly number[], loops?: readonly string[]): EdgeSelection | undefined {
  const total = inView ? inView.length : scene.edgeMarks.length;
  // No value withholds nothing, also null where a host keeps "no value" so.
  if (budget === null) return undefined;
  loops ??= [...selfLoopsOf(scene).values()].flat();
  if (typeof budget === "object") {
    const named = new Set(budget.edges);
    const drawn = new Set<number>();
    for (let k = 0; k < total; k++) {
      const i = inView ? inView[k] : k;
      if (named.has(scene.edgeMarks[i].id)) drawn.add(i);
    }
    loops = loops.filter((id) => named.has(id));
    return drawn.size < total ? { drawn, shown: drawn.size + loops.length, total: budget.total, kept: drawn.size, loops } : undefined;
  }
  // Not a number (NaN) withholds nothing, as "all" does.
  if (budget === undefined || budget === "all" || !(total > budget)) return undefined;
  const { rank, marked } = orderOf(scene);
  const selected = new Set(protection.selection?.edges);
  const drawn = new Set<number>();
  const rest: number[] = [];
  for (let k = 0; k < total; k++) {
    const i = inView ? inView[k] : k;
    const id = scene.edgeMarks[i].id;
    if (marked[i] || selected.has(id) || protection.focused === id || protection.highlighted?.has(id)) drawn.add(i);
    else rest.push(i);
  }
  const kept = drawn.size;
  const room = Math.floor(budget) - kept;
  if (room > 0) for (const i of rest.sort((a, b) => rank[a] - rank[b]).slice(0, room)) drawn.add(i);
  return drawn.size < total ? { drawn, shown: drawn.size + loops.length, total: total + loops.length, kept, loops } : undefined;
}

/** The adaptive budget's first step; the steps are 500, 1,000, 2,000, … */
export const FIRST_STEP = 2000;
const TARGET_MS = 16.7;
const RUN = 5;

/** The edges a frame drew, those in view, and how many of those drawn every step draws (protected). */
export interface FrameCounts {
  shown: number;
  total: number;
  kept?: number;
}

/**
 * The adaptive budget. It times the frames of gestures with `clock` (ms) and,
 * as the last gesture ends, moves one step: down after RUN frames in a row
 * above the target that drew more than the step below would (half the budget,
 * or the protected edges where they are more), up after RUN below half of it
 * (a step doubles the edges) that withheld edges.
 */
export function edgeBudgetAdapter(clock: () => number) {
  let budget = FIRST_STEP;
  let gestures = 0;
  let slow = 0;
  let fast = 0;
  let due = 0;
  return {
    get budget() {
      return budget;
    },
    start() {
      if (!gestures++) slow = fast = due = 0;
    },
    end() {
      if (!gestures || --gestures) return false;
      budget *= 2 ** due;
      return !!due;
    },
    frame(draw: (budget: number) => FrameCounts) {
      if (!gestures) return void draw(budget);
      const started = clock();
      const { shown, total, kept = 0 } = draw(budget);
      const ms = clock() - started;
      slow = ms > TARGET_MS && budget > 500 && shown > Math.max(kept, budget / 2) ? slow + 1 : 0;
      fast = ms < TARGET_MS / 2 && shown < total ? fast + 1 : 0;
      if (slow === RUN) due = -1;
      if (fast === RUN) due = 1;
    },
  };
}

export type EdgeBudgetAdapter = ReturnType<typeof edgeBudgetAdapter>;
