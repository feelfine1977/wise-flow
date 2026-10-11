// Writes src/tokens.css from the token table of the core (`tokenVariables`).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTokens } from './check-tokens.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const tokensPath = resolve(root, 'src/tokens.css');

const HEADER = `/*
 * Design tokens of @wise/flow as CSS variables, generated from the token
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

/** The text of `tokens.css` for the variables of the table. */
export function tokensCss({ light, dark }) {
  return [
    HEADER,
    block(':root', light),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', dark, '  ')}\n}`,
    block(':root[data-theme="dark"]', dark),
    MOTION,
  ].join('\n\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = await loadTokens();
  writeFileSync(tokensPath, tokensCss(tokens.tokenVariables()));
}
