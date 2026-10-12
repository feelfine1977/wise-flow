import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRY_POINTS, committedExports, declaredExports, documentedNames, emitDeclarations, exportDifferences, undocumentedExports } from '../../scripts/check-exports.mjs';

const list = committedExports();

test('the built declaration file of the core entry point exports exactly the committed names, deprecated as committed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wise-flow-declarations-'));
  try {
    const file = emitDeclarations(dir);
    assert.deepEqual(exportDifferences(declaredExports(file), list), []);
    const core = readFileSync(join(dir, 'core/index.d.ts'), 'utf8');
    assert.doesNotMatch(core, /export \*/, 'every name is listed');
    for (const tag of core.match(/@deprecated[^*]*/g) ?? []) assert.match(tag, /next major version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed list keeps the names exported before and its deprecated names are among them', () => {
  for (const name of ['FlowGraph', 'abstract', 'layout', 'toSVG', 'buildScales', 'HitIndex', 'repositionNodes', 'buildScene', 'routeSequenceFlows']) assert.ok(list.exports.includes(name), name);
  assert.deepEqual(list.deprecated.filter((n) => !list.exports.includes(n)), []);
});

test('the check names a removed, an added, an undeprecated and a newly deprecated name', () => {
  const found = { exports: ['a', 'c'], deprecated: ['c'] };
  assert.deepEqual(exportDifferences(found, { exports: ['a', 'b'], deprecated: ['a'] }), [
    'b is no longer exported',
    'c is exported but not in the committed list',
    'a is not marked @deprecated',
    'c is marked @deprecated but not in the committed list',
  ]);
});

test('a deprecation on the re-export or on the declaration counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wise-flow-declarations-'));
  try {
    writeFileSync(join(dir, 'a.d.ts'), 'export declare function a(): void;\n/** @deprecated Gone. */\nexport declare function b(): void;\nexport interface C { x: number }\n');
    writeFileSync(join(dir, 'index.d.ts'), 'export { a, b } from "./a.js";\nexport type {\n/** @deprecated Gone. */\nC, } from "./a.js";\n');
    assert.deepEqual(declaredExports(join(dir, 'index.d.ts')), { exports: ['C', 'a', 'b'], deprecated: ['C', 'b'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('docs/API.md lists every deprecated name of the entry point', () => {
  const api = readFileSync(fileURLToPath(new URL('../../docs/API.md', import.meta.url)), 'utf8');
  const section = api.slice(api.indexOf('## Deprecated names'));
  assert.ok(section.length < api.length, 'deprecation section');
  for (const name of list.deprecated) assert.match(section, new RegExp('`' + name + '`'), name);
});

test('docs/API.md names every name the four entry points export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wise-flow-declarations-'));
  try {
    emitDeclarations(dir, Object.values(ENTRY_POINTS));
    const exports = Object.fromEntries(Object.entries(ENTRY_POINTS).map(([entry, source]) => [entry, declaredExports(join(dir, source.replace(/\.ts$/, '.d.ts'))).exports]));
    assert.ok(exports['./react'].includes('ProcessMap') && exports['./bpmn'].includes('exportBpmn') && exports['./canvas'].includes('toPNG'));
    assert.deepEqual(undocumentedExports(exports, documentedNames()), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the documentation check reads names in code only, and not those of the removed names', () => {
  const api = [
    '## A', '', '```ts', 'export function a(x: Bee): void;', '```', '', 'Prose names c and `HitIndex.fromScene`.', '',
    '## Removed in the next version', '', '| `gone` | `kept` |', '', '## B', '', 'Then `after`.', '',
  ].join('\n');
  const named = documentedNames(api);
  for (const name of ['a', 'Bee', 'HitIndex', 'fromScene', 'after']) assert.ok(named.has(name), name);
  for (const name of ['c', 'gone', 'kept']) assert.ok(!named.has(name), name);
  assert.deepEqual(undocumentedExports({ '.': ['a', 'gone'], './react': ['c'] }, named), [
    'gone (.) is exported but docs/API.md does not name it',
    'c (./react) is exported but docs/API.md does not name it',
  ]);
});
