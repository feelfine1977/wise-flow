/**
 * Searching tests of the keyboard on random maps: random graphs above and
 * below the limit of the element list, random sequences of keys through the
 * map controller, the element list the Canvas map renders and the edges the
 * budget draws; reachability against a graph search written here; and the
 * same walk on the mounted map, read from its DOM.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AbstractOptions, type EdgeBudget, type ElementRef, type FlowEdge, type FlowGraph, type FlowScene, type GraphIndex, type Positions, type Selection, type ShownEdges, abstract, budgetEdges, buildScene, indexGraph } from "../../src/index";
import { type MapContext, type MapEvent, type MapState, initialMapState, mapEmphasis, mapStep } from "../../src/core/map-controller";
import { ProcessMap } from "../../src/react/index";
import { firstInReadingOrder, listedElements } from "../../src/react/map-elements";
import { type FamilyName, families } from "../support/graphs";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { POSITION_KINDS, positionsOf } from "../support/scenes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A random map: a graph of a family, positions, the scene the renderers draw,
// the limit of the element list (above or below the graph's size) and a budget.

interface RandomMap {
  name: string;
  graph: FlowGraph;
  scene: FlowScene;
  /** The boxes the keyboard moves between: the scene's. */
  positions: Positions;
  index: GraphIndex;
  limit: number;
  budget: EdgeBudget;
}

const FAMILY_NAMES = Object.keys(families) as FamilyName[];

function randomMap(seed: number): RandomMap {
  const rng = createRandom(seed);
  const family = rng.pick(FAMILY_NAMES);
  const size = rng.weighted([[rng.int(1, 6), 2], [rng.int(7, 30), 5], [rng.int(31, 60), 2]] as const);
  const graph = families[family](size, seed, { mixedKinds: rng.chance(0.4) });
  const kind = rng.pick(POSITION_KINDS);
  const scene = buildScene(graph, positionsOf(graph, kind, seed, { routes: rng.chance(0.5) }), { overlays: graph.overlays, selfLoops: true, lodBySize: true });
  const elements = graph.nodes.length + (graph.groups?.length ?? 0);
  // Below, at and above the limit: a limit of one or two, a limit just under or over the graph, or the default.
  const limit = rng.weighted([[rng.int(1, 3), 2], [Math.max(1, elements - rng.int(1, 5)), 3], [elements, 1], [elements + rng.int(1, 5), 2], [500, 1]] as const);
  const edges = scene.edgeMarks.length;
  const budget = rng.weighted<EdgeBudget>([["all", 2], [rng.int(0, Math.max(1, Math.floor(edges / 2))), 3], [Math.max(1, edges - 1), 1]]);
  return { name: `${family} ${size} ${kind}, limit ${limit}, budget ${budget}`, graph, scene, positions: scene.positions, index: indexGraph(graph), limit, budget };
}

// ---------------------------------------------------------------------------
// The documented keyboard, written out here without the controller's code.

const key = (k: string, mods: { altKey?: boolean; shiftKey?: boolean } = {}): Extract<MapEvent, { type: "key" }> => ({ type: "key", key: k, ...mods });
const ARROWS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
const forward = (k: string) => k === "ArrowRight" || k === "ArrowDown";

/** The paths Alt and the arrow keys move along: those joining two different nodes that have boxes; constraints are not paths. */
function pathsOf(graph: FlowGraph, positions: Positions): FlowEdge[] {
  return graph.edges.filter((e) => e.kind !== "constraint" && e.source !== e.target && !!positions.nodes[e.source] && !!positions.nodes[e.target]);
}

/** Home's and End's node: the first and last of the nodes with a box, left to right, then top to bottom, ties in the graph's order. */
function homeAndEnd(graph: FlowGraph, positions: Positions): { home?: string; end?: string } {
  let home: string | undefined;
  let end: string | undefined;
  for (const n of graph.nodes) {
    const b = positions.nodes[n.id];
    if (!b) continue;
    const h = home === undefined ? undefined : positions.nodes[home];
    if (!h || b.x < h.x || (b.x === h.x && b.y < h.y)) home = n.id;
    const e = end === undefined ? undefined : positions.nodes[end];
    if (!e || b.x > e.x || (b.x === e.x && b.y >= e.y)) end = n.id;
  }
  return { home, end };
}

