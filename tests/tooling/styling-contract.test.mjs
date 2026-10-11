import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { documentedParts, readContract, stylingContractErrors } from '../../scripts/check-styling-contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const api = readFileSync(join(root, 'docs/API.md'), 'utf8');
const contract = readContract();
const SENTENCE = 'CSS written against these selectors changes only the interactive DOM map and the panels around it. It does not change the Canvas map (used automatically above 2,000 elements), SVG or PNG exports, or the BPMN diagram. Anything that must look the same everywhere belongs in the theme or a rule.';

/** What the fixtures draw, as `tests/react/StylingContract.test.tsx` renders them in jsdom. */
function renderFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'wise-flow-styling-'));
  try {
    const out = join(dir, 'found.json');
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/react/StylingContract.test.tsx', '--reporter=dot'], { cwd: root, env: { ...process.env, FLOW_STYLING_FOUND: out }, encoding: 'utf8' });
    let found;
    try { found = JSON.parse(readFileSync(out, 'utf8')); } catch { found = undefined; }
    return { found, status: run.status, output: run.stdout + run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the rendered fixtures draw every part, kind and state of the styling contract, and docs/API.md lists them', () => {
  const { found, status, output } = renderFixtures();
  assert.ok(found, `the fixtures did not render:\n${output}`);
  assert.deepEqual(stylingContractErrors(contract, found, api), []);
  assert.equal(status, 0, output);
});

test('docs/API.md says what CSS against the selectors does not reach', () => {
  assert.ok(api.replace(/\s+/g, ' ').includes(SENTENCE));
});

test('the check names an entry the code no longer draws, one the document no longer lists, and one it does not know, and calls a removal breaking', () => {
  const found = Object.fromEntries(Object.entries(contract.parts).map(([part, { kinds = [], states = [] }]) => [part, { kinds: [...kinds], states: [...states] }]));
  assert.deepEqual(stylingContractErrors(contract, found, api), []);
  // The code stops drawing a part, a kind and a state.
  const lost = structuredClone(found);
  delete lost.legend;
  lost.node.kinds = lost.node.kinds.filter((k) => k !== 'gateway');
  lost.edge.states = lost.edge.states.filter((s) => s !== 'dimmed');
  const errors = stylingContractErrors(contract, lost, api);
  assert.equal(errors.length, 3);
  const named = (start) => errors.find((e) => e.startsWith(start)) ?? '';
  assert.match(named('part `legend`'), /^part `legend` is listed in docs\/styling-contract\.json but no element of the rendered fixtures carries it\. .*breaking change/);
  assert.match(named('kind `gateway`'), /^kind `gateway` of `node` .*no element of the rendered fixtures.*breaking change/);
  assert.match(named('state `dimmed`'), /^state `dimmed` of `edge` .*no element of the rendered fixtures.*breaking change/);
  // The document drops a row and a state.
  const document = api.replace(/^\| `legend` \|.*\n/m, '').replace(/(\| `group` \|[^\n]*)`selected`/, '$1');
  assert.deepEqual(stylingContractErrors(contract, found, document).map((e) => e.split('.')[0]), ['state `selected` of `group` is listed in docs/styling-contract', 'part `legend` is listed in docs/styling-contract']);
  assert.ok(stylingContractErrors(contract, found, document).every((e) => e.includes('docs/API.md does not list it') && e.includes('breaking change')));
  // The code draws what the contract does not list.
  const more = { ...structuredClone(found), minimap: { kinds: [], states: [] } };
  more.mark.states.push('pressed');
  assert.deepEqual(stylingContractErrors(contract, more, api), [
    'state `pressed` of `mark` is drawn but not listed in docs/styling-contract.json; add it there and to docs/API.md',
    'part `minimap` is drawn but not listed in docs/styling-contract.json; add it there and to docs/API.md',
  ]);
});

test('the document table is read row by row', () => {
  const rows = documentedParts('x\n## Styling contract\n\n| `node` | a node | `activity`, `stage` | `selected` |\n| `legend` | the legend | | |\n\n## Next\n| `edge` | x | | |\n');
  assert.deepEqual([...rows], [['node', { kinds: ['activity', 'stage'], states: ['selected'] }], ['legend', { kinds: [], states: [] }]]);
});
