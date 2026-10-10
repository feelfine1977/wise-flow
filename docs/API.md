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
  overlays?: Overlay[]; meta?: FlowMeta; focus?: string; paths?: FlowPaths; }   // focus, paths: 0.3
export interface FlowMeta { abstraction?: number | AbstractionMeta; [key: string]: unknown }
export interface AbstractionMeta { minEdgeShare?: number; minNodeShare?: number; keepConnected?: boolean;
  collapse?: string[] | "all" }

export const MAP_TARGET = "__map";      // overlay target for map-level chips
export function validateGraph(g: FlowGraph): GraphIssue[];
export function indexGraph(g: FlowGraph): GraphIndex;
export interface GraphIndex {
  nodes: Map<string, FlowNode>; edges: Map<string, FlowEdge>; groups: Map<string, FlowGroup>;
  outgoing: Map<string, FlowEdge[]>; incoming: Map<string, FlowEdge[]>;
  members: Map<string, FlowNode[]>;                         // direct members only
  ancestors(id: string, kind?: "node" | "group"): FlowGroup[];
  allMembers(groupId: string): FlowNode[];                  // nested groups included
  label(id: string): string;
}
```

`meta` passes every key through. `meta.abstraction` is either the server's
threshold share (a number; `0` means nothing was removed) or, on a graph
returned by `abstract`, the thresholds the library applied. `meta.abstraction`
was `unknown` before; code that reads it as either form keeps compiling.

`GraphIndex` answers the group hierarchy. `ancestors` returns the groups
enclosing an element, innermost first: for a node its group and upwards, for
a group its parent and upwards. An id that names both a node and a group (a
collapsed stage node) is read as the node unless `kind` is `"group"`. The
chain ends at an unknown parent and before a group would repeat, so cyclic
`parent` references cannot loop. `allMembers` lists the nodes of a group and
of every group nested in it, in graph order; `members` keeps the direct
members. `label` is the node's label, else the group's, else the id.

**Members of a group** mean the nested members everywhere: a selected group
keeps its nested activities bright (`relatedToSelection`), a group focus
stands for them (`focusMembers`, `neighbourhood`, `focusHighlight`), "filter
to" a stage covers them (`clauseForTarget`), stage bands span them
(`laneBands`) and `collapseGroups` folds them into the outermost collapsed
stage. For a group without nested groups this is the same as its direct
members.

Metric names the defaults read: nodes `cases`, `events`, `share`,
`violationShare`; follows edges `count`, `cases`, `share`, `violationShare`,
`medianLagHours`. Any other metric can be named in a `StyleSpec`. Tags the
library sets: `reconnected`, `collapsed`, `only-a`, `only-b`, `both`; tags it
reads: `start`, `end` on events, `and`/`or` on gateways.

`OverlayPayload` fields (all optional): `constraintId`, `constraintType`,
`layer`, `label`, `value` (a share in [0, 1] that colours the overlay),
`coverage`, `glyph`, `text` (formatted reading), `description`, `unit`,
`threshold`, `width`, `source`/`target` (arc endpoints), `reverse`, `gauge`,
`displayLabel` (text drawn beside a self-loop or arc instead of glyph and
value; it widens the overlay's reserved extent), `observed` (recorded data,
drawn at every zoom) and `edgeId` (the edge an overlay stands for, such as the
follows self-edge behind a self-loop). The last three were read before
without being declared; their declared types are `string`, `boolean` and
`string`.

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
export function clearLayoutCache(key?: string): void;   // one caller key, or every cached layout
export interface LayoutScopeOptions { maxEntries?: number }   // default 8, least recently used goes first
export interface LayoutScope {
  layout(g: FlowGraph, o?: LayoutOptions): Promise<Positions>;
  layoutUnion(scenes: FlowGraph[], o?: LayoutOptions): Promise<Positions>;
  readonly size: number; dispose(): void;
}
export function createLayoutScope(o?: LayoutScopeOptions): LayoutScope;
export type PositionsContents = Pick<Positions, "nodes" | "groups" | "edges">;
export function createPositions(c: PositionsContents, engine: LayoutEngine, direction: LayoutDirection): Positions;
export function positionsBounds(c: PositionsContents): Box;
export function unionBoxes(boxes: readonly Box[]): Box;
```

`createPositions` is the one place positions are built: it computes `bounds`
from the node and group boxes and the edge route points, so bounds always
match the contents. Layout, `filterPositions`, `laneBands`, `repositionNodes`,
`layoutBpmn`, `roundPositions` (bounds from the rounded contents), BPMN import
and `BpmnView` build their results with it; hosts
that assemble positions themselves should too. `unionBoxes` is the smallest
box around the given boxes; boxes without a non-negative width and height are
ignored, and no boxes give the empty box at the origin.

Positions are absolute top-left coordinates and deterministic for the same
input (elements are sorted by id before the engine runs). Groups become
compound nodes; top-level stage groups keep their array order along the
flow direction. `layoutUnion` lays out the union of the scenes once; every
scene reads its own ids from the result, so shared elements keep identical
positions.

Caching. With `cacheKey` the same key returns the cached positions, whatever
the graph and the other options; the caller owns the key and forgets it with
`clearLayoutCache(key)`. Without a key `layout` keeps nothing. A layout scope
from `createLayoutScope` keys each layout by its inputs: node ids, labels,
groups and resolved sizes (a size callback counts by what it returns), edge
ids and endpoints, the groups' ids, kinds, labels and parents, and every other
option (an `elk` instance by identity). A changed graph or changed options are
laid out anew; the last `maxEntries` layouts are kept. `dispose()` forgets the
scope's layouts; the scope stays usable. Caller keys inside a scope go to the
shared cache as above. `clearLayoutCache()` without a key forgets every cached
layout, every scope's included. ELK workers (`elkWorkerUrl`) start on demand,
one per URL, and are terminated once no scope and no running layout uses them:
after each `layout` call outside a scope, and when the last scope that used
one is disposed. An `elk` instance the caller supplies is never terminated.

## Style

```ts
export interface StyleSpec { edgeWidth?: ChannelSpec; edgeColor?: ColorSpec; nodeColor?: ColorSpec; lod?: Partial<LodRules> }
export const defaultStyle: StyleSpec;   // width ← count (sqrt, 1–8 px), colour ← violationShare, nodes by group
export const diffStyle: StyleSpec;      // colour ← delta_violationShare on the diverging palette
export function buildScales(g: FlowGraph, spec?: StyleSpec): Scales;
export interface Scales { edgeWidth(e): number; edgeColor(e): string; nodeColor(n): string; nodePattern(n): PatternId;
  categorical(key): { color; pattern; index }; color(value, palette, domain): string; legend: LegendItem[]; domains }
export type LegendItem =   // `title` is a string key for `t` (it was typed `string`)
  | { kind: "width"; title: StringKey; metric: string; domain: [number, number]; range: [number, number] }
  | { kind: "sequential" | "diverging"; title: StringKey; metric: string; domain: number[]; stops: readonly string[] }
  | { kind: "categorical"; title: StringKey; entries: CategoricalEntry[] };
export const palettes: { sequential; sequentialBlue; diverging; categorical };   // colour-blind safe
export function contrastText(background: string): string;  // ≥ 4.5 : 1 on every palette colour
export interface LodRules { labels; edgeLabels; badges; arcs; chips; hatch; selfLoops }  // minimum zoom per element
export function lodAt(zoom: number, rules?: Partial<LodRules>): Record<keyof LodRules, boolean>;
export function lodForSize(nodeCount: number, base?: Partial<LodRules>): LodRules;
export function patternDefs(prefix?: string, ink?: string): string;   // <pattern> tiles of the twins and the hatching; ink defaults to colorTokens.ink
```

