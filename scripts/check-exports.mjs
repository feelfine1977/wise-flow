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

/** Builds the declaration files of the package's `.` entry point into `outDir` the way the build does. */
export function emitDeclarations(outDir) {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(root, 'tsconfig.types.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
  const program = ts.createProgram([resolve(root, 'src/index.ts')], { ...config.options, outDir, emitDeclarationOnly: true, declarationMap: false, sourceMap: false });
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
