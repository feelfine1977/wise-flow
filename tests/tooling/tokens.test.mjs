import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTokens, readers, tokenDifferences, unusedVariables } from '../../scripts/check-tokens.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const css = read('../../src/tokens.css');
const tokens = await loadTokens();
const variables = tokens.tokenVariables();

test('tokens.css holds exactly the variables of the token table, in both schemes', () => {
  assert.deepEqual(tokenDifferences(css, variables), []);
});

test('the check names a changed, a missing and an extra variable and a missing block', () => {
  const changed = css.replace('--wf-ink: #1f1f1f;', '--wf-ink: #222222;');
  assert.deepEqual(tokenDifferences(changed, variables), [':root: --wf-ink is #222222, the table has #1f1f1f']);
  const missing = css.replace(/\n\s*--wf-note-height: 60px;/, '');
  assert.deepEqual(tokenDifferences(missing, variables), [':root: --wf-note-height missing, the table has 60px']);
  const extra = css.replace('--wf-radius: 6px;', '--wf-radius: 6px;\n  --wf-cat-0: #0072b2;');
  assert.deepEqual(tokenDifferences(extra, variables), [':root: --wf-cat-0 is not in the table']);
  const darkChanged = css.replace(/(:root\[data-theme="dark"\] \{[^}]*--wf-paper: )#16181d/, '$1#000000');
  assert.deepEqual(tokenDifferences(darkChanged, variables), [':root[data-theme="dark"]: --wf-paper is #000000, the table has #16181d']);
  const noDark = css.replace(/:root\[data-theme="dark"\] \{[^}]*\}/, '');
  assert.deepEqual(tokenDifferences(noDark, variables), [':root[data-theme="dark"]: block missing']);
});

test('the check ignores comments, quotes, spacing and the case of hex digits', () => {
  const restyled = css
    .replace('--wf-font: Inter, "Segoe UI", Helvetica, Arial, sans-serif;', "--wf-font:   Inter, 'Segoe UI',  Helvetica, Arial, sans-serif ; /* the stack */")
    .replace('--wf-fail: #d55e00;', '--wf-fail: #D55E00;');
  assert.deepEqual(tokenDifferences(restyled, variables), []);
});

test('the table states the default node sizes the CSS variables carry', () => {
  assert.deepEqual(tokens.nodeSizeTokens, {
    activity: { width: 180, height: 48 },
    stage: { width: 200, height: 56 },
    gateway: { width: 44, height: 44 },
    event: { width: 36, height: 36 },
    note: { width: 160, height: 60 },
  });
  assert.equal(variables.light['--wf-node-width'], '180px');
  assert.equal(variables.light['--wf-stage-height'], '56px');
  assert.equal(variables.light['--wf-gateway-width'], '44px');
});

test('every variable of tokens.css is read by a stylesheet or a renderer', () => {
  assert.deepEqual(unusedVariables(css, readers(tokens)), []);
  assert.deepEqual(unusedVariables(`${css}\n:root { --wf-unread: 1px; }`, readers(tokens)), ['--wf-unread']);
});

test('the stylesheet reads the default node sizes through their custom properties', () => {
  const style = read('../../src/react/style.css');
  const rule = (selector) => style.match(new RegExp(`\\n${selector.replace(/[.-]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`))?.[1] ?? '';
  for (const [selector, prefix] of [['.wf-node', 'node'], ['.wf-node--stage', 'stage'], ['.wf-node--gateway', 'gateway'], ['.wf-node--event', 'event'], ['.wf-node--note', 'note']]) {
    assert.match(rule(selector), new RegExp(`width: var\\(--wf-${prefix}-width\\);`), selector);
    assert.match(rule(selector), new RegExp(`height: var\\(--wf-${prefix}-height\\);`), selector);
  }
  // No other rule of the stylesheet repeats a default node size.
  for (const size of Object.values(tokens.nodeSizeTokens)) {
    assert.doesNotMatch(style, new RegExp(`width: ${size.width}px;\\s*height: ${size.height}px;`));
  }
});

test('components and the stylesheet name colours by token, not by hex literal', () => {
  const sources = ['../../src/react/style.css', ...readdirSync(fileURLToPath(new URL('../../src/react/', import.meta.url))).filter((n) => n.endsWith('.tsx')).map((n) => `../../src/react/${n}`)];
  assert.ok(sources.length > 10);
  for (const path of sources) {
    // Hex colours, not fragment references such as url(#id).
    assert.deepEqual(read(path).match(/(?<![\w(&])#[0-9a-fA-F]{3,8}\b(?![\w-])/g) ?? [], [], path);
  }
});
