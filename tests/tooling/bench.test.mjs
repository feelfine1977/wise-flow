import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { catalogue, settings } from '../bench/cases.mjs';
import { formatValue, markdown, summarise, verdict } from '../bench/report.mjs';

const reference = JSON.parse(readFileSync(new URL('../bench/reference.json', import.meta.url), 'utf8'));
const ids = (cases) => cases.flatMap((c) => c.rows.map((r) => r.id));

test('summarises samples by median, minimum and maximum', () => {
  assert.deepEqual(summarise([5, 1, 3]), { median: 3, min: 1, max: 5 });
  // An even count: the mean of the middle two.
  assert.deepEqual(summarise([4, 1, 3, 2]), { median: 2.5, min: 1, max: 4 });
  assert.ok(Object.values(summarise([])).every(Number.isNaN));
});

test('formats milliseconds with fewer decimals as they grow, bytes whole', () => {
  assert.equal(formatValue(0.4, 'ms'), '0.40 ms');
  assert.equal(formatValue(9.876, 'ms'), '9.88 ms');
  assert.equal(formatValue(16.734, 'ms'), '16.7 ms');
  assert.equal(formatValue(98.96, 'ms'), '99.0 ms');
  assert.equal(formatValue(1234.6, 'ms'), '1,235 ms');
  assert.equal(formatValue(743.4, 'B'), '743 B');
  assert.equal(formatValue(Number.NaN, 'ms'), '–');
});

test('judges the median against a bound, a run against "completes", and nothing else', () => {
  assert.equal(verdict({ median: 16.7 }, { max: 16.7 }), 'met');
  assert.equal(verdict({ median: 16.8 }, { max: 16.7 }), 'not met');
  assert.equal(verdict({ median: 9000 }, { completes: true }), 'met');
  assert.equal(verdict({ error: 'out of memory' }, { completes: true }), 'not met');
  assert.equal(verdict({ median: 1 }, { text: 'reported' }), undefined);
  assert.equal(verdict({ median: 1 }, undefined), undefined);
});

test('runs five trials after a warm-up in full mode and fewer in quick mode', () => {
  assert.deepEqual(settings({}), { mode: 'full', trials: 5, warmup: 1 });
  assert.deepEqual(settings({ quick: true }), { mode: 'quick', trials: 2, warmup: 1 });
  assert.deepEqual(settings({ trials: '9', warmup: '2' }), { mode: 'full', trials: 9, warmup: 2 });
});

test('measures every case the benchmark promises, in both modes', () => {
  const promised = [
    'prepare.100k', 'prepare.100k.self-loops', 'prepare.500k', 'prepare.500k.self-loops', 'prepare.1m', 'prepare.1m.self-loops',
    'simplify.50k.default', 'simplify.50k.unconnected', 'simplify.100k.default', 'simplify.100k.unconnected',
    'draw.sparse-100k', 'draw.hub-50k.adaptive', 'draw.hub-50k.all', 'draw.fit-all-50k',
    'map-ready.1000', 'map-ready.5000', 'map-ready.10000', 'map-ready.20000',
    'first-scene.sparse-100', 'first-scene.dense-100', 'first-scene.sparse-500', 'first-scene.dense-500',
    'refined-layout.sparse-100', 'refined-layout.dense-100', 'refined-layout.sparse-500', 'refined-layout.dense-500',
    'abort.terminated', 'memory.per-activity', 'memory.per-flow',
  ];
  for (const quick of [false, true]) {
    const measured = ids(catalogue({ quick }));
    assert.deepEqual(promised.filter((id) => !measured.includes(id)), [], `quick: ${quick}`);
    assert.equal(new Set(measured).size, measured.length);
  }
  assert.ok(ids(catalogue()).includes('memory.scene-500k'));
  // The sizes the cases are given.
  const spec = (id) => catalogue().find((c) => c.rows.some((r) => r.id === id)).spec;
  assert.deepEqual(spec('prepare.1m.self-loops'), { kind: 'prepare', flows: 1_000_000, selfLoops: true });
  assert.deepEqual(spec('simplify.100k.unconnected'), { kind: 'simplify', activities: 100_000, options: { keepConnected: false } });
  assert.deepEqual(spec('draw.hub-50k.all'), { kind: 'draw', scene: 'hub', size: 50_000, budget: 'all' });
  assert.deepEqual(spec('map-ready.20000'), { kind: 'ready', activities: 20_000 });
  assert.deepEqual(spec('refined-layout.dense-500'), { kind: 'firstScene', shape: 'dense', activities: 500 });
});

