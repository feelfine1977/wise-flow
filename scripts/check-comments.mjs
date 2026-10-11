import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { gzipBytes, workers } from './check-budgets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/**
 * Comments the emitted JavaScript may keep besides the notices its source requires: the reference
 * to its source map, the last line of every file.
 *
 * A source file requires a notice, such as a licence or copyright notice, by writing it as a
 * `/*! … *\/` comment; its emitted file must then carry the same comment. With `removeComments`,
 * TypeScript 5.9.3 keeps such a comment only at the head of the file and only when something other
 * than code comes before the first statement: a blank line, or another comment. It removes a
 * notice that the first statement follows directly, and every notice after code. No source file
 * requires a notice.
 */
export const notices = [/^\/\/# sourceMappingURL=[\w.-]+\.js\.map$/];

/** The configs `npm run build` compiles, in order, read from its `tsc -p <config>` steps. */
export function buildConfigs(script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.build) {
  const steps = script.split('&&').map((step) => step.trim());
  const configs = steps.filter((step) => /^tsc\b/.test(step)).map((step) => {
    const match = /^tsc -p (\S+)$/.exec(step);
    if (!match) throw new Error(`The build compiles with "${step}"; expected "tsc -p <config>"`);
    return match[1];
  });
  if (configs.length === 0) throw new Error('The build runs no "tsc -p <config>" step');
  return configs;
}

/** Builds the library's JavaScript and declarations into `outDir` the way `npm run build` does. */
export function emitLibrary(outDir) {
  for (const config of buildConfigs()) execFileSync(process.execPath, [tsc, '-p', resolve(root, config), '--outDir', outDir], { cwd: root, stdio: 'inherit' });
}

/** Every file under `dir` whose name ends with `suffix`, relative to `dir`, sorted. */
export function filesIn(dir, suffix) {
  const walk = (at) => readdirSync(at, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(at, entry.name)) : entry.name.endsWith(suffix) ? [relative(dir, join(at, entry.name))] : []);
  return walk(dir).sort();
}

const parse = (text, fileName) => {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(fileName, text, { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone }, true, kind);
};

/** The tokens the parser finds in a text, in order, the end of the file last. */
function tokensOf(source) {
  const tokens = [];
  const visit = (node) => {
    const children = node.getChildren(source);
    if (children.length === 0 || node.kind === ts.SyntaxKind.EndOfFileToken) tokens.push(node);
    for (const child of children) visit(child);
  };
  visit(source);
  return tokens;
}

/**
 * The comments of a JavaScript or TypeScript text, each with its offsets and line (1-based).
 * They are read from the trivia before each token the parser found, so text inside strings,
 * template literals and regular expressions is never taken for a comment.
 */
export function commentsIn(text, fileName = 'file.js') {
  const source = parse(text, fileName);
  const found = new Map();
  for (const token of tokensOf(source)) {
    for (const range of [...ts.getTrailingCommentRanges(text, token.pos) ?? [], ...ts.getLeadingCommentRanges(text, token.pos) ?? []]) found.set(range.pos, range);
  }
  return [...found.values()].sort((a, b) => a.pos - b.pos).map(({ pos, end }) => ({ pos, end, text: text.slice(pos, end), line: source.getLineAndCharacterOfPosition(pos).line + 1 }));
}

/**
 * The program a text parses to, one node per line, indented by its depth: the kind of each node
 * and the text of its names, literals, keywords and operators. Positions, comments and white space
 * are not part of it, nor are the semicolons that end a statement and the commas between the items
 * of a list, which the nesting already holds. So texts that differ only in comments and line breaks
 * have the same program, and a line break that changes what the parser reads, as after `return`,
 * gives another.
 */
export function programOf(text, fileName = 'file.js') {
  const source = parse(text, fileName);
  const lines = [];
  const visit = (node, depth, parent) => {
    const children = node.getChildren(source);
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    if (node.kind === ts.SyntaxKind.SemicolonToken && parent && parent.getLastToken(source) === node) return;
    if (node.kind === ts.SyntaxKind.CommaToken && parent?.kind === ts.SyntaxKind.SyntaxList) return;
    lines.push(`${'  '.repeat(depth)}${ts.SyntaxKind[node.kind]}${children.length === 0 ? ` ${node.getText(source)}` : ''}`);
    for (const child of children) visit(child, depth + 1, node);
  };
  visit(source, 0);
  return lines.join('\n');
}

/** The notices a source text requires its emitted file to keep: its `/*! … *\/` comments. */
export function requiredNotices(text, fileName) {
  return commentsIn(text, fileName).filter((comment) => comment.text.startsWith('/*!')).map((comment) => comment.text);
}

