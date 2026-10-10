/**
 * What the Canvas map and the PNG export drew, read from their recorded 2D
 * context calls: every fill, stroke and written text with the state it was
 * drawn in, in the coordinates the map is drawn in.
 */
import { type DrawContext, type DrawOptions, type PreparedScene, type View, drawScene } from "../../../src/canvas/index";
import { type Drawing, type Drawn, type DrawnText, bbox, dash, num, paint } from "./drawn";

/** A traced shape: its points (control points included), its arcs and its line segments. */
interface Shape {
  points: [number, number][];
  /** Arcs as centre and radius. */
  arcs: [number, number, number][];
  /** Segments of the lines, for which sides of a box a stroke draws. */
  lines: [number, number, number, number][];
}

export type Op =
  | { op: "fill" | "stroke"; paint: string; width: number; dash: string; shape: Shape }
  | { op: "text"; text: string; x: number; y: number; size: number; weight: number; paint: string; halo: boolean };

interface State {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  globalAlpha: number;
  dash: number[];
}

/** A paint of the context: a colour, or `pattern` for a pattern, at the global alpha. */
const paintOf = (style: unknown, alpha: number) => paint(typeof style === "string" ? style : "pattern", alpha);

function fontOf(font: string): { size: number; weight: number } {
  const m = /^(?:(\d+)\s+)?([\d.]+)px/.exec(font.trim());
  return { size: m ? Number(m[2]) : 10, weight: m?.[1] ? Number(m[1]) : 400 };
}

/**
 * A 2D context that records what is drawn and after how many `scale` calls,
 * so that a reader can tell the map from the background, the frame and the
 * legend. Coordinates are recorded as given, in the units the map is drawn
 * in. Patterns come back as `pattern`.
 */
export function recordingContext(measure: (text: string, font: string) => number) {
  const ops: (Op & { scales: number })[] = [];
  let state: State = { fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, font: "10px sans-serif", globalAlpha: 1, dash: [] };
  const saved: State[] = [];
  let path: Shape = { points: [], arcs: [], lines: [] };
  let at: [number, number] | undefined;
  let start: [number, number] | undefined;
  let scales = 0;
  const point = (x: number, y: number) => path.points.push([x, y]);
  const own = {
    save: () => saved.push({ ...state }),
    restore: () => {
      state = saved.pop() ?? state;
    },
    scale: () => {
      scales++;
    },
    translate: () => undefined,
    clearRect: () => undefined,
    beginPath: () => {
      path = { points: [], arcs: [], lines: [] };
      at = undefined;
    },
    moveTo: (x: number, y: number) => {
      point(x, y);
      at = start = [x, y];
    },
    lineTo: (x: number, y: number) => {
      point(x, y);
      if (at) path.lines.push([at[0], at[1], x, y]);
      at = [x, y];
    },
    closePath: () => {
      if (at && start) path.lines.push([at[0], at[1], start[0], start[1]]);
      at = start;
    },
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      point(x1, y1);
      point(x2, y2);
      point(x, y);
      at = [x, y];
    },
    arc: (x: number, y: number, r: number, a0: number, a1: number) => {
      path.arcs.push([x, y, r]);
      if (a1 - a0 >= 2 * Math.PI - 1e-9) {
        point(x - r, y - r);
        point(x + r, y + r);
      }
      at = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
    },
    rect: (x: number, y: number, w: number, h: number) => {
      point(x, y);
      point(x + w, y + h);
    },
    fill: () => ops.push({ op: "fill", paint: paintOf(state.fillStyle, state.globalAlpha), width: 0, dash: "none", shape: path, scales }),
    stroke: () => ops.push({ op: "stroke", paint: paintOf(state.strokeStyle, state.globalAlpha), width: state.lineWidth, dash: dash(state.dash), shape: path, scales }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      ops.push({ op: "fill", paint: paintOf(state.fillStyle, state.globalAlpha), width: 0, dash: "none", shape: { points: [[x, y], [x + w, y + h]], arcs: [], lines: [] }, scales }),
    fillText: (text: string, x: number, y: number) => ops.push({ op: "text", text, x, y, ...fontOf(state.font), paint: paintOf(state.fillStyle, state.globalAlpha), halo: false, scales }),
    strokeText: (text: string, x: number, y: number) => ops.push({ op: "text", text, x, y, ...fontOf(state.font), paint: paintOf(state.strokeStyle, state.globalAlpha), halo: true, scales }),
    measureText: (text: string) => ({ width: measure(text, state.font) }),
    setLineDash: (d: number[]) => {
      state.dash = [...d];
    },
    createPattern: () => ({}),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  const ctx = new Proxy(own as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : key in state ? state[key as keyof State] : undefined),
    set: (_target, key: string, value) => {
      (state as unknown as Record<string, unknown>)[key] = value;
      return true;
    },
  }) as unknown as DrawContext;
  return { ctx, ops };
}

