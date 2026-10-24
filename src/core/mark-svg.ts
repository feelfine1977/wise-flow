/**
 * Overlay marks, arrowhead markers and pattern tiles as SVG elements. The SVG
 * export writes them as a string; the React map and the BPMN view create the
 * same elements in the DOM.
 */
import type { MarkPaint, MarkText, OverlayMark } from "./overlay-marks.js";
import { truncateText } from "./text.js";
import { type Arrowhead, type PatternId, type PatternLook, arrowheadExtent, hatchTokens, patternTokens, patternTwin, strokeTokens, textTokens } from "./tokens.js";

/** An SVG element: tag, attributes in order, and child elements or text. */
export interface SvgElement {
  tag: string;
  attrs: [string, string][];
  children: (SvgElement | string)[];
}

export interface MarkSvgOptions {
  /** Colour of a paint role for the mark (a CSS colour, or a CSS variable in the DOM). */
  paint(mark: OverlayMark, paint: MarkPaint): string;
  /** Id of the arrowhead marker (`overlayArrow`). */
  arrowId: string;
  /** Id of the out-of-scope hatching pattern. */
  patternId: string;
}

const num = (n: number): string => Number(n.toFixed(2)).toString();

/**
 * `text` shortened to `maxWidth` at a chip's text size by `truncateText`.
 * @deprecated Mark texts arrive fitted by the scene's text measure; use `truncateText`. Removed in the next major version.
 */
export function fitChars(text: string, maxWidth: number | undefined): string {
  return maxWidth === undefined ? text : truncateText(text, maxWidth, textTokens.chip);
}

function textElement(mark: OverlayMark, m: MarkText, o: MarkSvgOptions): SvgElement {
  const { lead = "", text } = m;
  // Without a middle baseline in every SVG consumer, about 0.3 em below the middle.
  const y = m.baseline === "middle" ? m.y + 0.3 * m.size : m.y;
  // Preserve subpixel sizing while discarding platform-dependent power rounding.
  const size = Number(m.size.toFixed(12));
  const attrs: [string, string][] = [["x", num(m.x)], ["y", num(y)], ["font-size", String(size)]];
  if (m.weight) attrs.push(["font-weight", String(m.weight)]);
  if (m.anchor !== "start") attrs.push(["text-anchor", m.anchor]);
  attrs.push(["fill", o.paint(mark, m.paint)]);
  if (m.halo) attrs.push(["paint-order", "stroke"], ["stroke", o.paint(mark, "paper")], ["stroke-width", String(strokeTokens.halo)]);
  return { tag: "text", attrs, children: lead ? [{ tag: "tspan", attrs: [["font-weight", String(textTokens.chipLead.weight)]], children: [lead] }, ...(text ? [text] : [])] : [text] };
}

/** The group of SVG elements that draws one mark, in scene coordinates. */
export function markSvg(m: OverlayMark, o: MarkSvgOptions): SvgElement {
  const attrs: [string, string][] = [["class", `wf-overlay wf-${m.kind.toLowerCase()}`]];
  if (m.edgeId) attrs.push(["data-edge-id", m.edgeId]);
  if (m.opacity !== undefined) attrs.push(["opacity", String(m.opacity)]);
  const children: SvgElement[] = [{ tag: "title", attrs: [], children: [m.title] }];
  const stroke: [string, string][] = m.stroke ? [["stroke", o.paint(m, m.stroke.paint)], ["stroke-width", num(m.stroke.width)]] : [];
  if (m.stroke?.opacity !== undefined) stroke.push(["stroke-opacity", String(m.stroke.opacity)]);
  if (m.stroke?.dash) stroke.push(["stroke-dasharray", m.stroke.dash.join(" ")]);
  const box = (b: { x: number; y: number; width: number; height: number }): [string, string][] => [["x", num(b.x)], ["y", num(b.y)], ["width", num(b.width)], ["height", num(b.height)]];
  if (m.path !== undefined) {
    children.push({ tag: "path", attrs: [["d", m.path], ["fill", "none"], ...stroke, ...(m.arrow ? [["marker-end", `url(#${o.arrowId})`] as [string, string]] : [])], children: [] });
  } else {
    const fill: [string, string][] = [["fill", m.fill ? (m.fill.pattern ? `url(#${o.patternId})` : o.paint(m, m.fill.paint)) : "none"]];
    if (m.fill?.opacity !== undefined) fill.push(["fill-opacity", String(m.fill.opacity)]);
    children.push({ tag: "rect", attrs: [...box(m.box), ["rx", num(m.radius)], ...fill, ...(stroke.length ? stroke : [["stroke", "none"] as [string, string]])], children: [] });
  }
  if (m.pill) {
    const { box: b, radius, fill, stroke: line } = m.pill;
    children.push({ tag: "rect", attrs: [["class", "wf-pill"], ...box(b), ["rx", num(radius)], ["fill", o.paint(m, fill.paint)], ["stroke", o.paint(m, line.paint)], ["stroke-width", num(line.width)]], children: [] });
  }
  if (m.gauge) {
    const g = m.gauge;
    children.push({ tag: "rect", attrs: [...box(g), ["rx", num(g.height / 2)], ["fill", o.paint(m, "line")]], children: [] });
    if (g.value > 0) children.push({ tag: "rect", attrs: [...box({ ...g, width: g.value * g.width }), ["fill", o.paint(m, "value")]], children: [] });
    children.push({ tag: "rect", attrs: [...box({ x: g.x + g.threshold * g.width - 1, y: g.y - 1, width: 2, height: g.height + 2 }), ["fill", o.paint(m, "ink")]], children: [] });
  }
  for (const tx of m.texts) children.push(textElement(m, tx, o));
  return { tag: "g", attrs, children };
}

