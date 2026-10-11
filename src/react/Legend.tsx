import { type Locale, type Overlay, type Scales, type SceneLegend, colorTokens, formatCompact, formatNumber, formatShare, sceneLegend, t } from "../core/index.js";
import { PatternSwatch } from "./patterns.js";
import { part } from "./parts.js";

export interface LegendProps {
  scales: Scales;
  overlays?: Overlay[];
  locale?: Locale;
  /** Map-level chips are listed under the scales. */
  chips?: React.ReactNode;
  /** The scene's legend (`FlowScene.legend`); without it the rows follow from `scales` and `overlays`. */
  legend?: SceneLegend;
}

/** Legend for the scales in use and the overlay glyphs; always visible in a map. */
export function Legend({ scales, overlays = [], locale = "en", chips, legend }: LegendProps) {
  const { items, keys } = legend ?? sceneLegend(scales.legend, overlays);
  return (
    <div className="wf-panel wf-legend" {...part("legend")} role="region" aria-label={t(locale, "legend.title")}>
      <h3>{t(locale, "legend.title")}</h3>
      <dl>
        {items.map((item, i) => {
          if (item.kind === "width") {
            return (
              <div key={i}>
                <dt>{t(locale, item.title)}</dt>
                <dd className="wf-legend__width">
                  <span style={{ height: item.range[0] }} /> {formatCompact(item.domain[0], locale)}
                  <span style={{ height: item.range[1] }} /> {formatCompact(item.domain[1], locale)}
                </dd>
              </div>
            );
          }
          if (item.kind === "categorical") {
            return (
              <div key={i}>
                <dt>{t(locale, item.title)}</dt>
                {item.entries.map((e) => (
                  <dd key={e.key} className="wf-legend__cat">
                    <span className="wf-legend__swatch" style={{ background: e.color }}>
                      <PatternSwatch pattern={e.pattern} ink={colorTokens.ink} />
                    </span>
                    {e.key}
                  </dd>
                ))}
              </div>
            );
          }
          const share = /share/i.test(item.metric);
          const f = (v: number) => (share ? formatShare(v, locale) : formatNumber(v, 1, locale));
          return (
            <div key={i}>
              <dt>{t(locale, item.title)}</dt>
              <dd>
                <div className="wf-legend__gradient" style={{ background: `linear-gradient(to right, ${item.stops.join(", ")})` }} />
                <div className="wf-legend__range">
                  <span>{f(item.domain[0])}</span>
                  {item.domain.length === 3 ? <span>{f(item.domain[1])}</span> : null}
                  <span>{f(item.domain[item.domain.length - 1])}</span>
                </div>
              </dd>
            </div>
          );
        })}
        <div>
          {keys.map((key) => (
            <dd key={key.kind}>
              <span className="wf-legend__glyph" aria-hidden="true">
                {key.glyph}
              </span>
              {t(locale, key.title)}
            </dd>
          ))}
        </div>
      </dl>
      {chips ? <div className="wf-map-chips">{chips}</div> : null}
    </div>
  );
}
