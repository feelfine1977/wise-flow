import { type ButtonHTMLAttributes, type HTMLAttributes, type PointerEvent, type ReactNode, useId, useRef } from "react";
import { type Box, type FlowNode, type Insets, type Locale, type OpeningView, type Positions, type XY, formatShare, openingView, panelInsets, processStart, spaceTokens, t, viewTokens } from "../core/index.js";
import { part } from "./parts.js";

/**
 * The primitives of the panels around a map, modelled on the actions menu: a
 * panel (paper, a hairline, the large radius and, in the interactive map, a
 * shadow), a button (text or icon), a chip and a tooltip. Their look is the
 * stylesheet's (`.wf-panel`, `.wf-button`, `.wf-panel-chip`, `.wf-tooltip`), read
 * from the tokens; the legend, the abstraction panel, the zoom control, the
 * filter chips, the tooltips and the table's toolbar are built from them.
 */

/** The icons of the panels' buttons, as paths in a box of 16, drawn with the icon stroke. */
const ICONS = {
  zoomIn: "M3 8h10M8 3v10",
  zoomOut: "M3 8h10",
  fit: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4",
  readable: "M3 13l4-10 4 10M4.6 9h4.8M12 13V9M12 7v0",
  expand: "M4 6l4 4 4-4",
  collapse: "M4 10l4-4 4 4",
} as const;

export type IconName = keyof typeof ICONS;

/** An icon of the panels, hidden from assistive technology: the button it is on carries the name. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="wf-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** An icon instead of a text; the button then needs a `label`. */
  icon?: IconName;
  /** The accessible name (and the tooltip) of an icon button. */
  label?: string;
  /** A toggle: pressed or not (`aria-pressed`). */
  pressed?: boolean;
}

/** A button of the panels: a text, or an icon with an accessible name. */
export function Button({ icon, label, pressed, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`wf-button${icon && !children ? " wf-button--icon" : ""}${className ? ` ${className}` : ""}`}
      {...part("button")}
      aria-label={label}
      title={icon ? label : undefined}
      aria-pressed={pressed}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** The part of the styling contract the panel is (`legend`, `controls`, `status`, …). */
  part: string;
}

/** A panel over or beside a map. */
export function Panel({ part: name, className, children, ...rest }: PanelProps) {
  return (
    <div className={`wf-panel${className ? ` ${className}` : ""}`} {...part(name)} {...rest}>
      {children}
    </div>
  );
}

export interface ZoomControlProps {
  /** The current zoom, shown as a percentage between the buttons; none hides it. */
  zoom?: number;
  locale?: Locale;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** The name of the fit button. Default "Fit the map". */
  fitLabel?: string;
  /** The name of the group. Default "Zoom". */
  label?: string;
  /** The buttons cannot be used yet (the view is loading). */
  disabled?: boolean;
  /** Further buttons after the fit button. */
  children?: ReactNode;
  className?: string;
}

/**
 * The zoom control of every view (the React Flow map, the Canvas map and the
 * BPMN view): zoom in, zoom out, the current zoom and fit, as icon buttons with
 * accessible names in a group.
 */
export function ZoomControl({ zoom, locale = "en", onZoomIn, onZoomOut, onFit, fitLabel, label, disabled, children, className }: ZoomControlProps) {
  const level = zoom !== undefined && Number.isFinite(zoom) ? formatShare(zoom, locale) : undefined;
  return (
    <div className={`wf-panel wf-zoom${className ? ` ${className}` : ""}`} {...part("controls")} role="group" aria-label={label ?? t(locale, "map.zoom")}>
      <Button icon="zoomIn" label={t(locale, "map.zoomIn")} disabled={disabled} onClick={onZoomIn} />
      <Button icon="zoomOut" label={t(locale, "map.zoomOut")} disabled={disabled} onClick={onZoomOut} />
      {level ? (
        <span className="wf-zoom__level" {...part("zoom-level")} title={t(locale, "map.zoomLevel", { value: level })}>
          {level}
        </span>
      ) : null}
      <Button icon="fit" label={fitLabel ?? t(locale, "map.fit")} disabled={disabled} onClick={onFit} />
      {children}
    </div>
  );
}

/**
 * The boxes of the panels over a map inside `within` (the area itself unless
 * given), in the pixels of the element `area`: the Canvas map's overlay
 * panels, React Flow's panels and the BPMN view's; the map's overview among
 * them unless `overview` is false.
 */
