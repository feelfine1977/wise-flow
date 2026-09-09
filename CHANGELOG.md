# Changelog

## 0.3.1 — local packaging candidate (unreleased)

- Emit Node-valid ESM and declarations with explicit relative `.js` imports.
- Keep the BPMN legend above the required watermark, including small panels.
- Export BPMN CSS/fonts, React Flow CSS and the ELK worker; include original asset licences.
- Verify the npm tarball in an isolated Node/TypeScript/browser consumer.
- Restore the two Linux screenshots from the original CI artifact and make screenshot approval separate from strict CI.
- Support Node 22/24 LTS in CI; retain PolyForm Noncommercial and document installation and limits.

## 0.3.0 — milestone 0.3

"Interaction: select, ask, follow the paths, filter, draw large maps."
Additions only; the 0.1 and 0.2 API is unchanged (see "Changes in 0.3
against 0.2" in `docs/API.md`). One behaviour change on the map: Enter on
the focused element opens the actions menu (Space still selects); with
`contextMenu={false}` Enter selects as before.

### Selection and actions menu

- Selection model in the core (`selectElement`, `selectMany`,
  `selectionShape`, `relatedToSelection`, `describeSelection`): single and
  multi-select of activities, paths and groups; Shift, Ctrl or Cmd click
  and Shift with an arrow key extend the selection; two activities form a
  pair, more a set; groups are selected alone. The renderers dim what is
  unrelated to the selection.
- Actions menu: `menuTargetFor`, `defaultActions` (filter to, exclude,
  paths in and out, distribution lens, worst cases, pin, add expectation,
  collapse or expand a stage, hide the paths; pair and set actions on a
  multi-selection; closed and open cases on the end event) grouped in the
  order filter, explore, compare, author, with accelerator letters and the
  filter clause every filter action adds. `<ContextMenu/>`: `role="menu"`,
  arrow keys, Home, End, accelerators, Enter, Escape, focus returned to
  the map. `<ProcessMap/>` opens it on a right click and on Enter,
  `onContextMenu(target, actions)` lets the host fill or replace the
  entries, `onAction(action, target)` receives the choice, and every
  result is announced through the map's live region.

### Paths

- `pathsFor`, `neighbourhood`, `focusMembers`, `pathBetween`, `pathRows`,
  `focusHighlight`: incoming and outgoing paths of an activity or a stage
  with transitions, cases, share, median and 90th percentile lag and the
  expectation shortfall, from the `paths` block of a focused flow response
  (`GET …/flow?focus=`, snake_case accepted) or computed from the map;
  the shortest, then strongest path between two activities and its reverse.
- `<ProcessMap focus>` highlights predecessors and successors, dims the
  rest and shows `<PathList/>` at the side (sortable, totals equal to the
  activity's in- and out-counts, rows select and hover the path); two
  selected activities show the path between them. `FlowGraph` gained
  `focus` and `paths`.

### Filters

- Typed filter clauses of the workbench contract (`time`, `attribute`,
  `activity`, `follows`, `lag`, `count`, `open`, `constraint`, `slice`,
  `any`), `canonicalFilter` (aliases resolved, clauses sorted, duplicates
  removed, byte-identical for any order), `addClause`, `removeClause`,
  `describeClause` in plain words (en, de), `changesCases`,
  `clauseForTarget` for the map actions, `normalizeFilterPreview`.
- `<FilterChips/>` and the `filters` / `filterPreview` / `onFilterChange`
  props of `<ProcessMap/>`: one chip per clause with cases in and out and
  the marginal removal, "changes cases" marked, remove by button or Delete;
  the map never filters data, it calls back.

### Lanes

- `laneBands`, `laneGroups`, `laneAssignment`: stage groups as ordered
  bands along the flow (cut half-way between neighbouring stages, nodes
  untouched) or lane groups (roles) as bands stacked across the flow with
  the nodes moved into their lane; `<ProcessMap lanes="stages" | "roles" |
  "none">`, `Scene.lanes` for `toSVG` and `toPNG`.

### Canvas (`@wise/flow/canvas`, new entry point)

- `prepareScene` (retained geometry, colours, overlay shapes, R-tree),
  `drawScene` (viewport culling above 1,500 elements, level of detail by
  zoom, selection, hover, focus dimming, pattern twins and hatching),
  `CanvasRenderer` (pan, zoom, fit, hit-testing, animation-frame redraw),
  `<CanvasMap/>` (pointer handling, tooltip from the element description,
  hidden element list for assistive technology). `<ProcessMap
  renderer="auto">` draws on the canvas above `canvasThreshold` (2,000
  activities plus paths) with the same overlays, selection, menu, keyboard
  routes and controls.
- `toPNG`, `toPNGCanvas`, `toPNGDataUrl`: the scene as a bitmap with the
  figure presets, title, context line and embedded legend of `toSVG`.

### Core and React

- `LayoutEngine` accepts `"given"` for positions supplied by the caller;
  strings `selection.*`, `menu.*`, `paths.*`, `filters.*`, `clause.*`,
  `lanes.*`, `unit.*` and new `map.*` entries (en, de); the map's
  instructions name every keyboard route.

### Tooling

- Stories "Interaction › select and context menu", "paths for an
  activity", "filters"; "Layout › stage lanes", "role lanes"; "Canvas ›
  large map", "P2P map on canvas", "PNG export". Vitest suites for the
  selection, the actions, the paths, the filters, the lanes, the canvas
  (recording context, PNG, renderer), `<ContextMenu/>`, `<FilterChips/>`,
  `<PathList/>` and the map's interaction; Playwright screenshots of the
  paths and stage-lanes stories plus keyboard, filter and canvas checks.

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
