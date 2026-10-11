import { useId } from "react";
import { type AbstractOptions, type Locale, formatCount, formatShare, t } from "../core/index.js";
import { part } from "./parts.js";
import { Button } from "./primitives.js";

/** How many elements of a kind the map shows, of how many before the sliders' thresholds. */
export interface KeptCount {
  shown: number;
  total: number;
}

export interface AbstractionControlsProps {
  value: AbstractOptions;
  onChange: (value: AbstractOptions) => void;
  locale?: Locale;
  /** Stage groups exist, so the collapse toggle makes sense. */
  hasStages?: boolean;
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
  /** What the sliders keep: activities (and stages) and paths shown, of all; the readouts say "7 of 12" instead of the threshold. */
  counts?: { activities?: KeptCount; paths?: KeptCount };
}

/** Sliders for activities and paths with what they keep, the stage toggle (semantic zoom) and the table toggle. */
export function AbstractionControls({ value, onChange, locale = "en", hasStages = false, view, onViewChange, counts }: AbstractionControlsProps) {
  const id = useId();
  const collapsed = value.collapse === "all" || (Array.isArray(value.collapse) && value.collapse.length > 0);
  const nodeShare = value.minNodeShare ?? 0;
  const edgeShare = value.minEdgeShare ?? 0;
  // The readout: what a slider keeps when it is known, otherwise its threshold; the slider's value text says both.
  const readout = (share: number, kept: KeptCount | undefined, sentence: "controls.activitiesKept" | "controls.pathsKept") => {
    const threshold = formatShare(share, locale);
    if (!kept) return { text: threshold, value: threshold };
    const numbers = { shown: formatCount(kept.shown, locale), total: formatCount(kept.total, locale) };
    return { text: t(locale, "controls.kept", numbers), value: t(locale, sentence, { ...numbers, share: threshold }) };
  };
  const nodes = readout(nodeShare, counts?.activities, "controls.activitiesKept");
  const edges = readout(edgeShare, counts?.paths, "controls.pathsKept");
  return (
    <form className="wf-panel wf-controls" {...part("abstraction-panel")} onSubmit={(e) => e.preventDefault()} aria-label={t(locale, "controls.title")}>
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
          style={{ "--wf-range-fill": `${nodeShare * 100}%` } as React.CSSProperties}
          onChange={(e) => onChange({ ...value, minNodeShare: Number(e.target.value) })}
          aria-valuetext={nodes.value}
        />
        <output htmlFor={`${id}-nodes`}>{nodes.text}</output>
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
          style={{ "--wf-range-fill": `${edgeShare * 100}%` } as React.CSSProperties}
          onChange={(e) => onChange({ ...value, minEdgeShare: Number(e.target.value) })}
          aria-valuetext={edges.value}
        />
        <output htmlFor={`${id}-edges`}>{edges.text}</output>
      </label>
      <div className="wf-controls__row">
        {hasStages ? (
          <Button pressed={collapsed} onClick={() => onChange({ ...value, collapse: collapsed ? false : "all" })}>
            {collapsed ? t(locale, "controls.expand") : t(locale, "controls.collapse")}
          </Button>
        ) : null}
        <label>
          <input type="checkbox" checked={value.keepConnected ?? true} onChange={(e) => onChange({ ...value, keepConnected: e.target.checked })} />
          <span>{t(locale, "controls.connected")}</span>
        </label>
        {onViewChange ? (
          <Button pressed={view === "table"} onClick={() => onViewChange(view === "table" ? "map" : "table")}>
            {view === "table" ? t(locale, "controls.map") : t(locale, "controls.table")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
