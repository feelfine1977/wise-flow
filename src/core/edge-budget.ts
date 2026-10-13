/**
 * Which edges a map draws: at a small zoom only the paths whose lines can be
 * told apart (`pathsAtZoom`), and under an edge budget those of the edges in
 * view it keeps (protected first, then highlighted, then by weight, then id),
 * for every renderer.
 */
import { abstract } from "./aggregate.js";
import { isPath } from "./detail.js";
import type { EdgeMark } from "./element-marks.js";
import { metric } from "./model.js";
import type { FlowScene } from "./scene.js";
import { pathMetricOf } from "./style.js";

/** How many edges a map draws: a number, or `"all"`. */
export type EdgeBudget = number | "all";

/** The edges a map draws while its budget withholds some, and the edges its note counts. */
export interface ShownEdges {
  edges: readonly string[];
  total: number;
}

/**
 * What keeps an edge drawn under any budget, besides an overlay mark on it (one that names it, or an arc from its
 * source to its target), and what is drawn first within it.
 */
export interface EdgeProtection {
  selection?: { edges: readonly string[] };
  /** The element at the keyboard position. */
  focused?: string | null;
  /** Edges on a highlighted path (a focus of paths): drawn before the others, heaviest first, within the budget. */
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
  /** How many highlighted edges in view the budget withholds. */
  highlightedNotShown: number;
  /** How many of the paths in view it withholds (follows and flow edges, not indirect ones, and the loops a map's report does not name): what a panel counts as paths not drawn. */
  pathsNotShown: number;
}

// Per scene: each edge's rank by weight and id, and whether a mark is on it; kept with the edge marks for the
// metric and the overlay marks they were read from.
const orders = new WeakMap<readonly EdgeMark[], { given: string; overlays: FlowScene["marks"]; rank: Int32Array; marked: Uint8Array }>();

function orderOf(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph">) {
  const marks = scene.edgeMarks;
  const given = scene.style.edgeWidth?.metric ?? "count";
  let known = orders.get(marks);
  if (known && known.given === given && known.overlays === scene.marks) return known;
  // The metric the width reads, as the scales resolve it: cases, or the transitions where no path of the graph (loops too) gives cases.
  const name = pathMetricOf(scene.graph.edges)(given);
  const weight = marks.map((m) => metric(m.edge, name, -Infinity));
  const sorted = marks.map((_, i) => i).sort((a, b) => weight[b] - weight[a] || (marks[a].id < marks[b].id ? -1 : 1));
  const rank = new Int32Array(marks.length);
  sorted.forEach((i, at) => (rank[i] = at));
  const arcs = new Set(scene.marks.filter((m) => m.overlay.kind === "arc").map((m) => `${m.overlay.payload?.source}\n${m.overlay.payload?.target}`));
  const named = new Set(scene.marks.map((m) => m.edgeId));
  known = { given, overlays: scene.marks, rank, marked: Uint8Array.from(marks, (m) => +(named.has(m.id) || arcs.has(`${m.edge.source}\n${m.edge.target}`))) };
  orders.set(marks, known);
  return known;
}

type BudgetScene = Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph" | "positions">;

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

