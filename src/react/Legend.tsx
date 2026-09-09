import { type Locale, type Overlay, type Scales, type StringKey, formatCompact, formatNumber, formatShare, t } from "../core/index.js";
import { PatternSwatch } from "./patterns.js";

export interface LegendProps {
  scales: Scales;
  overlays?: Overlay[];
  locale?: Locale;
  /** Map-level chips are listed under the scales. */
  chips?: React.ReactNode;
}

/** Legend for the scales in use and the overlay glyphs; always visible in a map. */
export function Legend({ scales, overlays = [], locale = "en", chips }: LegendProps) {
  const kinds = new Set(overlays.map((o) => o.kind));
  const hasReverse = overlays.some((o) => o.kind === "arc" && o.payload?.reverse);
  const glyphs: [string, StringKey, boolean][] = [
    ["●", "legend.badge", kinds.has("badge")],
    ["⌒", "legend.arc", kinds.has("arc")],
    ["⌒┄", "legend.reverse", hasReverse],
    ["↻", "legend.selfLoop", kinds.has("selfLoop")],
    ["▨", "legend.outOfScope", kinds.has("hatch")],
    ["┄", "legend.reconnected", true],
  ];
  return (
    <div className="wf-panel wf-legend" role="region" aria-label={t(locale, "legend.title")}>
      <h3>{t(locale, "legend.title")}</h3>
      <dl>
        {scales.legend.map((item, i) => {
          if (item.kind === "width") {
            return (
              <div key={i}>
                <dt>{t(locale, item.title as StringKey)}</dt>
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
                <dt>{t(locale, item.title as StringKey)}</dt>
                {item.entries.map((e) => (
                  <dd key={e.key} className="wf-legend__cat">
                    <span className="wf-legend__swatch" style={{ background: e.color }}>
                      <PatternSwatch pattern={e.pattern} ink="#1f1f1f" />
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
              <dt>{t(locale, item.title as StringKey)}</dt>
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
          {glyphs
            .filter(([, , show]) => show)
            .map(([glyph, key]) => (
              <dd key={key}>
                <span className="wf-legend__glyph" aria-hidden="true">
                  {glyph}
                </span>
                {t(locale, key)}
              </dd>
            ))}
        </div>
      </dl>
      {chips ? <div className="wf-map-chips">{chips}</div> : null}
    </div>
  );
}
