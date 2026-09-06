# Public API (0.2)

The contract the 0.2 release implements: the 0.1 surface unchanged, the BPMN
bridge and the view helper added. Changes against the earlier draft
are listed at the end. Types are exported from `@wise/flow`, components from
`@wise/flow/react`.

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
  overlays?: Overlay[]; meta?: Record<string, unknown>; }

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
  bounds: Box; engine: "elk" | "dagre" | "di"; direction: "RIGHT" | "DOWN" | "LEFT" | "UP";
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
export interface Scene { graph; positions; overlays?; style?; title?; subtitle?; locale? }
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
  controls?: boolean; legend?: boolean; minimap?: boolean; renderer?: "auto" | "svg" | "canvas";
  selection?: Selection; onSelect?: (s: Selection) => void; onHover?: (id: string | null) => void;
  lod?: Partial<LodRules>; locale?: Locale; layout?: LayoutOptions; selfLoops?: boolean;
  view?: "map" | "table"; onViewChange?: (v: "map" | "table") => void;
  ariaLabel?: string; className?: string; containerStyle?: CSSProperties; fitView?: boolean; children?: ReactNode;
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
overlays. Keyboard: arrow keys move focus between activities, Enter and
Space select, Escape clears, Home and End jump. `aria-activedescendant`
points at the focused node; every node, edge and group carries an
`aria-label`; the map has a visually hidden description. `renderer:
"canvas"` is accepted and falls back to `svg` until the Canvas renderer
ships (0.3).

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
