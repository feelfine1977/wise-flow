import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { committedExports } from '../../scripts/check-exports.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ENTRIES = { '.': 'index', './react': 'react/index', './bpmn': 'bpmn/index', './canvas': 'canvas/index' };
/** React Flow's hooks, re-exported unchanged; the table says so. */
const NOT_OURS = new Set(['useReactFlow', 'useNodesInitialized', 'useStore']);

/** The declarations of the four entry points, built as the build builds them. */
function emitEntryDeclarations(outDir) {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(root, 'tsconfig.build.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
  const program = ts.createProgram(config.fileNames, { ...config.options, outDir, emitDeclarationOnly: true, declarationMap: false, sourceMap: false });
  const result = program.emit();
  const errors = ts.getPreEmitDiagnostics(program).concat(result.diagnostics).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
}

/** Value exports of each entry point that can be called or constructed with at least one parameter. */
function callableExports(outDir) {
  const files = Object.fromEntries(Object.entries(ENTRIES).map(([entry, path]) => [entry, join(outDir, `${path}.d.ts`)]));
  const program = ts.createProgram(Object.values(files), { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, skipLibCheck: true, types: [], jsx: ts.JsxEmit.ReactJSX });
  const checker = program.getTypeChecker();
  const found = new Map();
  for (const [entry, file] of Object.entries(files)) {
    const source = program.getSourceFile(file);
    for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (!(target.flags & ts.SymbolFlags.Value)) continue;
      const type = checker.getTypeOfSymbolAtLocation(target, source);
      const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
      if (!signatures.some((s) => s.getParameters().length > 0)) continue;
      (found.get(symbol.name) ?? found.set(symbol.name, new Set()).get(symbol.name)).add(entry);
    }
  }
  return found;
}

/** The rows of the table: name → entries, test file and test title of its section. */
function tableRows() {
  const rows = new Map();
  let section;
  for (const line of readFileSync(resolve(root, 'tests/invalid-input.md'), 'utf8').split('\n')) {
    const heading = /^Test: `([^`]+)` › "(.+)"\.$/.exec(line);
    if (heading) section = { file: heading[1], title: heading[2] };
    const row = /^\| `([^`]+)` \| `([^`]+)` \|/.exec(line);
    if (row && section) rows.set(row[1], { entries: row[2].split(/,\s*/), ...section });
  }
  return rows;
}

const outDir = mkdtempSync(join(tmpdir(), 'wise-flow-entry-declarations-'));
let exported;
try {
  emitEntryDeclarations(outDir);
  exported = callableExports(outDir);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
const rows = tableRows();

test('every callable export of the four entry points that takes a parameter has a row in the table of invalid input', () => {
  assert.ok(exported.size > 200, `${exported.size} callable exports`);
  const missing = [...exported.keys()].filter((name) => !NOT_OURS.has(name) && !rows.has(name));
  assert.deepEqual(missing, []);
  const wrongEntry = [...exported].filter(([name, entries]) => rows.has(name) && [...entries].some((e) => !rows.get(name).entries.includes(e) && !(name === 'BpmnView'))).map(([name, entries]) => `${name}: ${[...entries]}`);
  assert.deepEqual(wrongEntry, []);
  const table = readFileSync(resolve(root, 'tests/invalid-input.md'), 'utf8');
  for (const name of NOT_OURS) assert.match(table, new RegExp('`' + name + '`'), name);
});

test('the core entry point names in the table are the committed ones', () => {
  const committed = new Set(committedExports().exports);
  const core = [...exported].filter(([, entries]) => entries.has('.')).map(([name]) => name);
  assert.deepEqual(core.filter((name) => !committed.has(name)), []);
});

test("every row's test exists, has the section's title and names the function it runs", () => {
  const problems = [];
  for (const [name, { file, title }] of rows) {
    const path = resolve(root, file);
    if (!existsSync(path)) {
      problems.push(`${name}: ${file} does not exist`);
      continue;
    }
    const source = readFileSync(path, 'utf8');
    if (!source.includes(`"${title}"`)) problems.push(`${name}: ${file} has no test "${title}"`);
    if (!source.includes(`"${name}"`)) problems.push(`${name}: ${file} does not name it`);
  }
  assert.deepEqual(problems, []);
});
