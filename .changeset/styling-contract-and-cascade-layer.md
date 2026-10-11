---
"@wise/flow": minor
---

The interactive map and its panels have a styling contract. Every part carries
`data-wf-part`, and where it applies `data-wf-kind` and `data-wf-state`
(space-separated: `selected`, `focused`, `hovered`, `dimmed`, `outOfScope`,
`reconnected`); `docs/styling-contract.json` lists them and `docs/API.md`
("Styling contract") describes them. The existing classes stay.

`@wise/flow/style.css` now puts React Flow's base styles and the library's
rules into the cascade layer `wf`, so that any unlayered host rule wins. Load it
without React Flow's stylesheet. A page with an unlayered reset (Tailwind 3's
preflight) loses the library's borders under it: such a page loads the new
`@wise/flow/style.unlayered.css`, the rules as `style.css` held them before,
after `@wise/flow/react-flow.css` and the reset.

Paints that were inline styles moved where a host rule can override them: the
stroke colour, width, dash and dimmed opacity of a path come from the custom
properties `--wf-edge-color`, `--wf-edge-width` and `--wf-edge-dash` on the
edge through the stylesheet, and the theme paints of marks are classes
(`wf-fill-ink`, `wf-stroke-paper` and the like). The position of `<Badges/>`
moved into the stylesheet. Nothing is drawn differently.
