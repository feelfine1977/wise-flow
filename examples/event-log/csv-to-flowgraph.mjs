#!/usr/bin/env node
// Builds a wise-flow FlowGraph from an event log in CSV: one row per event, with a case, an activity and a time.
//
//   node examples/event-log/csv-to-flowgraph.mjs log.csv --out graph.json
//   node examples/event-log/csv-to-flowgraph.mjs log.csv --stages examples/event-log/bpic2019-stages.json --out graph.json
//
// Columns default to the names pm4py writes (case:concept:name, concept:name, time:timestamp); --case, --activity
// and --timestamp name others. The script reads the whole file into memory, which suits logs up to a few hundred
// thousand events; for larger logs compute the same counts where the log lives (a database, pandas, pm4py) and
// write the same JSON. It needs no package: Node 22 or 24 is enough.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    case: { type: 'string', default: 'case:concept:name' },
    activity: { type: 'string', default: 'concept:name' },
    timestamp: { type: 'string', default: 'time:timestamp' },
    stages: { type: 'string' },
    label: { type: 'string' },
    out: { type: 'string' },
  },
});
const [csvPath] = positionals;
if (!csvPath) {
  console.error('Usage: csv-to-flowgraph.mjs <log.csv> [--case column] [--activity column] [--timestamp column] [--stages stages.json] [--label text] [--out graph.json]');
  process.exit(2);
}

/** The rows of a CSV text (RFC 4180: quoted fields may hold commas, quotes written twice and line breaks). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Milliseconds since 1970 of a time as logs write it ("2018-01-02 10:00:00+00:00", ISO 8601), or NaN. */
function timeOf(text) {
  return Date.parse(/^\d{4}-\d\d-\d\d \d/.test(text) ? text.replace(' ', 'T') : text);
}

/** An id for a label: lower case, words joined by "_"; never a name of Object.prototype, which the library refuses. */
function slug(label, taken) {
  let id = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'activity';
  if (id in Object.prototype || id.startsWith('__')) id = `a_${id}`;
  let unique = id;
  for (let n = 2; taken.has(unique); n++) unique = `${id}_${n}`;
  taken.add(unique);
  return unique;
}

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(q * values.length) - 1)];
const round = (x, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;
const HOUR = 3_600_000;

const [header, ...records] = parseCsv(readFileSync(csvPath, 'utf8'));
const column = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`No column "${name}" in ${csvPath}; its columns are: ${header.join(', ')}`);
  return i;
};
const [caseColumn, activityColumn, timeColumn] = [column(options.case), column(options.activity), column(options.timestamp)];

// The events of each case in the order they happened; events at the same time keep the order of the file.
const cases = new Map();
let skipped = 0;
records.forEach((record, row) => {
  const caseId = record[caseColumn];
  const activity = record[activityColumn];
  const time = timeOf(record[timeColumn] ?? '');
  if (!caseId || !activity || Number.isNaN(time)) { skipped++; return; }
  if (!cases.has(caseId)) cases.set(caseId, []);
  cases.get(caseId).push({ activity, time, row });
});
for (const events of cases.values()) events.sort((a, b) => a.time - b.time || a.row - b.row);

// Stages: [{ "id", "label", "order", "match": a regular expression on the activity's name, "flags"? }]. An activity
// belongs to the first stage in the file whose expression matches it, else to "Other"; the map draws the stages by
// "order", so the file can list a narrow rule before a broad one ("Clear Invoice" before "Invoice").
const stages = options.stages ? JSON.parse(readFileSync(options.stages, 'utf8')).map((s) => ({ ...s, pattern: new RegExp(s.match, s.flags ?? '') })) : [];
const stageOf = (label) => stages.find((s) => s.pattern.test(label))?.id ?? (stages.length ? 'other' : undefined);

const ids = new Map();
const taken = new Set(['__start', '__end']);
const idOf = (label) => ids.get(label) ?? ids.set(label, slug(label, taken)).get(label);

const activities = new Map();   // id → counts
const paths = new Map();        // "source->target" → counts
const tally = (id, label) => activities.get(id) ?? activities.set(id, { label, events: 0, cases: new Set(), starts: 0, ends: 0, next: [], prev: [] }).get(id);
const pathOf = (source, target) => {
  const key = `${source}->${target}`;
  return paths.get(key) ?? paths.set(key, { source, target, count: 0, cases: new Set(), lags: [] }).get(key);
};
let eventCount = 0;
for (const [caseId, events] of cases) {
  eventCount += events.length;
  events.forEach((event, i) => {
    const id = idOf(event.activity);
    const a = tally(id, event.activity);
    a.events++;
    a.cases.add(caseId);
    const before = events[i - 1];
    const after = events[i + 1];
    if (!before) a.starts++;
    if (!after) a.ends++;
    if (after) a.next.push((after.time - event.time) / HOUR);
    if (before) a.prev.push((event.time - before.time) / HOUR);
    const path = pathOf(before ? idOf(before.activity) : '__start', id);
    path.count++;
    path.cases.add(caseId);
    if (before) path.lags.push((event.time - before.time) / HOUR);
  });
  const last = pathOf(idOf(events.at(-1).activity), '__end');
  last.count++;
  last.cases.add(caseId);
}

const total = cases.size;
const graph = {
  nodes: [
    { id: '__start', kind: 'event', label: 'Start', metrics: { cases: total, share: 1 }, tags: ['start'] },
    ...[...activities].map(([id, a]) => {
      const group = stageOf(a.label);
      const metrics = { events: a.events, cases: a.cases.size, share: round(a.cases.size / total), starts: a.starts, ends: a.ends };
      if (a.next.length) Object.assign(metrics, { medianNextHours: round(median(a.next)), nextPassages: a.next.length });
      if (a.prev.length) Object.assign(metrics, { medianPrevHours: round(median(a.prev)), prevPassages: a.prev.length });
      return { id, kind: 'activity', label: a.label, ...(group && { group }), metrics };
    }),
    { id: '__end', kind: 'event', label: 'End', metrics: { cases: total, share: 1 }, tags: ['end'] },
  ],
  edges: [...paths.values()].map((p) => {
    const metrics = { count: p.count, cases: p.cases.size, share: round(p.cases.size / total) };
    if (p.lags.length) Object.assign(metrics, { medianLagHours: round(median(p.lags)), p90LagHours: round(quantile(p.lags, 0.9)), lagPassages: p.lags.length });
    return { id: `${p.source}->${p.target}`, kind: 'follows', source: p.source, target: p.target, metrics };
  }),
  ...(stages.length && {
    groups: [...stages, { id: 'other', label: 'Other', order: Infinity }]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((s) => [...activities.values()].some((a) => stageOf(a.label) === s.id))
      .map((s) => ({ id: s.id, kind: 'stage', label: s.label })),
  }),
  meta: { label: options.label ?? csvPath.split('/').at(-1), cases: total, events: eventCount },
};

const json = JSON.stringify(graph, null, 1) + '\n';
if (options.out) writeFileSync(options.out, json);
else process.stdout.write(json);
console.error(`${total} cases, ${eventCount} events, ${activities.size} activities, ${paths.size} paths${skipped ? `; ${skipped} rows without a case, an activity or a readable time left out` : ''}`);
