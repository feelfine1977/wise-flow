import { useEffect, useId, useRef, useState } from "react";
import { type AbstractOptions, type DetailPositions, type DetailStatement, type Locale, type PartInView, formatCount, formatShare, inViewText, type StringKey, type Strings, t as translate } from "../core/index.js";
import { part } from "./parts.js";
import { Button } from "./primitives.js";

/** How many elements of a kind the map shows, of how many before the sliders' thresholds. */
export interface KeptCount {
  shown: number;
  total: number;
}

export interface AbstractionControlsProps {
  /** The host's wording over the library's (`Strings`): the panel's title, labels and buttons (`controls.*`, `detail.*`). */
  strings?: Strings;
  value: AbstractOptions;
  /** Called with the detail shares when a slider moves (`activityDetail`, `pathDetail`; thresholds and `keepConnected` dropped). */
  onChange: (value: AbstractOptions) => void;
  locale?: Locale;
  /** Stage groups exist, so the collapse toggle makes sense. */
  hasStages?: boolean;
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
  /** What the sliders keep, where no `statement` says it: activities (and stages) and paths shown, of all ("7 of 12"). */
  counts?: { activities?: KeptCount; paths?: KeptCount };
  /**
   * Where the sliders can stand and stand (`meta.shown.positions` of the shown
   * graph): each position is a number of activities by rank, to the end of a
   * tie, or of paths by frequency. Without it the sliders run over the shares in per cent.
   */
  positions?: DetailPositions;
  /** What is shown, beside each slider (`detailStatement` of the shown graph). */
  statement?: DetailStatement;
  /** Where the map draws fewer paths than are selected (at a small zoom, by the path budget): both numbers. */
  drawn?: { selected: number; drawn: number };
  /** What the view at rest shows of the map (`partInView`): while part of it is out of view, the panel says how much is in it. */
  inView?: PartInView;
  /** Pointing at or focusing the kept paths' part of the statement marks them on the map: `true`, and `false` when it ends. */
  onHighlightKept?: (on: boolean) => void;
  /** Says a statement politely; without it the panel has a live region of its own. */
  onAnnounce?: (text: string) => void;
}

type Slider = "activities" | "paths";

/** How far a key moves a slider: one step, ten with Page Up and Page Down, to an end with Home and End. */
const STEPS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10, Home: -Infinity, End: Infinity };

/** The position a key moves a slider to among its `stops`, from `at`. */
function stepTo(key: string, stops: number[], at: number): number | undefined {
  const step = STEPS[key];
  if (step === undefined) return undefined;
  const target = at + step;
  return step > 0 ? (stops.find((s) => s >= target) ?? stops[stops.length - 1]) : ([...stops].reverse().find((s) => s <= target) ?? stops[0]);
}

/**
 * The detail panel: a slider for activities ("Most frequent" to "All") and
 * one for paths ("Fewest paths" to "All paths"), each with the statement of
 * what is shown beside it; the marks not shown, the elements shown for a
 * protected deviation and the paths withheld at the zoom where there are any;
 * the stage toggle (semantic zoom) and the table toggle.
 */