Categorical colours are stable by hashed key and come with a pattern twin
(`solid | diagonal | dots | crosshatch | horizontal | vertical | diagonal-reverse | grid`).

## Design tokens

```ts
export const colorTokens: { paper; surface; ink; inkMuted; inkStrong; line; lineStrong; focus; onFocus; selection; hover; neutral; outOfScope;
  severity; mechanism; reservoir; pass; warn; fail };              // the light scheme
export const darkColorTokens: Partial<Record<ColorToken, string>>; // what the dark scheme changes
export const paletteTokens: { sequential; sequentialBlue; diverging; categorical };  // `palettes` is this object
export const fontTokens: { family; mono };                         // "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
export const nodeSizeTokens: Record<NodeKind, { width; height }>;  // `DEFAULT_SIZES` is this object
export const sizeTokens: { radius: 6; radiusLarge: 10; band: 8; shadow };
export const textSizeTokens: { label: 12; glyph: 14; small: 9; note: 11; edgeCount: 10; nameLine: 14; countLine: 12 };
export interface Arrowhead { size; box; length; width; overhang; outline }
export const arrowheadTokens: { edge: Arrowhead; overlay: Arrowhead };
export function arrowheadExtent(a: Arrowhead): { length; half; tip; outline };  // in user units
export type PatternId; export const PATTERNS: PatternId[];          // also exported from the style module, as before
export const patternTokens: { size: 6; strokeWidth: 1; strokeOpacity: 0.6; dotRadius: 1; dotOpacity: 0.7 };
export function patternTwin(p: PatternId): { size; lines: [x1, y1, x2, y2][]; dots: [cx, cy][] };
export const hatchTokens: { size: 8; width: 2 };
export const designTokens: { color; darkColor; palette; font; nodeSize; size; textSize; arrowhead; pattern; hatch };
export const themedColors: readonly ColorToken[];                  // the colours with a CSS variable
export function cssVariable(name: string): string;                 // "inkMuted" → "--wf-ink-muted"
export function tokenVariables(): { light: Record<string, string>; dark: Record<string, string> };
export function arrowMarker(id: string, a: Arrowhead): SvgElement; // the <marker> of an arrowhead, in user units
export function patternTwinSvg(id: string, p: PatternId, ink: string): SvgElement;
export function hatchSvg(id: string, color: string): SvgElement;
export function markArrowhead(arrow: { size; overhang }): Arrowhead;  // the rule for an overlay mark's arrow
```

One table in the core holds the colours, the palettes, the font stack, the
default node sizes, the sizes of the node and edge marks, the arrowhead rule
and the pattern twins. `fixedColors`, `palettes`, `DEFAULT_SIZES` and
`overlayArrow` are read from it and keep their names and values. The SVG
export and the marks use it directly; the Canvas renderer's `defaultTokens`
come from it and `readTokens` reads `cssVariable(key)` for each of them.
`tokens.css` writes `tokenVariables()` (light in `:root`, dark in both dark
blocks); a tooling test fails when the file and the table differ.

The arrowhead rule is the live map's: an edge ends in a closed triangle 3
long and 4.8 wide, outlined by 0.6 in its colour, its tip on the route's
end, in user units (`MarkerType.ArrowClosed` at 12 in React Flow, the
`wf-arrow` marker in SVG, the same triangle in Canvas); arcs and self-loops
end in a triangle 12 long and wide whose tip lies 1.2 beyond the path. A
pattern twin is a 6-unit tile drawn by `patternDefs` (SVG), the Canvas band
and `<PatternSwatch/>` (React) from `patternTwin`.

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
export class HitIndex { static fromScene(p: Positions, g?: OverlayGeometry, edgeTolerance?: number,
    indexOf?: (kind: HitItem["kind"], id: string) => number | undefined): HitIndex;
  at(x, y, tolerance?): HitItem[]; within(box: Box): HitItem[] }
export interface HitItem { minX; minY; maxX; maxY; id: string; kind: "node" | "edge" | "group" | "overlay";
  segment?: [XY, XY]; shapeId?: string; index?: number }   // index: indexOf(kind, id or shape id)
export interface Scene { graph; positions; overlays?; style?; title?; subtitle?; locale?; lanes?: LaneMode;
  activityLabels?: ActivityLabelOptions; selfLoops?: boolean }
export interface ExportOptions { preset?: "single-column" | "double-column" | "slide" | "none"; width?; legend?;
  background?; fontFamily?; padding?; lodZoom?; context? }
export function toSVG(scene: Scene, o?: ExportOptions): string;   // deterministic, legend embedded

export type FigurePreset = "single-column" | "double-column" | "slide" | "none";
export const FIGURE_WIDTHS: Record<Exclude<FigurePreset, "none">, number>;   // 1000, 2000, 1600
export type LegendKeyKind = "badge" | "arc" | "reverse" | "selfLoop" | "outOfScope" | "reconnected";
export interface LegendKey { kind: LegendKeyKind; glyph: string; title: StringKey }
export interface SceneLegend { items: LegendItem[]; keys: LegendKey[]; chips: Overlay[] }
export function sceneLegend(items: LegendItem[], overlays: readonly Overlay[]): SceneLegend;
export const legendMetrics: { width: 188; heading: 26; itemTitle: 16; widthScale: 20; gradient: 30; entry: 16; entriesEnd: 4;
  key: 14; chipsGap: 6; chipLabel: 13; chipText: 15 };
export function legendItemHeight(item: LegendItem): number;
export interface LegendLayout { items: { item; y }[]; keys: { key; y }[]; chips: { chip; y }[]; height: number }
export function legendLayout(legend: SceneLegend): LegendLayout;
export const figureMetrics: { padding: 24; legendColumn: 220; legendInset: 16; titleHeight: 40; titleBaseline: 26;
  contextHeight: 18; contextBaseline: 44; keyLine: 16 };
export interface FigureFrameOptions { title?: boolean; context?: boolean; legend?: boolean; padding?: number; preset?: FigurePreset; width?: number }
export interface FigureFrame { padding; header; map: { width; height; offset: XY };
  legend?: { layout: LegendLayout; x; y; width; rule: { x; top; bottom } }; key: { lines: string[]; y }; width; height; outWidth; outHeight }