/** The comments of an emitted JavaScript text that are neither listed notices nor `required`. */
export function unlistedComments(text, fileName, required = []) {
  return commentsIn(text, fileName).filter((comment) => !required.includes(comment.text) && !notices.some((notice) => notice.test(comment.text)));
}

/** A text without its comments, without trailing spaces and without blank lines. */
export function withoutComments(text, fileName) {
  let rest = '';
  let at = 0;
  for (const comment of commentsIn(text, fileName)) {
    rest += text.slice(at, comment.pos);
    at = comment.end;
  }
  rest += text.slice(at);
  return rest.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '').join('\n');
}

/** The name a node gives the comments attached to it or to the nodes inside it, if any. */
function nameOf(node) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isExportAssignment(node)) return 'default';
  if (ts.isUnionTypeNode(node.parent) || ts.isIntersectionTypeNode(node.parent)) return `${ts.isUnionTypeNode(node.parent) ? '|' : '&'}${node.parent.types.indexOf(node) + 1}`;
  if (node.name && !ts.isPropertyAccessExpression(node) && !ts.isQualifiedName(node) && !ts.isMetaProperty(node)) return node.name.getText();
  return undefined;
}

/**
 * Every node of a text below the file, in order, with its start, its depth and its path: the
 * names of the node and of the nodes it lies in. A node without a name, such as a statement or a
 * type literal, is named by its kind at the end of the path and is left out above that; a member of
 * a union or an intersection is named by its place, `|2`; a variable statement by its variables.
 */
function outline(text, fileName) {
  const source = parse(text, fileName);
  const nodes = [];
  const visit = (node, depth, names) => {
    const name = nameOf(node);
    const own = name ?? (ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.getText()).join(',') : `(${ts.SyntaxKind[node.kind]})`);
    // A union or intersection written with a leading `|` or `&` starts, as its first member does, after it.
    const start = (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node) ? node.types[0] : node).getStart(source);
    nodes.push({ node, start, depth, path: [...names, own].join('.') });
    ts.forEachChild(node, (child) => visit(child, depth + 1, name ? [...names, name] : names));
  };
  ts.forEachChild(source, (child) => visit(child, 0, []));
  return { source, nodes };
}

/** The paths of every node of a text, as `documentation` names the nodes comments are attached to. */
export function pathsIn(text, fileName) {
  return new Set(outline(text, fileName).nodes.map((entry) => entry.path));
}

/**
 * Every documentation comment of a declaration or source file, in order, by the path of the node
 * it is attached to: the node that follows it, the innermost one where several start there, but
 * not a single token such as a keyword or a name. So `Name`, `Name.member`, `f.parameter`, `T.|2`
 * for a member of a union, `Name#2` for a second overload; a comment that no node follows is named
 * by the node it lies in and `(end)`. Lines are compared without their indentation, which the
 * declaration emitter changes for members.
 */
export function documentation(text, fileName) {
  const { nodes } = outline(text, fileName);
  const following = nodes.filter((entry) => entry.node.kind >= ts.SyntaxKind.FirstNode).sort((a, b) => a.start - b.start || b.depth - a.depth);
  const docs = new Map();
  const counts = new Map();
  for (const comment of commentsIn(text, fileName)) {
    if (!comment.text.startsWith('/**') || comment.text === '/**/') continue;
    let low = 0;
    let high = following.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (following[middle].start < comment.end) low = middle + 1;
      else high = middle;
    }
    const around = nodes.filter((entry) => entry.start <= comment.pos && entry.node.end >= comment.end).at(-1);
    const next = following[low];
    const inside = next && (!around || next.start < around.node.end);
    const path = inside ? next.path : `${around ? `${around.path}.` : ''}(end)`;
    const index = (counts.get(path) ?? 0) + 1;
    counts.set(path, index);
    docs.set(index === 1 ? path : `${path}#${index}`, comment.text.split('\n').map((line) => line.trim()).join('\n'));
  }
  return docs;
}

/** Differences between two maps of documentation comments, by name. */
export function documentationDifferences(before, after) {
  const differences = [];
  for (const [name, doc] of before) {
    if (!after.has(name)) differences.push(`${name} lost its documentation comment`);
    else if (after.get(name) !== doc) differences.push(`${name} has a different documentation comment`);
  }
  for (const name of after.keys()) if (!before.has(name)) differences.push(`${name} gained a documentation comment`);
  if (differences.length === 0 && [...before.keys()].join('\n') !== [...after.keys()].join('\n')) differences.push('the documentation comments are in another order');
  return differences;
}

