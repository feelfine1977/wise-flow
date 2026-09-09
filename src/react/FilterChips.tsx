import { type Filter, type FilterClause, type FilterPreview, type Locale, asFilter, changesCases, describeClause, describePreview, formatCount, normalizeFilterPreview, removeClause, t } from "../core/index.js";

export interface FilterChipsProps {
  /** The filter of the contract (`{ and: [...] }`) or its clauses. */
  filter?: Filter | FilterClause[];
  /** Cases in and out and the marginal removal per clause (`GET …/filters/preview`; snake_case accepted). */
  preview?: FilterPreview | Record<string, unknown>;
  locale?: Locale;
  /** Activity id → label for the chip texts. */
  labelOf?: (id: string) => string;
  /** Called with the filter after a chip was removed; without it the chips are read-only. */
  onFilterChange?: (filter: Filter) => void;
  /** Text for a live region after a change. */
  onAnnounce?: (text: string) => void;
  /** Offer a "clear filters" button. Default true when `onFilterChange` is given. */
  clearable?: boolean;
  className?: string;
}

/**
 * Filter chips above a map: one chip per clause in plain words, with the
 * cases kept and removed and the marginal removal per clause when a
 * preview is given. The chips never filter data; removing one calls back
 * with the changed filter. Clauses that change the content of cases
 * (`events_inside`) are marked.
 */
export function FilterChips({ filter, preview, locale = "en", labelOf = (id) => id, onFilterChange, onAnnounce, clearable, className }: FilterChipsProps) {
  const f = asFilter(filter);
  const p = normalizeFilterPreview(preview as Record<string, unknown> | undefined);
  const marginal = new Map((p?.perClause ?? []).map((c) => [c.clause, c.removedMarginally]));
  const summary = describePreview(p, locale);
  const remove = (index: number) => {
    if (!onFilterChange) return;
    const text = describeClause(f.and[index], locale, labelOf);
    onFilterChange(removeClause(f, index));
    onAnnounce?.(t(locale, "filters.removed", { clause: text }));
  };
  const clear = () => {
    if (!onFilterChange) return;
    onFilterChange({ and: [] });
    onAnnounce?.(t(locale, "filters.cleared"));
  };
  const showClear = clearable ?? !!onFilterChange;
  return (
    <div className={`wf-filters${className ? ` ${className}` : ""}`} role="group" aria-label={t(locale, "filters.title")}>
      <span className="wf-filters__title">{t(locale, "filters.title")}</span>
      {summary ? (
        <span className="wf-filters__count" data-testid="wf-filters-count">
          {summary}
          {p?.casesOut !== undefined ? <span className="wf-filters__out"> · {t(locale, "filters.out", { out: formatCount(p.casesOut, locale) })}</span> : null}
        </span>
      ) : null}
      {f.and.length === 0 ? <span className="wf-filters__none">{t(locale, "filters.none")}</span> : null}
      <ul className="wf-filters__list">
        {f.and.map((c, i) => {
          const text = describeClause(c, locale, labelOf);
          const changes = changesCases(c);
          const m = marginal.get(i);
          return (
            <li
              key={`${i}-${text}`}
              className={`wf-chip wf-filter-chip${changes ? " wf-filter-chip--changes" : ""}`}
              data-kind={c.kind}
              data-changes-cases={changes || undefined}
              tabIndex={onFilterChange ? 0 : undefined}
              onKeyDown={(e) => {
                if (onFilterChange && (e.key === "Delete" || e.key === "Backspace")) {
                  e.preventDefault();
                  remove(i);
                }
              }}
            >
              <span className="wf-filter-chip__text">{text}</span>
              {changes ? <span className="wf-filter-chip__flag">{t(locale, "filters.changesCases")}</span> : null}
              {m !== undefined ? <span className="wf-filter-chip__marginal">{t(locale, "filters.marginal", { count: formatCount(m, locale) })}</span> : null}
              {onFilterChange ? (
                <button type="button" className="wf-filter-chip__remove" aria-label={t(locale, "filters.remove", { clause: text })} onClick={() => remove(i)}>
                  ×
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {showClear && f.and.length > 0 ? (
        <button type="button" className="wf-button wf-filters__clear" onClick={clear}>
          {t(locale, "filters.clear")}
        </button>
      ) : null}
    </div>
  );
}
