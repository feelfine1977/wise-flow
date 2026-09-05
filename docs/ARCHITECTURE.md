# Architecture

## 1. Layers

```
┌────────────────────────────────────────────────────────────┐
│ react/   <ProcessMap/> <TableAlternative/> <TraceTimeline/> │
│          <BpmnView/> <VariantStrip/> <PerformanceSpectrum/>  │
│          <DottedChart/> (later milestones)                   │
│          hooks: useFlowGraph, useStableLayout, useOverlays   │
├──────────────────────────┬─────────────────────────────────┤
│ canvas/  renderer (0.2)  │ bpmn/  import · mapping · overlays│
│          (large scenes)  │        · lite model (0.2)         │
├──────────────────────────┴─────────────────────────────────┤
│ core/    model · aggregate · layout · style · overlays ·    │
│          hit · export · format · strings                    │
└────────────────────────────────────────────────────────────┘
```

Dependencies point downwards only. `core` has no DOM and no React; it is
tested in Node. Renderers translate the core's scene description into
React Flow elements, Canvas draw calls or bpmn-js overlays.

## 2. Core

### 2.1 Model
`FlowGraph { nodes, edges, groups, overlays, meta }`, the JSON of
`GET /runs/{id}/flow`. Nodes: `activity`, `stage`, `gateway` (xor/and/or by
tag), `event` (start/end by tag), `note`. Node ids are the caller's stable
ids (canonical activity ids in the workbench). Edges: `follows`
(directly-follows with `count`, `cases`, `share`, `medianLagHours`,
`violationShare`), `constraint` (arc between two nodes with a payload),
`flow` (BPMN sequence flow). Groups: `lane`, `stage`, `pool`, nested through
`parent`. Every element carries a `metrics` record (numbers) and `tags`
(strings) that scales and overlays read. `validateGraph` reports duplicate
ids, dangling edges and unknown targets.

### 2.2 Aggregation
`abstract(graph, { minEdgeShare, minNodeShare, keepConnected, collapse })`
removes activities and follows edges whose strength (count or cases
relative to the strongest element) is below the thresholds, collapses stage
groups into stage nodes (semantic zoom) and restores connectivity: first a
maximum spanning forest over the strongest direct edges between the kept
nodes, then the cheapest paths of the original graph through removed nodes,
then one edge per activity that lost all incoming or all outgoing paths.
Re-added elements are tagged `reconnected` and drawn dashed. The thresholded
part is monotone in the thresholds; the reconnection is bounded (paths
between components plus one edge per open need) but not a global optimum,
so the total element count may differ by one re-added edge between
neighbouring thresholds. `diff(a, b)` returns a graph with `b`'s metrics,
`a_<metric>` and `delta_<metric>`, one-sided elements tagged.

### 2.3 Layout
`layout(graph, options)` runs ELK layered: in a Web Worker when the
application passes `elkWorkerUrl` (the URL of `elkjs/lib/elk-worker.min.js`),
in-process otherwise (Node, tests). Stage groups become compound nodes with
their order along the flow direction enforced through ELK partitions; lanes
are compound nodes as well. Dagre is the fallback on failure or timeout.
Elements are sorted by id before the engine runs, so positions are
deterministic. `Positions` holds absolute boxes for nodes and groups, edge
routes, bounds, engine and direction. **Stable layout**: `layoutUnion(scenes)`
lays out the union graph once and returns positions that every scene
filters (`filterPositions`), so compared maps do not jump; results are cached
by a caller key. The map lays out the *abstracted* graph (not the full
directly-follows graph), because hundreds of weak edges degrade layered
layouts; the cache makes returning to a previous abstraction level free.

### 2.4 Style
`buildScales` builds d3 scales from metric ranges: edge width ← count
(square root), edge and node colour ← a chosen metric (expectation shortfall
share, performance, delta) on colour-blind-safe sequential (single hue),
diverging (purple–orange) and categorical (Okabe–Ito) palettes; categorical
keys hash to a stable colour with a pattern twin; text on coloured fills
uses an ink with contrast ≥ 4.5 : 1. Level-of-detail rules say from which
zoom labels, edge labels, badges, arcs, chips, hatching and self-loops
appear; thresholds tighten with the number of nodes.

### 2.5 Overlays
An overlay is data, not drawing: `{ kind, target, payload }` where kind is
`badge | arc | hatch | tint | chip | selfLoop` and target is a node, edge,
group id or `__map`. Presets map a constraint description (presence,
singularity, exclusion, lag, precedence, balance / metric, applicability)
and its statistics to overlays with formatted readings. Renderers draw
overlays; the core computes their geometry (badge slots along the node's
top edge, cubic arcs above the map and reverse arcs below it, self-loops at
the corner, chips inside groups) within a declared margin around the
layout, and their visibility by zoom level. Overlays are drawn in a
canonical order so that exports do not depend on input order.

### 2.6 Hit-testing and export
An R-tree (rbush) over nodes, groups, edge segments and overlay shapes for
hover and click on Canvas and in exports; `toSVG(scene)` with figure presets
(single column, double column, slide), an embedded legend with the scales
and overlay glyphs, deterministic output. `toPNG` follows with the Canvas
renderer.

## 3. React renderer
Thin mapping to React Flow nodes and edges with custom components per node
and edge kind; groups as parent nodes; badges, hatching, chips and tints
inside the node components, arcs and self-loops in an SVG layer in the
viewport; edge labels and node details toggled through level-of-detail
classes on the container. Abstraction controls (activities, paths, stage
view, keep connected, table view) in a panel; the legend always visible.
Keyboard navigation over activities (arrow keys, Enter, Escape, Home, End)
with `aria-activedescendant`; ARIA labels on every element and a hidden
description of the map; `TableAlternative` lists the same activities, paths
and overlays as rows. Reduced motion is respected.

## 4. Canvas renderer (0.2)
Draws the same scene with retained geometry, dirty-rect redraw, pan and
zoom at 60 fps for ≤ 5k nodes and 20k edges, and hover from the R-tree.
Used automatically above an element threshold or on request.

## 5. BPMN bridge (0.2)
`importBpmn(xml)` parses with bpmn-moddle into a `FlowGraph` (tasks as
activities, gateways, events, lanes, sub-processes as stages) and returns a
mapping table to fill (task ↔ activity ids). `<BpmnView/>` hosts bpmn-js
(viewer or modeler) and projects overlays through bpmn-js's overlay
module, keeping the diagram fixed while overlay datasets switch; a
`selection` callback reports tasks, flows and lanes for authoring. `lite`
renders a simplified BPMN in the core's own model when the full modeler
is not wanted.

## 6. Custom views
Trace timeline (events on a time axis per case, violated constraints marked
on the events, span annotations, alignment by an anchor activity, table
alternative) ships in 0.1. Variant strip (chevrons with frequency and a
metric), performance spectrum (segments between two activities over time,
classified by duration band) and dotted chart (events by case over time,
colour by a categorical) follow in 0.3. All draw with d3 scales on SVG for
small data and Canvas for large samples.

## 7. Quality
Vitest for the core (aggregation invariants on the fixture and on random
graphs, layout stability, overlay geometry, deterministic scales and
export) and for the components (jsdom), Storybook for components with the
design tokens, Playwright screenshots of the stories, strict TypeScript,
ESLint, Changesets for releases.