/**
 * Marker of an arrowhead (`Arrowhead`) in user units: its view box is the
 * triangle's extent around the end of the path, so one view box unit is one
 * unit of the drawing.
 */
export function arrowMarker(id: string, a: Arrowhead): SvgElement {
  const { length, half, tip, outline } = arrowheadExtent(a);
  const pad = outline / 2;
  const w = length + outline;
  const h = 2 * half + outline;
  const path: [string, string][] = [["d", `M${num(tip)} 0L${num(tip - length)} ${num(half)}L${num(tip - length)} ${num(-half)}Z`], ["fill", "context-stroke"]];
  if (outline) path.push(["stroke", "context-stroke"], ["stroke-width", num(outline)], ["stroke-linejoin", "round"]);
  return {
    tag: "marker",
    attrs: [["id", id], ["viewBox", `${num(tip - length - pad)} ${num(-half - pad)} ${num(w)} ${num(h)}`], ["refX", "0"], ["refY", "0"], ["markerWidth", num(w)], ["markerHeight", num(h)], ["markerUnits", "userSpaceOnUse"], ["orient", "auto-start-reverse"]],
    children: [{ tag: "path", attrs: path, children: [] }],
  };
}

/** Tile of a pattern twin (`patternTwin`) in the ink colour, drawn as `look` says (a theme's `pattern`). */
export function patternTwinSvg(id: string, pattern: PatternId, ink: string, look: PatternLook = patternTokens): SvgElement {
  const shape = patternTwin(pattern);
  const children: SvgElement[] = [];
  if (shape.lines.length) {
    const d = shape.lines.map(([x1, y1, x2, y2]) => `M${num(x1)} ${num(y1)}L${num(x2)} ${num(y2)}`).join("");
    children.push({ tag: "path", attrs: [["d", d], ["stroke", ink], ["stroke-width", String(look.strokeWidth)], ["stroke-opacity", String(look.strokeOpacity)]], children: [] });
  }
  for (const [cx, cy] of shape.dots) {
    children.push({ tag: "circle", attrs: [["cx", num(cx)], ["cy", num(cy)], ["r", String(look.dotRadius)], ["fill", ink], ["fill-opacity", String(look.dotOpacity)]], children: [] });
  }
  return { tag: "pattern", attrs: [["id", id], ["width", String(shape.size)], ["height", String(shape.size)], ["patternUnits", "userSpaceOnUse"]], children };
}

/** Tile of the out-of-scope hatching (`hatchTokens`) in its colour. */
export function hatchSvg(id: string, color: string): SvgElement {
  const s = hatchTokens.size;
  return {
    tag: "pattern",
    attrs: [["id", id], ["width", String(s)], ["height", String(s)], ["patternUnits", "userSpaceOnUse"]],
    children: [{ tag: "path", attrs: [["d", `M0 ${s}L${s} 0`], ["stroke", color], ["stroke-width", String(hatchTokens.width)]], children: [] }],
  };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An element as SVG markup. */
export function svgMarkup(e: SvgElement | string): string {
  if (typeof e === "string") return esc(e);
  const attrs = e.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return e.children.length ? `<${e.tag}${attrs}>${e.children.map(svgMarkup).join("")}</${e.tag}>` : `<${e.tag}${attrs}/>`;
}
