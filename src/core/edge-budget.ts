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
  shown: number;
  total: number;
}

// Per scene: each edge's rank by weight and id, and whether a mark is on it.
const orders = new WeakMap<readonly EdgeMark[], { rank: Int32Array; marked: Uint8Array }>();

function orderOf(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style">) {
  const marks = scene.edgeMarks;
  let known = orders.get(marks);
  if (known) return known;
  const name = scene.style.edgeWidth?.metric ?? "count";
  const weight = marks.map((m) => metric(m.edge, name, -Infinity));
  const sorted = marks.map((_, i) => i).sort((a, b) => weight[b] - weight[a] || (marks[a].id < marks[b].id ? -1 : 1));
  const rank = new Int32Array(marks.length);
  sorted.forEach((i, at) => (rank[i] = at));
  const arcs = new Set(scene.marks.filter((m) => m.overlay.kind === "arc").map((m) => `${m.overlay.payload?.source}\n${m.overlay.payload?.target}`));
  const named = new Set(scene.marks.map((m) => m.edgeId));
  known = { rank, marked: Uint8Array.from(marks, (m) => +(named.has(m.id) || arcs.has(`${m.edge.source}\n${m.edge.target}`))) };
  orders.set(marks, known);
  return known;
}

/** The edges a budget draws of those in view (all when omitted); undefined when it withholds none. */
export function budgetEdges(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style">, budget: EdgeBudget | undefined, protection: EdgeProtection = {}, inView?: readonly number[]): EdgeSelection | undefined {
  const total = inView ? inView.length : scene.edgeMarks.length;
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
  rest.sort((a, b) => rank[a] - rank[b]);
  for (let k = 0, room = Math.floor(budget) - drawn.size; k < room && k < rest.length; k++) drawn.add(rest[k]);
  return drawn.size < total ? { drawn, shown: drawn.size, total } : undefined;
}

/** The adaptive budget's first step; the steps are 500, 1,000, 2,000, … */
export const FIRST_STEP = 2000;
const TARGET_MS = 16.7;
const RUN = 5;

/** The edges a frame drew and those in view. */
export interface FrameCounts {
  shown: number;
  total: number;
}

/**
 * The adaptive budget. It times the frames of gestures with `clock` (ms) and,
 * as the last gesture ends, moves one step: down after RUN frames in a row
 * above the target that drew more than the step below, up after RUN below
 * half of it (a step doubles the edges) that withheld edges.
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
      const { shown, total } = draw(budget);
      const ms = clock() - started;
      slow = ms > TARGET_MS && budget > 500 && shown > budget / 2 ? slow + 1 : 0;
      fast = ms < TARGET_MS / 2 && shown < total ? fast + 1 : 0;
      if (slow === RUN) due = -1;
      if (fast === RUN) due = 1;
    },
  };
}

export type EdgeBudgetAdapter = ReturnType<typeof edgeBudgetAdapter>;
