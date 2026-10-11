/**
 * Overlay marks in the DOM: the SVG elements of `markSvg` with paints that
 * follow the theme's CSS tokens through classes a host rule can override. The React map and the BPMN view both draw
 * through this module, so a new overlay kind needs no change in either.
 */
import { useStore } from "@xyflow/react";
import { createElement, type ReactNode } from "react";
import { type Arrowhead, type MarkPaint, type MarkSvgOptions, type OverlayMark, type SvgElement, MAP_TARGET, arrowMarker, createPositions, hatchSvg, hatchTokens, hexToRgb, markArrowhead, markSvg, overlayArrow, overlayGeometry, overlayMarks } from "../core/index.js";
import type { Overlay } from "../core/index.js";

const TOKENS: Record<Exclude<MarkPaint, "value" | "onValue">, string> = {
  ink: "var(--wf-ink)",
  inkMuted: "var(--wf-ink-muted)",
  paper: "var(--wf-paper)",
  surface: "var(--wf-surface)",
  line: "var(--wf-line)",
  lineStrong: "var(--wf-line-strong)",
  cueStripe: "var(--wf-cue-stripe)",
  cueFoot: "var(--wf-cue-foot)",
  outOfScope: "var(--wf-out-of-scope)",
};

/** A mark's paint as CSS: a theme token as its variable, the mark's value colour (or the text colour on it) as it is. */
export function paintCss(mark: { color: string; onColor?: string }, paint: MarkPaint): string {
  return paint === "value" ? mark.color : paint === "onValue" ? (mark.onColor ?? mark.color) : TOKENS[paint];
}

/** Ids of the arrowhead marker and the hatching pattern a drawing refers to. */
export interface MarkIds {
  arrow: string;
  pattern: string;
}

/** The ids of `MarkDefs`, which the map renders once for the marks its elements and legend draw. */
export const MARK_IDS: MarkIds = { arrow: "wf-mark-arrow", pattern: "wf-mark-outofscope" };

/** Paints as CSS: tokens as variables; a hovered mark shows its value in the focus colour. */
export function domMarkOptions(ids: MarkIds, hovered = false): MarkSvgOptions {
  return {
    paint: (m, paint) => (paint === "value" ? (hovered ? "var(--wf-focus)" : m.color) : paint === "onValue" ? (hovered ? TOKENS.paper : m.onColor) : TOKENS[paint]),
    arrowId: ids.arrow,
    patternId: ids.pattern,
  };
}

/** The marker and the pattern the marks refer to, as `toSVG` defines them. */
export function markDefs(ids: MarkIds): SvgElement {
  return { tag: "defs", attrs: [], children: [arrowMarker(ids.arrow, markArrowhead(overlayArrow)), hatchSvg(ids.pattern, TOKENS.outOfScope)] };
}

