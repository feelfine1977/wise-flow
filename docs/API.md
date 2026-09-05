# Public API (0.1)

The contract the 0.1 release implements. Changes against the earlier draft
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
  bounds: Box; engine: "elk" | "dagre"; direction: "RIGHT" | "DOWN" | "LEFT" | "UP";
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
"canvas"` is accepted and falls back to `svg` until 0.2.

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
