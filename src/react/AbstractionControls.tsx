import { useId } from "react";
import { type AbstractOptions, type Locale, formatShare, t } from "../core/index.js";

export interface AbstractionControlsProps {
  value: AbstractOptions;
  onChange: (value: AbstractOptions) => void;
  locale?: Locale;
  /** Stage groups exist, so the collapse toggle makes sense. */
  hasStages?: boolean;
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
}

/** Sliders for activities and paths, the stage toggle (semantic zoom) and the table toggle. */
export function AbstractionControls({ value, onChange, locale = "en", hasStages = false, view, onViewChange }: AbstractionControlsProps) {
  const id = useId();
  const collapsed = value.collapse === "all" || (Array.isArray(value.collapse) && value.collapse.length > 0);
  const nodeShare = value.minNodeShare ?? 0;
  const edgeShare = value.minEdgeShare ?? 0;
  return (
    <form className="wf-panel wf-controls" onSubmit={(e) => e.preventDefault()} aria-label={t(locale, "controls.title")}>
      <h3>{t(locale, "controls.title")}</h3>
      <label htmlFor={`${id}-nodes`}>
        <span>{t(locale, "controls.activities")}</span>
        <input
          id={`${id}-nodes`}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={nodeShare}
          onChange={(e) => onChange({ ...value, minNodeShare: Number(e.target.value) })}
          aria-valuetext={formatShare(nodeShare, locale)}
        />
        <output htmlFor={`${id}-nodes`}>{formatShare(nodeShare, locale)}</output>
      </label>
      <label htmlFor={`${id}-edges`}>
        <span>{t(locale, "controls.paths")}</span>
        <input
          id={`${id}-edges`}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={edgeShare}
          onChange={(e) => onChange({ ...value, minEdgeShare: Number(e.target.value) })}
          aria-valuetext={formatShare(edgeShare, locale)}
        />
        <output htmlFor={`${id}-edges`}>{formatShare(edgeShare, locale)}</output>
      </label>
      <div className="wf-controls__row">
        {hasStages ? (
          <button type="button" className="wf-button" aria-pressed={collapsed} onClick={() => onChange({ ...value, collapse: collapsed ? false : "all" })}>
            {collapsed ? t(locale, "controls.expand") : t(locale, "controls.collapse")}
          </button>
        ) : null}
        <label>
          <input type="checkbox" checked={value.keepConnected ?? true} onChange={(e) => onChange({ ...value, keepConnected: e.target.checked })} />
          <span>{t(locale, "controls.connected")}</span>
        </label>
        {onViewChange ? (
          <button type="button" className="wf-button" aria-pressed={view === "table"} onClick={() => onViewChange(view === "table" ? "map" : "table")}>
            {view === "table" ? t(locale, "controls.map") : t(locale, "controls.table")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
