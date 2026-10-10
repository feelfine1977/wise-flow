# src/react

Components on React Flow and bpmn-js. Import `@xyflow/react/dist/style.css`,
`@wise/flow/tokens.css` and `@wise/flow/style.css`; for `<BpmnView/>` also
`bpmn-js/dist/assets/diagram-js.css`, `bpmn-js/dist/assets/bpmn-js.css`
and `bpmn-js/dist/assets/bpmn-font/css/bpmn.css`.

| File | Content |
|---|---|
| `ProcessMap.tsx` | `<ProcessMap/>`: abstraction pipeline, stable or own layout, lane bands, React Flow or Canvas renderer, overlay layers, controls, legend, actions menu and focus with the path list drawn from the map controller's state, filter chips, ARIA, table view |
| `ContextMenu.tsx` | `<ContextMenu/>`: accessible actions menu (`role="menu"`, groups, accelerators, arrow keys, Escape, focus return) on the core's `menuKey`; `MenuView` (internal) draws it for the map, whose controller holds the menu state |
| `PathList.tsx` | `<PathList/>`: incoming and outgoing paths of an activity or the path between two activities, sortable, totals, row selection |
| `FilterChips.tsx` | `<FilterChips/>`: one chip per filter clause with cases in and out, marginal removal, "changes cases", removal and clear |
| `CanvasMap.tsx` | `<CanvasMap/>`: host of the Canvas renderer (pan, zoom, hover tooltip, click, right click, hidden element list, zoom buttons) |
| `BpmnView.tsx` | `<BpmnView/>` (and `createBpmnView`, the same view on another adapter of the viewer seam, for tests): bpmn-js viewer or modeler host, overlays through the overlays service and an SVG layer, dataset switching on a fixed diagram, selection and hover callbacks, controlled selection, `onChange` after edits, table alternative, legend, ARIA, refit on resize |
| `ViewSwitcher.tsx` | `<ViewSwitcher/>`: named views of one map as tabs or as a grid of small multiples with shared scales |
| `nodes.tsx` | activity, stage, gateway, event, note and group node components (groups also as lane bands); badges and chips |
| `edges.tsx` | follows / constraint / flow edge component on the layout routes |
| `OverlayLayer.tsx` | arcs between the edges and the nodes (in React Flow's edge label layer), self-loops above the nodes |
| `AbstractionControls.tsx` | sliders, stage toggle, keep-connected, table toggle |
| `Legend.tsx` | scales, overlay glyphs and map-level chips |
| `TableAlternative.tsx` | activities, paths and overlays as tables; rows select with the map controller's `clickSelection` |
| `TraceTimeline.tsx` | events per case on a time axis, anchor alignment, annotations, table alternative |
| `controller.ts` | Internal: `useMapController`, the core's map controller with controlled or internal `selection`, `focus`, `abstraction` and `view`, the host callbacks, the live region and the intents (running a chosen action, revealing a node, placing the menu, returning the focus) |
| `map-pointer.ts` | Internal: React Flow's and the Canvas map's pointer callbacks as the same map controller events |
| `map-actions.ts` | Internal: `useMenuActions`, what the map's default menu actions do (filters, paths, collapse, clear focus) and the host's `onContextMenu` |
| `map-elements.ts` | Internal: React Flow nodes and edges, the Canvas map's scene, state and element list, and the element descriptions |
| `hooks.ts` | `useFlowGraph`, `useStableLayout`, `useOverlays`, `usePrefersReducedMotion` |
| `describe.ts` | ARIA and table texts for nodes, edges (from the core), groups and the map |
| `style.css` | component styles (level-of-detail classes, nodes, badges, chips, lane bands, menu, path list, filter chips, canvas host, panels, tables, timeline, BPMN host, view switcher) |

`<VariantStrip/>`, `<PerformanceSpectrum/>`, `<DottedChart/>` follow in 0.4.
