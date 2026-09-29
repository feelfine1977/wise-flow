import { scaleLinear } from "d3-scale";
import { formatCount, type Locale, type PathRow, type Selection } from "../core/index.js";

/** A focused relation diagram; each bar and action uses the same directed row as the table. */
export function DirectedRelations({ focus, labelOf, incoming, outgoing, locale, onSelect }: {
  focus: string; labelOf: (id: string) => string; incoming: PathRow[]; outgoing: PathRow[];
  locale: Locale; onSelect?: (selection: Selection) => void;
}) {
  const rows = [...incoming, ...outgoing];
  const maximum = Math.max(1, ...rows.map(row => row.count ?? 0).filter(Number.isFinite));
  const width = scaleLinear().domain([0, maximum]).range([0, 100]);
  const column = (values: PathRow[], direction: "incoming" | "outgoing") => <div>
    <p className="wf-relations__caption">{direction === "incoming" ? locale === "de" ? "Eingehend" : "Incoming" : locale === "de" ? "Ausgehend" : "Outgoing"}</p>
    <ul>{[...values].sort((a, b) => (b.count ?? -1) - (a.count ?? -1)).slice(0, 5).map(row => {
      const name = `${labelOf(row.from)} → ${labelOf(row.to)}`;
      const content = <><span className="wf-relations__label">{labelOf(direction === "incoming" ? row.from : row.to)}</span><strong>{row.count === undefined ? "—" : formatCount(row.count, locale)}</strong><span className="wf-relations__bar" aria-hidden="true"><i style={{ width: `${row.count === undefined ? 0 : width(row.count)}%` }} /></span></>;
      return <li key={row.edgeId ?? JSON.stringify([row.from, row.to])}>{onSelect ? <button type="button" aria-label={`Inspect ${name}: ${row.count === undefined ? "unavailable" : formatCount(row.count, locale)} transitions`} onClick={() => onSelect(row.edgeId ? { nodes: [], edges: [row.edgeId], groups: [] } : { nodes: [row.from, row.to], edges: [], groups: [] })}>{content}</button> : <div title={name}>{content}</div>}</li>;
    })}</ul>
    {values.length === 0 && <p>{locale === "de" ? "Keine beobachteten Beziehungen" : "No observed relations"}</p>}
  </div>;
  return <section className="wf-relations" aria-label={locale === "de" ? "Gerichtete Beziehungen" : "Directed relations overview"}>
    {column(incoming, "incoming")}<div className="wf-relations__focus"><span aria-hidden="true">→</span><strong>{labelOf(focus)}</strong><span aria-hidden="true">→</span></div>{column(outgoing, "outgoing")}
    <p className="wf-relations__note">{locale === "de" ? "Bis zu fünf Beziehungen pro Richtung · Übergangszahlen, keine eindeutigen Fälle · vollständige Tabellen unten." : "Up to five relations per direction · transition counts, not distinct cases · complete tables below."}</p>
  </section>;
}
