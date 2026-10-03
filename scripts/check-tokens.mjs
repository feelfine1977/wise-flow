import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

/** The token table of the core, compiled on its own (it imports nothing). */
export async function loadTokens(path = resolve(root, 'src/core/tokens.ts')) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

/** Custom property declarations of the rule blocks whose selector (and enclosing at-rule) match. */
function declarations(css, selector) {
  const out = {};
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let found = false;
  const block = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of source.matchAll(block)) {
    if (m[1].replace(/\s+/g, ' ').trim() !== selector) continue;
    found = true;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2];
  }
  return found ? out : undefined;
}

const normal = (v) => v.replace(/\s+/g, ' ').replace(/'/g, '"').trim().replace(/#[0-9a-f]+\b/gi, (h) => h.toLowerCase());

/** The blocks of `tokens.css` and the variables of the table each must hold. */
export const TOKEN_BLOCKS = [
  { selector: ':root', scheme: 'light' },
  { selector: ':root:not([data-theme="light"])', scheme: 'dark' },
  { selector: ':root[data-theme="dark"]', scheme: 'dark' },
];

/** Differences between `tokens.css` and the variables of the token table (`tokenVariables`), as readable lines. */
export function tokenDifferences(css, variables) {
  const out = [];
  for (const { selector, scheme } of TOKEN_BLOCKS) {
    const actual = declarations(css, selector);
    const expected = variables[scheme];
    if (!actual) {
      out.push(`${selector}: block missing`);
      continue;
    }
    for (const [name, value] of Object.entries(expected)) {
      if (!(name in actual)) out.push(`${selector}: ${name} missing, the table has ${value}`);
      else if (normal(actual[name]) !== normal(value)) out.push(`${selector}: ${name} is ${actual[name].trim()}, the table has ${value}`);
    }
    for (const name of Object.keys(actual)) if (!(name in expected)) out.push(`${selector}: ${name} is not in the table`);
  }
  return out;
}

function filesAt(dir, pattern) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesAt(path, pattern) : pattern.test(path) ? [path] : [];
  });
}

/** Variables of `tokens.css` that no stylesheet or renderer under `src` reads. */
export function unusedVariables(css, sources) {
  const defined = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--wf-[\w-]+)\s*:/g)].map((m) => m[1]));
  const text = sources.join('\n');
  return [...defined].filter((name) => !new RegExp(`var\\(${name}[,)\\s]`).test(text) && !text.includes(`"${name}"`)).sort();
}

/** Stylesheets and modules under `src` other than `tokens.css`, with the CSS variable names the Canvas renderer derives. */
export function readers(tokens) {
  const files = filesAt(resolve(root, 'src'), /\.(css|tsx?)$/).filter((p) => !p.endsWith('tokens.css') && !p.endsWith('core/tokens.ts'));
  const sources = files.map((p) => readFileSync(p, 'utf8'));
  // `readTokens` reads `cssVariable(key)` for every key of the Canvas tokens.
  const canvas = readFileSync(resolve(root, 'src/canvas/tokens.ts'), 'utf8');
  const keys = [...(canvas.match(/export const defaultTokens[^{]*\{([^}]*)\}/)?.[1] ?? '').matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  return [...sources, keys.map((k) => `"${tokens.cssVariable(k)}"`).join('\n')];
}
