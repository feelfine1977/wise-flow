# stories

One story file per component, rendered with the design tokens of
`src/tokens.css` (light and dark).

| File | Stories |
|---|---|
| `ProcessMap.stories.tsx` | P2P map (fixture, overlays, abstraction controls), Dagre fallback, stage view, diff map (vendor vs all), German locale |
| `StableLayout.stories.tsx` | global vs vendor on one union layout (position check in the header), independent layouts for comparison |
| `Overlays.stories.tsx` | catalogue: one story per constraint preset, all presets, raw overlay kinds |
| `TableAlternative.stories.tsx` | vendor scene as tables, map in table view |
| `TraceTimeline.stories.tsx` | absolute time, aligned at goods receipt, table alternative |

ELK runs in a Web Worker in the stories through
`import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url"`.
