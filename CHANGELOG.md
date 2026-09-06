# Changelog

## 0.2.0 — milestone 0.2

"Create the process flow from known activities, and show different views."
Additions only; the 0.1 API is unchanged (see "Changes in 0.2 against 0.1"
in `docs/API.md`).

### BPMN (`@wise/flow/bpmn`, new entry point)

- BPMN-lite in the FlowGraph vocabulary: `liteFromStages` builds a process
  from an ordered stage model with known activities (one start, one end,
  tasks per stage, XOR split and merge around optional activities and
  stages and `choice` stages, AND around `parallel` stages, lanes from the
  stages or the roles); `liteFromGraph` turns a directly-follows graph
  above an abstraction level into tasks, XOR splits and joins where nodes
  branch or merge (AND with `andGateways` where the successors follow each
  other in both orders), start and end events, lanes from the groups, loop
  markers for self-loops; sequence flows keep the metrics of the paths they
  replace. Deterministic ids (`gw_split_<id>`, `gw_skip_<id>`,
  `<source>-><target>`). `stageModelFromGraph`, `liteCounts`.
- `layoutBpmn`: ELK layering along the flow, lanes as stacked full-width
  bands in one pool, rows inside a lane so that no shapes overlap,
  orthogonal sequence flows, BPMN shape sizes.
- `exportBpmn`: BPMN 2.0 XML with `BPMNDiagram`, shapes and edges from the
  positions, a collaboration with one participant when lanes exist, task
  sub-types, gateway types, event definitions and loop markers from tags,
  XML-safe ids with the FlowGraph id kept in `wise:flowId`; ids, kinds, tags
  and metrics travel in the `wise` extension so that a round trip is
  lossless and a re-export of the imported graph reproduces the XML.
  `validateBpmn` parses with bpmn-moddle and reports warnings, counts and
  elements without DI.
- `importBpmn`: bpmn-moddle → FlowGraph (tasks of all types → activity
  nodes, gateways, events with definition tags, lanes and pools → groups,
  expanded sub-processes → stage groups, sequence flows → flow edges with
  name and condition, message flows, text annotations), positions from the
  DI (`engine: "di"`), and a task ↔ activity mapping table filled by id,
  label and aliases (`matchActivities`, `applyMapping`, `mappingIndex`,
  `normalizeLabel`).
- `<BpmnView/>`: bpmn-js viewer (navigated) or modeler loaded on demand,
  overlays projected through the overlays service (badges, heat tints,
  hatching, chips) and an SVG layer (arcs, self-loops) from the core's
  overlay geometry; overlay datasets switch while the diagram and viewport
  stay fixed; targets resolved through the mapping; selection and hover
  callbacks with task, flow and lane ids; controlled selection; `onChange`
  with the XML after modeler edits; table alternative, legend, ARIA
  description, level-of-detail by zoom, refit on resize; the bpmn.io
  watermark stays.

### Views

- `buildViews` / `resolveViews`: the same graph and positions under named
  views with their own metrics and overlays; colour and width domains
  shared across views so that they compare; `viewsSharePositions`.
- `<ViewSwitcher/>`: tabs for one view at a time or a grid of small
  multiples with one legend per distinct style; shared selection.

### Core and React

- `LayoutEngine` gained `"di"`; `buildScales` reads domains from `flow`
  edges as well; `<ProcessMap/>` and `toSVG` colour flow edges through the
  scales; strings `bpmn.*` and `views.*` (en, de).

### Tooling

- Fixtures `fixtures/p2p_stages.ts` (stage model) and
  `fixtures/p2p_small.bpmn` (hand-written BPMN with a pool, three lanes,
  two gateways, task sub-types).
- Stories "BPMN › from stage model (P2P)", "from log (BPIC 2019, abstraction
  slider)", "overlays on a model", "export → import round trip", "Views ›
  four views of one map", "small multiples"; Vitest suites for BPMN-lite,
  the round trip, the import and the views; Playwright screenshots of the
  stage-model diagram and the view grid plus a viewport check for the
  dataset switch.

## 0.1.0 — milestone 0.1

First implementation of the public contract in `docs/API.md`.

### Core (`@wise/flow`)

- `FlowGraph` model matching the workbench schema (`nodes`, `edges`,
  `groups`, `overlays`, `meta`), `validateGraph`, `indexGraph`.
- `abstract` with activity and path thresholds relative to the strongest
  element, stage collapse (semantic zoom), and a keep-connected guarantee
  (spanning forest over the strongest direct edges, cheapest paths through
  removed nodes, one edge per activity that lost its flow context);
  re-added elements tagged `reconnected`. `diff` for slice-versus-baseline
  maps with `a_*` and `delta_*` metrics and one-sided tags.
- `layout` on ELK layered (Web Worker through `elkWorkerUrl`, in-process
  otherwise) with stage groups as ordered compound nodes, Dagre fallback on
  failure or timeout, deterministic positions, a cache by key;
  `layoutUnion` and `filterPositions` for stable positions across scenes.
- `buildScales`: width, sequential, diverging and categorical scales with
  colour-blind-safe palettes, pattern twins, contrast helpers, legend
  descriptions; level-of-detail rules by zoom and map size.
- Overlay grammar (`badge`, `arc`, `hatch`, `tint`, `chip`, `selfLoop`) with
  presets for presence, singularity, exclusion, lag, precedence, balance /
  metric and applicability; `overlayGeometry` with bounded shapes; canonical
  overlay order.
- `HitIndex` (rbush) over nodes, groups, edge segments and overlay shapes.
- `toSVG` with figure presets, embedded legend and deterministic output.
- Deterministic number formatting and English / German strings.

### React (`@wise/flow/react`)

- `<ProcessMap/>` on React Flow: activity, stage, gateway, event and note
  nodes, group compounds, follows and constraint edges, overlay layers,
  abstraction controls, legend, selection and hover callbacks, keyboard
  navigation, ARIA descriptions, table view.
- `<TableAlternative/>`, `<TraceTimeline/>` (absolute or anchored time axis,
  violated constraints marked, annotations, table alternative), `<Legend/>`,
  `<AbstractionControls/>`, hooks `useFlowGraph`, `useStableLayout`,
  `useOverlays`.
- Stylesheets `tokens.css` (light and dark) and `style.css`.

### Tooling

- Fixture `fixtures/bpic2019_p2p.json` derived from the BPI Challenge 2019
  log (whole log and vendor 0128) with constraint statistics, built by
  `fixtures/build_bpic2019_fixture.py`.
- Storybook 8 stories: P2P map, stable layout, overlay catalogue, table
  alternative, trace timeline; Vitest suites for the core and the
  components; Playwright screenshots of the P2P and stable-layout stories.
- Node 18 toolchain: TypeScript 5, Vite 5, Vitest 2, Storybook 8.6,
  Playwright 1.61.

### Changes against the draft contract

See "Changes against the draft" in `docs/API.md`: `Positions` shape,
`FlowGraph.overlays`, extra options on `abstract`, `constraintOverlays` and
`ProcessMap`, `diff` / keyboard navigation / table alternative moved into
0.1, `@dagrejs/dagre` instead of `dagre`, `d3-shape` and `d3-array` not
needed yet. BPMN bridge, Canvas renderer and the remaining custom views
follow in 0.2 and 0.3.
