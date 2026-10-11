import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { type Box, type Insets, type Locale, formatShare, panelInsets, spaceTokens, t } from "../core/index.js";
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
 * The insets that keep `bounds`, fitted into the element `area`, clear of the
 * panels over a map inside `within` (the area itself unless given): the Canvas
 * map's overlay panels, React Flow's panels and the BPMN view's, with a gap of
 * `spaceTokens.unit * 4` between a panel and the fitted bounds.
 */
export function clearOfPanels(area: Element, bounds: Box, padding: number, zoom: { minZoom?: number; maxZoom?: number } = {}, within: Element = area): Insets {
  const origin = area.getBoundingClientRect();
  const panels = [...within.querySelectorAll(".wf-overlay-panel, .react-flow__panel, .wf-bpmn__panel, .wf-bpmn__navigation")].map((panel) => {
    const r = panel.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
  });
  return panelInsets(panels, origin, bounds, { ...zoom, padding, gap: spaceTokens.unit * 4 });
}
