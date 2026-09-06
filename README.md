# wise-flow (`@wise/flow`)

Process-flow visualisation for process mining and norm-based analysis:
a headless TypeScript core (graph model, directly-follows aggregation with
abstraction, stable layouts, metric-to-style scales, constraint overlays,
hit-testing, SVG and PNG export, named views, selection and actions,
paths, filter clauses, lanes) with a React renderer on React Flow (actions
menu, path list, filter chips), a Canvas renderer for large maps and a
BPMN 2.0 bridge on bpmn-js (BPMN-lite from a stage model or a log, export
with diagram interchange, import with a task ↔ activity mapping,
`<BpmnView/>` with overlays).

Built for WISE Workbench, usable on its own: any application that has
activities, stages, directly-follows counts and per-element metrics can
render maps, diff maps, BPMN diagrams and trace timelines with it.

## Scope

- `core/` — framework-free; runs in Node and in the browser.
- `react/` — components on React Flow and bpmn-js for interactive scenes.
- `bpmn/` — BPMN-lite, BPMN 2.0 export and import, swimlane layout, `<BpmnView/>`.
- `canvas/` — Canvas 2D renderer for large maps on the same model, and `toPNG`.

Non-goals: a general diagramming editor (ports, routers, shape libraries),
statistical charts (use ECharts or similar), conformance checking.

## Status

Milestone 0.3 (see `docs/ROADMAP.md`): everything of 0.1 (core model,
`abstract`, `diff`, ELK layout with Dagre fallback, `layoutUnion`, scales
and overlay presets, level-of-detail rules, R-tree hit index, `toSVG`,
`<ProcessMap/>`, `<TableAlternative/>`, `<TraceTimeline/>`) and 0.2 (the
BPMN bridge `liteFromStages`, `liteFromGraph`, `exportBpmn`, `importBpmn`,
`layoutBpmn`, `<BpmnView/>`; named views `buildViews`, `<ViewSwitcher/>`)
plus the interaction model of 0.3: selection with single and multi-select,
an actions menu the host fills (`onContextMenu`, `onAction`), keyboard
routes and announcements, incoming and outgoing paths of an activity with
a side list (`focus`, `paths`), filter chips on the contract's clause kinds
(`filters`, `onFilterChange`), stage and role lanes (`lanes`), the Canvas
renderer for large maps and `toPNG`. `docs/API.md` is the public contract;
`CHECKPOINT.md` explains how to try the milestones by hand.

## Install and run

Node 18.18 or later and npm 10.

```sh
npm install
npm test              # Vitest: core invariants, BPMN round trips, interaction, canvas, React components
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
const svg = toSVG({ graph: shown, positions, overlays, title: "Purchase-to-pay", lanes: "stages" }, { preset: "single-column" });
```

### Selection, actions, paths, filters

```ts
import { selectElement, defaultActions, menuTargetFor, pathsFor, pathBetween, canonicalFilter, describeClause, laneBands } from "@wise/flow";
import type { Filter, Selection } from "@wise/flow";

// Selection state shared by every renderer: replace, toggle (Shift-click), add, remove.
let selection: Selection = selectElement({ nodes: [], edges: [], groups: [] }, { kind: "node", id: "record_goods_receipt" });
selection = selectElement(selection, { kind: "node", id: "record_invoice_receipt" }, "toggle");   // a pair

// The actions a menu offers for an element (or the pair / set it belongs to), with the filter clause each filter action adds.
const target = menuTargetFor(shown, { kind: "node", id: "record_invoice_receipt" }, selection);
const actions = defaultActions(shown, target);   // filter-to, exclude, paths, lens, pin, add-constraint … with accelerators

// Paths of an activity: from the response's `paths` block (GET …/flow?focus=) when present, else from the map.
const paths = pathsFor(graph, "record_invoice_receipt");        // incoming, outgoing, totals, source: "payload" | "graph"
const between = pathBetween(shown, "record_goods_receipt", "clear_invoice");   // shortest, then strongest, plus the reverse path

// Filter clauses of the workbench contract: canonical form, plain words for chips.
const filter: Filter = { and: [{ kind: "activity", op: "contains", activity: "record_goods_receipt" }, { kind: "open", value: false }] };
canonicalFilter(filter);                                       // byte-identical for any order or spelling of the same clauses
describeClause(filter.and[0], "en", (id) => labels[id]);       // "cases with Record Goods Receipt"

// Stage groups as ordered bands along the flow (nodes stay where they are).
const banded = laneBands(shown, positions, { lanes: "stages" }).positions;
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

### Canvas and PNG (`@wise/flow/canvas`)

```ts
import { toPNG, prepareScene, CanvasRenderer } from "@wise/flow/canvas";

// The scene as a bitmap with the same figure presets and embedded legend as toSVG.
const blob = await toPNG({ graph: shown, positions, overlays, title: "Purchase-to-pay", lanes: "stages" }, { preset: "single-column", scale: 2 });

// The renderer on its own (the React wrapper is <CanvasMap/>; <ProcessMap renderer="canvas"/> uses it).
const scene = prepareScene(shown, positions, { overlays, lanes: "stages" });
const renderer = new CanvasRenderer(canvasElement);
renderer.resize(800, 600);
renderer.setScene(scene);
renderer.fit();
renderer.hitAt(x, y);   // node, path, group or overlay under a screen point through the R-tree
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
    focus={focus}                  // activity id, or two ids: paths highlighted, side list shown
    onFocusChange={setFocus}
    paths={graph.paths}            // the response's paths block; computed from the map when absent
    filters={filter}               // the contract's clauses as chips; the map never filters, it calls back
    filterPreview={preview}        // cases in / out and the marginal removal per clause
    onFilterChange={setFilter}
    lanes="stages"                 // "stages" | "roles" | "none"
    onContextMenu={(target, actions) => [...actions, { id: "profile", label: "Open profile", group: "explore", accelerator: "o" }]}
    onAction={(action, target) => run(action.id, target.ids)}   // a returned string is announced
    renderer="auto"                // canvas above 2,000 activities plus paths
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
view, keep connected), a legend, selection (click, Shift-click, Shift with
an arrow key), an actions menu (right click or Enter: filter to, exclude,
paths, distribution lens, worst cases, pin, add expectation; accelerator
letters; the host fills or replaces the entries), the paths of a focused
activity with a side list, filter chips, stage or role lanes, keyboard
navigation (arrow keys, Alt with an arrow key along the paths, Space,
Enter, Escape, Home, End), live-region announcements, ARIA descriptions for
the map and every element, a Canvas renderer for large maps and a table
view that lists the same activities, paths and overlays. `<BpmnView/>`
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
