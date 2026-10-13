// Writes src/tokens.css from the token table of the core (`tokenVariables`).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTokens } from './check-tokens.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const tokensPath = resolve(root, 'src/tokens.css');

const HEADER = `/*
 * Design tokens of wise-flow as CSS variables, generated from the token
 * table of the core (\`src/core/tokens.ts\`, \`tokenVariables\`) by
 * \`npm run tokens\`; do not edit by hand. A tooling test fails when this file
 * and the table differ. The workbench ships its own tokens package; an
 * application theme that sets these variables is picked up by the stylesheet
 * and by the Canvas map. Light and dark schemes.
 */`;

const MOTION = `@media (prefers-reduced-motion: reduce) {
  .wf-process-map *,
  .wf-trace-timeline * {
    transition: none !important;
    animation: none !important;
  }
}`;

const block = (selector, variables, indent = '') =>
  `${indent}${selector} {\n${Object.entries(variables).map(([name, value]) => `${indent}  ${name}: ${value};`).join('\n')}\n${indent}}`;

/**
 * The class of each rung of the readable ladder (`readableTokens`) and the
 * floor it sets as `--wf-text-floor`, in layout units rounded up: the
 * interactive map writes the class of the rung its zoom rounds the floor up to.
 */
export function floorClasses({ steps, first, last }) {
  const out = {};
  for (let k = first; k <= last; k++) out[`wf-text-f${k}`] = String(Math.ceil(2 ** (k / steps) * 1e4) / 1e4);
  return out;
}

/** The floor each rung's class of the readable ladder sets, one rule a line. */
const FLOORS = (floors) => `/* The smallest text on the screen in layout units, by the class the map writes as it zooms. */\n${Object.entries(floors).map(([name, value]) => `.wf-process-map.${name} { --wf-text-floor: ${value}; }`).join('\n')}`;

/** The text of `tokens.css` for the variables of the table and the floors of the readable ladder. */
export function tokensCss({ light, dark }, floors = {}) {
  return [
    HEADER,
    block(':root', light),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', dark, '  ')}\n}`,
    block(':root[data-theme="dark"]', dark),
    MOTION,
    FLOORS(floors),
  ].join('\n\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = await loadTokens();
  writeFileSync(tokensPath, tokensCss(tokens.tokenVariables(), floorClasses(tokens.readableTokens)));
}
