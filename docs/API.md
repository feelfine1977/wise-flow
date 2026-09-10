# Public API (0.3)

The contract the 0.3 release implements: the 0.1 and 0.2 surface unchanged,
the interaction model (selection, actions menu, paths, filters, lanes) and
the Canvas renderer with `toPNG` added. Changes against the earlier draft
and between the milestones are listed at the end. Types are exported from
`@wise/flow`, components from `@wise/flow/react`, the BPMN bridge from
`@wise/flow/bpmn`, the Canvas renderer from `@wise/flow/canvas`.

## Model (`#/components/schemas/FlowGraph` of the workbench API)

```ts
export type NodeKind = "activity" | "stage" | "gateway" | "event" | "note";
export type EdgeKind = "follows" | "constraint" | "flow";
export type GroupKind = "lane" | "stage" | "pool";
export type OverlayKind = "badge" | "arc" | "hatch" | "tint" | "chip" | "selfLoop";

export interface FlowNode { id: string; kind: NodeKind; label: string; group?: string;
  metrics?: Record<string, number>; tags?: string[]; }
export interface FlowEdge { id: string; kind: EdgeKind; source: string; target: string;
  metrics?: Record<string, number>; tags?: string[]; payload?: unknown; }
export interface FlowGroup { id: string; kind: GroupKind; label: string; parent?: string; }
export interface Overlay { kind: OverlayKind; target: string; payload?: OverlayPayload; }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[]; groups?: FlowGroup[];
  overlays?: Overlay[]; meta?: Record<string, unknown>; focus?: string; paths?: FlowPaths; }   // focus, paths: 0.3

export const MAP_TARGET = "__map";      // overlay target for map-level chips
export function validateGraph(g: FlowGraph): GraphIssue[];
export function indexGraph(g: FlowGraph): GraphIndex;
```

Metric names the defaults read: nodes `cases`, `events`, `share`,
`violationShare`; follows edges `count`, `cases`, `share`, `violationShare`,
`medianLagHours`. Any other metric can be named in a `StyleSpec`. Tags the
library sets: `reconnected`, `collapsed`, `only-a`, `only-b`, `both`; tags it
reads: `start`, `end` on events, `and`/`or` on gateways.

`OverlayPayload` fields (all optional): `constraintId`, `constraintType`,
`layer`, `label`, `value` (a share in [0, 1] that colours the overlay),
`coverage`, `glyph`, `text` (formatted reading), `description`, `unit`,
`threshold`, `width`, `source`/`target` (arc endpoints), `reverse`, `gauge`.

## Label sizing (headless, opt-in)

These helpers export the map text counter-scaling policy through `@wise/flow`.
They read only numbers and do not enable styling or change any renderer defaults,
layout coordinates, fit lifecycle, selection or controls.

```ts
export const LABEL_PX = 12;
export const MIN_LABEL_PX = 11;
export const MAX_LABEL_PX = 14;
export const MAX_LABEL_UNITS = 64;
export const MIN_READABLE_ZOOM: number; // 11 / 64
export function labelUnitsAt(zoom: number, target?: number): number;
export function smallLabelUnitsAt(zoom: number): number;
export function mapScaleAt(zoom: number): number;
export function labelScreenPx(units: number, zoom: number): number;
```

For example, at zoom `0.5`, `labelUnitsAt(0.5)` returns `24` layout units
(12 screen pixels), `smallLabelUnitsAt(0.5)` returns `22` (11 screen pixels),
and `mapScaleAt(0.5)` returns `2` for a shape holding secondary text.

`labelUnitsAt` defaults to a base size of 12. Its inverse-zoom contribution
uses a target clamped to 11–14, retains the requested base size as a floor,
and caps the result at 64 layout units. `smallLabelUnitsAt` uses base size 11
and the same cap. Zooming in never shrinks base text, so screen size can exceed
14 pixels. Below `MIN_READABLE_ZOOM`, the cap prevents even secondary text
from reaching 11 screen pixels. Nonpositive or nonfinite zooms return the
base size (the supplied target for primary text, 11 for secondary text).
`labelScreenPx` simply multiplies; it does not clamp or round.

Hosts apply the returned sizes to their own text and containing shapes.
Wrapping, collision limits, box growth, fitting, label wording, CSS and
renderer-specific behavior remain separate responsibilities. These helpers
alone do not guarantee that a label fits its box or that labels never overlap.

## Aggregation

```ts
export interface AbstractOptions {
  minEdgeShare?: number;        // follows edges below this relative strength are removed
  minNodeShare?: number;        // activities and stages below this relative strength are removed
  keepConnected?: boolean;      // default true
  collapse?: string[] | "all" | false;   // stage groups → one stage node each
  edgeMetric?: string;          // default count, then cases, then share
  nodeMetric?: string;          // default cases, then events, then share
  relativeTo?: "max" | "total"; // strength relative to the maximum (default) or the sum
  keep?: string[];              // never removed
}
export function abstract(g: FlowGraph, o?: AbstractOptions): FlowGraph;
export function collapseGroups(g: FlowGraph, groups: string[] | "all"): FlowGraph;
export function isConnected(g: FlowGraph): boolean;
export function diff(a: FlowGraph, b: FlowGraph, o?: { metrics?: string[] }): FlowGraph;
```

Guarantees of `abstract`: events, gateways, constraint and flow edges are
never removed; the thresholded part is monotone (a higher threshold yields a
subset); with `keepConnected` the result is one connected component
whenever the input is, restored by a maximum spanning forest over the
strongest direct edges, then by the cheapest paths through removed nodes,
then by one edge per activity that lost all incoming or all outgoing paths;
re-added elements are tagged `reconnected`. A collapsed group becomes a
`stage` node with the group's id; counts are summed, `cases` and `share`
are maxima, other metrics weighted means, internal transitions land in
`internalCount`.

