# Changelog

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
