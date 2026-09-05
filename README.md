# wise-flow (`@wise/flow`)

Process-flow visualisation for process mining and norm-based analysis:
a headless TypeScript core (graph model, directly-follows aggregation with
abstraction, stable layouts, metric-to-style scales, constraint overlays,
hit-testing, SVG export) with a React renderer on React Flow. A Canvas
renderer and a BPMN 2.0 bridge on bpmn-js follow in later milestones.

Built for WISE Workbench, usable on its own: any application that has
activities, stages, directly-follows counts and per-element metrics can
render maps, diff maps and trace timelines with it.

## Scope

- `core/` — framework-free; runs in Node and in the browser.
- `react/` — components on React Flow for interactive scenes.
- `canvas/` — Canvas 2D renderer for large maps on the same model (0.2).
- `bpmn/` — import, task ↔ activity mapping, overlays on bpmn-js, BPMN-lite (0.2).

Non-goals: a general diagramming editor (ports, routers, shape libraries),
statistical charts (use ECharts or similar), conformance checking.

## Status

Milestone 0.1 (see `docs/ROADMAP.md`): core model, `abstract`, `diff`,
ELK layout with Dagre fallback, `layoutUnion`, scales and overlay presets,
level-of-detail rules, R-tree hit index, `toSVG`, `<ProcessMap/>`,
`<TableAlternative/>`, `<TraceTimeline/>`, Storybook stories, Vitest and
Playwright tests. `docs/API.md` is the public contract; `CHECKPOINT.md`
explains how to try the milestone by hand.

## Install and run

Node 18.18 or later and npm 10.

```sh
npm install
npm test              # Vitest: core invariants and React components
npm run build         # tsc → dist/ (ESM + types) and the stylesheets
npm run storybook     # http://localhost:6006
npm run test:visual   # Playwright screenshots of the stories (needs Chromium)
npm run fixture       # rebuild fixtures/bpic2019_p2p.json from the BPIC 2019 CSV
```

The workbench links the package locally (`"@wise/flow": "file:../wise-flow"`)
and imports from `dist/`, so run `npm run build` after changes.

## Usage

### Core

```ts
import { abstract, layoutUnion, filterPositions, buildScales, constraintOverlays, toSVG } from "@wise/flow";
import type { FlowGraph } from "@wise/flow";

// A FlowGraph as sent by GET /runs/{id}/flow: ids are stable, numbers pre-aggregated.
const graph: FlowGraph = await fetch(url).then((r) => r.json());

// Abstraction: drop weak activities and paths, keep the map connected.
const shown = abstract(graph, { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true });

// Stable layout across compared scenes: lay out the union once, filter per scene.
const union = await layoutUnion([globalGraph, vendorGraph], { elkWorkerUrl });
const positions = filterPositions(union, shown);

// Constraint overlays from the analysis' numbers.
const overlays = constraintOverlays(
  { id: "c_l1_clear_invoice_present", type: "presence", label: "Clear Invoice present", activities: ["clear_invoice"], params: { m: 1 } },
  { cases: 237236, violationShare: 0.2258 },
  { graph: shown },
);

// Scales for the renderer or a figure for the report.
const scales = buildScales(shown);
const svg = toSVG({ graph: shown, positions, overlays, title: "Purchase-to-pay" }, { preset: "single-column" });
```

`elkWorkerUrl` is the URL under which the application serves
`elkjs/lib/elk-worker.min.js` (with Vite: `import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url"`).
Without it ELK runs in-process, which is what Node and the tests use.

### React

```tsx
import "@xyflow/react/dist/style.css";
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";
import { ProcessMap, TableAlternative, TraceTimeline } from "@wise/flow/react";

<div style={{ height: 600 }}>
  <ProcessMap
    graph={graph}
    positions={positions}          // optional; computed when omitted
    overlays={overlays}
    defaultAbstraction={{ minNodeShare: 0.01, minEdgeShare: 0.03 }}
    onSelect={(s) => console.log(s.nodes, s.edges)}
    onHover={(id) => setHovered(id)}
    locale="en"
    layout={{ elkWorkerUrl }}
  />
</div>
```

`<ProcessMap/>` ships the abstraction controls (activities, paths, stage
view, keep connected), a legend, keyboard navigation (arrow keys, Enter,
Escape, Home, End), ARIA descriptions for the map and every element, and a
table view that lists the same activities, paths and overlays.

## Fixture

`fixtures/bpic2019_p2p.json` holds two scenes derived from the BPI
Challenge 2019 log (all 251,734 purchase order items and vendor 0128) plus
constraint statistics; `fixtures/build_bpic2019_fixture.py` rebuilds it
from the CSV, which is not part of the repository.

## Licence

PolyForm Noncommercial 1.0.0 (`LICENSE`): free for noncommercial use,
modification and redistribution with attribution; commercial use requires
a separate licence from the owner. Dependency notices and the reasoning
are in `docs/LICENSING.md`.