`diff(a, b)` (baseline `a`, slice `b`) carries `b`'s metrics under their own
names, `a`'s under `a_<metric>` and `b − a` under `delta_<metric>`; elements
on one side only are tagged `only-a` / `only-b`, shared ones `both`.

## Layout

```ts
export interface Box { x: number; y: number; width: number; height: number }
export interface EdgeRoute { points: { x: number; y: number }[]; labelX?: number; labelY?: number }
export interface Positions {
  nodes: Record<string, Box>; groups: Record<string, Box>; edges: Record<string, EdgeRoute>;
  bounds: Box; engine: "elk" | "dagre" | "di" | "given"; direction: "RIGHT" | "DOWN" | "LEFT" | "UP";
}
export interface LayoutOptions {
  engine?: "elk" | "dagre" | "auto";   // auto (default): ELK, Dagre on failure or timeout
  direction?: LayoutDirection; nodeSize?: NodeSize | ((n: FlowNode) => NodeSize);
  spacing?: { node?: number; layer?: number; group?: number };
  edgeRouting?: "ORTHOGONAL" | "POLYLINE" | "SPLINES";
  groups?: "compound" | "ignore"; orderStages?: boolean;
  elkWorkerUrl?: string | URL;          // run ELK in a Web Worker served from this URL
  elk?: ELK; elkOptions?: Record<string, string>; timeoutMs?: number; cacheKey?: string;
}
export function layout(g: FlowGraph, o?: LayoutOptions): Promise<Positions>;
export function layoutUnion(scenes: FlowGraph[], o?: LayoutOptions): Promise<Positions>;
export function unionGraph(scenes: FlowGraph[]): FlowGraph;
export function filterPositions(p: Positions, g: FlowGraph): Positions;
export function coversGraph(p: Positions, g: FlowGraph): boolean;
export function clearLayoutCache(key?: string): void;
```

Positions are absolute top-left coordinates and deterministic for the same
input (elements are sorted by id before the engine runs). Groups become
compound nodes; top-level stage groups keep their array order along the
flow direction. `layoutUnion` lays out the union of the scenes once; every
scene reads its own ids from the result, so shared elements keep identical
positions.

## Style

```ts
export interface StyleSpec { edgeWidth?: ChannelSpec; edgeColor?: ColorSpec; nodeColor?: ColorSpec; lod?: Partial<LodRules> }
export const defaultStyle: StyleSpec;   // width ← count (sqrt, 1–8 px), colour ← violationShare, nodes by group
export const diffStyle: StyleSpec;      // colour ← delta_violationShare on the diverging palette
export function buildScales(g: FlowGraph, spec?: StyleSpec): Scales;
export interface Scales { edgeWidth(e): number; edgeColor(e): string; nodeColor(n): string; nodePattern(n): PatternId;
  categorical(key): { color; pattern; index }; color(value, palette, domain): string; legend: LegendItem[]; domains }
export const palettes: { sequential; sequentialBlue; diverging; categorical };   // colour-blind safe
export function contrastText(background: string): string;  // ≥ 4.5 : 1 on every palette colour
export interface LodRules { labels; edgeLabels; badges; arcs; chips; hatch; selfLoops }  // minimum zoom per element
export function lodAt(zoom: number, rules?: Partial<LodRules>): Record<keyof LodRules, boolean>;
export function lodForSize(nodeCount: number, base?: Partial<LodRules>): LodRules;
```

Categorical colours are stable by hashed key and come with a pattern twin
(`solid | diagonal | dots | crosshatch | horizontal | vertical | diagonal-reverse | grid`).

## Overlays

```ts
export type ConstraintType = "presence" | "singularity" | "exclusion" | "lag" | "precedence" | "balance" | "metric" | "applicability";
export interface ConstraintDescription { id; type; label?; layer?; activities?; a?; b?; group?; params?; scope?; description? }
export interface ConstraintStats { cases?; evaluated?; violations?; violationShare?; coverage?; repeatShare?; meanCount?; maxCount?;
  medianDays?; p90Days?; unit?; reverseShare?; mean?; median?; p90?; threshold?; width?; casesInScope?; inScopeShare?;
  nodeShareInScope?: Record<string, number>; [k: string]: unknown }
export function constraintOverlays(c: ConstraintDescription, stats?: ConstraintStats,
  o?: { locale?: Locale; outOfScopeMinShare?: number; graph?: FlowGraph }): Overlay[];
export function overlaysFor(items: { description; stats? }[], o?): Overlay[];
export function canonicalOverlays(overlays: Overlay[]): Overlay[];
export function describeOverlay(o: Overlay, locale?: Locale): string;
export function overlayGeometry(overlays: Overlay[], positions: Positions, o?: OverlayGeometryOptions): OverlayGeometry;
export function overlayMargin(o?: OverlayGeometryOptions): number;
```

Presets: presence → badge (`≥m`, missing share); singularity → badge (`≤k`)
and self-loop (repeat share); exclusion → badge (`∅`, occurrence share); lag →
arc above the map (width = coverage, colour = late share, threshold in the
text); precedence → arc with `⇒` plus a reverse arc (`⇐`) below the map for
the reverse share; balance / metric → chip with a gauge on the group or the
map, tint on the group; applicability → hatch on nodes whose in-scope share
is below `outOfScopeMinShare` (default 1 %) and a scope chip. Constraints
without evaluated cases read "not applicable in this scene".

`overlayGeometry` returns shapes (boxes, arc and self-loop paths, label
anchors, minimum zoom) that never extend beyond `overlayMargin()` around the
positions' bounds.

## Hit index and export

