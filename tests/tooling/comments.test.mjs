import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { SourceMap, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildConfigs, checkComments, commentsIn, compareBuilds, documentation, documentationDifferences, emitLibrary, filesIn, pathsIn, programOf, unlistedComments } from '../../scripts/check-comments.mjs';

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

test('the declaration files keep the documentation comment of every node of their source they declare', () => {
  let documented = 0;
  for (const file of filesIn(dist, '.d.ts')) {
    const base = join(root, 'src', file.replace(/\.d\.ts$/, ''));
    const source = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
    const text = readFileSync(join(dist, file), 'utf8');
    // A comment on a node without a name, such as a file's heading above an import that the
    // declaration emitter may drop, has no counterpart to look for; comparing builds covers those.
    const named = (docs) => new Map([...docs].filter(([path]) => !/\)(#\d+)?$/.test(path)));
    const docs = named(documentation(text, file));
    const declared = pathsIn(text, file);
    const expected = new Map([...named(documentation(readFileSync(source, 'utf8'), source))].filter(([path]) => declared.has(path.replace(/#\d+$/, ''))));
    documented += docs.size;
    // The declaration emitter copies the comments of a type it writes out in place, as the members
    // of a constant built from other constants; such a copy is gained, not lost.
    assert.deepEqual(documentationDifferences(expected, docs).filter((d) => !d.endsWith(' gained a documentation comment')), [], file);
  }
  assert.ok(documented > 900, `${documented} documentation comments`);
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

test('the program of a text is the same without its comments, blank lines and line breaks, and differs when what the parser reads changes', () => {
  const program = programOf('function f(a, b) { return a + b; }');
  assert.equal(programOf('function f(a, /** The second. */\n  b) {\n  // Sum.\n\n  return a + b;\n}\n'), program);
  assert.notEqual(programOf('function f(a, c) { return a + c; }'), program);
  assert.notEqual(programOf('function f(a, b) { return a - b; }'), program);
  assert.notEqual(programOf('function f(a, b) { return "a + b"; }'), program);
  assert.notEqual(programOf('function f(){return\n1;}'), programOf('function f(){return 1;}'), 'a line break after return ends the statement');
  assert.notEqual(programOf('let a = 1;'), programOf('const a = 1;'));
  assert.notEqual(programOf('const a = -b;'), programOf('const a = !b;'));
  assert.notEqual(programOf('for (i++;;) {}'), programOf('for (;; i++) {}'));
  assert.notEqual(programOf('import { a } from "./a.js";'), programOf('import { a } from "./b.js";'));
  assert.notEqual(programOf('export { a };'), programOf('export { a as b };'));
  assert.equal(programOf('const a = [1, 2];\nf(a, b);\n'), programOf('const a = [1,\n  2];\n\n/* Call. */\nf(a,\n  b);'));
});

test('two files that differ only in comments and blank lines are the same build, and a line break after return is not', () => {
  const dirs = ['before', 'after'].map((name) => mkdtempSync(join(tmpdir(), `wise-flow-${name}-`)));
  try {
    writeFileSync(join(dirs[0], 'a.js'), '/** F. */\nexport function f() {\n  // One.\n  return 1;\n}\n');
    writeFileSync(join(dirs[1], 'a.js'), 'export function f() {\n\n  return 1;\n}\n');
    assert.deepEqual(compareBuilds(...dirs).differences, []);
    writeFileSync(join(dirs[1], 'a.js'), 'export function f() {\n  return\n  1;\n}\n');
    assert.deepEqual(compareBuilds(...dirs).differences, ['a.js: the program differs']);
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
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

test('every documentation comment is named by the node it is attached to: a member of a union, a parameter, a name exported through an export clause', () => {
  const docs = (text) => documentation(text, 'a.d.ts');
  const text = [
    '/** An event. */',
    'export type E =',
    '/** A click. */',
    '{',
    '    type: "click";',
    '}',
    '/** A hover. */',
    ' | {',
    '    /** What is hovered. */',
    '    id: string;',
    '};',
    '/** Places. */',
    'export declare function place(a: number,',
    '/** Boxes kept clear of. */',
    'titles?: readonly string[]): void;',
    '/** Hidden. */',
    'declare const hidden: number;',
    'export { hidden };',
    '',
  ].join('\n');
  const base = docs(text);
  assert.deepEqual([...base.keys()], ['E', 'E.|1', 'E.|2', 'E.|2.id', 'place', 'place.titles', 'hidden']);
  const without = (line) => docs(text.replace(`${line}\n`, ''));
  assert.deepEqual(documentationDifferences(base, without('/** A click. */')), ['E.|1 lost its documentation comment']);
  assert.deepEqual(documentationDifferences(base, without('/** Boxes kept clear of. */')), ['place.titles lost its documentation comment']);
  assert.deepEqual(documentationDifferences(base, without('/** Hidden. */')), ['hidden lost its documentation comment']);
  assert.deepEqual(documentationDifferences(docs('/** A. */\nexport declare const a: number;\n/** B. */\nexport declare const b: number;\n'), docs('/** B. */\nexport declare const b: number;\n/** A. */\nexport declare const a: number;\n')), ['the documentation comments are in another order']);
  assert.deepEqual([...docs('export interface I {\n    a: number;\n    /** Nothing follows. */\n}\n').keys()], ['I.(end)']);
});

test('removing a documentation comment of a union member or of a parameter from a built copy is a difference between the builds', () => {
  const copy = mkdtempSync(join(tmpdir(), 'wise-flow-copy-'));
  try {
    cpSync(dist, copy, { recursive: true });
    assert.deepEqual(compareBuilds(dist, copy).differences, []);
    const remove = (file, start) => {
      const text = readFileSync(join(copy, file), 'utf8');
      const line = text.split('\n').find((l) => l.trim().startsWith(start));
      assert.ok(line, `${start} in ${file}`);
      writeFileSync(join(copy, file), text.replace(`${line}\n`, ''));
    };
    remove('core/map-controller.d.ts', '/** A click on an element');
    remove('core/overlay-geometry.d.ts', '/** Boxes that arc labels keep clear of');
    assert.deepEqual(compareBuilds(dist, copy).differences, [
      'core/map-controller.d.ts: MapEvent.|1 lost its documentation comment',
      'core/overlay-geometry.d.ts: placeOverlays.titles lost its documentation comment',
    ]);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

/**
 * Compiles source files with the build's configuration of the JavaScript, in a package of the
 * library's module type, which decides what the compiler emits; returns the emitted texts by name.
 */
function compile(sources) {
  const project = mkdtempSync(join(tmpdir(), 'wise-flow-notice-'));
  try {
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).type }));
    for (const [name, text] of Object.entries(sources)) writeFileSync(join(project, 'src', `${name}.ts`), text);
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ extends: join(root, buildConfigs()[0]), compilerOptions: { rootDir: 'src', outDir: 'dist' }, include: ['src'] }));
    execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(project, 'tsconfig.json')], { cwd: project, stdio: 'inherit' });
    return { emitted: Object.fromEntries(Object.keys(sources).map((name) => [name, readFileSync(join(project, 'dist', `${name}.js`), 'utf8')])), faults: checkComments(join(project, 'dist'), join(project, 'src')) };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

const notice = '/*! Copyright notice. */';
const noticeCases = {
  directlyBeforeCode: `${notice}\nexport const a = 1;\n`,
  blankLineBeforeCode: `${notice}\n\nexport const a = 1;\n`,
  commentBeforeCode: `${notice}\n// Another comment.\nexport const a = 1;\n`,
  afterCode: `export const a = 1;\n${notice}\nexport const b = 2;\n`,
  commentOnTheSameLine: `${notice} // Another comment.\nexport const a = 1;\n`,
  noticeBeforeCode: `${notice}\n/*! Another notice. */\nexport const a = 1;\n`,
};

test('the compiler keeps a leading notice only when a line before the code is blank or holds a comment other than a notice, and the check requires what a source declares', () => {
  assert.equal(ts.version, '5.9.3', 'CONTRIBUTING.md and the doc comment of `notices` name the compiler these cases hold for');
  const { emitted, faults } = compile(noticeCases);
  assert.equal(emitted.blankLineBeforeCode, `${notice}\nexport const a = 1;\n//# sourceMappingURL=blankLineBeforeCode.js.map`);
  const kept = (text) => commentsIn(text, 'a.js').some((c) => c.text === notice);
  assert.deepEqual(Object.fromEntries(Object.entries(emitted).map(([name, text]) => [name, kept(text)])), {
    directlyBeforeCode: false,
    blankLineBeforeCode: true,
    commentBeforeCode: true,
    afterCode: false,
    commentOnTheSameLine: false,
    noticeBeforeCode: false,
  });
  assert.deepEqual(faults, [
    'afterCode.js: lacks the notice its source requires: /*! Copyright notice. */',
    'commentOnTheSameLine.js: lacks the notice its source requires: /*! Copyright notice. */',
    'directlyBeforeCode.js: lacks the notice its source requires: /*! Copyright notice. */',
    'noticeBeforeCode.js: lacks the notice its source requires: /*! Copyright notice. */',
    'noticeBeforeCode.js: lacks the notice its source requires: /*! Another notice. */',
  ]);
  assert.deepEqual(unlistedComments(emitted.blankLineBeforeCode, 'a.js'), [commentsIn(emitted.blankLineBeforeCode, 'a.js')[0]], 'a notice no source requires is not allowed');
});