const refKey = (ref: ElementRef) => `${ref.kind}:${ref.id}`;

/**
 * Every element the documented moves reach (Home, End, Alt with an arrow key
 * from a node to each of its paths in turn and from a path to its ends), from
 * no keyboard position or from a selected node: a breadth-first search over
 * the graph.
 */
function documentedReach(graph: FlowGraph, positions: Positions, selected?: string): Set<string> {
  const paths = pathsOf(graph, positions);
  const { home, end } = homeAndEnd(graph, positions);
  const reached = new Set<string>();
  const queue: ElementRef[] = [];
  const reach = (ref: ElementRef) => {
    if (reached.has(refKey(ref))) return;
    reached.add(refKey(ref));
    queue.push(ref);
  };
  const along = (node: string) => paths.filter((e) => e.source === node || e.target === node).forEach((e) => reach({ kind: "edge", id: e.id }));
  for (const id of [home, end]) if (id !== undefined) reach({ kind: "node", id });
  if (selected !== undefined && positions.nodes[selected]) along(selected);
  while (queue.length) {
    const at = queue.shift()!;
    if (at.kind === "node") along(at.id);
    else {
      const e = paths.find((x) => x.id === at.id)!;
      reach({ kind: "node", id: e.source });
      reach({ kind: "node", id: e.target });
    }
  }
  return reached;
}

/** The element at the keyboard position, as the map names it for `aria-activedescendant`. */
function keyboardRef(state: MapState, graph: FlowGraph): ElementRef | undefined {
  if (state.active === null) return undefined;
  return graph.edges.some((e) => e.id === state.active) ? { kind: "edge", id: state.active } : { kind: "node", id: state.active };
}

/** What a move key may lead to from the keyboard position, by the documentation. */
function documentedStep(graph: FlowGraph, positions: Positions, before: MapState, event: Extract<MapEvent, { type: "key" }>): Set<string> | undefined {
  const { home, end } = homeAndEnd(graph, positions);
  const at = keyboardRef(before, graph);
  const node = at?.kind === "node" ? at.id : at === undefined ? before.selection.nodes[0] : undefined;
  const edge = at?.kind === "edge" ? graph.edges.find((e) => e.id === at.id) : undefined;
  if (event.key === "Home") return new Set([`node:${home}`]);
  if (event.key === "End") return new Set([`node:${end}`]);
  if (!ARROWS.includes(event.key) || !event.altKey) return undefined;
  if (edge) return new Set([`node:${forward(event.key) ? edge.target : edge.source}`]);
  if (node === undefined) return new Set([`node:${home}`]);
  const out = pathsOf(graph, positions).filter((e) => (forward(event.key) ? e.source : e.target) === node);
  // Without a path in that direction the keyboard stays where it is.
  return new Set(out.length ? out.map((e) => `edge:${e.id}`) : [at ? refKey(at) : "none"]);
}

// ---------------------------------------------------------------------------
// Driving the controller as the map does: a key, and the menu the host opens.

interface Walk {
  state: MapState;
  context: MapContext;
}

/** Apply an event and what the map does for its intents: open the menu where it asked, report a chosen action as done. Returns the sentences for the live region. */
function press(walk: Walk, event: MapEvent): string[] {
  const queue: MapEvent[] = [event];
  const said: string[] = [];
  while (queue.length) {
    const step = mapStep(walk.state, queue.shift()!, walk.context);
    walk.state = step.state;
    if (step.announcement !== undefined) said.push(step.announcement);
    for (const intent of step.intents) {
      if (intent.kind === "menu") queue.push({ type: "openMenu", element: intent.element, at: { x: 0, y: 0 } });
      if (intent.kind === "run") queue.push({ type: "actionDone", action: intent.action });
    }
  }
  return said;
}