/** The edges a budget draws of those in view (all when omitted), or those a map reported; undefined when it withholds none. The loops in view count too. */
export function budgetEdges(scene: BudgetScene, budget: EdgeBudget | ShownEdges | undefined, protection: EdgeProtection = {}, inView?: readonly number[], loops?: readonly string[]): EdgeSelection | undefined {
  const total = inView ? inView.length : scene.edgeMarks.length;
  // No value withholds nothing, also null where a host keeps "no value" so.
  if (budget === null) return undefined;
  loops ??= [...selfLoopsOf(scene).values()].flat();
  if (typeof budget === "object") {
    const named = new Set(budget.edges);
    const drawn = new Set<number>();
    let pathsNotShown = 0;
    for (let k = 0; k < total; k++) {
      const i = inView ? inView[k] : k;
      const mark = scene.edgeMarks[i];
      if (named.has(mark.id)) drawn.add(i);
      else if (isPath(mark.edge)) pathsNotShown++;
    }
    // A loop in view the map did not draw is a path not shown too.
    const drawnLoops = loops.filter((id) => named.has(id));
    pathsNotShown += loops.length - drawnLoops.length;
    loops = drawnLoops;
    return drawn.size < total ? { drawn, shown: drawn.size + loops.length, total: budget.total, kept: drawn.size, loops, highlightedNotShown: 0, pathsNotShown } : undefined;
  }
  // Not a number (NaN) withholds nothing, as "all" does.
  if (budget === undefined || budget === "all" || !(total > budget)) return undefined;
  const { rank, marked } = orderOf(scene);
  const selected = new Set(protection.selection?.edges);
  const drawn = new Set<number>();
  const highlighted: number[] = [];
  const rest: number[] = [];
  // The edges a budget may withhold that are paths.
  const paths = new Set<number>();
  for (let k = 0; k < total; k++) {
    const i = inView ? inView[k] : k;
    const { id, edge } = scene.edgeMarks[i];
    if (marked[i] || selected.has(id) || protection.focused === id) drawn.add(i);
    else {
      (protection.highlighted?.has(id) ? highlighted : rest).push(i);
      if (isPath(edge)) paths.add(i);
    }
  }
  const kept = drawn.size;
  const room = Math.floor(budget) - kept;
  const byRank = (a: number, b: number) => rank[a] - rank[b];
  // The highlighted edges first, heaviest first, then the others; both within the budget.
  if (room > 0) for (const i of [...highlighted.sort(byRank), ...rest.sort(byRank)].slice(0, room)) drawn.add(i);
  const highlightedNotShown = highlighted.filter((i) => !drawn.has(i)).length;
  const pathsNotShown = [...paths].filter((i) => !drawn.has(i)).length;
  return drawn.size < total ? { drawn, shown: drawn.size + loops.length, total: total + loops.length, kept, loops, highlightedNotShown, pathsNotShown } : undefined;
}

/** The paths a map lets through at a zoom (`pathsAtZoom`): positions in `scene.edgeMarks`, and how many paths it withholds. */
export interface ZoomedPaths {
  /** The edges let through, in the scene's order. */
  through: number[];
  /** The paths withheld (follows and flow edges); every other edge is let through. */
  withheld: number;
}

// Per scene: the ids of the paths that keep every activity on a way from a start to an end.
const anchorsByMarks = new WeakMap<readonly EdgeMark[], ReadonlySet<string>>();

/**
 * The paths that keep each activity of a scene on a way from a start to an
 * end: what the detail shares keep of the scene's graph at every activity and
 * no path by frequency, each activity's strongest path from and to a more
 * frequent activity, a start or an end (`abstract`).
 */
function anchorsOf(scene: Pick<FlowScene, "edgeMarks" | "graph">): ReadonlySet<string> {
  let anchors = anchorsByMarks.get(scene.edgeMarks);
  if (!anchors) anchorsByMarks.set(scene.edgeMarks, (anchors = new Set(abstract(scene.graph, { activityDetail: 1, pathDetail: 0 }).edges.map((e) => e.id))));
  return anchors;
}

/**
 * The paths a map lets through at `zoom`: a path is drawn while its line is
 * at least `minPx` of a screen pixel wide (its width on the width scale,
 * `EdgeMark.width`, times the zoom). Always let through: every edge that is
 * not a path (constraint edges, indirect paths), a path that loops on one
 * activity, a path with a mark on it, a selected or focused one, one on a
 * highlighted path, and the paths that keep every activity on a way from a
 * start to an end (each activity's strongest path from and to a more
 * frequent one). Undefined when every path is let through, also with
 * `minPx` 0. What it lets through grows as the zoom grows.
 */
export function pathsAtZoom(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph">, zoom: number, minPx: number, protection: EdgeProtection = {}): ZoomedPaths | undefined {
  const marks = scene.edgeMarks;
  if (!(minPx > 0) || !(zoom > 0) || marks.every((m) => m.width * zoom >= minPx)) return undefined;
  const { marked } = orderOf(scene);
  const anchors = anchorsOf(scene);
  const selected = new Set(protection.selection?.edges);
  const through: number[] = [];
  let withheld = 0;
  marks.forEach(({ id, edge, width }, i) => {
    const kept = !isPath(edge) || edge.source === edge.target || width * zoom >= minPx || marked[i] || selected.has(id) || protection.focused === id || !!protection.highlighted?.has(id) || anchors.has(id);
    if (kept) through.push(i);
    else withheld++;
  });
  return withheld ? { through, withheld } : undefined;
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
 * above the target that drew more than the step below would, up after RUN
 * below half of it (a step doubles the edges) that withheld edges.
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
