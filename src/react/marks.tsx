/**
 * Overlay marks in the DOM: the SVG elements of `markSvg` with paints that
 * follow the theme's CSS tokens. The React map and the BPMN view both draw
 * through this module, so a new overlay kind needs no change in either.
 */
import { useStore } from "@xyflow/react";
import { createElement, type ReactNode } from "react";
import { type MarkPaint, type MarkSvgOptions, type OverlayMark, type SvgElement, MAP_TARGET, arrowMarker, createPositions, hatchSvg, hexToRgb, markArrowhead, markSvg, overlayArrow, overlayGeometry, overlayMarks } from "../core/index.js";
import type { Overlay } from "../core/index.js";

const TOKENS: Record<Exclude<MarkPaint, "value" | "onValue">, string> = {
  ink: "var(--wf-ink)",
  inkMuted: "var(--wf-ink-muted)",
  paper: "var(--wf-paper)",
  surface: "var(--wf-surface)",
  line: "var(--wf-line)",
  outOfScope: "var(--wf-out-of-scope)",
};

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

// CSS variables are not valid in presentation attributes; they go into the style.
const isVariable = (value: string) => value.startsWith("var(");
const camel = (name: string) => (name === "class" ? "className" : name.startsWith("data-") ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/** React elements for an SVG element; `extra` adds properties (handlers, data attributes) to the outermost one. */
export function svgReact(e: SvgElement | string, key?: number | string, extra: Record<string, unknown> = {}): ReactNode {
  if (typeof e === "string") return e;
  const props: Record<string, unknown> = { key };
  const style: Record<string, string> = {};
  for (const [name, value] of e.attrs) {
    if (isVariable(value)) style[camel(name)] = value;
    else props[camel(name)] = value;
  }
  if (Object.keys(style).length) props.style = style;
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

/** CSS background layers that draw the fills of marks covering an element (`layer: "below"`). */
export function coverBackground(marks: OverlayMark[]): string | undefined {
  const layers = marks.flatMap((m) => {
    if (!m.fill) return [];
    const opacity = m.fill.opacity ?? 1;
    const color = m.fill.paint === "value" ? `rgba(${hexToRgb(m.color).join(", ")}, ${opacity})` : `color-mix(in srgb, ${m.fill.paint === "onValue" ? m.onColor : TOKENS[m.fill.paint]} ${opacity * 100}%, transparent)`;
    return [m.fill.pattern ? `repeating-linear-gradient(135deg, transparent 0 5px, ${color} 5px 7px)` : `linear-gradient(${color}, ${color})`];
  });
  return layers.length ? layers.join(", ") : undefined;
}

/** A mark drawn on its own, at the size of its box (map-level chips in the legend). */
export function MarkFigure({ mark }: { mark: OverlayMark }) {
  const { x, y, width, height } = mark.box;
  return (
    <svg className="wf-mark" width={width} height={height} viewBox={`${x} ${y} ${width} ${height}`} overflow="visible" aria-hidden="true">
      {svgReact(domMark(mark, MARK_IDS))}
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
      <g transform={`translate(${-origin.x} ${-origin.y})`}>{marks.map((m, i) => (shown[i] === "1" ? svgReact(domMark(m, MARK_IDS), m.id) : null))}</g>
    </svg>
  );
}

/** The marker and pattern that `ElementMarks` refer to; rendered once by the map. */
export function MarkDefs() {
  return (
    <svg className="wf-mark-defs" width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
      {svgReact(markDefs(MARK_IDS))}
    </svg>
  );
}
