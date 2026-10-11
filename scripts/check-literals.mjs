// Size, radius, stroke, dash, weight, opacity and z-order literals in `src/` outside the token table.
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

/** The committed allow-list: the values allowed everywhere and the places allowed by name, each with its reason. */
export function allowList(path = resolve(root, 'scripts/literal-allow-list.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Files of the token table: the only place such values are written. */
const TABLE = ['src/core/tokens.ts', 'src/tokens.css'];

const number = (s) => Number(s);
const allowed = (values, n) => values.includes(Number(n));

// ---------------------------------------------------------------------------
// Stylesheets

/**
 * The CSS properties checked beyond pixel lengths, with the plain numbers each
 * allows: 0 is "none", 1 is a hairline, full opacity or the base of a stack.
 */
const CSS_PROPERTIES = [
  { test: /^font-size$/, what: 'font size', allow: [] },
  { test: /^font-weight$/, what: 'font weight', allow: [] },
  { test: /^border(-[a-z]+)*-radius$/, what: 'radius', allow: [0] },
  { test: /^stroke-width$/, what: 'stroke width', allow: [0, 1] },
  { test: /^stroke-dasharray$/, what: 'dash', allow: [] },
  { test: /^opacity$/, what: 'opacity', allow: [0, 1] },
  { test: /^z-index$/, what: 'z-order', allow: [0] },
];
const FONT_KEYWORDS = /^(inherit|initial|unset|bold|bolder|lighter|normal|smaller|larger)$/;

/** `value` without its `var()` references, nested fallbacks included. */
function withoutVariables(value) {
  let out = value;
  for (let prev; prev !== out; ) {
    prev = out;
    out = out.replace(/var\(--[\w-]+(,[^()]*)?\)/g, '');
  }
  return out;
}

/** Literals of a stylesheet: `[{ line, rule, text }]`. */
export function cssLiterals(css, values) {
  const out = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of source.matchAll(/([\w-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const [, property, raw] = m;
    if (property.startsWith('--')) continue;
    const line = source.slice(0, m.index).split('\n').length;
    const value = withoutVariables(raw).trim();
    const text = `${property}: ${raw.trim()}`;
    if ([...value.matchAll(/(-?\d*\.?\d+)px\b/g)].some((px) => !allowed(values.px, px[1]))) out.push({ line, rule: 'pixel length', text });
    const checked = CSS_PROPERTIES.find((p) => p.test.test(property));
    if (!checked || FONT_KEYWORDS.test(value)) continue;
    const numbers = [...value.matchAll(/-?\d*\.?\d+(%|rem|em|px)?/g)].filter((n) => n[1] || !allowed(checked.allow, n[0]));
    if (numbers.length && !out.some((o) => o.line === line && o.text === text)) out.push({ line, rule: checked.what, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modules

/** Object keys, JSX attributes and assigned properties whose value is drawn as a size, stroke, radius, dash, weight, opacity or z-order. */
const DRAW_KEYS = new Set(['fontSize', 'fontWeight', 'weight', 'size', 'strokeWidth', 'lineWidth', 'nodeStrokeWidth', 'interactionWidth', 'strokeOpacity', 'fillOpacity', 'opacity', 'globalAlpha', 'radius', 'rx', 'ry', 'r', 'dash', 'strokeDasharray', 'zIndex']);
/** Calls whose arguments at these positions are drawn as such: `true` for every argument. */
const DRAW_CALLS = { setLineDash: true, roundedRect: [2], outline: [1, 2], ink: [3], halo: [3] };
/** Constants named for what they hold. */
const DRAW_NAMES = /(DASH|OPACITY|RADIUS|STROKE|FONT_SIZE|WEIGHT)$/;
/** SVG attributes written in markup strings. */
const SVG_ATTRIBUTES = /\b(font-size|font-weight|stroke-width|stroke-dasharray|stroke-opacity|fill-opacity|opacity|rx|ry|r)="([^"$]*)"/g;
const ARITHMETIC = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken]);

const nameOf = (node) => (node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isPrivateIdentifier(node)) ? node.text : undefined);

/** A literal that is an operand of `+ - * / %`: layout arithmetic, such as half a box. */
function inArithmetic(node) {
  let child = node;
  let parent = node.parent;
  while (parent && ts.isPrefixUnaryExpression(parent)) [child, parent] = [parent, parent.parent];
  while (parent && ts.isParenthesizedExpression(parent)) [child, parent] = [parent, parent.parent];
  return !!parent && ts.isBinaryExpression(parent) && ARITHMETIC.has(parent.operatorToken.kind) && (parent.left === child || parent.right === child);
}

/** Literals of a module: `[{ line, rule, text }]`. */
export function tsLiterals(source, file, values) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const report = (node, rule) => {
    const line = lineOf(node);
    const text = sf.text.split('\n')[line - 1].trim();
    if (!out.some((o) => o.line === line && o.rule === rule)) out.push({ line, rule, text });
  };
  /** Numeric literals in a drawn value that are neither allowed values nor layout arithmetic. */
  const drawn = (expr, rule) => {
    const visit = (node) => {
      if (ts.isNumericLiteral(node)) {
        const negative = ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.MinusToken;
        if (!allowed(values.number, negative ? -number(node.text) : number(node.text)) && !inArithmetic(node)) report(node, rule);
        return;
      }
      // A function's body is not the value itself.
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
      ts.forEachChild(node, visit);
    };
    visit(expr);
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text;
      for (const px of text.matchAll(/(?<![\w.$}-])(-?\d*\.?\d+)px\b/g)) if (!allowed(values.px, px[1])) report(node, 'pixel length in a string');
      for (const a of text.matchAll(SVG_ATTRIBUTES)) if (/\d/.test(a[2]) && a[2].split(/[\s,]+/).some((n) => !allowed(values.number, n))) report(node, `${a[1]} in markup`);
    } else if (ts.isPropertyAssignment(node) && DRAW_KEYS.has(nameOf(node.name))) {
      drawn(node.initializer, nameOf(node.name));
    } else if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'width' && ts.isObjectLiteralExpression(node.parent) && ts.isPropertyAssignment(node.parent.parent) && nameOf(node.parent.parent.name) === 'stroke') {
      drawn(node.initializer, 'stroke width');
    } else if (ts.isJsxAttribute(node) && DRAW_KEYS.has(nameOf(node.name)) && node.initializer) {
      drawn(node.initializer, nameOf(node.name));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && DRAW_KEYS.has(node.left.name.text)) {
      drawn(node.right, node.left.name.text);
    } else if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : nameOf(node.expression);
      const positions = Object.hasOwn(DRAW_CALLS, callee) ? DRAW_CALLS[callee] : undefined;
      if (positions) node.arguments.forEach((a, i) => (positions === true || positions.includes(i)) && drawn(a, `${callee} argument`));
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && DRAW_NAMES.test(node.name.text) && node.initializer) {
      drawn(node.initializer, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------

function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesAt(path) : /\.(css|tsx?)$/.test(path) && !path.endsWith('.d.ts') ? [path] : [];
  });
}

/** The literals of `src/` outside the token table that the allow-list does not name, and the allow-list entries that name nothing. */
export function literalReport(list = allowList(), dir = resolve(root, 'src')) {
  const found = [];
  for (const path of filesAt(dir)) {
    const file = `src/${relative(dir, path).split('\\').join('/')}`;
    if (TABLE.includes(file)) continue;
    const source = readFileSync(path, 'utf8');
    const literals = path.endsWith('.css') ? cssLiterals(source, list.values) : tsLiterals(source, file, list.values);
    for (const l of literals) found.push({ file, ...l });
  }
  const used = new Set();
  const violations = found.filter((f) => {
    const entry = list.places.findIndex((p) => p.file === f.file && f.text.includes(p.text));
    if (entry >= 0) used.add(entry);
    return entry < 0;
  });
  return { violations, unused: list.places.filter((_, i) => !used.has(i)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { violations, unused } = literalReport();
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.rule}: ${v.text}`);
  for (const u of unused) console.error(`scripts/literal-allow-list.json: nothing in ${u.file} matches "${u.text}"`);
  if (violations.length || unused.length) process.exit(1);
  console.log('No size, radius, stroke, dash, weight, opacity or z-order literal outside the token table and the allow-list.');
}
