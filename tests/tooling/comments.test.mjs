import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfigs, checkComments, codeOf, commentsIn, documentation, documentationDifferences, emitLibrary, filesIn, unlistedComments } from '../../scripts/check-comments.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let dist;
before(() => {
  dist = mkdtempSync(join(tmpdir(), 'wise-flow-emit-'));
  emitLibrary(dist);
});
after(() => rmSync(dist, { recursive: true, force: true }));

test('the emitted JavaScript carries no comment but the reference to its source map', () => {
  const files = filesIn(dist, '.js');
  assert.ok(files.length > 50 && files.includes('index.js') && files.includes('react/index.js'), 'the library was emitted');
  assert.deepEqual(checkComments(dist), []);
  for (const file of files) assert.match(readFileSync(join(dist, file), 'utf8'), /\n\/\/# sourceMappingURL=[\w.-]+\.js\.map$/, file);
});

test('every exported name keeps the documentation comment of its source in the declaration files', () => {
  let documented = 0;
  for (const file of filesIn(dist, '.d.ts')) {
    const base = join(root, 'src', file.replace(/\.d\.ts$/, ''));
    const source = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
    const docs = documentation(readFileSync(join(dist, file), 'utf8'), file);
    documented += docs.size;
    assert.deepEqual(documentationDifferences(documentation(readFileSync(source, 'utf8'), source), docs), [], file);
  }
  assert.ok(documented > 500, `${documented} documented names`);
  const layout = documentation(readFileSync(join(dist, 'core/layout.d.ts'), 'utf8'), 'layout.d.ts');
  assert.match(layout.get('dagreJob'), /^\/\*\*\n\* Runs Dagre on an input\. It reads nothing but its arguments: the package's\n/);
});

/** Where the first line starting with `start` names `name` in a file: zero-based line and column. */
function position(file, start, name) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const line = lines.findIndex((text) => text.startsWith(start));
  assert.ok(line >= 0, `${start} in ${file}`);
  return { line, column: lines[line].indexOf(name) };
}

test('the source map of a JavaScript file and the map of a declaration file lead to the source line', () => {
  const source = position(join(root, 'src/core/layout.ts'), 'export function dagreJob(', 'dagreJob');
  for (const [file, start] of [['core/layout.js', 'export function dagreJob('], ['core/layout.d.ts', 'export declare function dagreJob(']]) {
    const emitted = position(join(dist, file), start, 'dagreJob');
    const map = new SourceMap(JSON.parse(readFileSync(join(dist, `${file}.map`), 'utf8')));
    const entry = map.findEntry(emitted.line, emitted.column);
    assert.equal(resolve(dirname(join(dist, file)), entry.originalSource), join(root, 'src/core/layout.ts'), file);
    assert.deepEqual({ line: entry.originalLine, column: entry.originalColumn }, source, file);
  }
});

test('the library is emitted with the configs the build script compiles', () => {
  assert.deepEqual(buildConfigs(), ['tsconfig.build.json', 'tsconfig.types.json']);
  assert.deepEqual(buildConfigs('node a.mjs && tsc -p one.json && tsc -p two.json && node b.mjs'), ['one.json', 'two.json']);
  assert.throws(() => buildConfigs('node a.mjs && node b.mjs'), /no "tsc -p <config>" step/);
  assert.throws(() => buildConfigs('tsc -p one.json --outDir out'), /compiles with "tsc -p one.json --outDir out"/);
});

test('comments are found before, between and after tokens, and never inside strings, templates or regular expressions', () => {
  const text = [
    '/** Leading. */',
    'const a = "// not a comment /* either */"; // trailing',
    'const b = `/* ${a /* inside */} // */`;',
    'const c = /\\/\\*[^*]*\\//g.test(a) /* between */ ? 1 : 2;',
    'f(a, // one',
    '  b);',
    '//# sourceMappingURL=a.js.map',
  ].join('\n');
  assert.deepEqual(commentsIn(text).map((c) => [c.line, c.text]), [
    [1, '/** Leading. */'],
    [2, '// trailing'],
    [3, '/* inside */'],
    [4, '/* between */'],
    [5, '// one'],
    [7, '//# sourceMappingURL=a.js.map'],
  ]);
  assert.deepEqual(unlistedComments(text).map((c) => c.line), [1, 2, 3, 4, 5]);
  assert.deepEqual(unlistedComments('//# sourceMappingURL=data:application/json;base64,e30=').map((c) => c.line), [1], 'only a reference to a map file is listed');
  assert.deepEqual(commentsIn('const url = "http://example.org/*"; const re = /a\\/\\/b/;'), []);
});

test('the code of a text is the same without its comments and line breaks, and differs when a name or value changes', () => {
  const code = codeOf('function f(a, b) { return a + b; }');
  assert.equal(codeOf('function f(a, /** The second. */\n  b) {\n  // Sum.\n  return a + b;\n}\n'), code);
  assert.notEqual(codeOf('function f(a, c) { return a + c; }'), code);
  assert.notEqual(codeOf('function f(a, b) { return a - b; }'), code);
  assert.notEqual(codeOf('function f(a, b) { return "a + b"; }'), code);
});

test('a documentation comment that is lost, changed or gained is named', () => {
  const docs = (text) => documentation(text, 'a.d.ts');
  const base = docs('/** A. */\nexport declare const a: number;\n/** B. */\nexport interface B {\n  /** X. */\n  x: number;\n}\ndeclare const c: number;\n');
  assert.deepEqual([...base.keys()], ['a', 'B', 'B.x']);
  assert.deepEqual(documentationDifferences(base, docs('/** A. */\nexport declare const a: number;\n/** B. */\nexport interface B {\n    /** X. */\n    x: number;\n}\n')), [], 'indentation is not compared');
  assert.deepEqual(documentationDifferences(base, docs('export declare const a: number;\n/** B, changed. */\nexport interface B {\n  /** X. */\n  x: number;\n  /** Y. */\n  y: number;\n}\n')), [
    'a lost its documentation comment',
    'B has a different documentation comment',
    'B.y gained a documentation comment',
  ]);
});
