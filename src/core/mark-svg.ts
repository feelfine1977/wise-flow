/**
 * Overlay marks as SVG elements. The SVG export writes them as a string; the
 * React map and the BPMN view create the same elements in the DOM.
 */
import type { MarkPaint, MarkText, OverlayMark } from "./overlay-marks.js";

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

/** `text` cut to the characters that fit `maxWidth` at about 6.2 px each, with an ellipsis. */
export function fitChars(text: string, maxWidth: number | undefined): string {
  if (maxWidth === undefined) return text;
  const max = Math.floor((maxWidth + 4) / 6.2);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** A text's lead and remainder after fitting both into its `maxWidth` together. */
export function fitLead(m: MarkText, fit: (text: string) => string): { lead: string; text: string } {
  const lead = m.lead ?? "";
  const whole = fit(lead + m.text);
  // A cut inside the lead leaves only the (shortened) lead.
  return whole.length - (whole === lead + m.text ? 0 : 1) < lead.length ? { lead: whole, text: "" } : { lead, text: whole.slice(lead.length) };
}

function textElement(mark: OverlayMark, m: MarkText, o: MarkSvgOptions): SvgElement {
  const { lead, text } = fitLead(m, (s) => fitChars(s, m.maxWidth));
  // Without a middle baseline in every SVG consumer, about 0.3 em below the middle.
  const y = m.baseline === "middle" ? m.y + 0.3 * m.size : m.y;
  const attrs: [string, string][] = [["x", num(m.x)], ["y", num(y)], ["font-size", String(m.size)]];
  if (m.weight) attrs.push(["font-weight", String(m.weight)]);
  if (m.anchor !== "start") attrs.push(["text-anchor", m.anchor]);
  attrs.push(["fill", o.paint(mark, m.paint)]);
  if (m.halo) attrs.push(["paint-order", "stroke"], ["stroke", o.paint(mark, "paper")], ["stroke-width", "3"]);
  return { tag: "text", attrs, children: lead ? [{ tag: "tspan", attrs: [["font-weight", "700"]], children: [lead] }, ...(text ? [text] : [])] : [text] };
}

/** The group of SVG elements that draws one mark, in scene coordinates. */
export function markSvg(m: OverlayMark, o: MarkSvgOptions): SvgElement {
  const attrs: [string, string][] = [["class", `wf-overlay wf-${m.kind.toLowerCase()}`]];
  if (m.edgeId) attrs.push(["data-edge-id", m.edgeId]);
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
  if (m.gauge) {
    const g = m.gauge;
    children.push({ tag: "rect", attrs: [...box(g), ["rx", num(g.height / 2)], ["fill", o.paint(m, "line")]], children: [] });
    if (g.value > 0) children.push({ tag: "rect", attrs: [...box({ ...g, width: g.value * g.width }), ["fill", o.paint(m, "value")]], children: [] });
    children.push({ tag: "rect", attrs: [...box({ x: g.x + g.threshold * g.width - 1, y: g.y - 1, width: 2, height: g.height + 2 }), ["fill", o.paint(m, "ink")]], children: [] });
  }
  for (const tx of m.texts) children.push(textElement(m, tx, o));
  return { tag: "g", attrs, children };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An element as SVG markup. */
export function svgMarkup(e: SvgElement | string): string {
  if (typeof e === "string") return esc(e);
  const attrs = e.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return e.children.length ? `<${e.tag}${attrs}>${e.children.map(svgMarkup).join("")}</${e.tag}>` : `<${e.tag}${attrs}/>`;
}
