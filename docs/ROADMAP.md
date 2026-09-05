# Roadmap

| Milestone | Content | Status |
|---|---|---|
| 0.1 | core model, `abstract`, `diff`, ELK layout in a worker with Dagre fallback, `layoutUnion`, scales and overlay presets, level-of-detail rules, R-tree hit index, `<ProcessMap/>` on React Flow with keyboard navigation and table alternative, `<TraceTimeline/>`, SVG export, Storybook, visual regression | delivered (see `CHECKPOINT.md`) |
| 0.2 | `<BpmnView/>` with overlays and mapping, `importBpmn`, BPMN-lite, Canvas renderer, PNG export, edge routing on the abstracted graph (orthogonal, bundled), position cache keyed by norm fingerprint and mapping version | next |
| 0.3 | variant strip, performance spectrum, dotted chart, Sankey helper, German locale for every component text, level-of-detail refinements for large maps | |
| 0.4 | BPMN authoring selection callbacks, annotation layer for workshops, animation (token replay) | |
| 1.0 | stable API, documentation site, bundle budget, npm release | |

Used by WISE Workbench from its Phase 0 through a local link; version
pins follow the workbench's roadmap. `diff`, keyboard navigation and the
table alternative were pulled forward from 0.2 into 0.1 because the map
needed them for its accessibility rules.
