import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTokens, readers, tokenDifferences, unusedVariables } from '../../scripts/check-tokens.mjs';
import { tokensCss } from '../../scripts/generate-tokens.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const css = read('../../src/tokens.css');
const tokens = await loadTokens();
const variables = tokens.tokenVariables();

test('tokens.css holds exactly the variables of the token table, in both schemes', () => {
  assert.deepEqual(tokenDifferences(css, variables), []);
});

test('tokens.css is the file the generator writes from the token table', () => {
  assert.equal(css, tokensCss(variables));
  assert.deepEqual(tokenDifferences(tokensCss(variables), variables), []);
});

test('the table gives the stylesheet its text, radius, stroke, dash, opacity, z-order, size and spacing roles as variables', () => {
  const { light } = variables;
  assert.equal(light['--wf-text-panel'], '13px');
  assert.equal(light['--wf-weight-legend-item'], '600');
  assert.equal(light['--wf-leading-activity-name'], '16px');
  assert.equal(light['--wf-text-comparison-note'], '13px');
  assert.equal(light['--wf-radius-key'], '4px');
  assert.equal(light['--wf-radius-pill'], '999px');
  assert.equal(light['--wf-stroke-selection'], '2px');
  assert.equal(light['--wf-dash-timeline-anchor'], '4 3');
  assert.equal(light['--wf-opacity-dimmed'], '0.35');
  // Nodes and groups take their outlines, tints and texts from their marks, not from these.
  for (const role of ['--wf-text-node-label', '--wf-weight-stage-label', '--wf-stroke-node', '--wf-stroke-group', '--wf-opacity-group-fill', '--wf-radius-circle']) assert.equal(light[role], undefined, role);
  assert.equal(light['--wf-z-menu'], '30');
  assert.equal(light['--wf-size-side-list'], '380px');
  assert.deepEqual(Object.entries(light).filter(([k]) => k.startsWith('--wf-space-')), [['--wf-space-1', '2px'], ['--wf-space-1-5', '3px'], ['--wf-space-2', '4px'], ['--wf-space-3', '6px'], ['--wf-space-4', '8px'], ['--wf-space-5', '10px'], ['--wf-space-6', '12px'], ['--wf-space-8', '16px']]);
});

test('the check names a changed, a missing and an extra variable and a missing block', () => {
  const changed = css.replace('--wf-ink: #1f1f1f;', '--wf-ink: #222222;');
  assert.deepEqual(tokenDifferences(changed, variables), [':root: --wf-ink is #222222, the table has #1f1f1f']);
  const missing = css.replace(/\n\s*--wf-note-height: 60px;/, '');
  assert.deepEqual(tokenDifferences(missing, variables), [':root: --wf-note-height missing, the table has 60px']);
  const extra = css.replace('--wf-radius: 4px;', '--wf-radius: 4px;\n  --wf-cat-0: #0072b2;');
  assert.deepEqual(tokenDifferences(extra, variables), [':root: --wf-cat-0 is not in the table']);
  const darkChanged = css.replace(/(:root\[data-theme="dark"\] \{[^}]*--wf-paper: )#16181d/, '$1#000000');
  assert.deepEqual(tokenDifferences(darkChanged, variables), [':root[data-theme="dark"]: --wf-paper is #000000, the table has #16181d']);
  const noDark = css.replace(/:root\[data-theme="dark"\] \{[^}]*\}/, '');
  assert.deepEqual(tokenDifferences(noDark, variables), [':root[data-theme="dark"]: block missing']);
});

test('the check names a dark block outside its media query and a variable in a block the table does not know', () => {
  const unwrapped = css.replace(/@media \(prefers-color-scheme: dark\) \{\s*(:root:not\(\[data-theme="light"\]\) \{[^}]*\})\s*\}/, '$1');
  assert.notEqual(unwrapped, css);
  assert.deepEqual(tokenDifferences(unwrapped, variables), [
    '@media (prefers-color-scheme: dark) :root:not([data-theme="light"]): block missing',
    ':root:not([data-theme="light"]): --wf-color-scheme is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-paper is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-surface is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-ink is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-ink-muted is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-line is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-line-strong is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-cue-stripe is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-cue-foot is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-pressed is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-on-pressed is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-pattern-ink is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-selection is not in a block of the table',
    ':root:not([data-theme="light"]): --wf-hover is not in a block of the table',
  ]);
  const stray = `${css}\n.wf-process-map { --wf-ink: #000000; }`;
  assert.deepEqual(tokenDifferences(stray, variables), ['.wf-process-map: --wf-ink is not in a block of the table']);
});

test('the check ignores comments, quotes, spacing and the case of hex digits', () => {
  const restyled = css
    .replace('--wf-font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;', "--wf-font:   system-ui, -apple-system, 'Segoe UI',  Roboto, Helvetica, Arial, sans-serif ; /* the stack */")
    .replace('--wf-fail: #d55e00;', '--wf-fail: #D55E00;');
  assert.deepEqual(tokenDifferences(restyled, variables), []);
});

test('the table states the default node sizes the CSS variables carry', () => {
  assert.deepEqual(tokens.nodeSizeTokens, {
    activity: { width: 180, height: 64 },
    stage: { width: 200, height: 64 },
    gateway: { width: 44, height: 44 },
    event: { width: 36, height: 36 },
    note: { width: 160, height: 60 },
  });
  assert.equal(variables.light['--wf-node-width'], '180px');
  assert.equal(variables.light['--wf-stage-height'], '64px');
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

test('every custom property a stylesheet, a component or a story reads is defined', () => {
  const files = (dir, pattern) => readdirSync(fileURLToPath(new URL(dir, import.meta.url))).filter((n) => pattern.test(n)).map((n) => `${dir}${n}`);
  const sources = [...files('../../src/react/', /\.(tsx?|css)$/), ...files('../../src/bpmn/', /\.ts$/), ...files('../../stories/', /\.tsx$/)];
  assert.ok(sources.length > 30);
  const defined = new Set(Object.keys(variables.light));
  const read = new Map();
  for (const path of sources) {
    const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    // Set on an element's style (in an object or by assignment), or declared in a stylesheet.
    for (const [, name] of text.matchAll(/["'](--wf-[\w-]+)["'](?:\s+as\s+string)?\]?\s*(?::|=(?!=))/g)) defined.add(name);
    for (const [, name] of text.matchAll(/^\s*(--wf-[\w-]+)\s*:/gm)) defined.add(name);
    for (const [, name] of text.matchAll(/var\(\s*(--wf-[\w-]+)/g)) if (!read.has(name)) read.set(name, path);
  }
  assert.deepEqual([...read].filter(([name]) => !defined.has(name)).map(([name, path]) => `${name} in ${path}`), []);
});