// CSS variables are not valid in presentation attributes. In the React map a paint of the theme
// becomes a class (`wf-fill-ink` for `fill: var(--wf-ink)`); the BPMN view's DOM gets it as a style.
const isVariable = (value: string) => value.startsWith("var(");
const camel = (name: string) => (name === "class" ? "className" : name.startsWith("data-") ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/** React elements for an SVG element; `extra` adds properties (handlers, data attributes) to the outermost one. */
export function svgReact(e: SvgElement | string, key?: number | string, extra: Record<string, unknown> = {}): ReactNode {
  if (typeof e === "string") return e;
  const props: Record<string, unknown> = { key };
  const paints: string[] = [];
  for (const [name, value] of e.attrs) {
    if (isVariable(value)) paints.push(`wf-${name}-${value.slice(9, -1)}`);
    else props[camel(name)] = value;
  }
  if (paints.length) props.className = [props.className, ...paints].filter(Boolean).join(" ");
  return createElement(e.tag, { ...props, ...extra }, ...e.children.map((c, i) => svgReact(c, i)));
}

/** DOM elements for an SVG element. */
export function svgDom(e: SvgElement | string, doc: Document): Node {
  if (typeof e === "string") return doc.createTextNode(e);
  const node = doc.createElementNS("http://www.w3.org/2000/svg", e.tag);
  for (const [name, value] of e.attrs) {
    if (isVariable(value)) node.style.setProperty(name, value);
    else node.setAttribute(name, value);
  }
  for (const c of e.children) node.appendChild(svgDom(c, doc));
  return node;
}

/**
 * A mark's group with its shape id and constraint. The pointer reaches a mark
 * along its path or over a mark with text; covers let it through.
 */
export function domMark(m: OverlayMark, ids: MarkIds, hovered = false): SvgElement {
  const g = markSvg(m, domMarkOptions(ids, hovered));
  const constraint = m.overlay.payload?.constraintId;
  g.attrs.push(["data-overlay-id", m.id], ["pointer-events", m.path !== undefined ? "stroke" : m.texts.length ? "visiblePainted" : "none"]);
  if (constraint) g.attrs.push(["data-constraint", String(constraint)]);
  return g;
}

/**
 * A mark of the React map and its panels: `domMark` with the data attributes of the styling
 * contract. The BPMN view's diagram draws `domMark` without them, out of reach of host CSS.
 */
export function mapMark(m: OverlayMark, ids: MarkIds, hovered = false): SvgElement {
  const g = domMark(m, ids, hovered);
  g.attrs.push(["data-wf-part", "mark"], ["data-wf-kind", m.kind]);
  if (hovered) g.attrs.push(["data-wf-state", "hovered"]);
  return g;
}

/** CSS background layers that draw the fills of marks covering an element (`layer: "below"`). */
export function coverBackground(marks: OverlayMark[]): string | undefined {
  const layers = marks.flatMap((m) => {
    if (!m.fill) return [];
    const opacity = m.fill.opacity ?? 1;
    const color = m.fill.paint === "value" ? `rgba(${hexToRgb(m.color).join(", ")}, ${opacity})` : `color-mix(in srgb, ${m.fill.paint === "onValue" ? m.onColor : TOKENS[m.fill.paint]} ${opacity * 100}%, transparent)`;
    const gap = hatchTokens.domPeriod - hatchTokens.width;
    return [m.fill.pattern ? `repeating-linear-gradient(135deg, transparent 0 ${gap}px, ${color} ${gap}px ${hatchTokens.domPeriod}px)` : `linear-gradient(${color}, ${color})`];
  });
  return layers.length ? layers.join(", ") : undefined;
}

/** A mark drawn on its own, at the size of its box (map-level chips in the legend). */
export function MarkFigure({ mark }: { mark: OverlayMark }) {
  const { x, y, width, height } = mark.box;
  return (
    <svg className="wf-mark" width={width} height={height} viewBox={`${x} ${y} ${width} ${height}`} overflow="visible" aria-hidden="true">
      {svgReact(mapMark(mark, MARK_IDS))}
    </svg>
  );
}

const NOWHERE = createPositions({ nodes: { at: { x: 0, y: 0, width: 0, height: 0 } }, groups: {}, edges: {} }, "di", "RIGHT");

/** Marks of overlays placed on an empty box at the origin (badges extend left from it) or, for chips, as map-level chips. */
export function marksAtOrigin(overlays: Overlay[], locale: Parameters<typeof overlayMarks>[1]): OverlayMark[] {
  const placed = overlays.map((o) => ({ ...o, target: o.kind === "chip" ? MAP_TARGET : "at" }));
  return overlayMarks(overlayGeometry(placed, NOWHERE).shapes, locale);
}

/**
 * The marks an element carries (badges, chips, hatching), drawn inside it in
 * scene coordinates shifted by the element's `origin`. Each shows from its
 * `minZoom`; the component re-renders only when one crosses its threshold.
 */
export function ElementMarks({ marks, origin }: { marks: OverlayMark[]; origin: { x: number; y: number } }) {
  const shown = useStore((s) => marks.map((m) => (s.transform[2] >= m.minZoom ? "1" : "0")).join(""));
  if (!marks.length) return null;
  return (
    <svg className="wf-marks" overflow="visible" aria-hidden="true">
      <g transform={`translate(${-origin.x} ${-origin.y})`}>{marks.map((m, i) => (shown[i] === "1" ? svgReact(mapMark(m, MARK_IDS), m.id) : null))}</g>
    </svg>
  );
}

/** The marker and pattern that `ElementMarks` refer to, and the heads of the map's edges by their ids; rendered once by the map. */
export function MarkDefs({ arrows = [] }: { arrows?: readonly [string, Arrowhead][] }) {
  return (
    <svg className="wf-mark-defs" width={0} height={0} aria-hidden="true">
      {svgReact(markDefs(MARK_IDS))}
      {arrows.length ? svgReact({ tag: "defs", attrs: [], children: arrows.map(([id, a]) => arrowMarker(id, a)) }) : null}
    </svg>
  );
}
