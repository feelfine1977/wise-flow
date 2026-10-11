/**
 * What the SVG export drew: its string parsed into elements, each map element
 * read from its attributes.
 */
import { type Drawing, type Drawn, type DrawnText, bbox, cue, dash, num, paint, pillOf } from "./drawn";

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

/** Line segments of path data with M, L, H and V. */
function segments(d: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let x = 0;
  let y = 0;
  for (const m of d.matchAll(/([MLHV])([^MLHVCZ]*)/gi)) {
    const n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const c = m[1].toUpperCase();
    const to = (nx: number, ny: number) => {
      out.push([x, y, nx, ny]);
      [x, y] = [nx, ny];
    };
    if (c === "M") [x, y] = [n[0], n[1]];
    else if (c === "H") to(n[0], y);
    else if (c === "V") to(x, n[0]);
    else to(n[0], n[1]);
  }
  return out;
}

/** Which sides of `box` the lines of a path draw. */
function sidesOf(e: El, box: NonNullable<Drawn["box"]>): string {
  const on = (v: number, w: number) => Math.abs(v - w) < 0.01;
  const drawn = new Set<string>();
  for (const [x1, y1, x2, y2] of segments(e.attrs.d ?? "")) {
    if (on(y1, y2) && on(y1, box.y)) drawn.add("top");
    if (on(x1, x2) && on(x1, box.x + box.width)) drawn.add("right");
    if (on(y1, y2) && on(y1, box.y + box.height)) drawn.add("bottom");
    if (on(x1, x2) && on(x1, box.x)) drawn.add("left");
  }
  return ["top", "right", "bottom", "left"].filter((side) => drawn.has(side)).join(" ") || "none";
}

const fillOf = (e: El) => paint(e.attrs.fill ?? "#000000", Number(e.attrs["fill-opacity"] ?? 1));
const strokeOf = (e: El) => paint(e.attrs.stroke, Number(e.attrs["stroke-opacity"] ?? 1));

/** Outline paint, width and dash of a shape; only the paint where it has none. */
function outline(e: El): Record<string, string> {
  const stroke = strokeOf(e);
  if (stroke === "none") return { outline: "none" };
  return { outline: stroke, outlineWidth: num(Number(e.attrs["stroke-width"] ?? 1)), dash: dash(e.attrs["stroke-dasharray"]) };
}

/**
 * A shadow is an SVG filter on the shape or its group. A filter of drop
 * shadows is written as `shadow` in `drawn.ts` writes CSS shadows, its blur
 * twice the standard deviation as in CSS and Canvas; any other filter as its
 * reference.
 */
function shadowOf(filters: Map<string, El>, g: El, shape: El): string {
  const ref = g.attrs.filter ?? shape.attrs.filter;
  if (!ref) return "none";
  const drops = elements(filters.get(/^url\(\s*["']?#([^"')]+)["']?\s*\)$/.exec(ref)?.[1] ?? "") ?? { tag: "", attrs: {}, children: [] }).filter((e) => e.tag === "feDropShadow");
  if (!drops.length) return ref;
  const n = (e: El, k: string, or: number) => Number(e.attrs[k] ?? or);
  return drops
    .map((d) => [paint(d.attrs["flood-color"] ?? "#000000", n(d, "flood-opacity", 1)), num(n(d, "dx", 2)), num(n(d, "dy", 2)), num(2 * n(d, "stdDeviation", 2))].join(" "))
    .join(", ");
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
  const all = [...walk(parseSvg(svg))];
  const filters = new Map(all.filter((e) => e.tag === "filter" && e.attrs.id).map((e) => [e.attrs.id, e]));
  const markers = new Map(all.filter((e) => e.tag === "marker" && e.attrs.id).map((e) => [e.attrs.id, e]));
  // A path's head: its marker, as wide as the marker is high (the triangle and its outline across the path).
  const head = (shape: El) => {
    const marker = markers.get(/url\(#([^)]+)\)/.exec(shape.attrs["marker-end"] ?? "")?.[1] ?? "");
    return marker ? `yes ${num(Number(marker.attrs.markerHeight))}` : "no";
  };
  const map = all.find((e) => hasClass(e, "wf-map"));
  if (!map) throw new Error("the export has no map");
  let mark = 0;
  for (const g of elements(map)) {
    const parts = elements(g).filter((e) => shapes.has(e.tag));
    const [shape] = parts;
    const texts = textsOf(g);
    if (hasClass(g, "wf-group")) {
      const props = { fill: fillOf(shape), radius: radiusOf(shape), shadow: shadowOf(filters, g, shape), ...outline(shape) };
      if (hasClass(g, "wf-group-band")) {
        // A band is its fill, then its outline along some sides, then its rule.
        const [, lines, rule] = parts;
        Object.assign(props, { ...outline(lines), outlineSides: sidesOf(lines, boxOf(shape)!), rule: `${strokeOf(rule)} ${num(Number(rule.attrs["stroke-width"]))}` });
      }
      out.set(`group:${g.attrs["data-id"]}`, { box: boxOf(shape), props, texts });
    } else if (hasClass(g, "wf-edge")) {
      const props = { fill: fillOf(shape), ...outline(shape), join: shape.attrs["stroke-linejoin"] ?? "miter", arrow: head(shape) };
      out.set(`edge:${g.attrs["data-id"]}`, { box: boxOf(shape), props, texts });
    } else if (hasClass(g, "wf-node")) {
      // The band and the frequency cue's stripe and foot are rectangles of their own classes.
      const part = (name: string) => parts.find((p) => hasClass(p, name));
      const band = part("wf-band");
      const [stripe, foot] = [part("wf-cue"), part("wf-cue-foot")];
      const props = {
        fill: fillOf(shape),
        radius: radiusOf(shape),
        shadow: shadowOf(filters, g, shape),
        band: band ? `${fillOf(band)} ${num(Number(band.attrs.width))}` : "none",
        cue: cue(stripe && fillOf(stripe), stripe && Number(stripe.attrs.width)),
        cueFoot: cue(foot && fillOf(foot), foot && Number(foot.attrs.width)),
        ...outline(shape),
      };
      out.set(`node:${g.attrs["data-id"]}`, { box: boxOf(shape), props, texts });
    } else if (hasClass(g, "wf-overlay")) {
      const id = markIds[mark++];
      if (id === undefined) throw new Error("the export draws more marks than the scene has");
      const props: Record<string, string> = { fill: fillOf(shape), ...outline(shape) };
      if (shape.tag === "rect") props.radius = radiusOf(shape);
      if (hasClass(g, "wf-arc") || hasClass(g, "wf-selfloop")) props.arrow = shape.attrs["marker-end"] ? "yes" : "no";
      const pill = parts.find((p) => hasClass(p, "wf-pill"));
      if (pill) props.pill = pillOf(boxOf(pill)!, fillOf(pill), { paint: strokeOf(pill), width: Number(pill.attrs["stroke-width"] ?? 1) }, radiusOf(pill));
      out.set(`mark:${id}`, { box: boxOf(shape), props, texts });
    }
  }
  if (mark !== markIds.length) throw new Error(`the export draws ${mark} marks, the scene ${markIds.length}`);
  return out;
}
