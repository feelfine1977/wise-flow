import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const headlessDependencies = new Set(['@dagrejs/dagre', 'd3-scale', 'elkjs', 'rbush']);

/** Module specifiers of imports, re-exports, import types and lazy imports; comments are not imports. */
export function importsOf(file, source) {
  const found = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (node) => {
    let specifier;
    let lazy = false;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      specifier = node.arguments[0];
      lazy = true;
      if (!specifier || !ts.isStringLiteral(specifier)) found.push({ name: undefined, lazy });
    }
    if (specifier && ts.isStringLiteral(specifier)) found.push({ name: specifier.text, lazy });
    ts.forEachChild(node, check);
  };
  check(tree);
  return found;
}

const packageOf = (name) => (name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);

/** Inspect imports, re-exports, import types and lazy imports; comments are not imports. */
export function boundaryViolations(file, source) {
  return importsOf(file, source).flatMap(({ name }) => {
    if (name === undefined) return ['Nonliteral module loading prevents boundary verification'];
    if (name.startsWith('.')) {
      const target = resolve(dirname(file), name);
      return target.startsWith(resolve(root, 'src/core') + '/') ? [] : [`Headless core imports outside core: ${name}`];
    }
    return headlessDependencies.has(packageOf(name)) ? [] : [`Unreviewed headless dependency: ${name}`];
  });
}

const bridgeDependencies = new Set([...headlessDependencies, 'bpmn-moddle']);

/**
 * The BPMN bridge outside its entry point: the core, the bridge itself,
 * bpmn-moddle, and bpmn-js loaded on demand only. React and the renderers stay
 * behind `src/bpmn/index.ts`, so Node code of the bridge never loads them.
 */
export function bridgeViolations(file, source) {
  return importsOf(file, source).flatMap(({ name, lazy }) => {
    if (name === undefined) return ['Nonliteral module loading prevents boundary verification'];
    if (name.startsWith('.')) {
      const target = resolve(dirname(file), name);
      const inside = ['src/core', 'src/bpmn'].some((dir) => target.startsWith(resolve(root, dir) + '/'));
      return inside && target !== resolve(root, 'src/bpmn/index.js') ? [] : [`BPMN bridge imports outside the core and the bridge: ${name}`];
    }
    const pkg = packageOf(name);
    if (pkg === 'bpmn-js') return lazy ? [] : [`BPMN bridge loads bpmn-js eagerly: ${name}`];
    return bridgeDependencies.has(pkg) ? [] : [`Unreviewed BPMN bridge dependency: ${name}`];
  });
}

/** Node tests load the bridge through its headless modules, never through the entry point or React. */
export function nodeTestViolations(file, source) {
  return importsOf(file, source).flatMap(({ name }) => {
    if (name === undefined || !name.startsWith('.')) return /^(react|react-dom|@xyflow\/react|@testing-library)(\/|$)/.test(name ?? '') ? [`Node test loads ${name}`] : [];
    const target = resolve(dirname(file), name).replace(/\.(js|ts|tsx)$/, '');
    if (target === resolve(root, 'src/bpmn/index')) return [`Node test loads the BPMN entry point, which loads React: ${name}`];
    if (target.startsWith(resolve(root, 'src/react'))) return [`Node test loads React components: ${name}`];
    return [];
  });
}

function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesAt(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

export function checkArchitecture() {
  const rules = [
    [boundaryViolations, [resolve(root, 'src/index.ts'), ...filesAt(resolve(root, 'src/core'))]],
    [bridgeViolations, filesAt(resolve(root, 'src/bpmn')).filter((file) => file !== resolve(root, 'src/bpmn/index.ts') && !file.endsWith('.d.ts'))],
    [nodeTestViolations, filesAt(resolve(root, 'tests/core'))],
  ];
  const errors = rules.flatMap(([rule, files]) => files.flatMap(file => rule(file, readFileSync(file, 'utf8')).map(message => `${relative(root, file)}: ${message}`)));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Headless boundaries checked across ${rules.reduce((n, [, files]) => n + files.length, 0)} files.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkArchitecture();