test('selects cases by a part of their ids', () => {
  assert.deepEqual(ids(catalogue({ only: ['map-ready.2'] })), ['map-ready.20000']);
  assert.deepEqual(ids(catalogue({ only: ['dense-500'] })), ['first-scene.dense-500', 'refined-layout.dense-500']);
});

test('refers only to measured cases and keeps the targets of the repairs', () => {
  const measured = ids(catalogue());
  assert.deepEqual(Object.keys(reference.entries).filter((id) => !measured.includes(id)), []);
  for (const entry of Object.values(reference.entries)) {
    for (const quoted of [entry.before, entry.after, entry.target].filter(Boolean)) {
      assert.ok(quoted.text && quoted.source && quoted.conditions, JSON.stringify(quoted));
    }
  }
  const bound = (id) => reference.entries[id].target.max;
  assert.equal(bound('first-scene.dense-500'), 1000);
  assert.equal(bound('map-ready.20000'), 500);
  for (const id of ['draw.sparse-100k', 'draw.hub-50k.adaptive', 'draw.fit-all-50k']) assert.equal(bound(id), 16.7);
  for (const id of measured.filter((id) => id.startsWith('prepare.'))) assert.equal(reference.entries[id].target.completes, true);
});

test('prints the reference and the target beside each measurement, with their sources', () => {
  const meta = {
    commit: 'abc123', dirty: true, date: '2026-10-11T12:00:00.000Z', mode: 'quick', trials: 2, warmup: 1, framesPerGesture: 6,
    machine: { cpu: 'Test CPU', cores: 4, memoryGB: 8, platform: 'linux', release: '6.0', arch: 'arm64', loadBefore: [3, 2, 1], loadAfter: [4, 3, 2], loaded: 'load average reached 4 on 4 cores' },
    runtime: { node: 'v24.0.0', v8: '13.0' }, browser: { name: 'Chromium', version: '140.0', playwright: '1.61.1' }, library: { javaScriptGzipBytes: 188989 },
  };
  const results = [
    { id: 'a', group: 'Group one', label: 'First | case', on: '10 flows', unit: 'ms', median: 12.5, min: 10, max: 20, samples: [10, 12.5, 20] },
    { id: 'b', group: 'Group one', label: 'Second', on: '', unit: 'ms', error: 'out of memory', samples: [] },
    { id: 'c', group: 'Group two', label: 'Third', on: '', unit: 'B', median: 700, min: 690, max: 710, samples: [690, 700, 710] },
  ];
  const ref = {
    entries: {
      a: { before: { text: 'about 1 s', source: 'Audit', conditions: 'load not recorded' }, target: { text: 'under 16.7 ms', max: 16.7, source: 'Targets', conditions: 'target' } },
      b: { target: { text: 'prepares without error', completes: true, source: 'Targets', conditions: 'target' } },
      c: { before: { text: '1,071 B', source: 'Audit', conditions: 'load not recorded' }, after: { text: '743 B', source: 'Diagnostic', conditions: 'sandbox' } },
    },
    notes: ['A note.'],
  };
  const text = markdown({ meta, results }, ref);
  assert.match(text, /Commit: `abc123` with uncommitted changes/);
  assert.match(text, /\*\*Measured on a loaded machine:\*\* load average reached 4 on 4 cores/);
  assert.match(text, /a Canvas trial is a gesture of 6 frames/);
  assert.match(text, /Machine: Test CPU, 4 cores, 8 GB, linux 6.0 arm64; load average 3 \/ 2 \/ 1 before and 4 \/ 3 \/ 2 after/);
  assert.match(text, /Library JavaScript, gzip: 188,989 bytes/);
  assert.match(text, /## Group one\n\n\| Measurement \| Measured on \| Median \| Min \| Max \| Trials \| Before \| During the repairs \| Target \|/);
  // Sources are numbered in order of first use and shared.
  assert.ok(text.includes('| First \\| case | 10 flows | 12.5 ms | 10.0 ms | 20.0 ms | 3 | about 1 s [1] | – | under 16.7 ms [2]: met |'));
  assert.ok(text.includes('| Second |  | failed: out of memory |  |  | 0 | – | – | prepares without error [2]: not met |'));
  assert.ok(text.includes('| Third |  | 700 B | 690 B | 710 B | 3 | 1,071 B [1] | 743 B [3] | – |'));
  assert.match(text, /## Sources of the reference numbers\n\n1\. Audit — load not recorded\n2\. Targets — target\n3\. Diagnostic — sandbox\n/);
  assert.match(text, /## Notes\n\n- A note\.\n/);
});
