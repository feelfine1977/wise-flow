/**
 * What a renderer drew, element by element, as values that can be compared
 * across renderers: the element's box, outline, dash, fill, radius, shadow,
 * colour band, band rule and texts. Each renderer's reader produces one
 * `Drawing`; `differences` compares one with the SVG export's and
 * `checkExpected` compares the differences with the committed list.
 */
import type { FlowScene } from "../../../src/index";

/** The renderers compared with the SVG export. */
export type Renderer = "dom" | "canvas" | "png";

export interface DrawnText {
  text: string;
  size: number;
  weight: number;
  paint: string;
}

/**
 * One drawn element. Properties are strings so that every renderer writes
 * them alike: paints as `#rrggbb` with `@alpha` below 1, numbers with at most
 * two decimals, `none` where nothing is drawn.
 */
export interface Drawn {
  box?: { x: number; y: number; width: number; height: number };
  props: Record<string, string>;
  texts: DrawnText[];
}

/** Elements by key: `node:<id>`, `edge:<id>`, `group:<id>`, `mark:<id>`. */
export type Drawing = Map<string, Drawn>;

/** One difference between the SVG export and another renderer, on one element kind and property. */
export interface Difference {
  renderer: Renderer;
  /** Element kind, such as `node:event`, `edge:follows`, `group:stage:band`, `mark:arc`. */
  kind: string;
  property: string;
  svg: string;
  other: string;
}

/** A difference with the fixtures it occurs in and the number of elements that have it. */
export interface Listed extends Difference {
  fixtures: string[];
  elements: number;
}

export const num = (n: number): string => String(Number(n.toFixed(2)));

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/**
 * A CSS colour as `#rrggbb`, with `@alpha` (two decimals) when it is not
 * opaque, multiplied by `opacity`; `none` for no paint or no alpha left.
 * Reads hex (3, 6 or 8 digits), `rgb()`, `rgba()` and `color(srgb …)`.
 */
export function paint(css: string | undefined | null, opacity = 1): string {
  const s = (css ?? "").trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return "none";
  if (s.startsWith("url(") || s === "pattern") return opacity < 1 ? `pattern@${num(opacity)}` : "pattern";
  let rgb: number[] | undefined;
  let alpha = 1;
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3})$/.exec(s))) rgb = [...m[1]].map((c) => parseInt(c + c, 16));
  else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s))) {
    rgb = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
    if (m[2]) alpha = parseInt(m[2], 16) / 255;
  } else if ((m = /^rgba?\(([^)]*)\)$/.exec(s))) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    rgb = parts.slice(0, 3);
    if (parts.length > 3) alpha = parts[3];
  } else if ((m = /^color\(srgb ([^)]*)\)$/.exec(s))) {
    const parts = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    rgb = parts.slice(0, 3).map((v) => v * 255);
    if (parts.length > 3) alpha = parts[3];
  }
  if (!rgb || rgb.some((v) => !Number.isFinite(v))) return s;
  const a = Number((alpha * opacity).toFixed(2));
  if (a <= 0) return "none";
  const color = `#${rgb.map(hex2).join("")}`;
  return a < 1 ? `${color}@${a}` : color;
}

/**
 * A label's pill as one value: its box (to one decimal, from the two the SVG
 * export writes), fill, outline paint and width, and corner radius.
 */
export function pillOf(box: { x: number; y: number; width: number; height: number }, fill: string | undefined, stroke: { paint: string; width: number } | undefined, radius: number | string): string {
  const one = (n: number) => String(Number(Number(n.toFixed(2)).toFixed(1)));
  return [[box.x, box.y, box.width, box.height].map(one).join(","), fill ?? "none", stroke ? `${stroke.paint} ${num(stroke.width)}` : "none", `r${typeof radius === "number" ? num(radius) : radius}`].join(" ");
}

/** A dash pattern as its lengths separated by spaces, `none` without one. */
export function dash(lengths: readonly number[] | string | undefined | null): string {
  if (lengths === undefined || lengths === null) return "none";
  const list = typeof lengths === "string" ? lengths.split(/[\s,]+/).filter(Boolean).map((v) => parseFloat(v)) : [...lengths];
  return list.length && list.some((v) => v > 0) ? list.map(num).join(" ") : "none";
}

/**
 * Shadows as paint and offsets, `#000000@0.12 0 1 2` for a shadow of that
 * colour offset by 0 and 1 and blurred by 2 (with the spread after it where
 * not 0), several separated by commas; `none` without one. Reads CSS
 * `box-shadow` values with the colour first, as browsers compute them.
 */
export function shadow(css: string | undefined | null): string {
  const s = (css ?? "").trim();
  if (!s || s === "none") return "none";
  const list = s.split(/,(?![^(]*\))/).map((one) => {
    const color = /^((?:rgba?|color)\([^)]*\)|#[0-9a-f]+)/i.exec(one.trim())?.[1] ?? "#000000";
    const [x = 0, y = 0, blur = 0, spread = 0] = (one.trim().slice(color.length).match(/-?[\d.]+(?=px)/g) ?? []).map(Number);
    return [paint(color), num(x), num(y), num(blur), ...(spread ? [num(spread)] : [])].join(" ");
  });
  return list.join(", ");
}

