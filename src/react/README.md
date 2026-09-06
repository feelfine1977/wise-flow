# src/react

Components on React Flow and bpmn-js. Import `@xyflow/react/dist/style.css`,
`@wise/flow/tokens.css` and `@wise/flow/style.css`; for `<BpmnView/>` also
`bpmn-js/dist/assets/diagram-js.css`, `bpmn-js/dist/assets/bpmn-js.css`
and `bpmn-js/dist/assets/bpmn-font/css/bpmn.css`.

| File | Content |
|---|---|
| `ProcessMap.tsx` | `<ProcessMap/>`: abstraction pipeline, stable or own layout, React Flow mapping, overlay layers, controls, legend, selection, hover, keyboard navigation, ARIA, table view |
| `BpmnView.tsx` | `<BpmnView/>`: bpmn-js viewer or modeler host, overlays through the overlays service and an SVG layer, dataset switching on a fixed diagram, selection and hover callbacks, controlled selection, `onChange` after edits, table alternative, legend, ARIA, refit on resize |
| `ViewSwitcher.tsx` | `<ViewSwitcher/>`: named views of one map as tabs or as a grid of small multiples with shared scales |
| `nodes.tsx` | activity, stage, gateway, event, note and group node components; badges and chips |
| `edges.tsx` | follows / constraint / flow edge component on the layout routes |
| `OverlayLayer.tsx` | arcs and self-loops in the viewport |
| `AbstractionControls.tsx` | sliders, stage toggle, keep-connected, table toggle |
| `Legend.tsx` | scales, overlay glyphs and map-level chips |
| `TableAlternative.tsx` | activities, paths and overlays as tables |
| `TraceTimeline.tsx` | events per case on a time axis, anchor alignment, annotations, table alternative |
| `hooks.ts` | `useFlowGraph`, `useStableLayout`, `useOverlays`, `usePrefersReducedMotion` |
| `describe.ts` | ARIA and table texts for nodes, edges, groups and the map |
| `style.css` | component styles (level-of-detail classes, nodes, badges, chips, panels, tables, timeline, BPMN host, view switcher) |

`<VariantStrip/>`, `<PerformanceSpectrum/>`, `<DottedChart/>` follow in 0.3.
