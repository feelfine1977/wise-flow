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

/** Rule blocks of a stylesheet: the selector, the enclosing at-rules (`@media …`, joined) and the custom property declarations. */
function ruleBlocks(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const open = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') {
      open.push({ prelude: source.slice(start, i).replace(/\s+/g, ' ').trim(), body: i + 1 });
      start = i + 1;
    } else if (source[i] === '}') {
      const block = open.pop();
      start = i + 1;
      if (!block || block.prelude.startsWith('@')) continue;
      const variables = {};
      for (const d of source.slice(block.body, i).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) variables[d[1]] = d[2];
      out.push({ selector: block.prelude, atRule: open.map((o) => o.prelude).join(' '), variables });
    }
  }
  return out;
}

const label = ({ selector, atRule = '' }) => (atRule ? `${atRule} ${selector}` : selector);

const normal = (v) => v.replace(/\s+/g, ' ').replace(/'/g, '"').trim().replace(/#[0-9a-f]+\b/gi, (h) => h.toLowerCase());

/** The blocks of `tokens.css`, with their enclosing at-rule, and the variables of the table each must hold. */
export const TOKEN_BLOCKS = [
  { selector: ':root', scheme: 'light' },
  { selector: ':root:not([data-theme="light"])', atRule: '@media (prefers-color-scheme: dark)', scheme: 'dark' },
  { selector: ':root[data-theme="dark"]', scheme: 'dark' },
];

/** Differences between `tokens.css` and the variables of the token table (`tokenVariables`), as readable lines. */
export function tokenDifferences(css, variables, floors = {}) {
  const out = [];
  const blocks = ruleBlocks(css);
  for (const block of TOKEN_BLOCKS) {
    const name = label(block);
    const matching = blocks.filter((b) => label(b) === name);
    if (!matching.length) {
      out.push(`${name}: block missing`);
      continue;
    }
    const actual = Object.assign({}, ...matching.map((b) => b.variables));
    const expected = variables[block.scheme];
    for (const [variable, value] of Object.entries(expected)) {
      if (!(variable in actual)) out.push(`${name}: ${variable} missing, the table has ${value}`);
      else if (normal(actual[variable]) !== normal(value)) out.push(`${name}: ${variable} is ${actual[variable].trim()}, the table has ${value}`);
    }
    for (const variable of Object.keys(actual)) if (!(variable in expected)) out.push(`${name}: ${variable} is not in the table`);
  }
  const known = new Set(TOKEN_BLOCKS.map(label));
  // The rungs of the readable ladder (`floorClasses`): each class sets the floor it stands for.
  const floor = (b) => !b.atRule && /^\.wf-process-map\.(wf-text-f\d+)$/.exec(b.selector)?.[1];
  for (const block of blocks.filter((b) => !known.has(label(b)))) {
    const rung = floor(block);
    for (const [variable, value] of Object.entries(block.variables)) {
      if (rung && variable === '--wf-text-floor' && rung in floors) {
        if (normal(value) !== floors[rung]) out.push(`${label(block)}: ${variable} is ${value.trim()}, the table has ${floors[rung]}`);
      } else out.push(`${label(block)}: ${variable} is not in a block of the table`);
    }
  }
  for (const rung of Object.keys(floors)) if (!blocks.some((b) => floor(b) === rung)) out.push(`.wf-process-map.${rung}: block missing`);
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