/** Bounding box of points. */
export function bbox(points: readonly (readonly [number, number])[]): Drawn["box"] {
  if (!points.length) return undefined;
  let [x0, y0] = points[0];
  let [x1, y1] = points[0];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const BOX = ["x", "y", "width", "height"] as const;

/** A box coordinate as an offset from the SVG export's, to one decimal; `undefined` where they agree. */
function offset(name: (typeof BOX)[number], svg: number, other: number): string | undefined {
  const d = Number((other - svg).toFixed(1));
  return d === 0 ? undefined : `${name} ${d > 0 ? "+" : "−"} ${Math.abs(d)}`;
}

/**
 * The differences of one element: box coordinates as offsets (`width + 18.2`),
 * every other property and every text by its value. An element one of the
 * two did not draw differs only in `drawn`.
 */
export function elementDifferences(svg: Drawn | undefined, other: Drawn | undefined): Omit<Difference, "renderer" | "kind">[] {
  if (!svg || !other) return svg === other ? [] : [{ property: "drawn", svg: svg ? "yes" : "no", other: other ? "yes" : "no" }];
  const out: Omit<Difference, "renderer" | "kind">[] = [];
  if (svg.box && other.box) {
    for (const name of BOX) {
      const d = offset(name, svg.box[name], other.box[name]);
      if (d) out.push({ property: `box.${name}`, svg: name, other: d });
    }
  } else if (svg.box || other.box) out.push({ property: "box", svg: svg.box ? "drawn" : "none", other: other.box ? "drawn" : "none" });
  for (const p of [...new Set([...Object.keys(svg.props), ...Object.keys(other.props)])].sort()) {
    const a = svg.props[p] ?? "none";
    const b = other.props[p] ?? "none";
    if (a !== b) out.push({ property: p, svg: a, other: b });
  }
  if (svg.texts.length !== other.texts.length) out.push({ property: "texts", svg: String(svg.texts.length), other: String(other.texts.length) });
  for (let i = 0; i < Math.min(svg.texts.length, other.texts.length); i++) {
    const a = svg.texts[i];
    const b = other.texts[i];
    if (a.text !== b.text) out.push({ property: `text${i + 1}.string`, svg: a.text, other: b.text });
    if (a.size !== b.size) out.push({ property: `text${i + 1}.size`, svg: num(a.size), other: num(b.size) });
    if (a.weight !== b.weight) out.push({ property: `text${i + 1}.weight`, svg: String(a.weight), other: String(b.weight) });
    if (a.paint !== b.paint) out.push({ property: `text${i + 1}.paint`, svg: a.paint, other: b.paint });
  }
  return out;
}

const keyOf = (d: Difference) => [d.renderer, d.kind, d.property, d.svg, d.other].join("\u0000");

const order = (a: Difference, b: Difference) => {
  const x = keyOf(a);
  const y = keyOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Every difference between the SVG export's drawing and the other renderers'
 * on the fixtures, one entry per renderer, element kind, property and pair of
 * values, with the fixtures it occurs in and how many elements have it.
 */
export function differences(fixtures: { name: string; kinds: Map<string, string>; svg: Drawing; others: Partial<Record<Renderer, Drawing>> }[]): Listed[] {
  const listed = new Map<string, Listed>();
  for (const f of fixtures) {
    for (const renderer of Object.keys(f.others).sort() as Renderer[]) {
      const other = f.others[renderer]!;
      for (const key of [...new Set([...f.svg.keys(), ...other.keys()])].sort()) {
        const kind = f.kinds.get(key) ?? key.slice(0, key.indexOf(":"));
        for (const d of elementDifferences(f.svg.get(key), other.get(key))) {
          const entry: Difference = { renderer, kind, ...d };
          const k = keyOf(entry);
          const seen = listed.get(k) ?? { ...entry, fixtures: [], elements: 0 };
          if (!seen.fixtures.includes(f.name)) seen.fixtures.push(f.name);
          seen.elements++;
          listed.set(k, seen);
        }
      }
    }
  }
  return [...listed.values()].map((l) => ({ ...l, fixtures: l.fixtures.sort() })).sort(order);
}

/**
 * What the committed list says and what was found: new differences, listed
 * ones that are gone (a second listing of one difference among them), listed
 * ones whose extent changed.
 */
export function checkExpected(found: Listed[], expected: Listed[]): { added: Listed[]; gone: Listed[]; changed: { expected: Listed; found: Listed }[] } {
  const byKey = new Map(expected.map((e) => [keyOf(e), e]));
  const foundKeys = new Set(found.map(keyOf));
  const added: Listed[] = [];
  const changed: { expected: Listed; found: Listed }[] = [];
  for (const f of found) {
    const e = byKey.get(keyOf(f));
    if (!e) added.push(f);
    else if (e.elements !== f.elements || [...e.fixtures].sort().join() !== f.fixtures.join()) changed.push({ expected: e, found: f });
  }
  const listed = new Set<string>();
  const gone = expected.filter((e) => {
    const k = keyOf(e);
    const again = listed.has(k);
    listed.add(k);
    return again || !foundKeys.has(k);
  });
  return { added, gone, changed };
}

/** Element kinds by key: `node:event`, `edge:follows`, `group:stage:band`, `mark:arc`. */
export function kindsOf(scene: FlowScene): Map<string, string> {
  const bands = new Set(scene.bands.map((b) => b.id));
  return new Map([
    ...scene.nodeMarks.map((m) => [`node:${m.id}`, `node:${m.kind}`] as const),
    ...scene.edgeMarks.map((m) => [`edge:${m.id}`, `edge:${m.kind}`] as const),
    ...(scene.graph.groups ?? []).map((g) => [`group:${g.id}`, `group:${g.kind}${bands.has(g.id) ? ":band" : ""}`] as const),
    ...scene.marks.map((m) => [`mark:${m.id}`, `mark:${m.kind}`] as const),
  ]);
}

/** Ids of the marks an export at zoom 1 draws on the map, in the order it draws them: below the edges, between, above. */
export function exportedMarks(scene: FlowScene): string[] {
  return (["below", "between", "above"] as const).flatMap((layer) => scene.marks.filter((m) => m.layer === layer && m.inMap && m.minZoom <= 1).map((m) => m.id));
}