/** A random key: on the map the moves, the modified arrows, selection, Enter for the menu and Escape; in the menu its own keys. */
function randomKey(rng: Random, menuOpen: boolean): Extract<MapEvent, { type: "key" }> {
  if (menuOpen) return rng.weighted([[key("ArrowDown"), 3], [key("ArrowUp"), 2], [key("Home"), 1], [key("End"), 1], [key("Escape"), 2], [key("Tab"), 1], [key("Enter"), 1], [key(rng.pick(["p", "i", "x", "q"])), 1]] as const);
  const arrow = rng.pick(ARROWS);
  return rng.weighted([
    [key(arrow), 4],
    [key(arrow, { altKey: true }), 6],
    [key(arrow, { shiftKey: true }), 1],
    [key("Home"), 1],
    [key("End"), 1],
    [key(" "), 1],
    [key("Enter"), 1],
    [key("Escape"), 1],
  ] as const);
}

// ---------------------------------------------------------------------------
// What every step must keep.

const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/**
 * The edges a budget draws, by its documentation: every protected edge (an
 * overlay mark names it or an arc joins its ends in its direction, it is
 * selected, the keyboard is on it, it lies on a highlighted path), then the
 * heaviest by the width's metric, ties by id, up to the budget.
 */
function documentedDrawn(scene: FlowScene, budget: number, protect: { selection: Selection; focused: string | null; highlighted?: ReadonlySet<string> }): Set<string> {
  const arcs = scene.marks.filter((m) => m.overlay.kind === "arc").map((m) => `${String(m.overlay.payload?.source)}>${String(m.overlay.payload?.target)}`);
  const named = scene.marks.map((m) => m.edgeId);
  const isProtected = (e: FlowEdge) =>
    named.includes(e.id) || arcs.includes(`${e.source}>${e.target}`) || protect.selection.edges.includes(e.id) || protect.focused === e.id || !!protect.highlighted?.has(e.id);
  const edges = scene.edgeMarks.map((m) => m.edge);
  const drawn = new Set(edges.filter(isProtected).map((e) => e.id));
  const name = scene.style.edgeWidth?.metric ?? "count";
  const weight = (e: FlowEdge) => (typeof e.metrics?.[name] === "number" && Number.isFinite(e.metrics[name]) ? e.metrics[name] : -Infinity);
  const rest = edges.filter((e) => !drawn.has(e.id)).sort((a, b) => weight(b) - weight(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of rest.slice(0, Math.max(0, Math.floor(budget) - drawn.size))) drawn.add(e.id);
  return drawn;
}

/** The edges the map draws under its budget (all of them when it withholds none), as the renderers ask the core. */
function drawnEdges(map: RandomMap, state: MapState): Set<string> {
  const { bright, focusShown } = mapEmphasis(state, map.graph);
  const selection = budgetEdges(map.scene, map.budget, { selection: state.selection, focused: state.active, highlighted: focusShown ? bright?.edges : undefined });
  return new Set(map.scene.edgeMarks.filter((_, i) => !selection || selection.drawn.has(i)).map((m) => m.id));
}

/** A searching test checks thousands of steps: the message is written only for a step that fails. */
function must(ok: boolean, message: () => string): void {
  if (!ok) expect.fail(message());
}

/** How often the walks met the situations they look for, so that a search that never meets one is noticed. */
const tally = { steps: 0, ontoWithheld: 0, countGrew: 0, bounded: 0, onPath: 0, menu: 0 };

function checkStep(map: RandomMap, before: MapState, event: MapEvent, after: MapState, label: () => string): void {
  const { graph, positions, limit, index } = map;
  const at = keyboardRef(after, graph);
  tally.steps++;
  if (after.menu) tally.menu++;
  if (at?.kind === "edge") tally.onPath++;
  // The element list the Canvas map renders for this state.
  const list = listedElements(graph, index, after.active, after.selection.nodes[0], limit, firstInReadingOrder(graph, positions)).map(refKey);
  const elements = graph.nodes.length + (graph.groups?.length ?? 0);
  if (elements > limit) tally.bounded++;
  if (elements > limit) must(list.length <= limit, () => `${label()}: ${list.length} listed above the limit`);
  else must(list.length === elements + (at?.kind === "edge" ? 1 : 0), () => `${label()}: ${list.length} listed of ${elements} elements`);
  must(new Set(list).size === list.length, () => `${label()}: an element is listed twice: ${list.join(" ")}`);
  if (!at) return;
  must(list.includes(refKey(at)), () => `${label()}: the active descendant ${refKey(at)} is not listed: ${list.join(" ")}`);
  // It is drawn: a node with a box in the scene, or an edge of the scene the budget draws.
  const drawn = at.kind === "node" ? map.scene.nodeMarks.some((m) => m.node.id === at.id) : map.scene.edgeMarks.some((m) => m.id === at.id) && (map.budget === "all" || drawnEdges(map, after).has(at.id));
  must(drawn, () => `${label()}: the keyboard is on ${refKey(at)}, which is not drawn`);
  if (event.type !== "key" || before.menu) return;
  // Moving onto a path or off one under a budget: the drawn edges are those the documentation orders first.
  const onPath = (s: MapState) => s.active !== null && index.edges.has(s.active);
  if (typeof map.budget === "number" && (onPath(before) || onPath(after))) {
    const { bright, focusShown } = mapEmphasis(after, graph);
    const expected = documentedDrawn(map.scene, map.budget, { selection: after.selection, focused: after.active, highlighted: focusShown ? bright?.edges : undefined });
    const actual = drawnEdges(map, after);
    must([...expected].every((id) => actual.has(id)) && expected.size === actual.size, () => `${label()}: drew ${[...actual].sort().join(" ")}; documented ${[...expected].sort().join(" ")}`);
    // Onto a withheld flow: it is drawn now; while the protected edges fit in the budget the count stays and the
    // last edge of the order gives way, beyond it the count grows by one (both by the comparison above).
    const earlier = drawnEdges(map, before);
    if (at.kind === "edge" && !earlier.has(at.id)) {
      tally.ontoWithheld++;
      if (actual.size > earlier.size) tally.countGrew++;
    }
  }
  // Moves land where the documentation says.
  const allowed = documentedStep(graph, positions, before, event);
  if (allowed) must(allowed.has(refKey(at)), () => `${label()}: ${event.altKey ? "Alt+" : ""}${event.key} from ${before.active} went to ${refKey(at)}, documented: ${[...allowed].join(" ")}`);
  // A plain or Shift arrow lands on a node whose centre lies strictly in its direction.
  if (ARROWS.includes(event.key) && !event.altKey && before.active !== null && after.active !== before.active) {
    const edge = index.edges.get(before.active);
    const from = positions.nodes[edge ? edge.target : before.active];
    if (from) {
      const a = centre(from);
      const b = centre(positions.nodes[after.active!]);
      const along = { ArrowRight: b.x - a.x, ArrowLeft: a.x - b.x, ArrowDown: b.y - a.y, ArrowUp: a.y - b.y }[event.key]!;
      must(along > 0, () => `${label()}: ${event.key} from ${before.active} went against its direction to ${after.active}`);
    }
  }
}

// ---------------------------------------------------------------------------

describe("random walks over random maps", () => {
  it("keep the active descendant listed and drawn and the list within its limit", () => {
    for (const seed of seeds(caseCount(200))) {
      const map = randomMap(seed);
      const rng = createRandom(seed + 7_000_003);
      for (let walk = 0; walk < 50; walk++) {
        const nodes = map.graph.nodes;
        const selected = nodes.length && rng.chance(0.3) ? [rng.pick(nodes).id] : [];
        const w: Walk = { state: initialMapState({ selection: { nodes: selected, edges: [], groups: [] } }), context: { graph: map.graph, positions: map.positions } };
        const length = rng.int(5, 15);
        for (let s = 0; s < length; s++) {
          const before = w.state;
          const event = randomKey(rng, before.menu !== null);
          const said = press(w, event);
          const label = () => caseLabel(seed, `${map.name}, walk ${walk}, step ${s}`);
          checkStep(map, before, event, w.state, label);
          // What the live region says is a sentence: no placeholder, no missing value, one full stop at its end.
          for (const text of said) must(text.trim().length > 0 && !/\{\w+\}|undefined|NaN|\.\.$/.test(text), () => `${label()}: says ${JSON.stringify(text)}`);
        }
      }
    }
    // The walks met every situation they look for, in a good share of their steps.
    expect(tally.bounded).toBeGreaterThan(tally.steps / 5);
    expect(tally.onPath).toBeGreaterThan(tally.steps / 10);
    expect(tally.menu).toBeGreaterThan(tally.steps / 50);
    expect(tally.ontoWithheld).toBeGreaterThan(100);
    expect(tally.countGrew).toBeGreaterThan(0);
  });
});

/**
 * Every element the keyboard reaches with Home, End and Alt with the arrow
 * keys, by the real controller: a search over its states, which tells two
 * states apart by the keyboard position and by where the turns through the
 * paths stand there: at a node both of its turns, on a path the outgoing turn
 * of its source and the incoming turn of its target. From any turn at a node,
 * going out along a path and back moves that turn on, so the search tries
 * every path of every node it reaches.
 */
function keyboardReach(map: RandomMap, selected?: string): Set<string> {
  const context: MapContext = { graph: map.graph, positions: map.positions };
  // Alt with Down and Up moves as with Right and Left (the walks check each step of them against the documentation).
  const keys = [key("Home"), key("End"), key("ArrowRight", { altKey: true }), key("ArrowLeft", { altKey: true })];
  const start = initialMapState({ selection: { nodes: selected === undefined ? [] : [selected], edges: [], groups: [] } });
  const turn = (s: MapState, node: string, way: "out" | "in") => s.cycle[`${node}:${way}`] ?? -1;
  const stateKey = (s: MapState) => {
    const edge = s.active === null ? undefined : map.index.edges.get(s.active);
    const turns = edge ? [turn(s, edge.source, "out"), turn(s, edge.target, "in")] : s.active === null ? [] : [turn(s, s.active, "out"), turn(s, s.active, "in")];
    return `${s.active}\n${turns.join("/")}`;
  };
  const seen = new Set([stateKey(start)]);
  const reached = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const state = queue.shift()!;
    for (const event of keys) {
      const next = mapStep(state, event, context).state;
      const at = keyboardRef(next, map.graph);
      if (at) reached.add(refKey(at));
      if (seen.has(stateKey(next))) continue;
      seen.add(stateKey(next));
      queue.push(next);
    }
  }
  return reached;
}

