import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const listFile = resolve(root, 'scripts/core-exports.json');

/** The committed names of the package's `.` entry point and the deprecated ones among them. */
export function committedExports() {
  return JSON.parse(readFileSync(listFile, 'utf8'));
}

/** The package's four entry points: their export paths and their sources. */
export const ENTRY_POINTS = { '.': 'index.ts', './react': 'react/index.ts', './bpmn': 'bpmn/index.ts', './canvas': 'canvas/index.ts' };

/** Builds the declaration files of the package's `.` entry point (or the given sources) into `outDir` the way the build does. */
export function emitDeclarations(outDir, sources = ['index.ts']) {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(root, 'tsconfig.build.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
  const roots = [...sources.map((source) => resolve(root, 'src', source)), ...config.fileNames.filter((f) => f.endsWith('.d.ts'))];
  const program = ts.createProgram(roots, { ...config.options, outDir, emitDeclarationOnly: true, declarationMap: false, sourceMap: false });
  const result = program.emit();
  const errors = ts.getPreEmitDiagnostics(program).concat(result.diagnostics).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  return join(outDir, 'index.d.ts');
}

/** Names a declaration file exports, sorted, and those whose export or declaration is marked `@deprecated`. */
export function declaredExports(file) {
  const program = ts.createProgram([file], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, skipLibCheck: true, types: [] });
  const checker = program.getTypeChecker();
  const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)));
  const deprecated = (symbol) => {
    for (let s = symbol; s; s = s.flags & ts.SymbolFlags.Alias ? checker.getImmediateAliasedSymbol(s) : undefined) {
      if ((s.declarations ?? []).some((d) => ts.getJSDocDeprecatedTag(d))) return true;
    }
    return false;
  };
  const sorted = (names) => [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { exports: sorted(symbols.map((s) => s.name)), deprecated: sorted(symbols.filter(deprecated).map((s) => s.name)) };
}

/** Differences between the names a declaration file exports and the committed list. */
export function exportDifferences(found, list) {
  const has = (names) => new Set(names);
  const [foundNames, listNames, foundDeprecated, listDeprecated] = [found.exports, list.exports, found.deprecated, list.deprecated].map(has);
  return [
    ...list.exports.filter((n) => !foundNames.has(n)).map((n) => `${n} is no longer exported`),
    ...found.exports.filter((n) => !listNames.has(n)).map((n) => `${n} is exported but not in the committed list`),
    ...list.deprecated.filter((n) => !foundDeprecated.has(n)).map((n) => `${n} is not marked @deprecated`),
    ...found.deprecated.filter((n) => !listDeprecated.has(n)).map((n) => `${n} is marked @deprecated but not in the committed list`),
  ];
}

/**
 * The names `docs/API.md` names in code, in a fenced block or in backticks, outside "Removed in the next
 * version" (those names are gone): every identifier there, so that `HitIndex.fromScene` names both.
 */
export function documentedNames(api = readFileSync(resolve(root, 'docs/API.md'), 'utf8')) {
  const removed = api.indexOf('\n## Removed in the next version');
  const text = removed < 0 ? api : api.slice(0, removed) + api.slice(api.indexOf('\n## ', removed + 1) >>> 0);
  const code = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const spans = [...text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return new Set([...code, ...spans].flatMap((s) => s.match(/[A-Za-z_$][\w$]*/g) ?? []));
}

/** The exported names of each entry point that `docs/API.md` does not name. */
export function undocumentedExports(exports, documented) {
  return Object.entries(exports).flatMap(([entry, names]) => names.filter((n) => !documented.has(n)).map((n) => `${n} (${entry}) is exported but docs/API.md does not name it`));
}

export function checkExports() {
  const outDir = mkdtempSync(join(tmpdir(), 'wise-flow-declarations-'));
  try {
    const found = declaredExports(emitDeclarations(outDir));
    const errors = exportDifferences(found, committedExports());
    if (errors.length) throw new Error(errors.join('\n'));
    return found;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = checkExports();
  console.log(`${found.exports.length} names of the core entry point checked, ${found.deprecated.length} deprecated.`);
}
