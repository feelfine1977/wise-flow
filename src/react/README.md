# src/react

Components on React Flow. Import `@xyflow/react/dist/style.css`,
`@wise/flow/tokens.css` and `@wise/flow/style.css`.

| File | Content |
|---|---|
| `ProcessMap.tsx` | `<ProcessMap/>`: abstraction pipeline, stable or own layout, React Flow mapping, overlay layers, controls, legend, selection, hover, keyboard navigation, ARIA, table view |
| `nodes.tsx` | activity, stage, gateway, event, note and group node components; badges and chips |
| `edges.tsx` | follows / constraint / flow edge component on the layout routes |
| `OverlayLayer.tsx` | arcs and self-loops in the viewport |
| `AbstractionControls.tsx` | sliders, stage toggle, keep-connected, table toggle |
| `Legend.tsx` | scales, overlay glyphs and map-level chips |
| `TableAlternative.tsx` | activities, paths and overlays as tables |
| `TraceTimeline.tsx` | events per case on a time axis, anchor alignment, annotations, table alternative |
| `hooks.ts` | `useFlowGraph`, `useStableLayout`, `useOverlays`, `usePrefersReducedMotion` |
| `describe.ts` | ARIA and table texts for nodes, edges, groups and the map |
| `style.css` | component styles (level-of-detail classes, nodes, badges, chips, panels, tables, timeline) |

`<VariantStrip/>`, `<PerformanceSpectrum/>`, `<DottedChart/>` follow in 0.3,
`<BpmnView/>` in 0.2.