export function AbstractionControls({ value, onChange, locale = "en", hasStages = false, view, onViewChange, counts, positions, statement, drawn, inView, onHighlightKept, onAnnounce, strings }: AbstractionControlsProps) {
  // The host's wording over the table's.
  const t = (l: Locale, key: StringKey, vars: Record<string, string | number> = {}) => translate(l, key, vars, strings);
  const id = useId();
  const collapsed = value.collapse === "all" || (Array.isArray(value.collapse) && value.collapse.length > 0);
  // Each slider's stops and where it stands: positions by rank, otherwise the shares in per cent.
  const scale = (slider: Slider) => {
    const detail = slider === "activities" ? value.activityDetail : value.pathDetail;
    if (!positions) return { stops: Array.from({ length: 101 }, (_, i) => i), at: Math.round((detail ?? 1) * 100), of: 100 };
    const stops = slider === "activities" ? positions.activities : Array.from({ length: positions.paths + 1 }, (_, i) => i);
    const of = stops[stops.length - 1] ?? 0;
    // The thresholds' position, or the shares': at the end of the tie it falls in.
    const at = stops.find((s) => s >= positions.at[slider]) ?? of;
    return { stops, at, of };
  };
  const scales = { activities: scale("activities"), paths: scale("paths") };
  const share = (slider: Slider, at: number) => (scales[slider].of > 0 ? at / scales[slider].of : 1);
  const moved = useRef<Slider | undefined>(undefined);
  const move = (slider: Slider, at: number) => {
    if (at === scales[slider].at) return;
    moved.current = slider;
    const { minNodeShare: _n, minEdgeShare: _e, keepConnected: _k, ...rest } = value;
    const other: Slider = slider === "activities" ? "paths" : "activities";
    const shares = { [slider]: share(slider, at), [other]: share(other, scales[other].at) } as Record<Slider, number>;
    onChange({ ...rest, activityDetail: shares.activities, pathDetail: shares.paths });
  };

  // The other slider's statement, when moving one changes it, is said politely.
  const [said, setSaid] = useState("");
  const announce = onAnnounce ?? setSaid;
  const previous = useRef(statement);
  useEffect(() => {
    const before = previous.current;
    previous.current = statement;
    const slider = moved.current;
    // The statement that follows a move answers it; a later one (the stages collapsed, a host's change) is not announced.
    moved.current = undefined;
    if (!statement || !before || !slider) return;
    const other = slider === "activities" ? "paths" : "activities";
    if (statement[other].full !== before[other].full) announce(statement[other].full);
  }, [statement]); // eslint-disable-line react-hooks/exhaustive-deps

  const [stuck, setStuck] = useState(false);
  const [pointed, setPointed] = useState(false);
  const highlight = stuck || pointed;
  useEffect(() => {
    if (!onHighlightKept || !highlight) return;
    onHighlightKept(true);
    return () => onHighlightKept(false);
  }, [highlight, onHighlightKept]);

  const slider = (name: Slider) => {
    const { stops, at, of } = scales[name];
    const line = statement?.[name];
    const kept = counts?.[name];
    // What the slider says: the short statement, else what it keeps, else its share.
    const valueText = line?.short ?? (kept ? t(locale, "controls.kept", { shown: formatCount(kept.shown, locale), total: formatCount(kept.total, locale) }) : formatShare(share(name, at), locale));
    const sliderId = `${id}-${name}`;
    const fullId = `${id}-${name}-full`;
    const parts = name === "paths" && statement ? statement.paths.parts : [valueText];
    const keptPart = name === "paths" ? statement?.paths.keptPart : undefined;
    return (
      <div className="wf-controls__slider">
        <label htmlFor={sliderId}>{t(locale, name === "activities" ? "controls.activities" : "controls.paths")}</label>
        <input
          id={sliderId}
          type="range"
          min={stops[0] ?? 0}
          max={of}
          step={1}
          value={at}
          disabled={of === 0}
          style={{ "--wf-range-fill": `${of > (stops[0] ?? 0) ? ((at - stops[0]) / (of - stops[0])) * 100 : 100}%` } as React.CSSProperties}
          onChange={(e) => {
            // A pointer may stop inside a tie: the tie enters whole.
            const v = Number(e.target.value);
            move(name, stops.find((s) => s >= v) ?? of);
          }}
          onKeyDown={(e) => {
            const to = stepTo(e.key, stops, at);
            if (to === undefined) return;
            e.preventDefault();
            move(name, to);
          }}
          aria-valuetext={valueText}
          aria-describedby={line ? fullId : undefined}
        />
        <div className="wf-controls__ends" aria-hidden="true">
          <span>{t(locale, name === "activities" ? "controls.activitiesLow" : "controls.pathsLow")}</span>
          <span>{t(locale, name === "activities" ? "controls.activitiesHigh" : "controls.pathsHigh")}</span>
        </div>
        <p className={`wf-controls__statement wf-controls__statement--${name}`} title={line?.full}>
          {parts.map((text, i) => (
            <span key={i}>
              <span aria-hidden={line ? "true" : undefined}>{i ? " · " : ""}</span>
              {text === keptPart ? (
                <Button
                  className="wf-controls__kept"
                  pressed={stuck}
                  title={line?.full}
                  onClick={() => setStuck(!stuck)}
                  onPointerEnter={() => setPointed(true)}
                  onPointerLeave={() => setPointed(false)}
                  onFocus={() => setPointed(true)}
                  onBlur={() => setPointed(false)}
                >
                  {text}
                </Button>
              ) : (
                <span aria-hidden={line ? "true" : undefined}>{text}</span>
              )}
            </span>
          ))}
          {line ? (
            <span className="wf-sr-only" id={fullId}>
              {line.full}
            </span>
          ) : null}
        </p>
      </div>
    );
  };
  // A further line: its short form shown, its full form its title and for assistive technology.
  const note = (line: { short: string; full: string } | undefined, kind: string) =>
    line ? (
      <p className={`wf-controls__note wf-controls__note--${kind}`} title={line.full}>
        <span aria-hidden="true">{line.short}</span>
        <span className="wf-sr-only">{line.full}</span>
      </p>
    ) : null;
  return (
    <form className="wf-panel wf-controls" {...part("abstraction-panel")} onSubmit={(e) => e.preventDefault()} aria-label={t(locale, "controls.title")}>
      <h3>{t(locale, "controls.title")}</h3>
      {slider("activities")}
      {slider("paths")}
      {drawn ? (
        <p className="wf-controls__note wf-controls__note--drawn">
          {t(locale, "detail.drawn", { selected: formatCount(drawn.selected, locale), drawn: formatCount(drawn.drawn, locale) })}
        </p>
      ) : null}
      {inView && !inView.whole ? (
        <p className="wf-controls__note wf-controls__note--in-view" data-testid="wf-in-view">
          {inViewText(inView, locale)}
        </p>
      ) : null}
      {statement?.marks ? (
        <details className="wf-controls__note wf-controls__note--marks">
          <summary title={statement.marks.full}>{statement.marks.short}</summary>
          <p className="wf-sr-only">{statement.marks.full}</p>
          {statement.marks.items.length ? (
            <ul>
              {statement.marks.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
      {note(statement?.protected, "protected")}
      <div className="wf-controls__row">
        {hasStages ? (
          <Button pressed={collapsed} onClick={() => onChange({ ...value, collapse: collapsed ? false : "all" })}>
            {collapsed ? t(locale, "controls.expand") : t(locale, "controls.collapse")}
          </Button>
        ) : null}
        {onViewChange ? (
          <Button pressed={view === "table"} onClick={() => onViewChange(view === "table" ? "map" : "table")}>
            {view === "table" ? t(locale, "controls.map") : t(locale, "controls.table")}
          </Button>
        ) : null}
      </div>
      {onAnnounce ? null : (
        <p className="wf-sr-only" aria-live="polite">
          {said}
        </p>
      )}
    </form>
  );
}