export function panelBoxes(area: Element, within: Element = area, overview = true): Box[] {
  const origin = area.getBoundingClientRect();
  return [...within.querySelectorAll(".wf-overlay-panel, .react-flow__panel, .wf-bpmn__panel, .wf-bpmn__navigation")]
    .filter((panel) => overview || !panel.classList.contains("wf-overview"))
    .map((panel) => {
      const r = panel.getBoundingClientRect();
      return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
    });
}

/**
 * The insets that keep `bounds`, fitted into the element `area`, clear of the
 * panels over a map inside `within` (`panelBoxes`), with a gap of
 * `spaceTokens.unit * 4` between a panel and the fitted bounds; clear of the
 * map's overview too unless `overview` is false.
 */
export function clearOfPanels(area: Element, bounds: Box, padding: number, zoom: { minZoom?: number; maxZoom?: number } = {}, within: Element = area, overview = true): Insets {
  return panelInsets(panelBoxes(area, within, overview), area.getBoundingClientRect(), bounds, { ...zoom, padding, gap: spaceTokens.unit * 4 });
}

/**
 * The view a map in the element `area` opens at (`openingView`): fitted
 * inside the insets of its panels where that is readable, otherwise on the
 * start of the process with room for the overview, which has the map's shape,
 * `viewTokens.overview` wide and at most as high. `insets` are a host's, used
 * instead of the panels.
 */
export function openingIn(area: Element, bounds: Box, nodes: readonly FlowNode[], positions: Pick<Positions, "nodes" | "direction">, options: { padding: number; minZoom?: number; maxZoom?: number; insets?: Partial<Insets> }): OpeningView {
  const { width, height } = area.getBoundingClientRect();
  const scale = Math.min(viewTokens.overview.width / Math.max(bounds.width, 1), viewTokens.overview.height / Math.max(bounds.height, 1));
  return openingView(bounds, { width, height }, {
    ...options,
    panels: options.insets ? [] : panelBoxes(area, area, false),
    gap: spaceTokens.unit * 4,
    start: processStart(nodes, positions),
    direction: positions.direction,
    boxes: nodes.flatMap((n) => (n.kind === "activity" && positions.nodes[n.id]) || []),
    overview: { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) },
  });
}

export interface MapOverviewProps {
  /** The map's bounds and its nodes' boxes, in layout units. */
  bounds: Box;
  nodes: Readonly<Record<string, Box>>;
  /** The view (a layout point `p` is drawn at `p * zoom + (x, y)`) and the size of the area it is drawn in. */
  view: { x: number; y: number; zoom: number };
  area: { width: number; height: number };
  /** The overview's box in the area's pixels (`OpeningView.overview`). */
  at: Box;
  locale?: Locale;
  /** Centres the view on a point of the map, keeping the zoom. */
  onMove: (centre: XY) => void;
}

/** The arrow keys move the view by a tenth of what is in view. */
const ARROWS: Record<string, number[]> = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };

/**
 * A small overview of the whole map in a corner, shown while the map opens
 * on its start: the boxes of its nodes and the part in view marked. A click
 * or a drag centres the view on the point under the pointer; the arrow keys
 * move it.
 */
export function MapOverview({ bounds, nodes, view, area, at, locale = "en", onMove }: MapOverviewProps) {
  const hint = useId();
  const drag = useRef(false);
  const shown = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: area.width / view.zoom, height: area.height / view.zoom };
  // The point of the map under the pointer: the overview's inside (within its outline) is the map's bounds.
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    if (r.width > 0) onMove({ x: bounds.x + ((e.clientX - r.left - el.clientLeft) / (el.clientWidth || r.width)) * bounds.width, y: bounds.y + ((e.clientY - r.top - el.clientTop) / (el.clientHeight || r.height)) * bounds.height });
  };
  return (
    <div
      className="wf-panel wf-overlay-panel wf-overview"
      {...part("overview")}
      style={{ left: at.x, top: at.y, width: at.width, height: at.height }}
      role="application"
      aria-label={t(locale, "map.overview")}
      aria-describedby={hint}
      tabIndex={0}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button) return;
        drag.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        if (drag.current) move(e);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        drag.current = false;
      }}
      onPointerCancel={() => void (drag.current = false)}
      onKeyDown={(e) => {
        const step = ARROWS[e.key];
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        onMove({ x: shown.x + shown.width * (0.5 + step[0]), y: shown.y + shown.height * (0.5 + step[1]) });
      }}
    >
      <span id={hint} className="wf-sr-only">
        {t(locale, "map.overview.hint")}
      </span>
      <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="wf-overview__nodes" d={Object.values(nodes).map((b) => `M${b.x} ${b.y}h${b.width}v${b.height}h${-b.width}z`).join("")} />
        <rect className="wf-overview__view" {...shown} data-testid="wf-overview-view" />
      </svg>
    </div>
  );
}
