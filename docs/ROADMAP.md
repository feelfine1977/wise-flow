# Roadmap

| Milestone | Content | Status |
|---|---|---|
| 0.1 | core model, `abstract`, `diff`, ELK layout in a worker with Dagre fallback, `layoutUnion`, scales and overlay presets, level-of-detail rules, R-tree hit index, `<ProcessMap/>` on React Flow with keyboard navigation and table alternative, `<TraceTimeline/>`, SVG export, Storybook, visual regression | delivered (see `CHECKPOINT.md`, CP-E1) |
| 0.2 | "create the process flow from known activities, and show different views": BPMN-lite from a stage model and from a log (`liteFromStages`, `liteFromGraph`), BPMN 2.0 export with DI (`exportBpmn`, `layoutBpmn`), import with task ↔ activity mapping (`importBpmn`, `matchActivities`, `applyMapping`), `<BpmnView/>` on bpmn-js with overlays, dataset switching and selection callbacks, named views of one map with shared scales (`buildViews`, `<ViewSwitcher/>`, small multiples) | delivered (see `CHECKPOINT.md`, CP-E2) |
| 0.3 | "select, ask, follow the paths, filter, draw large maps": selection model with single and multi-select, actions menu with default entries the host fills (`onContextMenu`, `onAction`), keyboard routes and live-region announcements, incoming and outgoing paths of an activity with a side list (`focus`, `paths`), the path between two activities, filter chips on the contract's clause kinds (`filters`, `onFilterChange`), stage and role lanes as bands (`lanes`), Canvas renderer for large maps with the same overlays and interaction, `toPNG` | delivered (see `CHECKPOINT.md`, CP-E3) |
| 0.4 | edge routing on the abstracted graph (orthogonal, bundled), position cache keyed by norm fingerprint and mapping version, variant strip, performance spectrum, dotted chart, Sankey helper, German locale for every component text, level-of-detail refinements for large maps, BPMN authoring forms on the selection callbacks (presence, singularity, lag, precedence, applicability from the modeler), annotation layer for workshops, animation (token replay) | next |
| 1.0 | stable API, documentation site, bundle budget, npm release | |

Used by WISE Workbench from its Phase 0 through a local link; version
pins follow the workbench's roadmap. `diff`, keyboard navigation and the
table alternative were pulled forward from 0.2 into 0.1 because the map
needed them for its accessibility rules; the Canvas renderer, PNG export
and edge routing moved from 0.2 to 0.3 so that 0.2 could concentrate on
the BPMN bridge and the views. 0.3 took the interaction model of the
workbench's flow requirements (selection, actions menu, paths, filters,
lanes) together with the Canvas renderer and `toPNG`; edge routing, the
position cache and the remaining custom views (variant strip, performance
spectrum, dotted chart) moved to 0.4.
