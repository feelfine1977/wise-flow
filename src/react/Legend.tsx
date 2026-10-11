import { type Locale, type Overlay, type Scales, type SceneLegend, sceneLegend } from "../core/index.js";
import { useContext } from "react";
import { PatternSwatch, PatternTheme } from "./patterns.js";
import { part } from "./parts.js";

export interface LegendProps {
  /** The scales the rows follow from without a `legend`. */
  scales?: Scales;
  overlays?: Overlay[];
  locale?: Locale;
  /** Map-level chips are listed under the scales. */
  chips?: React.ReactNode;
  /** The scene's legend (`FlowScene.legend`); without it the rows follow from `scales` and `overlays` (`sceneLegend`). */
  legend?: SceneLegend;
}

/** Legend for the scales in use and the overlay glyphs, rendered from the rows of the legend; always visible in a map. */
export function Legend({ scales, overlays = [], locale = "en", chips, legend }: LegendProps) {
  const { title, rows } = legend ?? sceneLegend(scales?.legend ?? [], overlays, locale);
  const { ink, look } = useContext(PatternTheme);
  return (
    <div className="wf-panel wf-legend" {...part("legend")} role="region" aria-label={title}>
      <h3>{title}</h3>
      {rows.map((row, i) => (row.kind === "measure" ? <p key={i} className="wf-legend__measure">{row.text}</p> : null))}
      <dl>
        {rows.map((row, i) => {
          if (row.kind === "width") {
            return (
              <div key={i}>
                <dt>{row.title}</dt>
                <dd className="wf-legend__width">
                  {row.samples.map((s, j) => [<span key={j} style={{ height: s.width }} />, ` ${s.text}`])}
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
  );
}
