import { type Locale, type Overlay, type Scales, type SceneLegend, sceneLegend, t } from "../core/index.js";
import { useContext, useId, useState } from "react";
import { PatternSwatch, PatternTheme } from "./patterns.js";
import { Button, Panel } from "./primitives.js";

export interface LegendProps {
  /** The scales the rows follow from without a `legend`. */
  scales?: Scales;
  overlays?: Overlay[];
  locale?: Locale;
  /** Map-level chips are listed under the scales. */
  chips?: React.ReactNode;
  /** The scene's legend (`FlowScene.legend`); without it the rows follow from `scales` and `overlays` (`sceneLegend`). */
  legend?: SceneLegend;
  /** Show the whole key (controlled); without it the legend keeps its own state, starting from `defaultExpanded`. */
  expanded?: boolean;
  /** Open as the whole key rather than the one-line strip. Default false. */
  defaultExpanded?: boolean;
  /** Called when the toggle expands or collapses the legend. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Says that the legend was expanded or collapsed, for a live region; without it the legend has a live region of its own. */
  onAnnounce?: (text: string) => void;
}

/**
 * Legend for the scales in use and the overlay glyphs, rendered from the rows
 * of the legend. It opens as a one-line strip that names the measure and its
 * unit, with the path width's samples, and a button (`aria-expanded`) that
 * expands it to the whole key and collapses it again; the change is announced.
 * Exports always draw the whole key.
 */
export function Legend({ scales, overlays = [], locale = "en", chips, legend, expanded: expandedProp, defaultExpanded = false, onExpandedChange, onAnnounce }: LegendProps) {
  const { title, rows } = legend ?? sceneLegend(scales?.legend ?? [], overlays, locale);
  const { ink, look } = useContext(PatternTheme);
  const [own, setOwn] = useState(defaultExpanded);
  const [said, setSaid] = useState("");
  const expanded = expandedProp ?? own;
  const keyId = useId();
  const toggle = () => {
    const next = !expanded;
    if (expandedProp === undefined) setOwn(next);
    onExpandedChange?.(next);
    const text = t(locale, next ? "legend.expanded" : "legend.collapsed");
    if (onAnnounce) onAnnounce(text);
    else setSaid(text);
  };
  const measure = rows.find((row) => row.kind === "measure");
  const width = rows.find((row) => row.kind === "width");
  return (
    <Panel part="legend" className={`wf-legend${expanded ? "" : " wf-legend--strip"}`} role="region" aria-label={title}>
      <div className="wf-legend__head">
        {expanded ? <h3>{title}</h3> : <p className="wf-legend__measure">{measure?.kind === "measure" ? measure.text : title}</p>}
        {!expanded && width?.kind === "width" ? (
          <span className="wf-legend__width" aria-hidden="true">
            {width.samples.map((s, j) => <span key={j} className="wf-legend__stroke" style={{ height: s.width }} />)}
          </span>
        ) : null}
        <Button icon={expanded ? "collapse" : "expand"} label={t(locale, expanded ? "legend.collapse" : "legend.expand")} aria-expanded={expanded} aria-controls={expanded ? keyId : undefined} onClick={toggle} />
      </div>
      {onAnnounce ? null : (
        <span className="wf-sr-only" aria-live="polite">
          {said}
        </span>
      )}
      {expanded ? (
        <div id={keyId} className="wf-legend__key">
          {measure?.kind === "measure" ? <p className="wf-legend__measure">{measure.text}</p> : null}
          <dl>
            {rows.map((row, i) => {
              if (row.kind === "width") {
                return (
                  <div key={i}>
                    <dt>{row.title}</dt>
                    <dd className="wf-legend__width">
                      {row.samples.map((s, j) => (
                        <span key={j} className="wf-legend__sample">
                          <span className="wf-legend__stroke" style={{ height: s.width }} /> {s.text}
                        </span>
                      ))}
                    </dd>
                  </div>
                );
              }
              if (row.kind === "swatches") {
                return (
                  <div key={i} className="wf-legend__cats">
                    <dt>{row.title}</dt>
                    {row.entries.map((e) => (
                      <dd key={e.text} className="wf-legend__cat">
                        <span className="wf-legend__swatch" style={{ background: e.color }}>
                          <PatternSwatch pattern={e.pattern} ink={ink} look={look} />
                        </span>
                        {e.text}
                      </dd>
                    ))}
                  </div>
                );
              }
              if (row.kind === "ramp") {
                return (
                  <div key={i}>
                    <dt>{row.title}</dt>
                    <dd>
                      <div className="wf-legend__gradient" style={{ background: `linear-gradient(to right, ${row.stops.join(", ")})` }} />
                      <div className="wf-legend__range">
                        {row.values.map((v, j) => (
                          <span key={j}>{v}</span>
                        ))}
                      </div>
                    </dd>
                  </div>
                );
              }
              return null;
            })}
            <div className="wf-legend__keys">
              {rows.map((row, i) =>
                row.kind === "key" ? (
                  <dd key={i}>
                    <span className="wf-legend__glyph" aria-hidden="true">
                      {row.glyph}
                    </span>
                    {row.text}
                  </dd>
                ) : null,
              )}
            </div>
          </dl>
          {chips ? <div className="wf-map-chips">{chips}</div> : null}
        </div>
      ) : null}
    </Panel>
  );
}
