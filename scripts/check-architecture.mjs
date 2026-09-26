import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const headlessDependencies = new Set(['@dagrejs/dagre', 'd3-scale', 'elkjs', 'rbush']);

/** Inspect imports, re-exports, import types and lazy imports; comments are not imports. */
export function boundaryViolations(file, source) {
  const violations = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (node) => {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteral(specifier)) violations.push('Nonliteral module loading prevents boundary verification');
    }
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text;
      if (name.startsWith('.')) {
        const target = resolve(dirname(file), name);
        if (!target.startsWith(resolve(root, 'src/core') + '/')) violations.push(`Headless core imports outside core: ${name}`);
      } else {
        const pkg = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
        if (!headlessDependencies.has(pkg)) violations.push(`Unreviewed headless dependency: ${name}`);
      }
    }
    ts.forEachChild(node, check);
  };
  check(tree);
  return violations;
}

function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesAt(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

export function checkArchitecture() {
  const files = [resolve(root, 'src/index.ts'), ...filesAt(resolve(root, 'src/core'))];
  const errors = files.flatMap(file => boundaryViolations(file, readFileSync(file, 'utf8')).map(message => `${relative(root, file)}: ${message}`));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Headless boundary checked across ${files.length} source files.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkArchitecture();