export function figureFrame(scene: FramedScene, o?: FigureFrameOptions): FigureFrame;   // FramedScene: graph, activityLabels?, locale, bounds, legend
```

The legend and the figure frame are described once. `sceneLegend` lists the
scale items, a key row for each overlay kind present (badges, arcs,
reverse-order arcs, self-loops, out-of-scope hatching) and then re-added
paths, which every map can show, and the map-level chips; the scene carries
it as `FlowScene.legend`. `legendLayout` places these rows from their
heights in `legendMetrics`, so the legend's height follows from its items.
`figureFrame` measures an exported figure: the header (title 40, context
line 18), the map with its padding and the offset of the scene's content,
the legend column (220: a rule, 16 inset, rows 188 wide, 16 inset), the
activity key under the taller of map and legend, and the output size for a
preset or width. `toSVG`, `toPNG` and the Canvas `drawLegend` draw from
these; `<Legend/>` lists the same rows.

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
  describedLimit?: number;   // default 500 activities plus groups
}): JSX.Element;
export interface Selection { nodes: string[]; edges: string[]; groups: string[] }

export function TableAlternative(props: { graph; overlays?; scales?; locale?; selection?; onSelect?; tables?; pageSize?: number }): JSX.Element;
// A click or Enter on an activity or path row selects as a click on the map does: the row alone, nothing when it was
// selected alone, and with Shift, Ctrl or Cmd the row is added to the selection or removed from it.
// With `pageSize` every table shows one page of rows with "Previous rows" and "Next rows" buttons and a status line
// ("Rows 1–100 of 20,000"), a search field filters the rows of all tables by their text, and the tables carry
// `aria-rowcount` and their rows `aria-rowindex`. Without it (default) every row is rendered and there is no search.
export function TraceTimeline(props: { traces: Trace[]; anchor?: string; annotations?: Annotation[]; locale?;
  width?; rowHeight?; colorKey?; onSelect?; table?: boolean }): JSX.Element;
export function AbstractionControls(props), Legend(props), OverlayLayer(props);
export interface LegendProps { scales: Scales; overlays?: Overlay[]; locale?: Locale; chips?: ReactNode;
  legend?: SceneLegend }   // the scene's legend; without it the rows follow from `scales` and `overlays`
export function useFlowGraph(g, o?), useStableLayout(scenes, o?), useOverlays(items, o?), usePrefersReducedMotion();
export { nodeTypes, edgeTypes, describeNode, describeEdge, describeGroup, describeMap };
export function midpoint(points: XY[]): XY;   // routeMidpoint
// Node and edge data carry the scene's marks; without one the components resolve it from the other fields.
export type ActivityNodeData = { node; color; pattern; badges; hatched; direction; focused; hovered; dimmed; locale; description;
  activityLabels?; labelWidth?; labelHeight?; meta?; mark?: NodeMark };
export type FollowsEdgeData = { edge; route?; width; color; label?; reconnected; hovered; dimmed; focused; description; mark?: EdgeMark };
```

The node and edge components draw what the scene's marks say: texts,
glyph, band and dashing of nodes, route, dash and count label of edges.
Labels are shortened by `truncateText` with `estimateTextWidth`; the
stylesheet's ellipsis still applies where the text is narrower in the
browser than estimated, and the full name stays in the node's description.

`describeMap` names the activity and path thresholds when `meta.abstraction`
is the object `abstract` records; a server's numeric threshold share is not
described.

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

Large maps: the Canvas renderer lists every activity and group in a hidden
element list for assistive technology (the targets of
`aria-activedescendant`). Above `describedLimit` (default 500 activities
plus groups) the list holds at most that many elements: the element the
keyboard is on (before the first key, the selected activity or the one Home
goes to), the ends of a path, their group, and their predecessors and
successors. Every keyboard move re-centres it, so the keys reach every
activity along the paths. The live region and the map's description then
say how many activities and paths there are and that the table view lists
all of them, and the table view shows 100 rows per page with a search field
(`TableAlternative` with `pageSize`). At or below the limit nothing changes.
New strings `map.described.bounded`, `table.search`, `table.rows`,
`table.previous` and `table.next` in English and German.

Stylesheets: `@wise/flow/tokens.css` (design tokens, light and dark),
`@wise/flow/style.css` (components) and `@xyflow/react/dist/style.css`.
`tokens.css` defines `--wf-font`, `--wf-font-mono`, the themed colours
(`--wf-paper`, `--wf-surface`, `--wf-ink`, `--wf-ink-muted`, `--wf-line`,
`--wf-line-strong`, `--wf-focus`, `--wf-on-focus`, `--wf-selection`,
`--wf-hover`, `--wf-neutral`, `--wf-out-of-scope`, `--wf-warn`, `--wf-fail`),
`--wf-radius`, `--wf-radius-lg`, `--wf-shadow` and the default node boxes
(`--wf-node-width` and `--wf-node-height` for activities, `--wf-stage-*`,
`--wf-gateway-*`, `--wf-event-*` and `--wf-note-*` with `-width` and
`-height`), which the stylesheet reads. The variables nothing read
(`--wf-severity`, `--wf-mechanism`, `--wf-reservoir`, `--wf-pass`,
`--wf-cat-0`…`7`, `--wf-seq-0`…`4`, `--wf-div-neg`, `--wf-div-mid`,
`--wf-div-pos`) are no longer defined; their values remain in `colorTokens`
and `paletteTokens`.

Overlays on the map are drawn from the scene's marks (see "Scene"). A node or
group draws the marks it carries (badges, chips, hatching) inside itself, at
the boxes the core gives them, each from its `minZoom`, and the marks that
cover it (tints) as background layers; `<OverlayLayer/>` draws the marks that
run between elements (arcs, self-loops) in flow coordinates; the legend lists
map-level chips. The stylesheet holds only the layout of these drawings; it no
longer positions or colours badges and chips itself.

```ts
export interface OverlayLayerProps { marks?: OverlayMark[]; shapes?: OverlayShape[]; locale: Locale; zoom?: number;
  /** @deprecated */ showArcs?: boolean; /** @deprecated */ showSelfLoops?: boolean;
  hoveredId: string | null; onHover?: (id: string | null) => void; onSelect?: (shape: OverlayShape) => void }
// ActivityNodeData and GroupNodeData also carry:
//   tint?: string        CSS background layers of the marks that cover the element
//   marks?: OverlayMark[] the marks the element carries, in scene coordinates
//   origin?: XY          the top-left corner of the element's box in scene coordinates
// ActivityNodeData.badges and GroupNodeData.chips are deprecated: the map no longer draws from them.
// GroupNodeData.tint held one CSS colour before; it now holds background layers (valid for `background`, not `background-color`).
export function Badges(props: { badges: Overlay[]; locale: Locale }): JSX.Element | null; // SVG, from the top-right corner
export function Chip(props: { chip: Overlay; locale: Locale }): JSX.Element | null;       // SVG, at the size of its mark
```