```ts
export class HitIndex { static fromScene(p: Positions, g?: OverlayGeometry): HitIndex;
  at(x, y, tolerance?): HitItem[]; within(box: Box): HitItem[] }
export interface Scene { graph; positions; overlays?; style?; title?; subtitle?; locale?; lanes?: LaneMode }
export interface ExportOptions { preset?: "single-column" | "double-column" | "slide" | "none"; width?; legend?;
  background?; fontFamily?; padding?; lodZoom?; context? }
export function toSVG(scene: Scene, o?: ExportOptions): string;   // deterministic, legend embedded
```

## Formatting and strings

```ts
export type Locale = "en" | "de";
export function formatCount(v, locale?), formatNumber(v, decimals?, locale?), formatShare(v, locale?),
  formatDelta(v, locale?), formatHours(v, locale?), formatDays(v, locale?), formatCompact(v, locale?);
export function t(locale: Locale, key: StringKey, vars?): string;
export function metricLabel(locale: Locale, metric: string): string;
```

## React (`@wise/flow/react`)

```ts
export function ProcessMap(props: {
  graph: FlowGraph; positions?: Positions; overlays?: Overlay[]; style?: StyleSpec;
  abstraction?: AbstractOptions; defaultAbstraction?: AbstractOptions; onAbstractionChange?: (o: AbstractOptions) => void;
  controls?: boolean; legend?: boolean; minimap?: boolean; renderer?: "auto" | "svg" | "canvas"; canvasThreshold?: number;
  selection?: Selection; onSelect?: (s: Selection) => void; onHover?: (id: string | null) => void;
  lod?: Partial<LodRules>; locale?: Locale; layout?: LayoutOptions; selfLoops?: boolean;
  view?: "map" | "table"; onViewChange?: (v: "map" | "table") => void;
  ariaLabel?: string; className?: string; containerStyle?: CSSProperties; fitView?: boolean; children?: ReactNode;
  // 0.3
  focus?: Focus | null; defaultFocus?: Focus; onFocusChange?: (f: Focus | undefined) => void; pathList?: boolean; paths?: FlowPaths;
  filters?: Filter | FilterClause[]; filterPreview?: FilterPreview | Record<string, unknown>; onFilterChange?: (f: Filter) => void;
  lanes?: LaneMode; contextMenu?: boolean;
  onContextMenu?: (target: MenuTarget, actions: MenuAction[]) => MenuAction[] | false | void;
  onAction?: (action: MenuAction, target: MenuTarget) => void | string; announce?: string;
}): JSX.Element;
export interface Selection { nodes: string[]; edges: string[]; groups: string[] }

export function TableAlternative(props: { graph; overlays?; scales?; locale?; selection?; onSelect?; tables? }): JSX.Element;
export function TraceTimeline(props: { traces: Trace[]; anchor?: string; annotations?: Annotation[]; locale?;
  width?; rowHeight?; colorKey?; onSelect?; table?: boolean }): JSX.Element;
export function AbstractionControls(props), Legend(props), OverlayLayer(props);
export function useFlowGraph(g, o?), useStableLayout(scenes, o?), useOverlays(items, o?), usePrefersReducedMotion();
export { nodeTypes, edgeTypes, describeNode, describeEdge, describeGroup, describeMap };
```

`<ProcessMap/>` behaviour: collapse (stage view) runs before the thresholds
and gets its own layout; thresholds filter positions, so sliding the
controls never moves the surviving elements. Given `positions` are used
as long as they cover the graph. Follows self-loops become self-loop
overlays. Keyboard: arrow keys move focus between activities, Alt with an
arrow key along the paths, Space selects, Enter opens the actions menu
(selects when `contextMenu` is false), Shift with an arrow key extends the
selection, Escape clears, Home and End jump. `aria-activedescendant`
points at the focused node; every node, edge and group carries an
`aria-label`; the map has a visually hidden description and a polite live
region. `renderer: "auto"` draws on the Canvas renderer above
`canvasThreshold` (2,000 activities plus paths), `"canvas"` always,
`"svg"` never (see "Interaction and Canvas (0.3)").

Stylesheets: `@wise/flow/tokens.css` (design tokens, light and dark),
`@wise/flow/style.css` (components) and `@xyflow/react/dist/style.css`.

## Contract rules

Ids are opaque and stable; all numbers arrive pre-aggregated; every
component accepts `locale` and renders a table alternative on request;
colour never carries meaning alone (patterns, glyphs and numbers are
redundant); breaking changes only in major versions.

## Changes against the draft

- `Positions` is an object with `nodes`, `groups`, `edges`, `bounds`,
  `engine`, `direction` (the draft left it open). Groups and nodes live in
  separate maps so a collapsed stage node may share its id with its group.
- `FlowGraph.overlays` and `Overlay` added to the model, matching the
  workbench schema.
- `constraintOverlays` takes an optional third argument (locale, scope
  threshold, graph) and `ConstraintStats` is a typed record with an index
  signature.
- `abstract` accepts `edgeMetric`, `nodeMetric`, `relativeTo`, `keep`;
  strengths are relative to the maximum by default.
- `ProcessMap` gained `defaultAbstraction`, `onAbstractionChange`,
  `controls`, `legend`, `minimap`, `layout`, `selfLoops`, `view`,
  `onViewChange`, `ariaLabel`, `containerStyle`, `fitView`; `Selection` now
  includes `groups`.
- `diff`, keyboard navigation and the table alternative moved from 0.2
  into 0.1; `BpmnView`, `importBpmn`, `VariantStrip`, `PerformanceSpectrum`,
  `DottedChart`, `toPNG` and the Canvas renderer remain planned (see the
  roadmap) and are not exported. The `./canvas` and `./bpmn` entry points
  will appear with them.