/**
 * The JavaScript files of `dist` that the compiler emitted, relative to `dist`: not the layout
 * workers, ELK's and Dagre's code as their packages ship it, with their notices.
 */
export function emittedJavaScript(dist) {
  return filesIn(dist, '.js').filter((file) => !workers.includes(file));
}

/** The source file under `src` that a JavaScript file of `dist` was emitted from, if there is one. */
function sourceOf(src, file) {
  return [file.replace(/\.js$/, '.ts'), file.replace(/\.js$/, '.tsx')].map((name) => join(src, name)).find((path) => existsSync(path));
}

/**
 * The faults of the emitted JavaScript files of `dist`, as messages: a notice that the file's
 * source in `src` requires and the file lacks, and a comment that is neither such a notice nor a
 * listed one.
 */
export function checkComments(dist, src = join(root, 'src')) {
  return emittedJavaScript(dist).flatMap((file) => {
    const source = sourceOf(src, file);
    const required = source ? requiredNotices(readFileSync(source, 'utf8'), source) : [];
    const text = readFileSync(join(dist, file), 'utf8');
    const present = commentsIn(text, file).map((c) => c.text);
    return [
      ...required.filter((notice) => !present.includes(notice)).map((notice) => `${file}: lacks the notice its source requires: ${notice.split('\n')[0].slice(0, 80)}`),
      ...unlistedComments(text, file, required).map((c) => `${file}:${c.line}: ${c.text.split('\n')[0].slice(0, 80)}`),
    ];
  });
}

/** Directories of `dist` whose JavaScript belongs to one entry point; the layout workers are assets. */
export const entryPoints = { '.': ['index.js', 'core/'], './react': ['react/'], './bpmn': ['bpmn/'], './canvas': ['canvas/'] };

/** Gzip bytes of each entry point's JavaScript, as `check-budgets.mjs` measures the library. */
export function weigh(dist) {
  const files = emittedJavaScript(dist);
  const weights = Object.fromEntries(Object.entries(entryPoints).map(([entry, prefixes]) => [entry, gzipBytes(files.filter((f) => prefixes.some((p) => f === p || f.startsWith(p))).map((f) => join(dist, f)))]));
  return { ...weights, total: gzipBytes(files.map((f) => join(dist, f))) };
}

/**
 * Compares two builds: the JavaScript files and their programs (`programOf`), every documentation
 * comment of every declaration file, and the weight of each entry point. `reflowed` lists the
 * files whose lines differ once comments and blank lines are removed although their programs are
 * the same: a line break the compiler kept for a comment.
 */
export function compareBuilds(before, after) {
  const js = [filesIn(before, '.js'), filesIn(after, '.js')];
  const dts = [filesIn(before, '.d.ts'), filesIn(after, '.d.ts')];
  const differences = [];
  const reflowed = [];
  if (js[0].join() !== js[1].join()) differences.push('the JavaScript files differ');
  if (dts[0].join() !== dts[1].join()) differences.push('the declaration files differ');
  for (const file of js[1].filter((f) => js[0].includes(f))) {
    const texts = [before, after].map((dir) => readFileSync(join(dir, file), 'utf8'));
    if (programOf(texts[0], file) !== programOf(texts[1], file)) differences.push(`${file}: the program differs`);
    else if (withoutComments(texts[0], file) !== withoutComments(texts[1], file)) reflowed.push(file);
  }
  let documented = 0;
  for (const file of dts[1].filter((f) => dts[0].includes(f))) {
    const docs = [before, after].map((dir) => documentation(readFileSync(join(dir, file), 'utf8'), file));
    documented += docs[0].size;
    differences.push(...documentationDifferences(...docs).map((d) => `${file}: ${d}`));
  }
  return { javaScriptFiles: js[1].length, declarationFiles: dts[1].length, documented, differences, reflowed, weights: { before: weigh(before), after: weigh(after) } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, ...rest] = process.argv.slice(2);
  if (first === '--compare') {
    const result = compareBuilds(...rest.map((dir) => resolve(dir)));
    console.log(JSON.stringify(result, null, 2));
    if (result.differences.length) process.exit(1);
  } else {
    const dist = resolve(first ?? join(root, 'dist'));
    const found = checkComments(dist);
    if (found.length) throw new Error(`Comments in the emitted JavaScript:\n${found.join('\n')}`);
    console.log(`${emittedJavaScript(dist).length} JavaScript files of ${relative(root, dist) || dist} carry no comments but the listed notices.`);
  }
}
