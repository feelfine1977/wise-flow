import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Names marked `@deprecated` in a module: declarations, re-exported names and members as `Owner.member`. */
export function deprecatedNames(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = [];
  const ownerOf = (node) => {
    for (let p = node.parent; p; p = p.parent) if ((ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isClassDeclaration(p)) && p.name) return p.name.text;
    return undefined;
  };
  const visit = (node) => {
    // The trivia before a node holds its comments, also those on the line of the previous token.
    const marked = /@deprecated\b/.test(source.slice(node.getFullStart(), node.getStart(tree)));
    const name = node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
    if (marked && name) {
      const member = ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isMethodSignature(node);
      found.push(member ? `${ownerOf(node)}.${name}` : name);
    }
    if (marked && ts.isVariableStatement(node)) found.push(...node.declarationList.declarations.map((d) => d.name.getText(tree)));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** Rows `| \`name\` | replacement |` of the "Deprecated names" section of a document. */
export function documentedDeprecations(markdown) {
  const start = markdown.indexOf('\n## Deprecated names\n');
  if (start < 0) return new Map();
  const next = markdown.indexOf('\n## ', start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  return new Map([...section.matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].map(([, name, replacement]) => [name, replacement.trim()]));
}

function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesAt(path) : /\.tsx?$/.test(path) && !path.endsWith('.d.ts') ? [path] : [];
  });
}

test('every deprecated name of the package is listed in docs/API.md with its replacement', () => {
  const names = new Set(filesAt(resolve(root, 'src')).flatMap((file) => deprecatedNames(file, readFileSync(file, 'utf8'))));
  const documented = documentedDeprecations(readFileSync(resolve(root, 'docs/API.md'), 'utf8'));
  for (const name of ['byId', 'manhattanRoute', 'OverlayLayerProps.showArcs', 'ActivityNodeData.badges', 'GroupNodeData.chips']) assert.ok(names.has(name), name);
  for (const name of names) {
    assert.ok(documented.has(name), `${name} is deprecated but not listed under "Deprecated names" in docs/API.md`);
    assert.ok(documented.get(name) && documented.get(name) !== 'none', `${name} has no replacement in docs/API.md`);
  }
  for (const name of documented.keys()) assert.ok(names.has(name), `docs/API.md lists ${name}, which is not deprecated`);
});

test('deprecations are found on re-exports, declarations and members, and only there', () => {
  assert.deepEqual(deprecatedNames('x.ts', `
    export { a, /** @deprecated Gone. */ b } from "./x.js";
    /** @deprecated Gone. */
    export function c() {}
    /** Still here. */
    export function d() {}
    /** @deprecated */ export const e = 1;
    export type F = { /** @deprecated */ g: string; h: number };
    export interface I { /** @deprecated */ j?: boolean }
  `), ['b', 'c', 'e', 'F.g', 'I.j']);
});

test('the document check reads only the rows of its own section', () => {
  const rows = documentedDeprecations('## Other\n\n| `x` | y |\n\n## Deprecated names\n\n| Name | Replacement |\n| --- | --- |\n| `a` | `b` |\n\n### Sub\n\n| `C.d` | none |\n\n## Later\n\n| `z` | w |\n');
  assert.deepEqual([...rows], [['a', '`b`'], ['C.d', 'none']]);
});