- `d3-shape` is not used by 0.1 and was dropped from the dependencies;
  `@dagrejs/dagre` (the maintained fork with ESM and types) replaces `dagre`.

## Views (0.2)

```ts
export interface ViewSpec { id: string; label: string; description?: string; style?: StyleSpec; overlays?: Overlay[];
  nodeMetrics?: Record<string, Metrics>; edgeMetrics?: Record<string, Metrics>; graph?: FlowGraph }
export interface ResolvedView { id; label; description?; graph: FlowGraph; overlays: Overlay[]; style: StyleSpec; scales: Scales }
export interface ViewSet { base: FlowGraph; positions: Positions; views: ResolvedView[]; domains: Record<string, number[]> }
export function buildViews(g: FlowGraph, views: ViewSpec[], o?: { positions?; layout?; abstraction?; shareScales?: boolean }): Promise<ViewSet>;
export function resolveViews(g: FlowGraph, views: ViewSpec[], positions: Positions, o?: { shareScales?: boolean }): ViewSet;
export function viewsSharePositions(set: ViewSet): boolean;
```

Every view renders the same graph (ids, elements, positions) with its own
metrics (merged over the base graph's by id), overlays and style. With
`shareScales` (default) the domain of a metric on a channel is its extent
over all views, so equal colours and widths mean equal numbers across the
views; the filled-in domains are returned in `views[i].style` and
`domains` (`"edgeWidth:count"`, `"edgeColor:medianLagHours"`, …).

## BPMN (`@wise/flow/bpmn`, 0.2)

```ts
// BPMN-lite: BPMN shapes in the FlowGraph vocabulary (activity nodes tagged `task`,
// gateway nodes tagged xor/and + split/join, event nodes tagged start/end, `flow` edges, `lane` groups).
export interface StageActivity { id; label?; role?; optional?; loop?; tags?; metrics? }
export interface Stage { id; label?; activities: (StageActivity | string)[]; role?; flow?: "sequence" | "choice" | "parallel"; optional? }
export interface StageModel { id?; label?; stages: Stage[] }
export function liteFromStages(model: StageModel, o?: { lanes?: "stage" | "role" | "none"; startLabel?; endLabel? }): FlowGraph;
export function liteFromGraph(g: FlowGraph, o?: { abstraction?: AbstractOptions; andGateways?: boolean;
  lanes?: "groups" | "none"; selfLoops?: "marker" | "flow" | "drop" }): FlowGraph;
export function stageModelFromGraph(g: FlowGraph, o?: { limit?: number; label?: string }): StageModel;
export function liteCounts(g: FlowGraph): { tasks; gateways; events; flows; lanes };
export const START_ID = "__start", END_ID = "__end", TASK_TAG = "task", LOOP_TAG = "loop", GENERATED_TAG = "generated";

// Layout for BPMN diagrams: ELK layering along the flow, lanes as stacked full-width bands in one pool,
// orthogonal sequence flows; BPMN shape sizes (task 100 × 80, gateway 50, event 36).
export function layoutBpmn(g: FlowGraph, o?: BpmnLayoutOptions): Promise<Positions>;
export interface BpmnLayoutOptions extends Omit<LayoutOptions, "direction" | "groups"> {
  lanes?: "bands" | "compound" | "ignore"; rowGap?; lanePadding?; labelWidth?; poolPadding? }
export const POOL_ID = "__pool";   // pool box in Positions.groups when the graph has lanes but no pool group
export function manhattanRoute(s: Box, t: Box, kinds, gap?): EdgeRoute;

// Export → BPMN 2.0 XML with BPMNDiagram / BPMNShape / BPMNEdge from the positions.
export function exportBpmn(g: FlowGraph, o?: { positions?: Positions; layout?: BpmnLayoutOptions; id?; processId?; name?;
  format?: boolean; extension?: boolean; participant?: boolean }): Promise<{ xml: string; positions: Positions; ids: IdMap; warnings: string[] }>;
export function validateBpmn(xml: string): Promise<{ ok: boolean; warnings: string[]; counts; missingDi: string[] }>;
export function xmlId(id: string, taken?: Set<string>, prefix?: string): string;
export function roundPositions(p: Positions): Positions;
export interface IdMap { toBpmn: Record<string, string>; toFlow: Record<string, string> }

// Import ← BPMN 2.0 XML.
export interface ActivityRef { id: string; label?: string; aliases?: string[] }
export interface MappingRow { taskId; nodeId; label; type; lane?; activityId?; matchedBy?: "id" | "label" | "alias" | "manual" }
export function importBpmn(xml: string, o?: { activities?: ActivityRef[]; positions?: boolean; keepIds?: boolean;
  subProcesses?: "stage" | "activity"; normalize?: (s: string) => string }):
  Promise<{ graph: FlowGraph; mapping: MappingRow[]; positions?: Positions; warnings: string[]; ids: IdMap; processId? }>;
export function matchActivities(mapping: MappingRow[], activities: ActivityRef[], o?): MappingRow[];
export function applyMapping(g: FlowGraph, mapping: MappingRow[] | Record<string, string>): FlowGraph;
export function mappingIndex(mapping): { toTasks: Record<string, string[]>; toActivity: Record<string, string> };
export function normalizeLabel(s: string): string;
export function positionsFromDi(definitions: ModdleElement, ids: IdMap): Positions | undefined;

// bpmn-moddle with the `wise` extension (ids, kinds, tags, metrics through the XML).
export function createModdle(): BpmnModdleInstance;
export const wiseModdleDescriptor, WISE_NS = "http://wise-workbench.org/schema/flow";
export function flowIdOf(el), wiseAttr(el, name), isType(el, type), tagOfType(type), typeOfTag(tag);

// React
export function BpmnView(props: {
  xml?: string; graph?: FlowGraph; layout?: BpmnLayoutOptions; mode?: "view" | "model";
  overlays?: Overlay[]; mapping?: MappingRow[] | Record<string, string>;
  selection?: BpmnSelection; onSelect?: (s: BpmnSelection) => void; onHover?: (id: string | null) => void;
  view?: "diagram" | "table"; onViewChange?; controls?: boolean; legend?: boolean; locale?; lod?; fitView?: boolean;
  onImport?: (r: BpmnImport) => void; onChange?: (xml: string) => void; onError?: (e: Error) => void;
  viewerOptions?: Record<string, unknown>; ariaLabel?; className?; containerStyle?; children?;
} & { ref?: Ref<BpmnViewHandle> }): JSX.Element;
export interface BpmnSelection { tasks: string[]; flows: string[]; lanes: string[] }
export interface BpmnViewHandle { viewer(): unknown; saveXML(): Promise<string | undefined>; saveSVG(): Promise<string | undefined>; fit(): void }
export function ViewSwitcher(props: { views: ViewSet; mode?: "single" | "grid"; onModeChange?; activeView?; onActiveViewChange?;
  columns?; locale?; selection?; onSelect?; onHover?; legend?; lod?; minimap?; className?; containerStyle? }): JSX.Element;   // from @wise/flow/react
```

Mapping of BPMN-lite to BPMN 2.0: activity and stage nodes → `bpmn:Task`
(or the sub-type named by a tag: `userTask`, `serviceTask`, `manualTask`,
`scriptTask`, `businessRuleTask`, `sendTask`, `receiveTask`,
`callActivity`, `subProcess`; a `loop` tag adds standard loop
characteristics); gateway nodes → exclusive (default), parallel (`and`),
inclusive (`or`), event-based (`eventBased`), complex; event nodes → start,
end, intermediate throw or catch (`catch`), boundary, with event
definitions from the tags `timer`, `message`, `error`, `signal`,
`escalation`, `terminate`, `conditional`; note nodes → text annotations;
`flow` and `follows` edges → sequence flows (`payload.label` becomes the
name, `payload.condition` a condition expression, tag `default` the default
flow); `constraint` edges have no BPMN counterpart and are listed in
`warnings`; lane and stage groups → lanes (nested through `parent`), a
top-level pool group → the participant. When lanes exist the process is
wrapped in a collaboration with one participant, as Camunda Modeler does.

The `wise` extension keeps the round trip lossless: `wise:flowId` (the
FlowGraph id when the XML id had to be made safe), `wise:kind` (when it
differs from the type's default), `wise:tags` (space-separated) and
`<wise:metric name value/>` extension elements. `importBpmn` reads them when
present and derives kinds and tags from the BPMN types otherwise; the
same bpmn-moddle instance (`createModdle`) is used by `<BpmnView/>` so the
attributes survive editing in the modeler. Files without the extension
import with their BPMN ids as node ids; `keepIds: false` ignores the
extension ids.

`importBpmn` also returns `positions` from the first `BPMNDiagram`
(`engine: "di"`; `LayoutEngine` gained this value), which `<ProcessMap/>`
accepts like any other positions.

`<BpmnView/>` behaviour: bpmn-js is loaded on demand (NavigatedViewer, or
Modeler with `mode="model"`); XML is imported once per `xml` value and the
viewport fitted (and refitted when the container resizes); overlays are
projected through bpmn-js's overlays service (badges, tints, hatching,
chips as HTML overlays following the shapes; arcs and self-loops drawn
from the core's `overlayGeometry` into an SVG layer of the canvas) and are
replaced without touching the diagram or the viewport when `overlays`
change; overlay targets may be FlowGraph ids, BPMN ids or activity ids
translated through `mapping`; the level-of-detail rules hide badges, chips
and arcs below their zoom thresholds. Selection reports tasks, sequence
flows and lanes or pools in FlowGraph ids; a controlled `selection` is
applied to the diagram. In modeler mode every change is saved (debounced)
and passed to `onChange`; XML that the modeler itself produced is not
re-imported. The table alternative lists the imported graph with the
mapping applied. Stylesheets: `bpmn-js/dist/assets/diagram-js.css`,
`bpmn-js/dist/assets/bpmn-js.css` and
`bpmn-js/dist/assets/bpmn-font/css/bpmn.css` in addition to the package's.

## Changes in 0.2 against 0.1

Additions only; the 0.1 surface is unchanged.

- `LayoutEngine` accepts `"di"` for positions read from BPMN diagram
  interchange.
- `buildScales` computes width and colour domains over `follows` and
  `flow` edges (BPMN-lite sequence flows carry the metrics of the paths
  they replace); `<ProcessMap/>` and `toSVG` colour `flow` edges through
  the scales like paths (constraint edges keep the fixed colour).
- New strings `bpmn.*` and `views.*` in English and German.
- New entry point `@wise/flow/bpmn`; `<BpmnView/>` and `<ViewSwitcher/>`
  are also exported from `@wise/flow/react`.

## Interaction (0.3)

### Selection

```ts
export type ElementKind = "node" | "edge" | "group";
export interface ElementRef { kind: ElementKind; id: string }
export type SelectMode = "replace" | "toggle" | "add" | "remove";
export type SelectionShape = "none" | "node" | "pair" | "set" | "edge" | "edges" | "group" | "mixed";
export const emptySelection: Selection;
export function selectElement(s: Selection, ref: ElementRef, mode?: SelectMode): Selection;
export function selectMany(s: Selection, refs: ElementRef[], mode?: SelectMode): Selection;
export function clearSelection(): Selection;
export function isSelected(s, ref), selectionSize(s), selectionEquals(a, b), selectionElements(s): ElementRef[];
export function selectionShape(s: Selection): SelectionShape;
export function relatedToSelection(g: FlowGraph, s: Selection): { nodes: Set<string>; edges: Set<string> };
export function describeSelection(g: FlowGraph, s: Selection, locale?: Locale): string;
```

`replace` selects the element alone (a click on the only selected element
clears), `toggle` adds or removes it (Shift, Ctrl or Cmd click, Shift with
an arrow key), `add` and `remove` are the explicit forms. Groups are
selected alone and leave the selection when a node or path joins. Two
activities form a `pair`, more a `set`. `relatedToSelection` names what
stays bright: the selected nodes and the paths touching them, the selected
paths with their endpoints, the members of a selected group.

### Actions menu

```ts
export type MenuGroup = "filter" | "explore" | "compare" | "author" | "export";
export const MENU_GROUP_ORDER: MenuGroup[];
export interface MenuTarget { kind: "node" | "edge" | "group" | "pair" | "set"; id: string; ids: string[]; label: string;
  nodeKind?: NodeKind; groupKind?: GroupKind; edgeKind?: EdgeKind }
export interface MenuAction { id: string; label: string; group: MenuGroup; accelerator?: string; disabled?: boolean;
  clause?: FilterClause | FilterClause[]; run?: (target: MenuTarget) => void | string; description?: string }
export function menuTargetFor(g: FlowGraph, element: ElementRef, selection: Selection): MenuTarget;
export function defaultActions(g: FlowGraph, target: MenuTarget, locale?: Locale, o?: { collapsed?: boolean; hasFocus?: boolean }): MenuAction[];
export function sortActions(actions: MenuAction[]): MenuAction[];
export function menuTitle(target: MenuTarget, g: FlowGraph, locale?: Locale): string;
```

Default action ids: `filter-to` (`f`), `exclude` (`x`), `paths` (`i`),
`lens` (`d`), `worst-cases` (`w`), `pin` (`p`), `add-constraint` (`c`),
`collapse` / `expand` (`z`), `clear-focus` (`h`). Activities get all of
them; paths `filter-to`, `exclude`, `paths`, `worst-cases`, `pin`,
`add-constraint`; stages `collapse` or `expand`, `filter-to` (any member),
`exclude`, `paths`, `worst-cases`, `pin`; the end event `filter-to`
(closed cases), `exclude` (open cases), `pin`; gateways, start events,
notes and constraint edges only `lens` / `pin`. A pair offers `filter-to`
(eventually follows), `exclude`, `paths`, `lens`, `pin`, `add-constraint`; a
set `filter-to` (all), `exclude` (any), `pin`. Filter actions carry the
clause they add. `<ProcessMap/>` handles `filter-to`, `exclude` (through
`onFilterChange`), `paths`, `collapse`, `expand` and `clear-focus` itself
and passes every choice to `onAction`; `onContextMenu(target, actions)`
may return replacement actions (with `run` handlers or not) or `false`.

### Paths

```ts
export interface FlowPath { from?; to?; count?; cases?; share?; medianLagHours?; p90LagHours?; violationShare?;
  median_lag?; violation_share?; [k: string]: unknown }
export interface FlowPaths { focus?: string; incoming: FlowPath[]; outgoing: FlowPath[] }
export interface PathRow { edgeId?; from; to; count?; cases?; share?; medianLagHours?; p90LagHours?; violationShare?; reconnected? }
export interface ActivityPaths { focus: string; incoming: PathRow[]; outgoing: PathRow[]; source: "payload" | "graph";
  totals: { incoming: number; outgoing: number } }
export type PathSortKey = "count" | "cases" | "share" | "medianLagHours" | "p90LagHours" | "violationShare" | "label";
export type Focus = string | [string, string];
export function pathsFor(g: FlowGraph, focus: string, o?: { paths?: FlowPaths; sort?: PathSortKey; ascending?: boolean; kinds?: EdgeKind[] }): ActivityPaths;
export function neighbourhood(g: FlowGraph, id: string): { predecessors: string[]; successors: string[]; incoming: FlowEdge[]; outgoing: FlowEdge[] };
export function focusMembers(g: FlowGraph, focus: string): Set<string>;
export interface PathBetween { a; b; direct?: FlowEdge; nodes: string[]; edges: string[]; found: boolean; reverse?: { direct?; nodes; edges } }
export function pathBetween(g: FlowGraph, a: string, b: string): PathBetween;
export function pathRows(g: FlowGraph, between: PathBetween, direction?: "forward" | "reverse"): PathRow[];
export function focusHighlight(g: FlowGraph, focus: Focus): { nodes: Set<string>; edges: Set<string> };
export function normalizePath(p: FlowPath, focus: string, direction: "incoming" | "outgoing"): PathRow;
```

`pathsFor` reads the `paths` block of a focused flow response
(`GET …/flow?focus=<activity>`: `graph.paths` or `options.paths`, the
contract's `median_lag` / `violation_share` accepted) when it belongs to
the focus and computes the rows from the map's follows edges otherwise
(`source` says which); self-loops are left to the self-loop overlay,
constraint edges are ignored; `totals` sum the transitions; `share` is
cases relative to the activity's cases. A group focus stands for its
members (paths crossing the boundary). `pathBetween` is the shortest, then
strongest path (Dijkstra on hops with a small penalty for weak paths, so
the result is deterministic) and the reverse path when one exists.

### Filters

```ts
export type TimeMode = "case_start" | "case_end" | "active" | "events_inside";
export interface TimeClause { kind: "time"; field?: TimeMode; mode?: TimeMode; from?: string; to?: string }
export interface AttributeClause { kind: "attribute"; field: string; in?; not_in?; range?; missing?: boolean }
export interface ActivityClause { kind: "activity"; op: "contains" | "not_contains" | "starts_with" | "ends_with" | "never"; activity: string }
export interface FollowsClause { kind: "follows"; a: string; b: string; directly?: boolean; never?: boolean }
export interface LagClause { kind: "lag"; a; b; unit?: "D" | "H" | "M" | "S"; min?; max?; directly? }
export interface CountClause { kind: "count"; activity: string; min?; max? }
export interface OpenClause { kind: "open"; value: boolean }
export interface ConstraintClause { kind: "constraint"; constraint: string; state: "violating" | "satisfied" | "in_scope" | "out_of_scope"; label? }
export interface SliceClause { kind: "slice"; slicing: string; key: unknown }
export interface AnyClause { kind: "any"; clauses: FilterClause[] }
export type FilterClause = TimeClause | AttributeClause | ActivityClause | FollowsClause | LagClause | CountClause | OpenClause | ConstraintClause | SliceClause | AnyClause;
export interface Filter { and: FilterClause[] }
export interface FilterPreview { casesIn?; casesOut?; casesTotal?; perClause?: { clause: number; removedMarginally: number }[]; inScopeByConstraint? }
export const emptyFilter: Filter;
export function asFilter(f: Filter | FilterClause[] | undefined | null): Filter;
export function canonicalClause(c: FilterClause): FilterClause;
export function clauseKey(c: FilterClause): string;
export function canonicalFilter(f: Filter | FilterClause[] | undefined): Filter;
export function filterEquals(a, b): boolean;
export function addClause(f, clause: FilterClause): Filter;      // no duplicates
export function removeClause(f, index: number): Filter;
export function changesCases(c: FilterClause): boolean;          // events_inside and groups containing it
export function describeClause(c: FilterClause, locale?: Locale, labelOf?: (id: string) => string): string;
export function describePreview(p: FilterPreview | undefined, locale?: Locale): string | undefined;
export function normalizeFilterPreview(raw: Record<string, unknown> | FilterPreview | undefined): FilterPreview | undefined;   // snake_case accepted
export interface FilterTarget { kind: "node" | "edge" | "group" | "pair" | "set"; ids: string[] }
export function clauseForTarget(target: FilterTarget, action: "keep" | "exclude", graph?: FlowGraph): FilterClause | FilterClause[] | undefined;
```

Clauses combine by AND, an `any` group by OR. The canonical form resolves
aliases (`mode` → `field`, `not_contains` → `never`), sorts value lists and
clauses and removes duplicates, so two orderings of the same clauses are
byte-identical. `clauseForTarget` is what the map's filter actions add: an
activity → `contains` / `never`; a path → `follows` directly / never
directly; two activities → eventually follows; a stage → `any` of its
members (exclude: one `never` per member); a set → one `contains` per
activity; the end event → `open: false` (closed cases) or `open: true`.
The map never filters data itself.

### Lanes

```ts
export type LaneMode = "stages" | "roles" | "none";
export interface LaneOptions { lanes: LaneMode; padding?: number; labelSpace?: number; gap?: number }
export interface LaneBand { id: string; index: number; axis: "main" | "cross"; box: Box }
export interface LaneResult { positions: Positions; bands: LaneBand[]; mode: LaneMode }
export function laneBands(g: FlowGraph, p: Positions, o: LaneOptions): LaneResult;
export function laneGroups(g: FlowGraph, mode: LaneMode): FlowGroup[];
export function laneAssignment(g: FlowGraph, lanes: FlowGroup[]): Map<string, string>;
```

`stages`: top-level stage groups become consecutive bands along the flow,
cut half-way between neighbouring stages (the order the ELK partitioning
produced) and spanning the map across the flow; nodes and routes stay
where they are. `roles`: top-level lane groups become bands stacked across
the flow in their array order; every node moves into its lane (by group,
by a `lane:` / `role:` tag, else along its paths), routes inside one lane
move with it, routes across lanes are dropped so the renderer draws them
directly. `none` returns the positions as they are. The renderers,
`toSVG` and `toPNG` draw bands for `LaneBand`s.

### React (`@wise/flow/react`, 0.3)

```ts
export function ContextMenu(props: { x; y; title; subtitle?; note?; actions: MenuAction[]; locale?; onAction: (a: MenuAction) => void;
  onClose: () => void; returnFocusTo?: HTMLElement | null; boundsRef?; className? }): JSX.Element;
export function PathList(props: { graph; focus: Focus; paths?: FlowPaths; locale?; selection?; onSelect?; onHover?; onClose?;
  sort?: PathSortKey; ascending?; onSortChange?; className? }): JSX.Element;
export function FilterChips(props: { filter?: Filter | FilterClause[]; preview?; locale?; labelOf?; onFilterChange?; onAnnounce?; clearable?; className? }): JSX.Element;
export function CanvasMap(props: { scene: PreparedScene | undefined; state: DrawState; locale?; fitKey?; fitView?; describe?; onHover?; onClick?;
  onContextMenu?; onViewportChange?; descendants?; className?; children? } & { ref?: Ref<CanvasMapHandle> }): JSX.Element;
export interface CanvasMapHandle { centerOn(id, zoom?); fit(); zoomBy(factor); screenBox(id): Box | undefined; renderer(): CanvasRenderer | null }
```

`<ProcessMap/>` with the 0.3 props: a right click on a node, path or group
(or Enter on the focused element) opens `<ContextMenu/>` with
`defaultActions` for the element or the pair / set it belongs to, the
element's kind and stage, and the worst expectation touching it; the
opening, every choice and the selection are announced through a polite
live region (`announce` injects a host text). `focus` (controlled, `null`
for none) or `defaultFocus` highlights the paths of an activity or stage
(`focusHighlight`) and shows `<PathList/>` at the side with `paths`
(default `graph.paths`); two selected activities show the path between
them; the map area shrinks and the view is fitted again while the list is
shown. `filters` renders `<FilterChips/>` above the map; the filter
actions add clauses through `onFilterChange`. `lanes` draws stage or role
bands (`laneBands`). Renderer choice: `auto` (default) uses the Canvas
renderer above `canvasThreshold` elements; the container carries
`data-renderer="svg" | "canvas" | "table"`, `data-lanes`, `data-focus`.

## Canvas (`@wise/flow/canvas`, 0.3)

```ts
export interface PreparedScene { graph; positions; scales; overlays; shapes: OverlayShape[]; nodes: SceneNode[]; edges: SceneEdge[];
  groups: SceneGroup[]; bands: LaneBand[]; bounds: Box; hit: HitIndex; lod: LodRules; locale; size: number;
  nodeById; edgeById; groupById; shapeById; labelCache }
export function prepareScene(g: FlowGraph, p: Positions, o?: { style?; overlays?; lod?; locale?; lanes?: LaneMode; bands?: LaneBand[];
  overlayGeometry?; selfLoops?: boolean }): PreparedScene;
export interface DrawContext { /* the subset of CanvasRenderingContext2D the routines use */ }
export interface View { x: number; y: number; zoom: number; width: number; height: number }
export interface DrawState { selection: Selection; hovered?: string | null; focused?: string | null; bright?: { nodes: Set<string>; edges: Set<string> } }
export interface DrawOptions { tokens?: CanvasTokens; cull?: boolean; background?: boolean | string; createCanvas? }
export function drawScene(ctx: DrawContext, scene: PreparedScene, view: View, state?: DrawState, o?: DrawOptions): { nodes; edges; shapes; culled };
export function drawLegend(ctx: DrawContext, scene: PreparedScene, x, y, width, tokens?): number;
export function tracePath(ctx: DrawContext, d: string): { last?; beforeLast? };
export class CanvasRenderer { constructor(canvas: HTMLCanvasElement, o?: { tokens?; devicePixelRatio?; minZoom?; maxZoom?; draw? });
  resize(w, h); setScene(s); getScene(); setState(patch: Partial<DrawState>); getState(); setTokens(t);
  getViewport(); setViewport(v, notify?); fit(padding?); panBy(dx, dy); zoomBy(factor, centre?); centerOn(point, zoom?);
  toFlow(x, y); toScreen(x, y); screenBox(id); hitAt(x, y, tolerancePx?): HitItem | undefined; requestDraw(); draw(); dispose();
  onViewportChange?: (v: Viewport) => void; lastDraw?: { nodes; edges; shapes; culled; ms } }
export interface CanvasTokens { font; paper; surface; ink; inkMuted; line; lineStrong; focus; selection; neutral; outOfScope }
export const defaultTokens: CanvasTokens;
export function readTokens(element: Element | null | undefined, overrides?: Partial<CanvasTokens>): CanvasTokens;   // from the CSS variables
export interface PngOptions { preset?: FigurePreset; width?; scale?; background?; legend?; padding?; lodZoom?; tokens?; createCanvas?; context? }
export function toPNGCanvas(scene: Scene, o?: PngOptions): { canvas; width; height; cssWidth; cssHeight; scale };
export function toPNG(scene: Scene, o?: PngOptions): Promise<Blob>;
export function toPNGDataUrl(scene: Scene, o?: PngOptions): string;
```

`prepareScene` is pure and runs in Node: it resolves every element's box
or route, colours, labels and overlay shapes once and builds the R-tree
that serves hover, click and viewport culling. `drawScene` issues plain 2D
context calls (a screen canvas, an offscreen canvas for PNG, or a
recording stub in tests): groups and bands, edges with arrowheads, nodes
with pattern twins and hatching, overlay shapes by kind, edge labels;
level of detail follows `lodAt(view.zoom)`; above 1,500 elements only the
elements inside the viewport are drawn. `CanvasRenderer` owns the
viewport (zoom clamped to `minZoom` … `maxZoom`), draws on animation
frames and follows the device pixel ratio. `toPNG` uses the same figure
presets, title, context line and legend as `toSVG`; `scale` sets the
bitmap density (default: the device pixel ratio, at least 2) and
`createCanvas` supplies a canvas where there is no document.

## Changes in 0.3 against 0.2

Additions only, except the keyboard route for Enter.

- Enter on the focused element opens the actions menu (Space selects);
  with `contextMenu={false}` Enter selects as in 0.1. Alt with an arrow
  key moves along the paths; Shift with an arrow key extends the
  selection.
- `FlowGraph` gained `focus` and `paths`; `Scene` gained `lanes`;
  `LayoutEngine` accepts `"given"`.
- `ProcessMap` gained `focus`, `defaultFocus`, `onFocusChange`,
  `pathList`, `paths`, `filters`, `filterPreview`, `onFilterChange`,
  `lanes`, `contextMenu`, `onContextMenu`, `onAction`, `announce`,
  `canvasThreshold`; `renderer: "canvas"` now draws on the Canvas
  renderer and `"auto"` chooses it above the threshold.
- New entry point `@wise/flow/canvas`; `<ContextMenu/>`, `<PathList/>`,
  `<FilterChips/>` and `<CanvasMap/>` exported from `@wise/flow/react`.
- New strings `selection.*`, `menu.*`, `paths.*`, `filters.*`, `clause.*`,
  `lanes.*`, `unit.*`, `map.focus`, `map.focusPair`, `map.focused`,
  `map.renderer.canvas`, `map.zoomIn`, `map.zoomOut`, `map.fit` (en, de);
  `map.instructions` names every keyboard route.
