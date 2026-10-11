---
"@wise/flow": minor
---

Every size, radius, stroke width, dash, text size and weight, opacity,
spacing step and z-order the library draws now has a role name in the token
table, at the value drawn before; nothing drawn changes. New tables:
`textTokens` (size, weight and line height by text role), `radiusTokens`,
`strokeTokens`, `dashTokens`, `opacityTokens`, `spaceTokens` (multiples of a
2-pixel unit), `zTokens` and `dimensionTokens`, also under `designTokens`
(`text`, `radius`, `stroke`, `dash`, `opacity`, `space`, `z`, `dimension`).
`sizeTokens` gains `shadowMenu` and `hatchTokens` gains `domPeriod`;
`sizeTokens`, `textSizeTokens` and `TINT_OPACITY` read the new tables and keep
their values. The marks, the Canvas drawing, the SVG and PNG exports and the
React components read the tables.

`tokens.css` is generated from the table (`npm run tokens`) and defines the
roles the stylesheet reads as CSS variables: `--wf-text-*`, `--wf-weight-*`,
`--wf-leading-*`, `--wf-radius-*`, `--wf-stroke-*`, `--wf-dash-*`,
`--wf-opacity-*`, `--wf-z-*`, `--wf-size-*`, `--wf-space-*` and
`--wf-shadow-menu`. `style.css` reads them in place of its literals, so it
needs `tokens.css` for its sizes as it already did for its colours. The
computed styles are the same as before.
