# stories

One story file per component, rendered with the design tokens of
`src/tokens.css` (light and dark).

| File | Stories |
|---|---|
| `ProcessMap.stories.tsx` | P2P map (fixture, overlays, abstraction controls), Dagre fallback, stage view, diff map (vendor vs all), German locale |
| `Interaction.stories.tsx` | select and context menu (selection, right click or Enter, host action through `onContextMenu`, `onAction`), paths for an activity (`focus`, side list from the response's `paths` block or the map, pair path), filters (chips with a preview, filter actions, canonical filter) |
| `Layout.stories.tsx` | stage lanes (stage groups as ordered bands), role lanes (BPMN-lite from the stage model with role lanes) |
| `Canvas.stories.tsx` | large map (5,000 synthetic activities and 20,000 paths on the Canvas renderer; sizes selectable), P2P map on canvas, PNG export |
| `StableLayout.stories.tsx` | global vs vendor on one union layout (position check in the header), independent layouts for comparison |
| `Overlays.stories.tsx` | catalogue: one story per constraint preset, all presets, raw overlay kinds |
| `Bpmn.stories.tsx` | from stage model (P2P), from log (BPIC 2019, abstraction slider), overlays on a model (dataset switch, mapping table, modeler selection), export → import round trip (checks, XML) |
| `Views.stories.tsx` | four views of one map (Finance, Logistics, Compliance, Automation; tabs and grid), small multiples |
| `TableAlternative.stories.tsx` | vendor scene as tables, map in table view |
| `TraceTimeline.stories.tsx` | absolute time, aligned at goods receipt, table alternative |

ELK runs in a Web Worker in the stories through
`import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url"`; the BPMN
stories import the hand-written model with `?raw` and the bpmn-js
stylesheets are loaded in `.storybook/preview.ts`.
