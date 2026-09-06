import { type CSSProperties, useId, useState } from "react";
import { type Locale, type LodRules, type ViewSet, t } from "../core/index";
import { Legend } from "./Legend";
import { ProcessMap } from "./ProcessMap";
import { type Selection, emptySelection } from "./types";

export interface ViewSwitcherProps {
  /** Views from `buildViews` or `resolveViews`: one graph, one set of positions, several metric and overlay sets. */
  views: ViewSet;
  /** One view at a time behind tabs, or all views as small multiples. Default `single`. */
  mode?: "single" | "grid";
  onModeChange?: (mode: "single" | "grid") => void;
  activeView?: string;
  onActiveViewChange?: (id: string) => void;
  /** Columns of the grid. Default 2. */
  columns?: number;
  locale?: Locale;
  /** Selection shared by all views. */
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
  onHover?: (id: string | null) => void;
  /** Show the legend(s). Default true. */
  legend?: boolean;
  lod?: Partial<LodRules>;
  minimap?: boolean;
  className?: string;
  containerStyle?: CSSProperties;
}

/**
 * The same map under several named views. Every view renders `<ProcessMap/>`
 * with the shared positions and its own metrics, overlays and style; the
 * style carries the domains that `buildViews` shared, so a colour or width
 * means the same number in every view. `grid` shows all views as small
 * multiples with one legend per distinct style.
 */
export function ViewSwitcher({ views, mode: modeProp, onModeChange, activeView, onActiveViewChange, columns = 2, locale = "en", selection: selectionProp, onSelect, onHover, legend = true, lod, minimap, className, containerStyle }: ViewSwitcherProps) {
  const [innerMode, setInnerMode] = useState<"single" | "grid">("single");
  const mode = modeProp ?? innerMode;
  const setMode = (m: "single" | "grid") => {
    if (modeProp === undefined) setInnerMode(m);
    onModeChange?.(m);
  };
  const [innerActive, setInnerActive] = useState(views.views[0]?.id);
  const active = activeView ?? innerActive ?? views.views[0]?.id;
  const setActive = (id: string) => {
    if (activeView === undefined) setInnerActive(id);
    onActiveViewChange?.(id);
  };
  const [innerSelection, setInnerSelection] = useState<Selection>(emptySelection);
  const selection = selectionProp ?? innerSelection;
  const select = (s: Selection) => {
    if (selectionProp === undefined) setInnerSelection(s);
    onSelect?.(s);
  };
  const id = useId();
  const current = views.views.find((v) => v.id === active) ?? views.views[0];
  const legendStyles = new Map<string, (typeof views.views)[number]>();
  for (const v of views.views) {
    const key = JSON.stringify(v.style);
    if (!legendStyles.has(key)) legendStyles.set(key, v);
  }

  return (
    <div className={`wf-views${className ? ` ${className}` : ""}`} style={containerStyle} data-mode={mode}>
      <div className="wf-views__bar">
        <div role="tablist" aria-label={t(locale, "views.title")} className="wf-views__tabs">
          {views.views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              id={`${id}-tab-${v.id}`}
              className="wf-button"
              aria-selected={mode === "single" && v.id === current?.id}
              aria-controls={`${id}-panel-${v.id}`}
              title={v.description}
              onClick={() => {
                setActive(v.id);
                if (mode !== "single") setMode("single");
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="wf-views__mode">
          <button type="button" className="wf-button" aria-pressed={mode === "grid"} onClick={() => setMode(mode === "grid" ? "single" : "grid")}>
            {mode === "grid" ? t(locale, "views.single") : t(locale, "views.grid")}
          </button>
          <span className="wf-views__note">{t(locale, "views.shared")}</span>
        </div>
      </div>
      {mode === "single" && current ? (
        <div role="tabpanel" id={`${id}-panel-${current.id}`} aria-labelledby={`${id}-tab-${current.id}`} className="wf-views__single">
          {current.description ? <p className="wf-views__caption">{current.description}</p> : null}
          <ProcessMap
            graph={current.graph}
            positions={views.positions}
            overlays={current.overlays}
            style={current.style}
            controls={false}
            legend={legend}
            selection={selection}
            onSelect={select}
            onHover={onHover}
            locale={locale}
            lod={lod}
            minimap={minimap}
          />
        </div>
      ) : (
        <div className="wf-views__grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {views.views.map((v) => (
            <figure key={v.id} id={`${id}-panel-${v.id}`} className="wf-views__cell" aria-labelledby={`${id}-tab-${v.id}`}>
              <figcaption>
                <strong>{v.label}</strong>
                {v.description ? <span> — {v.description}</span> : null}
              </figcaption>
              <div className="wf-views__map">
                <ProcessMap graph={v.graph} positions={views.positions} overlays={v.overlays} style={v.style} controls={false} legend={false} selection={selection} onSelect={select} onHover={onHover} locale={locale} lod={lod} />
              </div>
            </figure>
          ))}
          {legend ? (
            <div className="wf-views__legends">
              {[...legendStyles.values()].map((v) => (
                <div key={v.id} className="wf-views__legend">
                  <Legend scales={v.scales} overlays={v.overlays} locale={locale} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