/** The radius of a traced box: its arcs' (one for a circle), 0 for a box or a diamond. */
const radiusOf = (shape: Shape) => num(shape.arcs.reduce((r, [, , a]) => Math.max(r, a), 0));

const shapeBox = (shape: Shape) => bbox(shape.points);

const same = (a: Shape, b: Shape) => a === b || (a.points.length === b.points.length && a.points.every(([x, y], i) => x === b.points[i][0] && y === b.points[i][1]));

/** Which sides of `box` the lines of a stroke draw. */
function sides(shape: Shape, box: NonNullable<Drawn["box"]>): string {
  const on = (v: number, w: number) => Math.abs(v - w) < 0.01;
  const drawn = new Set<string>();
  for (const [x1, y1, x2, y2] of shape.lines) {
    if (on(y1, y2) && on(y1, box.y)) drawn.add("top");
    if (on(x1, x2) && on(x1, box.x + box.width)) drawn.add("right");
    if (on(y1, y2) && on(y1, box.y + box.height)) drawn.add("bottom");
    if (on(x1, x2) && on(x1, box.x)) drawn.add("left");
  }
  return ["top", "right", "bottom", "left"].filter((s) => drawn.has(s)).join(" ") || "none";
}

const textsOf = (ops: Op[]): DrawnText[] => ops.flatMap((o) => (o.op === "text" && !o.halo ? [{ text: o.text, size: o.size, weight: o.weight, paint: o.paint }] : []));

type Shaped = Extract<Op, { op: "fill" | "stroke" }>;

/**
 * One element from the operations that drew it. The first shape is the
 * element's outline (`kind` says how a node, edge, group or mark draws
 * it); fills and strokes of that shape give its fill and outline.
 */
export function readOps(kind: string, ops: Op[]): Drawn | undefined {
  const drawn = ops.filter((o): o is Shaped => o.op !== "text");
  if (!drawn.length && !ops.length) return undefined;
  const texts = textsOf(ops);
  const props: Record<string, string> = {};
  const outline = (o: Shaped | undefined) => (o ? { outline: o.paint, outlineWidth: num(o.width), dash: o.dash } : { outline: "none" });
  if (kind.startsWith("group:") && kind.endsWith(":band")) {
    // The band's fill, its sides in the line colour and the rule along its start.
    const [fill, lines, rule] = drawn;
    const box = fill && shapeBox(fill.shape);
    Object.assign(props, { fill: fill?.paint ?? "none", radius: "0", shadow: "none", ...outline(lines), outlineSides: lines && box ? sides(lines.shape, box) : "none", rule: rule ? `${rule.paint} ${num(rule.width)}` : "none" });
    return { box, props, texts };
  }
  const [first] = drawn;
  if (!first) return { props, texts };
  const own = drawn.filter((o) => same(o.shape, first.shape));
  const fill = own.find((o) => o.op === "fill");
  const stroke = own.find((o) => o.op === "stroke");
  Object.assign(props, { fill: fill?.paint ?? "none", ...outline(stroke) });
  if (kind.startsWith("node:") || kind.startsWith("group:")) {
    props.radius = radiusOf(first.shape);
    props.shadow = "none";
  }
  if (kind.startsWith("node:")) {
    // The colour band: the first rectangle filled after the outline, in a colour.
    const band = drawn.find((o) => o.op === "fill" && !same(o.shape, first.shape) && !o.paint.startsWith("pattern"));
    props.band = band ? `${band.paint} ${num(shapeBox(band.shape)!.width)}` : "none";
  }
  // A mark drawn as a rounded box (its corners are arcs, of radius 0 too) has a radius; a path has none.
  if (kind.startsWith("mark:") && first.shape.arcs.length) props.radius = radiusOf(first.shape);
  return { box: shapeBox(first.shape), props, texts };
}

/** The scene with only the given elements, for drawing one element at a time. */
export function only(scene: PreparedScene, part: Partial<Pick<PreparedScene, "nodes" | "edges" | "groups" | "marks">>): PreparedScene {
  return { ...scene, nodes: [], edges: [], groups: [], marks: [], ...part };
}

