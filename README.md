# wise-flow (`@wise/flow`)

Process-flow visualisation for process mining and norm-based analysis:
a headless TypeScript core (graph model, directly-follows aggregation with
abstraction, stable layouts, metric-to-style scales, constraint overlays,
hit-testing, SVG export, named views) with a React renderer on React Flow
and a BPMN 2.0 bridge on bpmn-js (BPMN-lite from a stage model or a log,
export with diagram interchange, import with a task ↔ activity mapping,
`<BpmnView/>` with overlays). A Canvas renderer follows in a later milestone.

Built for WISE Workbench, usable on its own: any application that has
activities, stages, directly-follows counts and per-element metrics can
render maps, diff maps, BPMN diagrams and trace timelines with it.

## Scope

- `core/` — framework-free; runs in Node and in the browser.
- `react/` — components on React Flow and bpmn-js for interactive scenes.
- `bpmn/` — BPMN-lite, BPMN 2.0 export and import, swimlane layout, `<BpmnView/>`.
- `canvas/` — Canvas 2D renderer for large maps on the same model (0.3).

Non-goals: a general diagramming editor (ports, routers, shape libraries),
statistical charts (use ECharts or similar), conformance checking.

## Status

Milestone 0.2 (see `docs/ROADMAP.md`): everything of 0.1 (core model,
`abstract`, `diff`, ELK layout with Dagre fallback, `layoutUnion`, scales
and overlay presets, level-of-detail rules, R-tree hit index, `toSVG`,
`<ProcessMap/>`, `<TableAlternative/>`, `<TraceTimeline/>`) plus the BPMN
bridge (`liteFromStages`, `liteFromGraph`, `exportBpmn`, `importBpmn`,
`layoutBpmn`, `<BpmnView/>`) and named views of one map (`buildViews`,
`<ViewSwitcher/>`). `docs/API.md` is the public contract; `CHECKPOINT.md`
explains how to try the milestones by hand.

## Install and run

Node 18.18 or later and npm 10.

```sh
npm install
npm test              # Vitest: core invariants, BPMN round trips, React components
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

### BPMN (`@wise/flow/bpmn`)

```ts
import { liteFromStages, liteFromGraph, exportBpmn, importBpmn, validateBpmn } from "@wise/flow/bpmn";

// 1. BPMN-lite from known activities (no log): stages in order, one start, one end,
//    gateways only where the model needs them (optional steps, choices, parallel stages).
const lite = liteFromStages({
  label: "Purchase-to-pay",
  stages: [
    { id: "order", label: "Purchase order", activities: [{ id: "create_purchase_order_item", label: "Create Purchase Order Item" }, { id: "change_price", label: "Change Price", optional: true }] },
    { id: "receipt", label: "Goods receipt", flow: "choice", activities: [{ id: "record_goods_receipt", label: "Record Goods Receipt", loop: true }, { id: "record_service_entry_sheet", label: "Record Service Entry Sheet" }] },
    { id: "payment", label: "Payment", activities: [{ id: "clear_invoice", label: "Clear Invoice" }] },
  ],
});

// ... or from a directly-follows graph above an abstraction level: XOR split where a node
//     has several successors, XOR join where it has several predecessors, AND on request.
const fromLog = liteFromGraph(graph, { abstraction: { minNodeShare: 0.05, minEdgeShare: 0.12 }, andGateways: true });

// 2. BPMN 2.0 XML with DI (lanes as bands, orthogonal flows); opens in bpmn-js and Camunda Modeler.
const { xml, positions, ids } = await exportBpmn(lite, { layout: { elkWorkerUrl }, name: "Purchase-to-pay" });
const check = await validateBpmn(xml);   // parser warnings, element counts, elements without DI

// 3. Import any BPMN 2.0 file: tasks → activity nodes, gateways, events, lanes and pools → groups,
//    sequence flows → flow edges, positions from the DI, and a mapping table to fill.
const { graph: model, mapping, positions: di } = await importBpmn(xml, {
  activities: graph.nodes.filter((n) => n.kind === "activity").map((n) => ({ id: n.id, label: n.label })),
});
// mapping: [{ taskId, nodeId, label, type, lane, activityId?, matchedBy?: "id" | "label" | "alias" }]
```

### Views

```ts
import { buildViews } from "@wise/flow";

// One map, four named views: same positions, own metrics and overlays, shared scale domains.
const set = await buildViews(shown, [
  { id: "finance", label: "Finance", overlays: financeOverlays },
  { id: "logistics", label: "Logistics", style: { edgeColor: { metric: "medianLagHours", palette: "sequentialBlue" } }, overlays: lagArcs },
  { id: "compliance", label: "Compliance", overlays: precedenceOverlays },
  { id: "automation", label: "Automation", nodeMetrics: eventsPerCase, style: { nodeColor: { metric: "eventsPerCase" } } },
], { layout: { elkWorkerUrl } });
// set.positions is shared; set.views[i].style carries the shared domains, set.views[i].scales is ready to draw.
```

### React

```tsx
import "@xyflow/react/dist/style.css";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "@wise/flow/tokens.css";
import "@wise/flow/style.css";
import { ProcessMap, TableAlternative, TraceTimeline, ViewSwitcher } from "@wise/flow/react";
import { BpmnView } from "@wise/flow/bpmn";

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

<div style={{ height: 600 }}>
  <BpmnView
    xml={xml}                      // or graph={lite} to export a BPMN-lite graph on the fly
    mode="view"                    // "model" hosts the bpmn-js modeler
    overlays={overlays}            // badges, heat tints, hatching, arcs, chips on the diagram
    mapping={mapping}              // activity id → task, so overlays keyed by activity ids land on tasks
    onSelect={(s) => console.log(s.tasks, s.flows, s.lanes)}
    onChange={(xml) => save(xml)}  // modeler only
  />
</div>

<ViewSwitcher views={set} mode="grid" columns={2} />
```

`<ProcessMap/>` ships the abstraction controls (activities, paths, stage
view, keep connected), a legend, keyboard navigation (arrow keys, Enter,
Escape, Home, End), ARIA descriptions for the map and every element, and a
table view that lists the same activities, paths and overlays. `<BpmnView/>`
keeps the diagram and its viewport fixed while overlay datasets switch,
reports selected tasks, flows and lanes for constraint authoring, offers the
same table alternative, and keeps the bpmn.io watermark (licence).

## Fixture

`fixtures/bpic2019_p2p.json` holds two scenes derived from the BPI
Challenge 2019 log (all 251,734 purchase order items and vendor 0128) plus
constraint statistics; `fixtures/build_bpic2019_fixture.py` rebuilds it
from the CSV, which is not part of the repository. `fixtures/p2p_stages.ts`
is a purchase-to-pay stage model with known activities and
`fixtures/p2p_small.bpmn` a hand-written BPMN model for the import.

## Licence

PolyForm Noncommercial 1.0.0 (`LICENSE`): free for noncommercial use,
modification and redistribution with attribution; commercial use requires
a separate licence from the owner. Dependency notices and the reasoning
are in `docs/LICENSING.md`.
