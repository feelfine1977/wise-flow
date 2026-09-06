# Roadmap

| Milestone | Content | Status |
|---|---|---|
| 0.1 | core model, `abstract`, `diff`, ELK layout in a worker with Dagre fallback, `layoutUnion`, scales and overlay presets, level-of-detail rules, R-tree hit index, `<ProcessMap/>` on React Flow with keyboard navigation and table alternative, `<TraceTimeline/>`, SVG export, Storybook, visual regression | delivered (see `CHECKPOINT.md`, CP-E1) |
| 0.2 | "create the process flow from known activities, and show different views": BPMN-lite from a stage model and from a log (`liteFromStages`, `liteFromGraph`), BPMN 2.0 export with DI (`exportBpmn`, `layoutBpmn`), import with task ↔ activity mapping (`importBpmn`, `matchActivities`, `applyMapping`), `<BpmnView/>` on bpmn-js with overlays, dataset switching and selection callbacks, named views of one map with shared scales (`buildViews`, `<ViewSwitcher/>`, small multiples) | delivered (see `CHECKPOINT.md`, CP-E2) |
| 0.3 | Canvas renderer, PNG export, edge routing on the abstracted graph (orthogonal, bundled), position cache keyed by norm fingerprint and mapping version, variant strip, performance spectrum, dotted chart, Sankey helper, German locale for every component text, level-of-detail refinements for large maps | next |
| 0.4 | BPMN authoring forms on the selection callbacks (presence, singularity, lag, precedence, applicability from the modeler), annotation layer for workshops, animation (token replay) | |
| 1.0 | stable API, documentation site, bundle budget, npm release | |

Used by WISE Workbench from its Phase 0 through a local link; version
pins follow the workbench's roadmap. `diff`, keyboard navigation and the
table alternative were pulled forward from 0.2 into 0.1 because the map
needed them for its accessibility rules; the Canvas renderer, PNG export
and edge routing moved from 0.2 to 0.3 so that 0.2 could concentrate on
the BPMN bridge and the views.
