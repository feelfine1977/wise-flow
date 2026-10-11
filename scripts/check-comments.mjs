import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { workers } from './check-budgets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/**
 * Comments the emitted JavaScript may keep: the reference to its source map, the last line of
 * every file. A licence or copyright notice would be listed here too; no source file has one.
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

/** The code of a text without comments and white space: its tokens, one per line. */
export function codeOf(text, fileName = 'file.js') {
  const source = parse(text, fileName);
  return tokensOf(source).map((token) => token.getText(source)).join('\n');
}

/** The comments of an emitted JavaScript text that are not listed notices. */
export function unlistedComments(text, fileName) {
  return commentsIn(text, fileName).filter((comment) => !notices.some((notice) => notice.test(comment.text)));
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

/**
 * The documentation comments of a declaration or source file's exported declarations and of
 * their members, by name: `Name`, `Name.member`, `Name.member#2` for a second overload. Lines are
 * compared without their indentation, which the declaration emitter changes for members.
 */
export function documentation(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const docs = new Map();
  const counts = new Map();
  const record = (key, node) => {
    const index = (counts.get(key) ?? 0) + 1;
    counts.set(key, index);
    const doc = (ts.getLeadingCommentRanges(text, node.pos) ?? []).map((r) => text.slice(r.pos, r.end)).filter((c) => c.startsWith('/**'));
    if (doc.length) docs.set(index === 1 ? key : `${key}#${index}`, doc.map((c) => c.split('\n').map((line) => line.trim()).join('\n')).join('\n'));
  };
  const nameOf = (node) => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name)) ? node.name.text : undefined;
  const members = (prefix, node) => {
    const list = ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeLiteralNode(node) ? node.members
      : ts.isEnumDeclaration(node) ? node.members
      : ts.isTypeAliasDeclaration(node) ? (ts.isTypeLiteralNode(node.type) ? node.type.members : [])
      : [];
    for (const member of list) {
      const name = nameOf(member) ?? (ts.isConstructorDeclaration(member) ? 'constructor' : undefined);
      if (!name) continue;
      record(`${prefix}.${name}`, member);
      if (member.type && ts.isTypeLiteralNode(member.type)) members(`${prefix}.${name}`, member.type);
    }
  };
  const exported = (node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!exported(statement)) continue;
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) record(declaration.name.text, statement);
    } else if (nameOf(statement) && exported(statement)) {
      record(nameOf(statement), statement);
      members(nameOf(statement), statement);
    }
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
  return differences;
}

/**
 * The JavaScript files of `dist` that the compiler emitted, relative to `dist`: not the layout
 * workers, ELK's and Dagre's code as their packages ship it, with their notices.
 */
export function emittedJavaScript(dist) {
  return filesIn(dist, '.js').filter((file) => !workers.includes(file));
}

/** The comments of every emitted JavaScript file of `dist` that are not listed notices, as messages. */
export function checkComments(dist) {
  return emittedJavaScript(dist).flatMap((file) => unlistedComments(readFileSync(join(dist, file), 'utf8'), file).map((c) => `${file}:${c.line}: ${c.text.split('\n')[0].slice(0, 80)}`));
}

/** Directories of `dist` whose JavaScript belongs to one entry point; the layout workers are assets. */
export const entryPoints = { '.': ['index.js', 'core/'], './react': ['react/'], './bpmn': ['bpmn/'], './canvas': ['canvas/'] };

/** Gzip bytes of each entry point's JavaScript, as `check-budgets.mjs` measures the library. */
export function weigh(dist) {
  const files = emittedJavaScript(dist);
  const weights = Object.fromEntries(Object.entries(entryPoints).map(([entry, prefixes]) => [entry, files.filter((f) => prefixes.some((p) => f === p || f.startsWith(p))).reduce((sum, f) => sum + gzipSync(readFileSync(join(dist, f))).length, 0)]));
  return { ...weights, total: files.reduce((sum, f) => sum + gzipSync(readFileSync(join(dist, f))).length, 0) };
}

/**
 * Compares two builds: the JavaScript files and their code (tokens without comments and white
 * space), the documentation comments of every declaration file, and the weight of each entry
 * point. `reflowed` lists the files whose lines differ once comments and blank lines are removed
 * although their code is the same: a line break the compiler kept for a comment.
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
    if (codeOf(texts[0], file) !== codeOf(texts[1], file)) differences.push(`${file}: the code differs`);
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