describe("reachability by keyboard", () => {
  it("equals the documented moves, found by a graph search", () => {
    for (const seed of seeds(caseCount(200))) {
      const map = randomMap(seed);
      const rng = createRandom(seed + 8_000_003);
      const starts = [undefined, ...(map.graph.nodes.length ? [rng.pick(map.graph.nodes).id] : [])];
      for (const selected of starts) {
        const label = () => caseLabel(seed, `${map.name}, ${selected === undefined ? "no keyboard position" : `${selected} selected`}`);
        const expected = [...documentedReach(map.graph, map.positions, selected)].sort();
        const actual = [...keyboardReach(map, selected)].sort();
        must(JSON.stringify(actual) === JSON.stringify(expected), () => `${label()}: reached ${actual.join(" ")}; documented ${expected.join(" ")}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The same walks on the mounted map, read from its DOM: the hidden list of the
// Canvas map or React Flow's elements, the edges the map reports as drawn, and
// the menu's actions that change the graph (expanding a collapsed stage).

/** A 2D context that draws nothing; frames run when the test flushes them. */
function quietCanvas(): () => void {
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, k) => (k in target ? target[k] : () => {}),
    set: (target, k, value) => ((target[k] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return () => act(() => {
    while (frames.length) frames.shift()!(0);
  });
}

const STAGED: FamilyName[] = ["stages", "nested", "overlaid", "germanLabels", "markupLabels", "lanes", "layered", "cyclic", "hub"];

describe("random walks on the mounted map", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("name a listed, drawn element in aria-activedescendant, also after the menu expands a stage", () => {
    for (const seed of seeds(caseCount(6))) {
      const rng = createRandom(seed);
      const family = rng.pick(STAGED);
      const graph = families[family](rng.int(4, 40), seed, { mixedKinds: rng.chance(0.4) });
      const collapsed = (graph.groups ?? []).some((g) => g.kind === "stage") && rng.chance(0.6);
      // Positions for every node the map can show: the members and the collapsed stages.
      const members = positionsOf(graph, rng.pick(POSITION_KINDS), seed);
      const stageNodes = collapsed ? positionsOf(abstract(graph, { collapse: "all" }), "grid", seed) : undefined;
      const positions = { ...members, nodes: { ...stageNodes?.nodes, ...members.nodes } };
      const renderer = rng.weighted([["canvas", 3], ["svg", 1]] as const);
      const elements = graph.nodes.length + (graph.groups?.length ?? 0);
      const limit = rng.pick([1, 3, Math.max(1, elements - 2), elements + 5]);
      const budget = rng.weighted<EdgeBudget>([["all", 1], [rng.int(0, Math.max(1, Math.floor(graph.edges.length / 2))), 2]]);
      const name = `${family} ${graph.nodes.length} nodes, ${renderer}, limit ${limit}, budget ${budget}${collapsed ? ", collapsed" : ""}`;
      const flush = quietCanvas();
      let reported: ShownEdges | undefined;
      let abstraction: AbstractOptions = collapsed ? { collapse: "all" } : {};
      const view = render(
        <div style={{ width: 1200, height: 800 }}>
          <ProcessMap graph={graph} positions={positions} renderer={renderer} describedLimit={limit} edgeBudget={budget} defaultAbstraction={abstraction} onAbstractionChange={(a) => (abstraction = a)} onEdgesShown={(s) => (reported = s)} controls={false} legend={false} fitView={false} />
        </div>,
      );
      flush();
      const map = view.container.querySelector(".wf-process-map") as HTMLElement;
      act(() => map.focus());
      for (let walk = 0; walk < 3; walk++) {
        fireEvent.keyDown(map, { key: "Escape" });
        for (let s = 0; s < 20; s++) {
          const menuOpen = view.container.querySelector('[role="menu"]') !== null;
          // In a menu on a collapsed stage, z expands it.
          const event = menuOpen && rng.chance(0.3) ? key("z") : randomKey(rng, menuOpen);
          fireEvent.keyDown(map, { key: event.key, altKey: event.altKey, shiftKey: event.shiftKey });
          flush();
          const label = () => caseLabel(seed, `${name}, walk ${walk}, step ${s}, ${event.altKey ? "Alt+" : event.shiftKey ? "Shift+" : ""}${event.key}`);
          const shown = abstract(graph, abstraction);
          const shownElements = shown.nodes.length + (shown.groups?.length ?? 0);
          const listed = [...view.container.querySelectorAll('[data-testid="wf-canvas-descendants"] > *')].map((el) => el.id);
          const id = map.getAttribute("aria-activedescendant");
          if (renderer === "canvas") {
            if (shownElements > limit) must(listed.length <= limit, () => `${label()}: ${listed.length} listed above the limit`);
            if (id !== null) must(listed.includes(id), () => `${label()}: ${id} is not listed: ${listed.join(" ")}`);
          } else if (id !== null) must(view.container.querySelector(`[id="${id}"]`) !== null, () => `${label()}: ${id} names no element`);
          if (id === null || !id.startsWith("wf-edge-")) continue;
          const edge = id.slice("wf-edge-".length);
          must(shown.edges.some((e) => e.id === edge), () => `${label()}: ${edge} is not on the map`);
          must(reported === undefined || reported.edges.includes(edge), () => `${label()}: the keyboard is on ${edge}, which the budget withholds`);
        }
      }
      cleanup();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
