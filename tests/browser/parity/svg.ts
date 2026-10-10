/**
 * What the SVG export drew: its string parsed into elements, each map element
 * read from its attributes.
 */
import { type Drawing, type Drawn, type DrawnText, bbox, dash, num, paint } from "./drawn";

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** The export's markup as a tree; it writes no comments, CDATA or processing instructions. */
export function parseSvg(svg: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const m of svg.matchAll(/<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.children.push(unescape(m[5]));
      continue;
    }
    if (m[1]) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = unescape(a[2]);
    const el: El = { tag: m[2], attrs, children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const elements = (e: El) => e.children.filter((c): c is El => typeof c !== "string");

function* walk(e: El): Generator<El> {
  for (const c of elements(e)) {
    yield c;
    yield* walk(c);
  }
}

const hasClass = (e: El, c: string) => (e.attrs.class ?? "").split(" ").includes(c);

/** Points of path data with M, L, H, V, C and Z, control points included. */
export function pathPoints(d: string): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const m of d.matchAll(/([MLHVCZ])([^MLHVCZ]*)/gi)) {
    const n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const c = m[1].toUpperCase();
    if (c === "H") for (const v of n) out.push([(x = v), y]);
    else if (c === "V") for (const v of n) out.push([x, (y = v)]);
    else for (let i = 0; i + 1 < n.length; i += 2) out.push([(x = n[i]), (y = n[i + 1])]);
  }
  return out;
}

const fillOf = (e: El) => paint(e.attrs.fill ?? "#000000", Number(e.attrs["fill-opacity"] ?? 1));
const strokeOf = (e: El) => paint(e.attrs.stroke, Number(e.attrs["stroke-opacity"] ?? 1));

/** Outline paint, width and dash of a shape; only the paint where it has none. */
function outline(e: El): Record<string, string> {
  const stroke = strokeOf(e);
  if (stroke === "none") return { outline: "none" };
  return { outline: stroke, outlineWidth: num(Number(e.attrs["stroke-width"] ?? 1)), dash: dash(e.attrs["stroke-dasharray"]) };
}

/** Extent of a shape in the units it is drawn in. */
function boxOf(e: El): Drawn["box"] {
  const a = (k: string) => Number(e.attrs[k] ?? 0);
  if (e.tag === "rect") return { x: a("x"), y: a("y"), width: a("width"), height: a("height") };
  if (e.tag === "circle") return { x: a("cx") - a("r"), y: a("cy") - a("r"), width: 2 * a("r"), height: 2 * a("r") };
  return bbox(pathPoints(e.attrs.d ?? ""));
}

function radiusOf(e: El): string {
  if (e.tag === "circle") return e.attrs.r;
  return num(Number(e.attrs.rx ?? 0));
}

/** Texts of an element: every text, its bold lead apart. */
function textsOf(e: El): DrawnText[] {
  const out: DrawnText[] = [];
  for (const t of walk(e)) {
    if (t.tag !== "text") continue;
    const size = Number(t.attrs["font-size"]);
    const weight = Number(t.attrs["font-weight"] ?? 400);
    const fill = paint(t.attrs.fill ?? "#000000");
    for (const c of t.children) {
      if (typeof c === "string") out.push({ text: c, size, weight, paint: fill });
      else out.push({ text: c.children.join(""), size, weight: Number(c.attrs["font-weight"] ?? weight), paint: fill });
    }
  }
  return out;
}

const shapes = new Set(["rect", "circle", "path"]);

/**
 * The map elements of an SVG export, keyed as `Drawing` says. The export
 * writes overlay marks without their id, in the order of the scene's marks
 * per layer; `markIds` gives that order (the ids of the marks it draws, below,
 * between and above).
 */
export function readSvg(svg: string, markIds: string[]): Drawing {
  const out: Drawing = new Map();
  const map = [...walk(parseSvg(svg))].find((e) => hasClass(e, "wf-map"));
  if (!map) throw new Error("the export has no map");
  let mark = 0;
  for (const g of elements(map)) {
    const parts = elements(g).filter((e) => shapes.has(e.tag));
    const [shape] = parts;
    const texts = textsOf(g);
    if (hasClass(g, "wf-group")) {
      const props = { fill: fillOf(shape), radius: radiusOf(shape), shadow: "none", ...outline(shape) };
      if (hasClass(g, "wf-group-band")) {
        const rule = parts[1];
        Object.assign(props, { outlineSides: "top right bottom left", rule: `${strokeOf(rule)} ${num(Number(rule.attrs["stroke-width"]))}` });
      }
      out.set(`group:${g.attrs["data-id"]}`, { box: boxOf(shape), props, texts });
    } else if (hasClass(g, "wf-edge")) {
      out.set(`edge:${g.attrs["data-id"]}`, { box: boxOf(shape), props: { fill: "none", ...outline(shape) }, texts });
    } else if (hasClass(g, "wf-node")) {
      const band = parts.find((p, i) => i > 0 && p.tag === "rect" && !p.attrs.fill.startsWith("url("));
      const props = { fill: fillOf(shape), radius: radiusOf(shape), shadow: "none", band: band ? `${fillOf(band)} ${num(Number(band.attrs.width))}` : "none", ...outline(shape) };
      out.set(`node:${g.attrs["data-id"]}`, { box: boxOf(shape), props, texts });
    } else if (hasClass(g, "wf-overlay")) {
      const id = markIds[mark++];
      if (id === undefined) throw new Error("the export draws more marks than the scene has");
      const props: Record<string, string> = { fill: shape.tag === "path" ? "none" : fillOf(shape), ...outline(shape) };
      if (shape.tag === "rect") props.radius = radiusOf(shape);
      out.set(`mark:${id}`, { box: boxOf(shape), props, texts });
    }
  }
  if (mark !== markIds.length) throw new Error(`the export draws ${mark} marks, the scene ${markIds.length}`);
  return out;
}