`<OverlayLayer/>` draws the given `marks` (or the marks of `shapes`) that are
on the map and above the nodes, each from its `minZoom` when `zoom` is given;
`onSelect` receives the shape of a clicked mark. `showArcs` and
`showSelfLoops` are deprecated: without `zoom` the layer keeps its former
behaviour and draws only arcs (with `showArcs`) and self-loops (with
`showSelfLoops`, observed ones always). `ActivityNodeData.badges` and
`GroupNodeData.chips` are still filled but deprecated; custom node types
should draw `marks` instead. `<Badges/>` and `<Chip/>` now draw SVG from the
marks the core resolves for the overlays: badges extend left from the
top-right corner of the element they are placed in, a chip has the size of
its mark.

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
/** @deprecated Not used by `layoutBpmn`; use `routeSequenceFlows` from `@wise/flow`. */
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

// Ids: FlowGraph id ↔ BPMN id ↔ activity id. An element is named by its BPMN id, its FlowGraph id
// and every activity id the mapping points at either of them (the alias rule).
export type ActivityMapping = MappingRow[] | Record<string, string>;   // activity id → task (FlowGraph or BPMN id)
export function createIdResolver(o?: { ids?: IdMap; mapping?: ActivityMapping }): IdResolver;
export interface IdResolver {
  flowId(element: string | ModdleElement): string;        // BPMN id or moddle element → FlowGraph id
  bpmnId(flowId: string): string | undefined;
  activityId(flowId: string): string | undefined;
  flowIdsOfActivity(activityId: string): string[];
  names(element: string | ModdleElement): string[];       // BPMN id, FlowGraph id, mapped activity ids
  matches(element: string | ModdleElement, id: string): boolean;
}
export function renameToActivities(nodeIds: string[], r: IdResolver): { renamed: Map<string, string>; toMapped(id): string; toFlow(id): string };
export function createIdMap(): IdMap;
export function registerId(ids: IdMap, bpmnId: string, flowId: string): void;

// bpmn-moddle with the `wise` extension (ids, kinds, tags, metrics through the XML).
export function createModdle(): BpmnModdleInstance;
export const wiseModdleDescriptor, WISE_NS = "http://wise-workbench.org/schema/flow";
export function flowIdOf(el), wiseAttr(el, name), isType(el, type), tagOfType(type), typeOfTag(tag);