/** The view a map is drawn in at zoom 1 from the origin. */
export const AT_ORIGIN: View = { x: 0, y: 0, zoom: 1, width: 1, height: 1 };

type Recorded = Op & { scales: number };

/** Canvases for pattern tiles, each drawing into a recorder of its own. */
const tiles = (measure: (text: string, font: string) => number) => (width: number, height: number) => ({ width, height, getContext: () => recordingContext(measure).ctx });

/** A canvas factory whose first canvas (the figure) draws into `main` and the later ones (pattern tiles) as `tiles`. */
function canvases(main: DrawContext, measure: (text: string, font: string) => number) {
  const tile = tiles(measure);
  let first = true;
  return (width: number, height: number) => {
    if (!first) return tile(width, height);
    first = false;
    return { width, height, getContext: () => main };
  };
}

/** The operations of one element drawn on its own; what precedes the map's scale is the background. */
function isolated(scene: PreparedScene, part: Parameters<typeof only>[1], measure: (text: string, font: string) => number, options: Omit<DrawOptions, "createCanvas"> = {}): Recorded[] {
  const { ctx, ops } = recordingContext(measure);
  drawScene(ctx, only(scene, part), AT_ORIGIN, undefined, { cull: false, ...options, createCanvas: tiles(measure) });
  return ops.filter((o) => o.scales >= 1);
}

/** Every map element of a prepared scene, in the order the map draws them: groups, marks below the edges, edges, marks between, nodes, marks above. */
function elementsOf(scene: PreparedScene): { key: string; part: Parameters<typeof only>[1] }[] {
  const marks = (layer: string) => scene.marks.filter((m) => m.layer === layer).map((m) => ({ key: `mark:${m.id}`, part: { marks: [m] } }));
  return [
    ...scene.groups.map((g) => ({ key: `group:${g.group.id}`, part: { groups: [g] } })),
    ...marks("below"),
    ...scene.edges.map((e) => ({ key: `edge:${e.edge.id}`, part: { edges: [e] } })),
    ...marks("between"),
    ...scene.nodes.map((n) => ({ key: `node:${n.node.id}`, part: { nodes: [n] } })),
    ...marks("above"),
  ];
}

/** What the Canvas map drew, one element at a time at zoom 1 from the origin. */
export function readCanvasMap(scene: PreparedScene, kinds: Map<string, string>, measure: (text: string, font: string) => number): Drawing {
  const out: Drawing = new Map();
  for (const { key, part } of elementsOf(scene)) {
    const drawn = readOps(kinds.get(key) ?? key, isolated(scene, part, measure));
    if (drawn) out.set(key, drawn);
  }
  return out;
}

const signature = (o: Op) => (o.op === "text" ? `${o.halo ? "halo" : "text"} ${num(o.x)},${num(o.y)} ${o.text}` : `${o.op} ${o.shape.points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}`);

/**
 * What the PNG export drew. `toPNG` draws the whole figure into one context;
 * its map is what it draws at the map's scale. Each of those operations is
 * given to the element that draws the same operation (by kind, shape and
 * text) when drawn on its own from `scene`, the scene `toPNG` prepares, and
 * read from the PNG's own call. Operations of no element are kept under
 * `map:unattributed`.
 */
export function readPng(draw: (createCanvas: (width: number, height: number) => { width: number; height: number; getContext(): unknown }) => void, scene: PreparedScene, kinds: Map<string, string>, measure: (text: string, font: string) => number): Drawing {
  const owners = new Map<string, string[]>();
  for (const { key, part } of elementsOf(scene)) {
    for (const o of isolated(scene, part, measure, { lodZoom: 1 })) {
      const s = signature(o);
      owners.set(s, [...(owners.get(s) ?? []), key]);
    }
  }
  const { ctx, ops } = recordingContext(measure);
  draw(canvases(ctx, measure));
  // The figure's scale, then the map's; the frame and the legend are drawn at a third.
  const map = ops.filter((o) => o.scales === 2);
  const byElement = new Map<string, Op[]>();
  for (const o of map) {
    const key = owners.get(signature(o))?.shift() ?? "map:unattributed";
    byElement.set(key, [...(byElement.get(key) ?? []), o]);
  }
  const out: Drawing = new Map();
  for (const [key, list] of byElement) {
    const drawn = key === "map:unattributed" ? { props: { operations: String(list.length) }, texts: [] } : readOps(kinds.get(key) ?? key, list);
    if (drawn) out.set(key, drawn);
  }
  return out;
}