// React
export function BpmnView(props: {
  xml?: string; graph?: FlowGraph; layout?: BpmnLayoutOptions; mode?: "view" | "model";
  overlays?: Overlay[]; mapping?: MappingRow[] | Record<string, string>;
  selection?: BpmnSelection; onSelect?: (s: BpmnSelection) => void; onHover?: (id: string | null) => void;
  view?: "diagram" | "table"; onViewChange?; controls?: boolean; navigation?: boolean; legend?: boolean; locale?; lod?; fitView?: boolean;
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
viewport fitted (and refitted when the container resizes until a navigation control is used); overlays are
projected from the scene's marks: a mark with a path (arcs, self-loops) goes
into an SVG layer of the canvas; a box (badges, tints, hatching, chips) becomes
a bpmn-js overlay on the element it names, at the offset of its box, holding
the mark's SVG elements in an element classed `wf-<kind>` (marks below the
edges also `wf-mark--below`, multiplied onto the shape; the element gets the
marker `wf-bpmn--<kind>`, and hatched ones a dashed outline). Marks with text
scale between 0.8 and 1.2, covers with the diagram; each is shown from its
`minZoom`. Chips show what the map's chips show. Overlays are replaced without touching the
diagram or the viewport when `overlays` change; overlay targets may be
FlowGraph ids, BPMN ids or activity ids translated through `mapping`.
Order, level of detail and geometry come from `buildScene` over the imported
graph and the boxes of the element registry: overlays whose target (or, for
an arc, an endpoint) names no task, event, gateway, lane, pool or subprocess
of the diagram (a sequence flow included) are neither drawn nor listed in the
table, the legend or the description; badges of one task given under
different ids take one slot each; the level-of-detail
rules hide badges, chips, arcs and self-loops below their zoom thresholds,
except observed repeats (`observed`); a self-loop without `displayLabel` or
value draws no text. Selection reports tasks, sequence
flows and lanes or pools in FlowGraph ids; a controlled `selection` is
applied to the diagram. In modeler mode every change is saved (debounced)
and passed to `onChange`; XML that the modeler itself produced is not
re-imported. The table alternative lists the imported graph with the
mapping applied; a row selected in the table is reported in FlowGraph ids,
as a diagram click is, and a diagram selection highlights the mapped row.
Selections from the diagram, from the table and from a controlled
`selection` are announced in the polite live region with the sentences of
`<ProcessMap/>` ("Selected: Approve Invoice.", "Selected: path A → B.",
"Selection cleared."), named by the graph the table lists; before, the view
announced counts ("Selected: 1 tasks, 0 flows, 0 lanes.") and said nothing
when the selection was cleared.
Every id the view matches (overlay targets, controlled selection, reported
selection and hover) goes through `createIdResolver` with the import's id
map and `mapping`. Stylesheets: `bpmn-js/dist/assets/diagram-js.css`,
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
paths with their endpoints, the members of a selected group including the
members of groups nested in it (as `focusMembers` counts them).

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
members, nested groups included (paths crossing the outer boundary). `pathBetween` is the shortest, then
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

// The lane model shared by role bands and `layoutBpmn`.
export interface LaneModelOptions { lanes: "roles" | "nested"; crossLaneEdges: "direct" | "routed" }
export interface LaneModel { options: LaneModelOptions; lanes: FlowGroup[]; laneOf: Map<string, string> }
export interface LaneSlot { lane: FlowGroup; start: number; size: number }
export function laneModel(g: FlowGraph, o: LaneModelOptions): LaneModel;
export function stackLanes(g: FlowGraph, m: LaneModel, start: number, gap: number,
  place: (lane: FlowGroup, members: FlowNode[], start: number) => number): { slots: LaneSlot[]; end: number };
export function spanLanes(g: FlowGraph, m: LaneModel, laneBoxes: Record<string, Box>, o: { main: "x" | "y"; labelSpace?: number }): Record<string, Box>;
export function laneRoutes(g: FlowGraph, m: LaneModel, nodes: Record<string, Box>,
  before?: { routes: Record<string, EdgeRoute>; axis: "x" | "y"; offsets: ReadonlyMap<string, number> }): Record<string, EdgeRoute>;
export function routeSequenceFlows(g: FlowGraph, nodes: Record<string, Box>, o?: { allowOverlap?: boolean }): Record<string, EdgeRoute>;
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

Role bands and `layoutBpmn` share one lane model. `laneModel` picks the lanes
and the lane of every node: `roles` takes the top-level lane groups and
reads `lane:` / `role:` tags (role bands); `nested` takes the leaves of the
group tree and puts a node of a parent group into its first leaf (BPMN). In
both, a node without a lane follows its predecessor, then its successor,
then the first lane. `stackLanes` stacks the lanes across the flow, a
caller's `place` putting the members and returning each lane's size;
`spanLanes` gives the groups above the lanes their boxes (`roles`: a pool
spans its lanes and the lanes without a parent; `nested`: a group spans its
children with a label strip, a top-level pool spans all lanes).
`crossLaneEdges` states what happens to edges once the nodes moved:
`direct` (role bands) moves a route with its ends and drops it across lanes
so the renderer draws it directly; `routed` (BPMN) routes every edge around
the shapes with `routeSequenceFlows`, the orthogonal obstacle router.
`manhattanRoute` in `@wise/flow/bpmn` is deprecated: no layout uses it; use
`routeSequenceFlows`.

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

`<CanvasMap/>` (and `<ProcessMap renderer="canvas"/>`) follows the theme:
it reads the CSS variables of its host with `readTokens` when it mounts and
again, redrawing when a value changed, whenever the `class`, `style` or
`data-theme` attribute of the host or an ancestor changes or the system's
colour scheme (`prefers-color-scheme`) switches.

`<ProcessMap/>` with the 0.3 props: a right click on a node, path or group
(or Enter on the focused element) opens `<ContextMenu/>` with
`defaultActions` for the element or the pair / set it belongs to, the
element's kind and stage, and the worst expectation touching it; the
opening, every choice and the selection are announced through a polite
live region (`announce` injects a host text, which is announced also when
a new `focus` arrives with it; a string returned by `onAction` is what is
announced for that choice). While the menu is open, its keys (arrows, Home,
End, Enter, Space, accelerator letters, Escape, Tab) are the map
controller's: a chosen entry runs once, the menu closes and the input focus
returns to the map; the key does not reach the map's own routes. `focus` (controlled, `null`
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
export interface PreparedScene extends FlowScene { shapes: OverlayShape[]; nodes: SceneNode[]; edges: SceneEdge[];
  groups: SceneGroup[]; bounds: Box; hit: HitIndex; size: number; nodeById; edgeById; groupById; shapeById; labelCache }
export function prepareScene(g: FlowGraph, p: Positions, o?: { activityLabels?; style?; overlays?; lod?; lodBySize?: boolean; locale?;
  lanes?: LaneMode; bands?: LaneBand[]; overlayGeometry?; selfLoops?: boolean }): PreparedScene;
export interface DrawContext { /* the subset of CanvasRenderingContext2D the routines use */ }
export interface View { x: number; y: number; zoom: number; width: number; height: number }
export interface DrawState { selection: Selection; hovered?: string | null; focused?: string | null; bright?: { nodes: Set<string>; edges: Set<string> } }
export interface DrawOptions { tokens?: CanvasTokens; cull?: boolean; background?: boolean | string; lodZoom?: number; createCanvas? }
export function drawScene(ctx: DrawContext, scene: PreparedScene, view: View, state?: DrawState, o?: DrawOptions): { nodes; edges; shapes; culled };
export function drawLegend(ctx: DrawContext, scene: PreparedScene, x, y, width, tokens?, o?: { createCanvas? }): number;   // the scene's legend; returns legendLayout(scene.legend).height
export function tracePath(ctx: DrawContext, d: string): { last?; beforeLast? };
export class CanvasRenderer { constructor(canvas: HTMLCanvasElement, o?: { tokens?; devicePixelRatio?; minZoom?; maxZoom?; draw? });
  resize(w, h); setScene(s); getScene(); setState(patch: Partial<DrawState>); getState(); setTokens(t);
  getViewport(); setViewport(v, notify?); fit(padding?); panBy(dx, dy); zoomBy(factor, centre?); centerOn(point, zoom?);
  toFlow(x, y); toScreen(x, y); screenBox(id); hitAt(x, y, tolerancePx?): HitItem | undefined; requestDraw(); draw(); dispose();
  onViewportChange?: (v: Viewport) => void; lastDraw?: { nodes; edges; shapes; culled; ms } }
export interface CanvasTokens { font; paper; surface; ink; inkMuted; line; lineStrong; focus; selection; neutral; outOfScope }
export const defaultTokens: CanvasTokens;   // from the token table (`colorTokens`, `fontTokens`)
export function readTokens(element: Element | null | undefined, overrides?: Partial<CanvasTokens>): CanvasTokens;   // from the CSS variables (`cssVariable(key)`)
export interface PngOptions { preset?: FigurePreset; width?; scale?; background?; legend?; padding?; lodZoom?; tokens?; createCanvas?; context? }
export function toPNGCanvas(scene: Scene, o?: PngOptions): { canvas; width; height; cssWidth; cssHeight; scale };
export function toPNG(scene: Scene, o?: PngOptions): Promise<Blob>;
export function toPNGDataUrl(scene: Scene, o?: PngOptions): string;
```

`prepareScene` is pure and runs in Node: it builds the core scene
(`buildScene`) and adds what the Canvas renderer needs, every element's box
or route, colours and labels resolved once and the R-tree that serves
hover, click and viewport culling. The overlays are `o.overlays`, or
`graph.overlays` without it, each drawn once. `lodBySize` (default true)
tightens the level of detail with the number of nodes for a fitted live
map; `bands` keeps caller-computed bands and the positions as given. `drawScene` issues plain 2D
context calls (a screen canvas, an offscreen canvas for PNG, or a
recording stub in tests): groups and bands, the scene's overlay marks below
the edges (tints), edges with arrowheads, nodes with pattern twins, the
marks above the nodes, edge labels; level of detail follows
`lodAt(o.lodZoom ?? view.zoom)` and each mark is drawn from its `minZoom`;
a hovered mark shows its value colour in the focus colour; above 1,500
elements (or with `cull: true`) only the groups, marks, edges and nodes the
hit index finds inside the viewport are read and drawn, in the order of a
full draw: every item of `scene.hit` carries its element's position in
`groups`, `marks`, `edges` or `nodes` as `HitItem.index`, so a draw reads
about as many elements as the view holds, whatever the size of the scene.
Groups wholly outside the viewport are no longer drawn there. Marks that are
not drawn on the map (map-level chips) are neither in `bounds` nor in the
hit index; the one segment of a two-point route is the route's own `points`
array. Nodes and edges are drawn from their marks (`SceneNode.mark`,
`SceneEdge.mark`, the scene's `nodeMarks` and `edgeMarks`); the other
fields of `SceneNode` and `SceneEdge` stay as data. `SceneGroup.tint` and `SceneNode.hatched` still describe the
group's tint and the node's hatching, but the group and node routines no
longer paint them: the tint and hatch marks do, once each. `CanvasRenderer` owns the
viewport (zoom clamped to `minZoom` … `maxZoom`), draws on animation
frames and follows the device pixel ratio. `toPNG` uses the same figure
frame (`figureFrame`) and legend as `toSVG` and reads the same
scene: overlays, follows self-loops (`Scene.selfLoops`, default shown) and
level of detail at `lodZoom` (default 1, without tightening by size)
agree with the SVG export; `scale` sets the
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


## Abstraction identity and interaction notes

`abstract` and `collapseGroups` preserve response `focus` and `paths` so a focused
payload cannot be relabeled as another activity's paths. Collapsed stages retain
original activity IDs in `graph.meta.collapsedMembers`; original edge IDs map to
displayed edges or containing stages in `graph.meta.collapsedEdgeTargets`. These
are JSON-compatible metadata records, not exact case membership sets.

Stage keep/exclude actions use original activities, including nested stages. A
collapsed edge or activity pair has no default filter when the original relation
cannot be represented exactly. Hosts should respect unavailable actions rather
than inventing synthetic activity IDs.

`pathBetween` minimizes hops before maximizing summed normalized count strength;
stable IDs break remaining ties. A graph route is not proof that one observed
case followed the complete sequence. Collapsing overlays preserves their separate
values and remaps targets; folded arcs become labeled stage chips.

ProcessMap and `useStableLayout` lay out in a layout scope of their own: the
layout module keys each layout by the graph structure, the resolved node sizes
and the options, so changed inputs are laid out anew and earlier ones are reused;
the scope is released when the component unmounts. Supplying an explicit
`layout.cacheKey` keeps caller-controlled reuse semantics.

## Cohort comparison (0.3.2 candidate)

`FlowComparison` from `@wise/flow/react` accepts `cohorts: { id, label, cases, graph }[]`, optional plural `noun`, and optional `onSelect(cohortId)`. Import the package tokens and stylesheet.

The two tabs align activity labels or ordered activity pairs across graphs. Cells show distinct `metrics.cases` divided by the supplied cohort case count, plus the count itself. Repeated occurrences and supplied shares never substitute for case counts. Reverse pairs and self-loops remain separate. The default eight rows have the largest percentage-point range across available cohorts; search and Show all reveal the rest. Arrow keys navigate the tabs. Cohort headings optionally invoke the host navigation callback.

Only activity nodes and activity-to-activity `follows` edges enter the comparison. It does not reconstruct complete traces. Missing rows become zero only for a graph whose abstraction removed nothing (`meta.abstraction` is `0`, or the object `abstract` records with `minNodeShare` and `minEdgeShare` both `0` and no `collapse`), valid `nodesTotal` and `edgesTotal`, resolved endpoints and sufficient supplied activities and pairs. Otherwise they remain unavailable. Invalid counts, duplicate labels/pairs and zero cohort denominators are explicitly unavailable; overlapping rows are never summed. The host owns canonical naming, exact source counts, cohort membership and navigation.


## Activity label presentation (0.3.3)

`ProcessMapProps.activityLabels`, `Scene.activityLabels` and Canvas `PrepareOptions.activityLabels` opt into a shared presentation contract. Existing callers retain their current rendering.

```ts
const activityLabels = {
  mode: "names" as const, // or "ids"
  references: activityReferences(fullGraph, previousReferences),
  showCounts: true,
  caseLabel: "items",
};
const nodeSize = (node: FlowNode) => activityNodeSize(node, activityLabels);
```

Use `nodeSize` when providing precomputed positions. Names reserve 280px width and enough height for wrapped text; IDs reserve 140px. Hiding counts does not change dimensions. `useStableLayout` compares resolved dimensions, so equivalent callbacks do not trigger layout. Invalidate an explicit layout cache key when its inputs change.

`references` maps canonical activity IDs to display references. Persist the dictionary across filters; absent entries are retained and new entries are added without renumbering. References indicate identity, not execution order. Optional `names` supplies display aliases; the original graph is unchanged.

Nodes show one secondary measure: distinct cases/items. Hover, focus and the export key show the original name plus exact item and event counts. Missing values are marked unavailable. Tooltips are dismissible with Escape and remain visible while their trigger or tooltip is hovered. Selecting an activity returns its canonical ID.

SVG and Canvas PNG exports include the canonical activity key even when the colour legend or node counts are hidden. Recorded self-loop labels describe transition occurrences; a case repeat share is reported only when the required case counts exist. Explicit constraint evidence remains separate.


## Scene

```ts
export interface FlowSceneOptions { overlays?: Overlay[]; style?: StyleSpec; locale?: Locale; lanes?: LaneMode;
  moved?: Readonly<Record<string, XY>>; activityLabels?: ActivityLabelOptions; selfLoops?: boolean; lod?: Partial<LodRules>; lodBySize?: boolean;
  overlayGeometry?: OverlayGeometryOptions }
export interface FlowScene { graph; positions; bands: LaneBand[]; activityLabels?; locale; style; scales: Scales;
  overlays: Overlay[]; lod: LodRules; geometry: OverlayGeometry; marks: OverlayMark[]; nodeMarks: NodeMark[]; edgeMarks: EdgeMark[];
  legend: SceneLegend; bounds: Box }
export function buildScene(g: FlowGraph, p: Positions, o?: FlowSceneOptions): FlowScene;
export function followsSelfLoops(g: FlowGraph, o?: { locale?: Locale; observed?: { caseLabel?: string } }): Overlay[];
export function withFollowsSelfLoops(g: FlowGraph, overlays: Overlay[], o?: { locale?; observed? }): Overlay[];

export type MarkPaint = "ink" | "inkMuted" | "paper" | "surface" | "line" | "outOfScope" | "value" | "onValue";
export interface MarkFill { paint: MarkPaint; pattern?: "outOfScope"; opacity?: number }
export interface MarkStroke { paint: MarkPaint; width: number; opacity?: number; dash?: number[] }
export interface MarkText { text: string; x: number; y: number; size: number; weight?: number; anchor: "start" | "middle" | "end";
  baseline: "middle" | "alphabetic"; paint: MarkPaint; halo: boolean; maxWidth?: number; lead?: string }
export interface MarkGauge { x: number; y: number; width: number; height: number; value: number; threshold: number } // shares 0–1
export interface OverlayMark { id: string; kind: OverlayKind; overlay: Overlay; box: Box; layer: "below" | "above"; inMap: boolean;
  minZoom: number; color: string; onColor: string; title: string; radius: number; path?: string; fill?: MarkFill;
  stroke?: MarkStroke; arrow?: { size: number; overhang: number }; texts: MarkText[]; gauge?: MarkGauge; edgeId?: string }
export function overlayMarks(shapes: OverlayShape[], locale?: Locale): OverlayMark[];
export function overlayColor(o: Overlay): string;           // value on the sequential palette, neutral without one
export function tintColor(o: Overlay): string | undefined;  // the same colour at TINT_OPACITY, as CSS rgba()
export function arcWidth(o: Overlay): number;               // 2 + 8 × coverage (default 1)
export const TINT_OPACITY: number;                          // 0.18
export const overlayArrow: { size: number; overhang: number }; // 12, tip 0.1 × size beyond the path (`arrowheadTokens.overlay`)
export const chipLayout: { padding: 8; glyph: 12.4; gauge: 46; gaugeWidth: 40; gaugeHeight: 6; char: 6.2 };
export function chipText(o: Overlay, locale?: Locale): { lead?: string; text: string }; // "label: " and text or share

export interface SvgElement { tag: string; attrs: [string, string][]; children: (SvgElement | string)[] }
export interface MarkSvgOptions { paint(mark: OverlayMark, paint: MarkPaint): string; arrowId: string; patternId: string }
export function markSvg(m: OverlayMark, o: MarkSvgOptions): SvgElement;  // the <g> that draws one mark
export function svgMarkup(e: SvgElement | string): string;
export function fitChars(text: string, maxWidth?: number): string;        // about 6.2 px per character, with an ellipsis
export function fitLead(t: MarkText, fit: (text: string) => string): { lead: string; text: string };

export interface ElementText extends MarkText { role: "label" | "glyph" | "count" | "nameLine" | "countLine"; lod?: "labels" | "edgeLabels" }
export interface NodeMark { id: string; kind: NodeKind; node: FlowNode; box: Box; shape: "box" | "circle" | "diamond"; radius: number;
  color: string; pattern: PatternId; fill: MarkPaint; stroke: { paint: MarkPaint; width: number; dash?: number[] }; band?: number;
  texts: ElementText[]; reconnected: boolean; title?: string }
export interface EdgeMark { id: string; kind: EdgeKind; edge: FlowEdge; points: XY[]; color: string; width: number; dash?: number[];
  texts: ElementText[]; reconnected: boolean }
export function nodeMark(n: FlowNode, box: Box, o: { color: string; pattern: PatternId; locale?: Locale; activityLabels?: ActivityLabelOptions }): NodeMark;
export function edgeMark(e: FlowEdge, points: XY[], o: { color: string; width: number; locale?: Locale }): EdgeMark;
export function nodeMarks(g: FlowGraph, p: Positions, scales: Scales, o?: { locale?; activityLabels? }): NodeMark[];
export function edgeMarks(g: FlowGraph, p: Positions, scales: Scales, locale?: Locale): EdgeMark[];
export function edgeColor(e: FlowEdge, scales: Scales): string;      // constraint edges in the mechanism colour
export function gatewayGlyph(n: FlowNode): string;                  // + (and), ○ (or), × otherwise
export function nodeCount(n: FlowNode, locale?: Locale): string | undefined;  // cases; a stage's members before them
export function edgePoints(p: Positions, e: FlowEdge): XY[] | undefined;      // the route, or straight between the boxes
export function routeMidpoint(points: readonly XY[]): XY;           // half of the polyline's length
export function edgeLabelPoint(points: readonly XY[]): XY;          // 4 above the route's midpoint
export type TextMeasure = (text: string, font: { size: number; weight?: number }) => number;
export const estimateTextWidth: TextMeasure;                        // 0.55 em per character
export function truncateText(text: string, maxWidth: number, font: { size: number; weight?: number }, measure?: TextMeasure): string;
export function fitText(t: MarkText, measure?: TextMeasure): string;
```

`buildScene` resolves a graph and its positions once into what a renderer
draws: activity references for every activity, lane bands and the positions
they produce, scales, the overlays to show, level-of-detail rules and the
overlay geometry with the bounds of map and overlays. The overlays are
`o.overlays` (default `graph.overlays`) whose target is a node, a group or
the map, and arcs whose two endpoints are; then one self-loop per follows
edge from a node to itself (`followsSelfLoops`), labelled as an observed
repeat when `activityLabels` is set, replacing a self-loop overlay that
already stands for that edge; then sorted once with `canonicalOverlays`.
`selfLoops: false` leaves the follows self-loops out. The level-of-detail
rules are `defaultLod` under `style.lod` under `o.lod`; `lodBySize` tightens
them with the number of nodes as a live map does, exports leave it off.
`moved` places nodes at absolute points after the lane bands are cut (the
bands stay where the lanes put them) and routes the edges again with
`repositionNodes`; the overlay geometry follows the moved boxes.

`marks` holds one `OverlayMark` per shape of the geometry, in the same
order, with everything needed to draw it: a rounded box (`box`, `radius`)
or a `path`, fill, stroke with width, opacity and dash, an arrowhead, the
texts with position, size, weight, anchor, baseline and halo, the layer
(tints below the edges, everything else above the nodes), the zoom from
which the mark is drawn (`minZoom`; observed self-loops at every zoom) and
whether it is drawn on the map at all (`inMap`: map-level chips are listed
with the legend instead). Colours are roles: `value` is the mark's `color`
(`overlayColor`), `onValue` the text colour on it, and `ink`, `paper` and
`outOfScope` are tokens the renderer resolves, so a themed Canvas keeps its
colours. `toSVG` and the Canvas drawing map these primitives to their output
and decide nothing by overlay kind. The rules behind the marks exist once:
`overlayColor`, `tintColor`, `arcWidth` and `overlayArrow` (a triangle 12
long and 12 wide whose tip reaches 1.2 beyond the end of the path, the live
map's arrowhead), and the kind order in `canonicalOverlays`. `bounds` covers
the positions and the marks drawn on the map; map-level chips do not count.

A chip's mark shows what the live map's chip shows: its glyph, a gauge when
the overlay has one (`gauge`: a track in the `line` colour, the mean's share
of threshold + width filled in the value colour, an ink tick at the
threshold), and its text after its label as a bold `lead` (`chipText`: the
overlay's `text`, or its share without one). `chipLayout` holds the widths
the chip's box is sized and laid out with; `fixedColors.line` is the line
colour of exports.

`markSvg` turns a mark into SVG elements: a group with a title, the path or
the rounded box, the gauge and the texts (a lead as a bold `tspan`; text cut
to `maxWidth` with `fitText`, about 6.2 px per character). The paint roles
are resolved by `o.paint` and the arrowhead and hatching refer to
`o.arrowId` and `o.patternId`. `toSVG` writes these elements with
`svgMarkup`; `<ProcessMap/>`, `<OverlayLayer/>` and `<BpmnView/>` create the
same elements in the DOM with the theme's CSS variables as paints (in the
`style` attribute, since presentation attributes cannot hold variables), and
the Canvas drawing maps the same primitives to 2D calls. None of them decides
anything by overlay kind.

`nodeMarks` holds one `NodeMark` per node with a box and `edgeMarks` one
`EdgeMark` per edge between two placed nodes (edges from a node to itself
are self-loop overlays), both in the graph's order. A node mark says what
the live map shows for its kind: the outline (`box` with a corner radius,
the `circle` of an event, the `diamond` of a gateway), the fill and border
with width and dash (notes dotted on the surface colour, re-added elements
dashed, stages 3 wide, end events 3 wide), the colour band with its
pattern twin (`band`, 8 wide; not on notes, events and gateways) and the
texts: a gateway's glyph (×, + or ○) instead of its label, an event's label
inside its circle at 9 px, a note's label at 11 px at every zoom, the
label of activities and stages 16 in from the left (stages semibold) and
their count in the lower right corner in the muted ink (`nodeCount`: the
cases, for a stage its members before them), or with `activityLabels` the
wrapped name and count lines and the exact description as `title`. An edge
mark carries the route (`edgePoints`: the routed points, or a straight line
between the two boxes where the positions have none), colour (`edgeColor`),
width, dash (re-added `6 5`, constraint `2 4`) and, where the edge has a
`count`, of any kind, the count at `edgeLabelPoint`. Every text names its
`role` and the level-of-detail rule it is drawn from (`lod`; drawn at
every zoom without one). What does not differ between elements is shared and
frozen: one node outline (`stroke`) per paint, width and dash, one dash per
kind of dashed edge, one empty `texts` list for the edges without a count
and, in the Canvas scene, one empty `badges` list for the nodes without
badges. Copy such a part before changing it
(`{ ...mark, stroke: { ...mark.stroke, width: 3 } }`). Equal counts share one
string, and the optional keys of a mark and of a node's texts are present,
`undefined`, where they do not apply. Texts with a `maxWidth` are shortened by one rule,
`truncateText`: the longest start that fits with an ellipsis, by an
injectable `TextMeasure` (`estimateTextWidth` without font metrics). `toSVG`
and the React Flow map use the estimate, the Canvas drawing the context's
`measureText`; `fitText` applies the rule to a mark text. Overlay marks'
texts (`markSvg`) are cut by `fitChars`, about 6.2 px per character.

`<ProcessMap/>` reads the same scene: one scene per graph, positions and
options gives its bands, scales, overlays, level-of-detail rules and overlay
geometry, and in Canvas mode the same scene is handed to the Canvas map.
Its overlays are `graph.overlays` and the `overlays` prop together. Since
this change the map follows the scene's rules: plain self-loop labels are
formatted in the map's `locale`; a given self-loop overlay that stands for
a follows edge (its `edgeId`, no constraint) is replaced by the derived one
instead of being drawn twice; an arc is kept only when both its endpoints
are on the map; and the Canvas map draws every graph overlay once.

`toSVG` draws this scene. Since this change it draws follows self-loops by
default (as the live map does), also without `activityLabels`;
`Scene.selfLoops: false` hides them, also in `toPNG`. Overlays on unknown
targets are dropped before their order is fixed.

## BPMN routing and navigation (0.3.4)

Band layouts route every sequence flow on an orthogonal visibility grid after
placing the nodes. Shape interiors are obstacles; shared tracks and crossings
carry a routing cost. Return connections remain present. This is a readable
heuristic, not an optimal or crossing-free graph layout. Crossing lines do not
create a junction. Row gaps default to 56 units and lane padding to 48 units.
Overlapping or otherwise unroutable supplied geometry raises a descriptive
error instead of silently drawing a connection through a task.

`BpmnView.navigation` defaults to `controls`. Hosts with their own Map/Model/Table
switch can pass `controls={false} navigation` to keep zoom, whole-model fit and
readable-size buttons. Readable size centres the selected task, or the first
task if none is selected. The bpmn.io attribution remains visible.

Arc `payload.displayLabel` may supply a complete, unambiguous result label,
e.g. “63% miss constraint”. It overrides the glyph/percentage label across
React, BPMN, Canvas and SVG; it does not change the underlying result value.
Hosts should provide the rule target, units and evaluated denominator alongside
the drawing. A constraint arc is not an observed process route.

### Manual activity placement

`ProcessMap` accepts `nodesDraggable` (SVG activities only, opt-in), `onNodeMove(id, absolutePosition)` for a controlled host, and `layoutResetKey` to clear internally held manual positions. Group-relative React Flow positions are converted to absolute layout coordinates. Hover, selection and zoom do not alter them. Hosts applying `onNodeMove` can call `repositionNodes(graph, basePositions, overrides)` and clear the override record to restore the exact automatic layout.

`repositionNodes` keeps supplied edge identities, directions and metrics unchanged. It routes around all visible boxes, including a moved box obstructing an unrelated edge; self loops remain node-anchored overlays. During an overlapping drag, an unroutable edge falls back to a clipped direct route rather than throwing. Positions and routes are immutable, and bounds include the rerouted edges. Manual placement is local to the mounted map unless the host persists it.

Custom child controls should import `useReactFlow`, `useNodesInitialized` and `useStore` from `@wise/flow/react`, so they share the renderer's context even when a host resolves different Node/browser entry points of React Flow.

## Deprecated names

No name is removed from any entry point. A deprecated name keeps working, is
marked `@deprecated` in the declarations, and leaves its entry point in the next
major version. Each table names what to use instead. A tooling test
(`tests/tooling/deprecations.test.mjs`) checks that every `@deprecated` name
in the source is listed here with a replacement.

### `@wise/flow`

`src/core/index.ts` lists every name of the `.` entry point; no import path
changes. The names below are used by no renderer, no test and no document:

| Name | Replacement |
| --- | --- |
| `FlowElement` | `FlowNode \| FlowEdge` |
| `isEdge` | `"source" in element` |
| `isStructuralNode` | `node.kind === "event" \|\| node.kind === "gateway"` |
| `byId` | compare `a.id` and `b.id` |
| `DiffOptions` | `NonNullable<Parameters<typeof diff>[2]>` |
| `colorOn` | `buildScales(graph, spec).color` |
| `rgbToHex` | format the rounded channels as `#rrggbb` |
| `relativeLuminance` | `contrastRatio` |
| `PaletteName` | `NonNullable<ColorSpec["palette"]>` |
| `PatternShape` | `ReturnType<typeof patternTwin>` |
| `shapeAnchor` | `{ x: s.labelX ?? s.x + s.width / 2, y: s.labelY ?? s.y }` |
| `HitKind` | `HitItem["kind"]` |
| `BuildViewsOptions` | `NonNullable<Parameters<typeof buildViews>[2]>` |
| `PathsOptions` | `NonNullable<Parameters<typeof pathsFor>[2]>` |
| `ActivityOp` | `ActivityClause["op"]` |
| `DefaultActionOptions` | `NonNullable<Parameters<typeof defaultActions>[3]>` |
| `FollowsSelfLoopOptions` | `NonNullable<Parameters<typeof followsSelfLoops>[1]>` |
| `NodeMarkOptions` | `Parameters<typeof nodeMark>[2]` |

`scripts/core-exports.json` holds the entry point's names and the deprecated
ones; a tooling test compares the built `index.d.ts` with it. Outside the core,
the package imports a name the entry point provides from the entry point.

### `@wise/flow/react`

| Name | Replacement |
| --- | --- |
| `OverlayLayerProps.showArcs` | pass `zoom`: the layer then draws every mark on the map from its `minZoom` |
| `OverlayLayerProps.showSelfLoops` | pass `zoom`, as for `showArcs` |
| `ActivityNodeData.badges` | `ActivityNodeData.marks`, drawn at `origin` (for example with `markSvg` from `@wise/flow`) |
| `GroupNodeData.chips` | `GroupNodeData.marks`, drawn at `origin` |

### `@wise/flow/bpmn`

| Name | Replacement |
| --- | --- |
| `manhattanRoute` | `routeSequenceFlows` from `@wise/flow` |
