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
  collapse?: string[] | "all";
  removedEdges?: { constraint?: number; flow?: number } }   // edges removed with an element at an end; see "Aggregation"

export const MAP_TARGET = "__map";      // overlay target for map-level chips
export function validateGraph(g: FlowGraph): GraphIssue[];
export function validateGateways(g: FlowGraph): GraphIssue[];   // warnings: unpaired parallel gateways
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

`validateGraph` is structural. It reports as errors duplicate node, edge and
group ids, an edge whose source or target names no node, a group parent that
names no group, and a cycle of group parents: every group whose chain of
parents returns to it (two groups inside each other, a group that is its own
parent) is reported once, as `group parent cycle`; a group that only lies
inside such a cycle is not. It reports as warnings a node group that names no
group and an overlay whose target names no node, edge or group. Up to 0.3.5 a
cycle of group parents passed validation; `collapseGroups(g, "all")` then
collapsed nothing and `layout` rejected with the engine's plain error.

`validateGateways` checks the pairing of parallel gateways in any graph with
gateways, generated or imported: a parallel split (a `gateway` node tagged
`and` with several outgoing flows) has a partner when its branches end, one
each, in the incoming flows of one parallel join, every branch running from
the split to the join without leaving the block (no other entry, no end, no
flow back to the split) and the branches meeting only at the join. It
returns a warning for a parallel split without a partner and for a
parallel join that is the partner of no parallel split; flows are the edges
other than constraints, messages and associations. Nothing is rejected: an
imported model loads as before, and a host decides what to do with the
warnings. A sound model whose parallel branches are not nested as blocks is
reported too.

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

Guarantees of `abstract`: events, gateways and the ids in `keep` are never
removed. A constraint or flow edge is removed only with an activity or stage
at one of its ends (an edge to an element that is not on the map cannot be
drawn); `meta.abstraction.removedEdges` counts those by kind (`{ constraint,
flow }`, absent while none went; abstracting an abstracted graph adds to the
count it carries). With `keepConnected` an activity re-added to keep the map
connected brings back its constraint and flow edges to elements on the map,
tagged `reconnected` like everything re-added. Collapsing a stage folds the
edges between its members, of every kind, into its `internalCount`. Up to
this version the documentation said constraint and flow edges were never
removed, nothing counted the ones that went, and a re-added activity came
back without them. The thresholded part is monotone (a higher threshold yields a
subset); with `keepConnected` the result is one connected component
whenever the input is, restored by a maximum spanning forest over the
strongest direct edges, then by the cheapest paths through removed nodes,
then by one edge per activity that lost all incoming or all outgoing paths;
re-added elements are tagged `reconnected`. Of equally cheap reconnecting
paths the one chosen depends on ids only, not on the input order
([Architecture §2.2](ARCHITECTURE.md#22-aggregation)), and a strength relative to
the total divides by a sum taken in ascending order, which no input order
changes. A collapsed group becomes a
`stage` node with the group's id; counts are summed, `cases` and `share`
are maxima, other metrics weighted means over the members that carry them
(plain means where none has a weight; summed in id order, so that no input
order changes them), internal transitions land in `internalCount`
(summed in ascending order). A stage's `cases` is therefore a lower bound of
the cases that touch it, and `minNodeShare` compares a collapsed stage by
that bound: a stage of four activities with 25 different cases each, which
100 cases touch, reads 25 and goes at 50 % beside an activity of 100 cases,
with or without `keepConnected`. Its `events` add up, so with `nodeMetric:
"events"` the stage reads 100 and stays. Edges of one kind between the same two shown
nodes merge into one, named `source->target`, or `source->target:kind:n`
where that id is taken; merged edges take their names in the order of their
smallest original id, not of the input.

`diff(a, b)` (baseline `a`, slice `b`) carries `b`'s metrics under their own
names, `a`'s under `a_<metric>` and `b − a` under `delta_<metric>`; elements
on one side only are tagged `only-a` / `only-b`, shared ones `both`.

## Layout

```ts
export interface Box { x: number; y: number; width: number; height: number }
export interface EdgeRoute { points: { x: number; y: number }[]; labelX?: number; labelY?: number }
export interface Positions {
  nodes: Record<string, Box>; groups: Record<string, Box>; edges: Record<string, EdgeRoute>;
  bounds: Box; engine: "elk" | "dagre" | "di" | "given" | "provisional"; direction: "RIGHT" | "DOWN" | "LEFT" | "UP";
}
export interface LayoutOptions {
  engine?: "elk" | "dagre" | "auto";   // auto (default): ELK, Dagre on failure or timeout
  direction?: LayoutDirection; nodeSize?: NodeSize | ((n: FlowNode) => NodeSize);
  spacing?: { node?: number; layer?: number; group?: number };
  edgeRouting?: "ORTHOGONAL" | "POLYLINE" | "SPLINES";
  groups?: "compound" | "ignore"; orderStages?: boolean;
  elkWorkerUrl?: string | URL;          // run ELK in a Web Worker served from this URL
  dagreWorkerUrl?: string | URL;        // run Dagre in a Web Worker served from this URL
  elk?: ELK; elkOptions?: Record<string, string>; cacheKey?: string;
  timeoutMs?: number;                   // per engine run, default 20000
  fallbackLimit?: number;               // nodes + edges for Dagre fallback on the calling thread, default 500
  signal?: AbortSignal;                 // stop waiting; not part of the layout's inputs
}
export class LayoutUnavailableError extends Error {}   // name "LayoutUnavailableError"
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

`coversGraph` is true when every node of the graph has a box whose four
numbers are finite; up to 0.3.5 any box counted, so `<ProcessMap/>` drew
given positions with `NaN` or an infinity in them instead of laying the graph
out.

Dagre lays out a node or an edge whose id is the empty string, or names a
member of `Object.prototype` (`__proto__`, `constructor`, `toString`, …),
like any other, as ELK does. Up to 0.3.5 it failed on such an id with a
`TypeError`, and a node called `__proto__` could add properties to
`Object.prototype`, which every object of the page shares. A
spacing (`spacing.node`, `layer`, `group`) or a node size (given or returned
by the `nodeSize` callback) that is not a finite number counts as not given:
the default applies, in both engines and in the provisional arrangement. Up
to 0.3.5 Dagre threw a `TypeError` or a plain error on it and ELK returned
boxes that were not finite. Dagre leaves out an edge whose source or target
is not a node of the graph (which `validateGraph` reports); up to 0.3.5 it
placed a node of its own for the missing end and routed the edge through
coordinates that were not finite. ELK rejects such a graph with its own
error, and `engine: "auto"` then falls back to Dagre, as before.

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
laid out anew; the last `maxEntries` layouts are kept. `maxEntries` bounds
the finished layouts a scope keeps, not the layouts running: a scope runs the
layout of its latest request only (see Stopping). `dispose()` forgets the
scope's layouts and stops waiting for its latest request; the scope stays
usable. Caller keys inside a scope go to the
shared cache as above. `clearLayoutCache()` without a key forgets every cached
layout, every scope's included.

Workers. With `elkWorkerUrl` (the URL of `@wise/flow/elk-worker.min.js` or
`elkjs/lib/elk-worker.min.js` as served) ELK runs in a Web Worker; with
`dagreWorkerUrl` (the URL of `@wise/flow/dagre-worker.min.js`, Dagre and the
package's Dagre step, MIT) Dagre runs in one, whether asked for by
`engine: "dagre"` or as the fallback; it gives the same positions as on the
calling thread. Without a worker URL, or where `Worker` does not exist (Node),
the engines run in-process. A worker runs one layout at a time; workers start
on demand, one per running layout, and are terminated once no scope and no
running layout uses them: after each `layout` call outside a scope, and when
the last scope that used one is disposed (a scope keeps one idle worker per
URL until then). An `elk` instance the caller supplies is used instead of the
ELK worker, not the Dagre worker, and is never terminated.

Stopping. A layout runs while somebody waits for it. `signal` stops waiting:
the promise rejects with the signal's reason (an `AbortError` unless another
reason is given), and once nobody else waits for the same layout (the same
`cacheKey`, or the same inputs in a scope) its worker is terminated and
nothing it sends afterwards is read; an aborted layout is not kept, except one
whose answer was already being read when its last waiter left: it finished, so
it is kept like any other and the next request for its inputs is free. A request
to a scope replaces the scope's earlier request: if that one is still
running, its promise rejects with an `AbortError` ("A newer layout request
replaced this one."), and its worker is terminated unless another caller
still waits for it. Disposing a scope does the same for its latest request
("The layout scope was disposed."), so a host that disposes a scope need not
abort its own request; up to this version a layout in flight kept its worker
running after its scope was disposed, until the layout finished or its
caller aborted it. A layout asked for again before the current task ends
(a component that mounts again) keeps running. `timeoutMs` bounds each engine
run: ELK, and Dagre in a worker. When it passes, the worker running it is
terminated, so no layout work continues; `engine: "auto"` then falls back to
Dagre, `"elk"` and `"dagre"` reject with "layout timed out after … ms". A
timeout does not try ELK again (without stage partitions, as an ELK error
still does). A timeout longer than a timer can wait (2³¹ − 1 ms, about 24
days), `Infinity` included, waits that long; up to 0.3.5 the timer fired at
once and the layout timed out before the engine answered. **In-process ELK, and an `elk` instance the caller supplies,
cannot be interrupted**: an abort or timeout rejects at once, but the engine
finishes its run in the background and its result is discarded; in-process
ELK also blocks the calling thread while it runs, so a timeout cannot end it
early. Pass `elkWorkerUrl` wherever a worker can be served.

Fallback limit. Without `dagreWorkerUrl` the Dagre fallback (`engine: "auto"`
after ELK failed or timed out) runs on the calling thread only up to
`fallbackLimit` nodes plus edges (default 500; Dagre's cost grows quickly
with dense graphs, from tenths of a second at 500 to many seconds). Above it
the layout rejects with `LayoutUnavailableError` instead of freezing the page.
`engine: "dagre"` runs whatever the size.

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

An arc keeps clear of the activities between its ends where it can. Its
default course runs above the map from the tops of its ends (below from the
bottoms for a reverse arc) at a height of 22 % of its span, at least 40,
plus 14 for each earlier arc on the same pair, at most 140 (`arcHeight`). When
that course, drawn at its stroke width, crosses the box of a node other than
its ends, the arc takes the course that crosses the fewest: first on its own
side, then on the other, each from the nearest height in steps of 14 (the
further one first when two are equally near, up to 32 steps), within the
margin. A tie keeps the earlier course, so an arc that crosses nothing is
drawn as before. The dash and the glyph still tell a reverse arc from a
forward one on either side. The arc's label sits on it, 8 above the curve
(14 below for a course below the map), at the point nearest the middle (in
steps of 1/32 of the curve) where its box (11 per character and 4 on either
side, from 14 above its baseline to 4 below) covers no node, no badge, no
earlier arc's label and no group's title, and in `buildScene` no path's
count either (as wide as the text at 0.55 em per character, from one em above
its baseline down to it); where none is free, at the point that covers the
fewest. Before, every arc took its default course and its label sat at the
middle; until badges and counts were kept clear of, a label could sit on a
badge of its own end or on the count of a path running under the arc. `buildScene` and the renderers reading it (SVG, PNG, the
Canvas map, the React map and the BPMN view) all draw these courses.

## Hit index and export

```ts
export class HitIndex { constructor(edgeTolerance?: number);
  static fromScene(p: Positions, g?: OverlayGeometry, edgeTolerance?: number,
    indexOf?: (kind: HitItem["kind"], id: string) => number | undefined,
    extentOf?: (item: HitItem) => Box | undefined): HitIndex;   // a box the item's bounds also cover
  at(x, y, tolerance?): HitItem[]; within(box: Box): HitItem[] }
export interface HitItem { minX; minY; maxX; maxY; id: string; kind: "node" | "edge" | "group" | "overlay";
  segment?: [XY, XY]; shapeId?: string; index?: number;   // index: indexOf(kind, id or shape id)
  box?: Box; layer?: "below" | "between" | "above" }   // box: of a node, group or overlay shape, what hit tests read; layer: of an overlay shape
export interface Scene { graph; positions; overlays?; style?; title?; subtitle?; locale?; lanes?: LaneMode;
  activityLabels?: ActivityLabelOptions; selfLoops?: boolean }
export interface ExportOptions { preset?: "single-column" | "double-column" | "slide" | "none"; width?; legend?;
  background?; fontFamily?; padding?; lodZoom?; context?;
  edgeBudget?: EdgeBudget | ShownEdges }   // default every edge; see "Edge budget"
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
  contextHeight: 18; contextBaseline: 44; keyLine: 16; noteRow: 16; noteBaseline: 12; noteSize: 11 };
export interface FigureFrameOptions { title?: boolean; context?: boolean; legend?: boolean; padding?: number; preset?: FigurePreset; width?: number;
  withheld?: { shown: number; total: number } }
export interface FigureFrame { padding; header; map: { width; height; offset: XY };
  legend?: { layout: LegendLayout; x; y; width; rule: { x; top; bottom } }; note?: { text: string; x; y }; key: { lines: string[]; y };
  width; height; outWidth; outHeight }
export function figureFrame(scene: FramedScene, o?: FigureFrameOptions): FigureFrame;   // FramedScene: graph, activityLabels?, locale, bounds, legend
```

`toSVG` writes every text and id that comes with the scene (labels, ids,
kinds, metric names, overlay texts, title) escaped: `&`, `<`, `>` and `"`
become entities, so nothing in them becomes markup. Up to 0.3.5 a node kind
outside `NodeKind` was written into a `class` attribute as it was.

`HitIndex.fromScene` indexes the boxes of the nodes and groups, the segments
of the edge routes (each grown by `edgeTolerance`, 4) and the overlay shapes.
Every bound is rounded outwards to a whole unit, so that the index holds
whole numbers, which the engine stores in place while every other number
costs it a heap object: an area query (`within`) may therefore find an item
whose bounds end less than a unit short of the box. With `extentOf` each
item's bounds also cover the box the callback returns for it, so that an
area query finds an element whose drawing reaches beyond its box. `at`
tests the point against the element's own box (`HitItem.box`, carried by
every node, group and overlay item), not the bounds, and an edge against its
segment, so a hit test is exact. `at` lists the items within `tolerance` of
the point (a box when the point is within the tolerance of it, an edge when
it is within the tolerance of one of its segments) with the one painted on
top first: overlay shapes above the nodes (badges, chips, hatching,
self-loops), nodes, arcs, edges, tints, groups; among those the smaller
element first (a segment with the tolerance around it), then by id. Overlay
items carry their shape's layer (`HitItem.layer`, see `OverlayMark.layer`);
an item without one ranks above the nodes. Up to 0.3.5 every overlay shape
ranked first, so inside a tinted group every hit was the tint, and where an
arc crossed a node, the arc.

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
preset or width. With `withheld` it adds the note on withheld edges
(`map.edges.withheld` in the scene's locale) in a row of 16 under the map
and the legend, its baseline 12 into the row and the activity key below it;
the legend's rule then ends beside the map, and a figure narrower than the
note (11 px, measured by `estimateTextWidth`) is widened so that the note
fits between the paddings. `toSVG`, `toPNG` and the Canvas `drawLegend` draw from
these; `<Legend/>` lists the same rows.

## Formatting and strings

```ts
export type Locale = "en" | "de";
export function formatCount(v, locale?), formatNumber(v, decimals?, locale?), formatShare(v, locale?),
  formatDelta(v, locale?), formatHours(v, locale?), formatDays(v, locale?), formatCompact(v, locale?);
export function t(locale: Locale, key: StringKey, vars?): string;
export function metricLabel(locale: Locale, metric: string): string;
```

`formatNumber` prints between 0 and 100 decimals: fewer are taken as 0, more
as 100, a fraction is cut and `NaN` counts as 0; up to 0.3.5 a number
outside threw a `RangeError`. A value that is not a finite number (`NaN`,
an infinity, a string) prints as `–` in every formatter.

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
  edgeBudget?: EdgeBudget | "adaptive";   // default "adaptive"; see "Edge budget"
  onEdgesShown?: (shown: ShownEdges | undefined) => void;   // the edges drawn while some are withheld, for toSVG and toPNG
}): JSX.Element;
export interface Selection { nodes: string[]; edges: string[]; groups: string[] }

export function TableAlternative(props: { graph; overlays?; scales?; locale?; selection?; onSelect?; tables?; pageSize?: number }): JSX.Element;
// A click or Enter on an activity or path row selects as a click on the map does: the row alone, nothing when it was
// selected alone, and with Shift, Ctrl or Cmd the row is added to the selection or removed from it.
// With `pageSize` every table shows one page of rows with "Previous rows" and "Next rows" buttons and a status line
// ("Rows 1–100 of 20,000"), a search field filters the rows of all tables by their text, and the tables carry
// `aria-rowcount` and their rows `aria-rowindex`. Without it (default) every row is rendered and there is no search.
// A pager button that reaches the last page ("Next rows") or the first ("Previous rows") while it has the input focus
// hands the focus to the other button, which still works there.
export function TraceTimeline(props: { traces: Trace[]; anchor?: string; annotations?: Annotation[]; locale?;
  width?; rowHeight?; colorKey?; onSelect?; table?: boolean }): JSX.Element;
export function AbstractionControls(props), Legend(props), OverlayLayer(props);
export interface LegendProps { scales: Scales; overlays?: Overlay[]; locale?: Locale; chips?: ReactNode;
  legend?: SceneLegend }   // the scene's legend; without it the rows follow from `scales` and `overlays`
export function useFlowGraph(g, o?), useStableLayout(scenes, o?), useOverlays(items, o?), usePrefersReducedMotion();
export type LayoutStatus = "idle" | "pending" | "ready" | "error";
export interface StableLayout { positions: Positions | undefined; status: LayoutStatus; error?: Error;
  provisional: boolean }   // true while `positions` are shown until the layout arrives (status "pending")
export { nodeTypes, edgeTypes, describeNode, describeEdge, describeGroup, describeMap };
export function midpoint(points: XY[]): XY;   // routeMidpoint
// Node and edge data carry the scene's marks. Without one a component resolves it from `node` or `edge` with `color`, `width`,
// `pattern`, `locale`, `labelWidth`/`labelHeight` (else the default size) and `activityLabels`; `label`, `reconnected` and `hatched` are not read.
export type ActivityNodeData = { node; color; pattern; hatched; direction; focused; hovered; dimmed; locale; description;
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
selection, Escape clears, Home and End jump. In the table view the keys are
the table's (its rows, search field and pages); only Escape from a row
clears the selection there, as on the map. `aria-activedescendant`
points at the focused node or path while it is on the map, and at nothing
in the table view, which renders neither; when it leaves the map (a stage
expanded, a threshold raised, a host filter), the attribute goes and the
next key starts as from no keyboard position. Every node, edge
and group carries an `aria-label`; the map has a visually hidden
description and a polite live region. `renderer: "auto"` draws on the
Canvas renderer above
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
all of them. Above the same limit the table view shows 100 rows per page with
a search field (`TableAlternative` with `pageSize`), whichever renderer draws
the map: a React Flow map above the limit gets the paged table too, while its
own elements stay in the DOM as before. At or below the limit nothing
changes.
New strings `map.described.bounded`, `table.search`, `table.rows`,
`table.previous` and `table.next` in English and German.

First scene: a map without `positions` draws at once, before its layout
finishes. It shows a finished layout of the same inputs when its layout scope
holds one (returning to an earlier abstraction level); otherwise, after a
change, the earlier positions of the activities still present, each new node
keeping the offset a provisional arrangement gives it from a placed
neighbour; otherwise a provisional arrangement computed on the calling thread
in time linear in nodes plus edges: nodes in longest-path ranks along the
flow direction, each rank ordered by one barycentre pass, groups as boxes
around their members (top-level stages in their order), straight edges.
These positions carry `engine: "provisional"` (`LayoutEngine` gained the
value). While they are shown the map
is fully interactive, a status panel says "Arranging the map…" (string
`map.arranging`, English and German), the map's description ends with the
same sentence and `data-layout-status` is `"pending"`. When the layout
arrives it replaces them once: the nodes move into place over 300 ms, or at
once when the user prefers reduced motion; `data-layout-status` turns
`"ready"` once they are in place. Selection, the keyboard position and the
input focus stay. The view is fitted to the layout as before, unless it was
moved since it was last fitted (or `fitView` is false): then its zoom stays
and the node nearest the centre of the view stays where it is on screen.
Given positions that cover the graph are drawn as given, without motion;
positions from `useStableLayout` are treated as above while they are
provisional.

`useStableLayout(scenes, options)` returns `positions` from the first render:
a finished layout of the same inputs (status `"ready"`), or provisional
positions as above with `provisional: true` and status `"pending"`; when the
layout arrives, `positions` are replaced once by it (`"ready"`,
`provisional: false`). Without scenes the status is `"idle"`; a failed layout
gives `"error"` with `positions` undefined, as before, except a
`LayoutUnavailableError`: then the provisional positions stay, with
`provisional: true`, status `"error"` and the error. Until this release
`positions` held the previous result (or nothing) while a layout was pending.
The hook aborts the layout of a request it no longer shows (changed scenes
or options, unmount), which terminates its worker; mounted again before the
current task ends (StrictMode), it keeps its layouts and joins the layout
that is running instead of starting it twice. A new `elk` instance alone does
not lay out again, as up to 0.3.5, so an engine made on each render does not
restart the layout it shows. The layouts it keeps for earlier inputs are kept
per instance, though: returning to them with a new instance lays them out
again, as 0.3.5 did. It passes its own `signal`:
a `signal` in its options, or in `<ProcessMap layout>`, is replaced and has no
effect there.

Refined layout unavailable: when the layout fails with
`LayoutUnavailableError`, `<ProcessMap/>` keeps the provisional scene, fully
interactive; the status panel and the map's description say "The refined
layout is unavailable; the map shows a provisional arrangement." (string
`map.layoutUnavailable`, English and German) and `data-layout-status` is
`"error"`. Other layout errors are shown as before.

Stylesheets: `@wise/flow/tokens.css` (design tokens, light and dark),
`@wise/flow/style.css` (components) and `@wise/flow/react-flow.css` (React
Flow's own stylesheet, shipped with the package).
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
run between elements in flow coordinates: arcs above the edges and below the
nodes (in React Flow's edge label layer, which lies between them), so that a
node and the badges it carries stay readable where an arc crosses it, and
self-loops above the nodes; the legend lists map-level chips. The stylesheet holds only the layout of these drawings; it no
longer positions or colours badges and chips itself.

```ts
export interface OverlayLayerProps { marks?: OverlayMark[]; shapes?: OverlayShape[]; locale: Locale; zoom?: number;
  hoveredId: string | null; onHover?: (id: string | null) => void; onSelect?: (shape: OverlayShape) => void }
// ActivityNodeData and GroupNodeData also carry:
//   tint?: string        CSS background layers of the marks that cover the element
//   marks?: OverlayMark[] the marks the element carries, in scene coordinates
//   origin?: XY          the top-left corner of the element's box in scene coordinates
// GroupNodeData.tint held one CSS colour before; it now holds background layers (valid for `background`, not `background-color`).
export function Badges(props: { badges: Overlay[]; locale: Locale }): JSX.Element | null; // SVG, from the top-right corner
export function Chip(props: { chip: Overlay; locale: Locale }): JSX.Element | null;       // SVG, at the size of its mark
```

`<OverlayLayer/>` draws the given `marks` (or the marks of `shapes`) that are
on the map and not below the edges, each from its `minZoom` at `zoom`: those
of the layer `between` (arcs) between the edges and the nodes, the others
above the nodes (before, every mark it drew lay above the nodes); `onSelect`
receives the shape of a clicked mark. Without `zoom` it reads the zoom of the
React Flow map it sits in, as the marks that nodes carry do, so that zooming
out sheds arcs and self-loops as it sheds badges and chips; up to this
version it then drew every mark at any zoom, which `zoom={Infinity}` still
does. `ProcessMap` passes its zoom and is unchanged. Custom node types draw `marks` and `origin`. `<Badges/>` and `<Chip/>` now draw SVG from the
marks the core resolves for the overlays: badges extend left from the
top-right corner of the element they are placed in, a chip has the size of
its mark; `<Chip/>` given an overlay that has no mark on its own (an arc,
which needs its two ends, or a kind outside `OverlayKind`) renders nothing,
where up to 0.3.5 it threw a `TypeError`. A chip drawn on its own (`<Chip/>`, the legend's map-level chips) is
an image named by its label and reading ("Balance: 12 % over"), the words its
text gave assistive technology before; the marks an element carries are
described with the element.

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
export function liteFromGraph(g: FlowGraph, o?: { abstraction?: AbstractOptions; andGateways?: boolean;   // AND only as a split/join pair
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
export function positionsFromDi(definitions: ModdleElement, ids: IdMap, warnings?: string[]): Positions | undefined;

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
  columns?; locale?; selection?; onSelect?; onHover?; legend?; lod?; minimap?; className?; containerStyle?;
  edgeBudget?: EdgeBudget | "adaptive" }): JSX.Element;   // from @wise/flow/react; edgeBudget is passed to every view's map
```

Gateways of `liteFromGraph`: a node with several successors gets an XOR
split `gw_split_<id>`, a node with several predecessors an XOR join
`gw_join_<id>`. With `andGateways`, parallel gateways are emitted only as a
pair: the split of a node becomes AND, and the join of a node becomes AND,
when the branches leaving the first are exactly the inputs of the second:
the successors of the first node follow each other in both orders (which is
how a directly-follows graph shows concurrency), each of them is entered
only from that node or from another branch and left only to the second
node, and the second node's predecessors are exactly these branches. The
paths between the branches only show that they interleave and become no
flows. Every split or join without such a partner is XOR, so a generated
model has no parallel join that waits for a branch an exclusive split did
not take, and no parallel split whose branches an exclusive merge lets
through twice; `validateGateways` reports nothing on it. Without
`andGateways` every gateway is XOR, as before. Two edges between the same two
nodes (a follows edge and a flow, say) become two flows; where a gateway
takes the place of an end, the second keeps the id the first takes with
`:1` after it (`:2` for a third). Up to 0.3.5 both took one id.

Lanes of `liteFromStages` with `lanes: "role"`: a lane per role, in the
order the activities first use them; the split and join of a choice,
parallel or optional stage sit in the stage's `role`, and a role that only
such gateways use gets its lane after the others (up to 0.3.5 it had none,
and the gateways named a missing group).

Start and end of `liteFromGraph`: an added start event leads to the nodes
without predecessors, else to those that start cases (`metrics.starts`),
else to the node with the most cases; an added end event is reached from the
nodes without successors, else from those that end cases (`metrics.ends`),
else from the node with the most cases. Then every node is put on a path from
a start event to an end event (or to a node without outgoing flows, where a
case leaves the process): while some nodes are not reached from a start
event, the first start event leads to those of them that the same rule picks
among them, and while some cannot reach an end, those the rule picks among
them lead to the first end event. So a part of the graph that only its own
nodes lead into (two activities that follow each other, a loop) is entered
from the start, and a part that only leads into itself is left to the end,
and a graph without activities has a flow from the start to the end. Up to
0.3.5 such parts had no flow from the start (their activities could never
happen) or none to the end (a case that entered them could never end). A flow
from the start or to the end carries `metrics.count` only where the node has
a number for it (up to 0.3.5 it was `NaN`). With `selfLoops: "flow"`, a
self-loop leaves through its node's exclusive split and returns through its
exclusive join, like every other path, and a node with a self-loop is never
the split or the join of a parallel pair; up to 0.3.5 the self-loop was a
second outgoing flow of the task without a gateway, which BPMN reads as a
parallel split, so every round added a case.

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

Every element of the export has an id of its own. A FlowGraph id that names
a node, an edge and a group at once (a collapsed stage shares its group's
id) gives each its own BPMN id, and `ids.toBpmn` maps it to the first, the
node's; a node without an id is written as one with the empty id. Up to
0.3.5 such elements were written under one id, which made the file invalid,
and an element without an id threw a `TypeError`.

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
accepts like any other positions. A shape or a route whose coordinates are
not finite numbers (`x="abc"`, `1e400`) is left out of them, and all
positions are left out when the diagram's extent is not a finite number;
each is reported in `warnings` (`positionsFromDi` pushes these to its
optional `warnings` array).

Broken files: `importBpmn` rejects only when the text cannot be read as BPMN
definitions (not XML, truncated, another root element, a namespace that is
not BPMN's). It then rejects with the parser's error, a plain `Error` whose
message starts with `unparsable content` or `failed to parse document` and
whose `warnings` lists what the parser found; any other rejection is a
defect. Every other file is imported, and what is wrong with it is listed in
`warnings`: the parser's warnings (unknown elements and attributes,
duplicate ids, unresolved references), sequence flows without a flow node at
an end, coordinates as above, and every issue `validateGraph` reports on the
imported graph, as `<message>: <id>` (two elements with one `wise:flowId`, or
two without an id, give one node id twice). Elements nested deeper than the
call stack reaches (sub-processes, lanes) are read like any others, also by
`validateBpmn`, which up to 0.3.5 overflowed the stack (`RangeError`) on
them. An
element's empty `name` is exported and imported as an empty label; up to
0.3.5 the export left it out and the import used the id. A sequence flow is
marked `default` only when its source's `default` attribute names it; up to
0.3.5 a flow without an id was marked whenever its source named no default.

`<BpmnView/>` behaviour: bpmn-js is loaded on demand (NavigatedViewer, or
Modeler with `mode="model"`); XML is imported once per `xml` value and the
viewport fitted (and refitted when the container resizes until a navigation control is used); overlays are
projected from the scene's marks: a mark with a path (arcs, self-loops) goes
into an SVG layer of the canvas; a box (badges, tints, hatching, chips) becomes
a bpmn-js overlay on the element it names, at the offset of its box, holding
the mark's SVG elements in an element classed `wf-<kind>` (marks below the
edges also `wf-mark--below`, multiplied onto the shape; the element gets the
marker `wf-bpmn--<kind>`, and hatched ones a dashed outline). Tints and
hatching cover their element without taking the pointer, so a click or a
hover reaches the element, as before. Marks with text
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
map and `mapping`. Stylesheets: `@wise/flow/bpmn.css` (bpmn-js's
`diagram-js.css`, `bpmn-js.css` and `bpmn-font/css/bpmn.css`, shipped with the
package) in addition to the package's.

When the view reports: `data-bpmn-status` on its root becomes `ready` once
the viewer has imported the XML and fitted the viewport (with `fitView`), and
`onImport` is called with the headless import (graph, mapping table,
warnings) once the view is `ready` for that XML and its overlays are
projected, or once the diagram cannot be shown (`error`). A host that reads
the viewport in `onImport` therefore reads the fitted one. Before, `onImport`
was called as soon as the headless import finished, usually before the viewer
had imported and fitted the diagram. It is still called once per import of
an `xml` value; switching `overlays`, `mapping` or `mode` does not call it
again, and an overlay change never moves the viewport.

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
may return replacement actions (with `run` handlers or not) or `false`. When
the menu opens on an element that was not selected, `onContextMenu` is asked
before `onSelect` reports the selection the opening makes (up to 0.3.5,
`onSelect` came first).

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
`focusHighlight` and `<PathList/>` read a focus that is not a pair as one
id, also the missing id of a node a backend sent without one; up to 0.3.5
such a focus threw a `TypeError`.

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

`normalizeFilterPreview` reads numbers only where they are finite numbers,
and the marginal removals (`perClause`, `per_clause`) only from a list, of
its entries whose `clause` is a number; up to 0.3.5 anything else under that
key threw a `TypeError`.

Clauses combine by AND, an `any` group by OR. A clause of a kind this
version does not know is kept as it is (its canonical form is itself), and
an `any` group without `clauses` is an empty group, which changes no cases;
up to 0.3.5 both threw a `TypeError` in `canonicalClause`, `clauseKey`,
`canonicalFilter`, `filterEquals` and `addClause`, and the group also in
`describeClause` and `changesCases` (and with them `<FilterChips/>` and
`<ProcessMap filters>`). The canonical form resolves
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
then the first lane. Groups on a cycle of parents (which `validateGraph`
reports) have no leaf, so their nodes have no lane of their own; up to 0.3.5
`laneModel`, `spanLanes` and with them `layoutBpmn` overflowed the stack on
such a graph. `stackLanes` stacks the lanes across the flow, a
caller's `place` putting the members and returning each lane's size;
`spanLanes` gives the groups above the lanes their boxes (`roles`: a pool
spans its lanes and the lanes without a parent; `nested`: a group spans its
children with a label strip, a top-level pool spans all lanes).
`crossLaneEdges` states what happens to edges once the nodes moved:
`direct` (role bands) moves a route with its ends and drops it across lanes
so the renderer draws it directly; `routed` (BPMN) routes every edge around
the shapes with `routeSequenceFlows`, the orthogonal obstacle router.
`manhattanRoute` was removed from `@wise/flow/bpmn`; use `routeSequenceFlows`.

### React (`@wise/flow/react`, 0.3)

```ts
export function ContextMenu(props: { x; y; title; subtitle?; note?; actions: MenuAction[]; locale?; onAction: (a: MenuAction) => void;
  onClose: () => void; returnFocusTo?: HTMLElement | null; boundsRef?; className? }): JSX.Element;
export function PathList(props: { graph; focus: Focus; paths?: FlowPaths; locale?; selection?; onSelect?; onHover?; onClose?;
  sort?: PathSortKey; ascending?; onSortChange?; className? }): JSX.Element;
export function FilterChips(props: { filter?: Filter | FilterClause[]; preview?; locale?; labelOf?; onFilterChange?; onAnnounce?; clearable?; className? }): JSX.Element;
export function CanvasMap(props: { scene: PreparedScene | undefined; state: DrawState; locale?; fitKey?; fitView?; describe?; onHover?; onClick?;
  onContextMenu?; onViewportChange?; descendants?; className?; children?;
  edgeBudget?: EdgeBudget | "adaptive";   // default "adaptive"
  clock?: () => number;   // ms, read by the adaptive edge budget; default performance.now; read when the map mounts
  onAnnounce?: (text: string) => void; onEdgesShown?: (shown: ShownEdges | undefined) => void }
  & { ref?: Ref<CanvasMapHandle> }): JSX.Element;
export interface CanvasMapHandle { centerOn(id, zoom?); fit(); zoomBy(factor); screenBox(id): Box | undefined; renderer(): CanvasRenderer | null;
  moved(): boolean }   // true when the view changed since the map was last fitted
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
export interface DrawState { selection: Selection; hovered?: string | null; focused?: string | null; bright?: { nodes: Set<string>; edges: Set<string> };
  highlighted?: ReadonlySet<string> }   // edges on a highlighted path, drawn under any edge budget
export interface DrawOptions { tokens?: CanvasTokens; cull?: boolean; background?: boolean | string; lodZoom?: number; createCanvas?;
  edgeBudget?: EdgeBudget | ShownEdges }   // default "all"
export function drawScene(ctx: DrawContext, scene: PreparedScene, view: View, state?: DrawState, o?: DrawOptions): { nodes; edges; shapes; culled;
  kept?: number;   // with an edge budget other than "all": the protected edges drawn, which every budget draws
  withheld?: EdgeSelection };   // present when the edge budget left edges in view out
export function drawLegend(ctx: DrawContext, scene: PreparedScene, x, y, width, tokens?, o?: { createCanvas? }): number;   // the scene's legend; returns legendLayout(scene.legend).height
export function tracePath(ctx: DrawContext, d: string): { last?; beforeLast? };
export class CanvasRenderer { constructor(canvas: HTMLCanvasElement, o?: { tokens?; devicePixelRatio?; minZoom?; maxZoom?;
    draw?: RendererDrawOptions; clock?: () => number });   // clock: ms, read by the adaptive edge budget only; default performance.now
  drawOptions: RendererDrawOptions;   // DrawOptions without tokens; edgeBudget may also be "adaptive"
  beginGesture(); endGesture();   // a pan or zoom gesture; see "Edge budget"
  resize(w, h); setScene(s); getScene(); setState(patch: Partial<DrawState>); getState(); setTokens(t);
  getViewport(); setViewport(v, notify?); fit(padding?); panBy(dx, dy); zoomBy(factor, centre?); centerOn(point, zoom?);
  toFlow(x, y); toScreen(x, y); screenBox(id); hitAt(x, y, tolerancePx?): HitItem | undefined; requestDraw(); draw(); dispose();
  onViewportChange?: (v: Viewport) => void; lastDraw?: { nodes; edges; shapes; culled; withheld?; ms };
  onDraw?: (stats: { nodes; edges; shapes; culled; withheld?; ms }) => void }   // called after every draw
export interface CanvasTokens { font; paper; surface; ink; inkMuted; line; lineStrong; focus; selection; neutral; outOfScope }
export const defaultTokens: CanvasTokens;   // from the token table (`colorTokens`, `fontTokens`)
export function readTokens(element: Element | null | undefined, overrides?: Partial<CanvasTokens>): CanvasTokens;   // from the CSS variables (`cssVariable(key)`)
export interface PngOptions { preset?: FigurePreset; width?; scale?; background?; legend?; padding?; lodZoom?; tokens?; createCanvas?; context?;
  edgeBudget?: EdgeBudget | ShownEdges }   // default every edge; see "Edge budget"
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
the edges (tints), edges with arrowheads, the marks between the edges and
the nodes (arcs), nodes with pattern twins, the marks above the nodes, edge
labels; level of detail follows
`lodAt(o.lodZoom ?? view.zoom)` and each mark is drawn from its `minZoom`;
a hovered mark shows its value colour in the focus colour; above 1,500
elements (or with `cull: true`) only the groups, marks, edges and nodes the
hit index finds inside the viewport are read and drawn, in the order of a
full draw: every item of `scene.hit` carries its element's position in
`groups`, `marks`, `edges` or `nodes` as `HitItem.index`, so a draw reads
about as many elements as the view holds, whatever the size of the scene.
An element is found when its drawn extent meets the viewport, not only its
box: `prepareScene` builds the index with the extent of everything the
drawing can put beyond an element's box, whether or not the level of detail
or the interaction state draws it at the moment. A node's extent is its box
grown by 6 (its outline is at most 3 wide, its selection ring reaches 6
outside the box and its focus rectangle 5; a gateway's diamond is as tall as
it is wide) and its texts; a group's its box grown by 1.5 (a band's line, the
dashed outline) and its title (12 in from the left, on a baseline 22 below
the top, 14 px); an overlay mark's its box grown by half its stroke or by the
reach of its arrowhead (10.8, the base of the triangle behind the path's
end) and its texts; an edge's each segment grown by half its width, at least
by the hit tolerance of 4 (which covers the arrowhead), and the segment at
the route's middle by the count label written 4 above it. A text's extent
allows 0.7 em per character (a shortened text keeps a character and the
ellipsis), 1 em above an alphabetic baseline and 0.35 em below it, 0.6 em
each way from a middle baseline, and the halo around it; a font wider than
that can still lose the last pixels of a label at the edge of a culled
view. The index rounds every bound outwards to a whole unit, so an element
whose extent ends less than a unit short of the view is read as well (and
draws nothing visible; the canvas clips it). Up to 0.3.5 the index held the boxes alone, so a node whose outline,
ring or focus rectangle reached into the view, an edge whose count label
did, a badge whose share did, a group whose title did or an arc whose
arrowhead did was not drawn while its box lay outside. Groups wholly outside
the viewport are not drawn in a culled view, like nodes and edges. A hit
index whose items lack `index` (built without `indexOf`) is drawn by
walking the lists, as before. Marks that are
not drawn on the map (map-level chips) are neither in `bounds` nor in the
hit index; the one segment of a two-point route is the route's own `points`
array. Nodes and edges are drawn from their marks (`SceneNode.mark`,
`SceneEdge.mark`, the scene's `nodeMarks` and `edgeMarks`); the other
fields of `SceneNode` and `SceneEdge` stay as data. `SceneGroup.tint` and `SceneNode.hatched` still describe the
group's tint and the node's hatching, but the group and node routines no
longer paint them: the tint and hatch marks do, once each. `CanvasRenderer` owns the
viewport (zoom clamped to `minZoom` … `maxZoom`), draws on animation
frames and follows the device pixel ratio. A renderer whose scene is
replaced keeps the ids of the edges its last draw drew, not that scene, so
that until the next draw a hit on the new scene (or none, after
`setScene(undefined)`) still leaves out the edges the last draw withheld.
`dispose()` stops drawing and lets go of the scene, the drawing context,
`onDraw` and `onViewportChange` (`lastDraw`, which holds counts and no scene,
stays readable); afterwards every method that
changes something (`resize`, `setScene`, `setState`, `setTokens`,
`setViewport`, `fit`, `panBy`, `zoomBy`, `centerOn`, `beginGesture`,
`endGesture`, `requestDraw`, `draw`) returns without an effect, and
`getScene()`, `screenBox` and `hitAt` return `undefined`. Up to this version
a cleared renderer kept the last scene it drew until it drew another, and a
disposed one kept its scene, context and callbacks while it stayed
reachable, and still resized its canvas, took a new scene and called
`onViewportChange`. `toPNG` uses the same figure
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
export interface OverlayMark { id: string; kind: OverlayKind; overlay: Overlay; box: Box; layer: "below" | "between" | "above"; inMap: boolean;
  minZoom: number; color: string; onColor: string; title: string; radius: number; path?: string; fill?: MarkFill;
  stroke?: MarkStroke; arrow?: { size: number; overhang: number }; texts: MarkText[]; gauge?: MarkGauge; edgeId?: string }
export function overlayMarks(shapes: OverlayShape[], locale?: Locale): OverlayMark[];
export function overlayColor(o: Overlay): string;           // value on the sequential palette, neutral without one
export function tintColor(o: Overlay): string | undefined;  // the same colour at TINT_OPACITY, as CSS rgba()
export function arcWidth(o: Overlay): number;               // 2 + 8 × coverage in [0, 1] (default 1, also for a coverage that is not a finite number)
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
`repositionNodes`; the overlay geometry follows the moved boxes. A box or a
route of the positions (given or moved) that holds a number that is not
finite (`NaN`, an infinity) is left out as if it were missing: the node or
group is not drawn, an edge without its route is drawn straight between its
boxes, and the bounds cover what is left. Up to 0.3.5 such numbers reached
the scene and with it the SVG, the PNG, the Canvas map and the React map.
`exportBpmn` leaves them out of its positions too and reports the elements
in `warnings` as without a position.

`marks` holds one `OverlayMark` per shape of the geometry, in the same
order, with everything needed to draw it: a rounded box (`box`, `radius`)
or a `path`, fill, stroke with width, opacity and dash, an arrowhead, the
texts with position, size, weight, anchor, baseline and halo, the layer
(tints below the edges, arcs between the edges and the nodes, everything
else above the nodes; arcs were above the nodes before, and `between` is a
new value of `layer`), the zoom from
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

## Edge budget

```ts
export type EdgeBudget = number | "all";
export interface EdgeProtection { selection?: { edges: readonly string[] }; focused?: string | null; highlighted?: ReadonlySet<string> }
export interface EdgeSelection { drawn: Set<number>; shown: number; total: number; kept: number;   // positions in scene.edgeMarks
  loops: readonly string[] }   // the paths in view that loop on one activity, counted in shown and total
export interface ShownEdges { edges: readonly string[]; total: number }   // what a map draws, as onEdgesShown reports it
export function budgetEdges(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph" | "positions">, budget: EdgeBudget | ShownEdges | undefined,
  protection?: EdgeProtection, inView?: readonly number[], loops?: readonly string[]): EdgeSelection | undefined;
```

When tens of thousands of edges are in view (a hub, or a fitted large map),
culling cannot shorten a draw. An edge budget of n draws n of the edges in
view, chosen once in the core by `budgetEdges` so that the Canvas map and
the React Flow map draw the same ones. The order is fixed: protected edges
first, then the weight descending (the metric the edge width reads,
`style.edgeWidth.metric`, `count` by default; an edge without it comes
last), then the id. A budget of n draws the first n edges of that order,
and every protected edge even beyond n, so lowering the budget only removes
edges from the end of the order and never replaces a drawn edge by another.

An edge is protected when it carries an overlay mark of the scene (a mark
that names it, `OverlayMark.edgeId`, as a loop's mark does, or an arc that
joins its source to its target in that direction), when it is selected, when the keyboard
is on it (`focused`), or when it lies on a highlighted path: the edges of the
focus of paths in effect (`mapEmphasis(...).bright.edges` while
`focusShown`, which includes the pair of activities a selection of two
names). The edges a selection of activities merely brightens are not
protected. So Alt with an arrow key can move onto a path the budget
withholds: it is drawn while the keyboard is on it, in place of the last
edge of the order while the protected edges fit in the budget (the note's
numbers stay) and beyond it otherwise (the note counts one more), and it is
withheld again once the keyboard moves on.

Protected edges have no cap, and overlay marks and edge labels are not
budgeted at all. When more protected edges are in view than the budget, all of
them are drawn and the note counts them (25 highlighted of 30 under a budget
of 10: "Showing 25 of 30 flows"); when every edge in view is protected,
nothing is withheld and no note is shown. A focus on the paths of a hub
therefore draws every path of it, whatever the budget: measured in headless
Chromium on a loaded sandbox (the renderer's draw time per frame in motion,
median of 30), a hub of 2,501 activities and 5,000 paths took 44 ms with every
path highlighted against 9.3 ms under the default budget (2,000 drawn), and a
hub of 25,001 activities and 50,000 paths 316 ms against 124 ms (500 drawn;
there the activities dominate the frame).

**Paths that loop on one activity** (an edge from a node to itself) have no
line: the map draws them as loops at their activity (`selfLoops`), and the
budget never withholds them. They count in both numbers of the note, so its
total is the number of paths the map's description, the canvas sentence, the
bounded list's sentence and the table count: with the whole map in view,
every edge of the shown graph. "Showing 5 of 10 flows" is a hub of eight
paths and two loops under a budget of 3: the three heaviest lines and both
loops. They are counted also where `selfLoops: false` hides them, since the
descriptions and the table list them too. Up to this change the note counted
only the lines (on the BPIC global scene "of 656" where the description says
677 paths).

`budgetEdges` returns undefined when the budget is `"all"`, undefined, null or
not a number (`NaN`), or when it withholds nothing (no more edges in view than the budget, or every
edge protected); otherwise the positions in `scene.edgeMarks` of the edges
drawn, how many paths are shown (`shown`: those edges and the loops), how
many are in view (`total`: the edges in view and the loops), how many of the
drawn edges are protected (`kept`), which every budget draws, and the ids of
the loops (`loops`). The edges in view are `inView` (positions in
`scene.edgeMarks`), or every edge of the scene without it; the loops in view
are `loops`, or every edge of the scene from a node with a box to itself
without it. The order by weight is computed once per scene and
kept with its `edgeMarks` while they live, together with the metric and the
overlay marks it was read from: a scene object that shares the edge marks but
has other `marks` or another `style` is ordered and protected by its own.
Computing it ranks every edge of the scene, not only those in view, so the
first call that withholds edges (on the Canvas map, the first frame with more
edges in view than the budget) costs more than the ones after it, which read
only the edges in view. Measured in Node 24 on a shared sandbox with 5,000
edges in view, median of 5: 23 ms for a scene of 50,000 edges, 87 ms for
200,000 and 471 ms for 1,001,000; every later call took 1.4 ms or less.

`<ProcessMap edgeBudget/>` applies it in both renderers (default
`"adaptive"`, below). The React Flow map has every edge of the
scene in view and passes only the drawn ones to React Flow. The Canvas map
(`drawScene` with `DrawOptions.edgeBudget`, `CanvasRenderer` through its
`draw` options, `<CanvasMap edgeBudget/>`) counts as in view what it would
draw: in a culled view the edges the hit index finds there and the loops of
the activities it finds there, otherwise every edge; withheld edges are drawn neither as lines nor with their labels, and
`CanvasRenderer.hitAt` does not return an edge its last draw withheld. While
edges are withheld the map shows a note with both numbers, "Showing 2,000 of
49,999 flows" (`map.edges.withheld`, English and German), as text at the
bottom centre of the map (`role="note"`), and the polite live region
announces it once its numbers have stayed the same for 400 ms, so a view
in motion does not flood it. The table view always lists every edge.

### Adaptive budget

`edgeBudget` of `<ProcessMap/>`, `<CanvasMap/>` and `<ViewSwitcher/>` also
takes `"adaptive"`, the default; a number or `"all"` is a fixed budget, as
above, and turns adaptation off entirely: no frame is timed and no clock is
read. The adaptive budget is a step of 500, 1,000, 2,000, 4,000 and so on,
each double the one before; it starts at 2,000. Protected edges are drawn
at every step, and the note always shows the numbers of the last frame.

On the Canvas map it aims at 16.7 ms per frame while the view moves. The
frames drawn during a pan or zoom gesture (a drag, or a run of wheel or
pinch events that ends 200 ms after the last) are timed, and the budget
changes only when the view is at rest: as the gesture ends it moves at most
one step, down after 5 consecutive frames above 16.7 ms that drew more edges
than the step below would, up after 5 consecutive frames below 8.35 ms
(half the target: the next step doubles the edges) that withheld edges. A
single slow frame changes nothing, a step that would draw the same edges is
not taken, and once a step covers every edge in view it does not grow
further, so it reaches "all" for the view without overshooting it. The
frame at rest is then drawn in full with the new budget, at once, without
any transition, also when reduced motion is asked for. Because the order is
stable, a smaller step only removes the weakest unprotected edges. Frames
drawn while the view is at rest (a hover, a selection) are not timed.

The step below draws the protected edges and then up to half the budget, so a
slow frame counts only when it drew more edges than both: each draw says how
many of its edges are protected (`kept` in the statistics of `drawScene`).
With 2,500 protected paths of 5,000 in view (a selection or a focus of paths
that large) every step draws the same 2,500, so slow frames leave the budget
at 2,000; so do 1,500 edges in view that are all protected. Up to this change
a slow frame counted whenever it drew more than half the budget: such a view
stepped from 2,000 to 1,000 and 500, and once the selection was cleared the
map drew 500 paths until fast gestures brought the budget back.

The React Flow map moves its elements with a transform and has no frame of
its own to time; there `"adaptive"` keeps its first step, 2,000 edges, which
below the Canvas threshold (2,000 activities plus paths) never withholds
an edge. A map React Flow draws above it (`renderer="svg"`, or a higher
`canvasThreshold`) withholds the edges beyond 2,000 by default.

`CanvasRenderer` adapts when its `drawOptions.edgeBudget` is `"adaptive"`
and its host reports gestures with `beginGesture()` and `endGesture()`
(overlapping gestures count until the last one ends, and every gesture is
counted whatever the budget is, so a gesture that began on a fixed budget
and ends after the host turned it adaptive cannot move the budget while
another gesture is still under way); `<CanvasMap/>` does
this for its drag and wheel. The clock is injected (`clock`, in ms, default
`performance.now`), so tests drive it with a fake one. `drawScene` and
`budgetEdges` draw one frame and take a number, `"all"` or a `ShownEdges`, never `"adaptive"`.
`lastDraw.ms` is measured as before and is not the adaptation's clock.

Stories, tests of the Canvas map and the browser and visual lanes use a
fixed budget so that they draw the same edges on every machine: the stories
take their maps from `stories/maps.tsx`, which passes `"all"`, and
`check:architecture` refuses a story that takes a map from the library or
asks for `"adaptive"`.

Given a `ShownEdges` instead of a number, `budgetEdges` draws exactly the
edges it names (of those in view) and states its `total`; it withholds
nothing when it names every edge in view.

### Exporting what the map shows

`<ProcessMap onEdgesShown/>` (and `<CanvasMap onEdgesShown/>`) is called
whenever the edges the map draws change: while the budget withholds edges,
with their ids (`edges`: the edges drawn in the scene's order, then the paths
that loop on one activity in view) and the number the map's note counts
(`total`); with undefined once every edge is drawn again. It is not
called while nothing was ever withheld; a host that starts listening while
edges are withheld is told them at once. A culled Canvas map counts the edges
in its view, so a pan can change the value. When `<ProcessMap/>` switches
renderer (`renderer="auto"` crossing its threshold), and when it draws the
Canvas map again after the table view, it is called with undefined and then
with what the map then withholds, if anything.

`toSVG`, `toPNG`, `toPNGCanvas` and `toPNGDataUrl` take `edgeBudget`:

- the last `ShownEdges` the map reported: the figure draws exactly those
  edges (with their labels), and the note states the map's two numbers (the
  loops it names count as shown);
- a number: the figure draws by the map's order, protecting the edges with
  an overlay mark on them (a figure has no selection, keyboard position or
  highlighted path), and counts every edge of the figure;
- `"all"`, or no value (also undefined, which `onEdgesShown` reports while
  every edge is drawn): every edge and no note, the same output as before
  this option existed.

While edges are withheld the note is part of the figure as text: "Showing 3
of 8 flows" (`map.edges.withheld` in the scene's `locale`, English and
German) at 11 px in the ink colour under the map and the legend, inside the
figure's frame (see `figureFrame`); in SVG it is a `<text
class="wf-edge-note">`. The figure keeps every node, group and overlay.

## BPMN routing and navigation (0.3.4)

Band layouts route every sequence flow on an orthogonal visibility grid after
placing the nodes. Shape interiors are obstacles; shared tracks and crossings
carry a routing cost. Return connections remain present. This is a readable
heuristic, not an optimal or crossing-free graph layout. Crossing lines do not
create a junction. Row gaps default to 56 units and lane padding to 48 units.
Overlapping or otherwise unroutable supplied geometry raises a descriptive
error instead of silently drawing a connection through a task. A box with a
number that is not finite is left out of the routing as if it were missing,
so its edges get no route; up to 0.3.5 such a box could keep the search
going until its route outgrew an array (a `RangeError` after seconds). A
connection that no route can reach (its target walled in by overlapping
boxes) gets its fallback at once; up to 0.3.5 the search for it went over the
whole grid many times, which took seconds for a few dozen overlapping boxes.

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

`repositionNodes` keeps supplied edge identities, directions and metrics unchanged; an edge without an id is routed like any other (up to 0.3.5 it threw a `TypeError`). It routes around all visible boxes, including a moved box obstructing an unrelated edge; self loops remain node-anchored overlays. During an overlapping drag, an unroutable edge falls back to a clipped direct route rather than throwing. Positions and routes are immutable, and bounds include the rerouted edges. Manual placement is local to the mounted map unless the host persists it.

Custom child controls should import `useReactFlow`, `useNodesInitialized` and `useStore` from `@wise/flow/react`, so they share the renderer's context even when a host resolves different Node/browser entry points of React Flow.

## Deprecated names

No name is deprecated at present. A name that is marked `@deprecated` in the
source is listed here, with the entry point as a `###` heading and a table of
name and replacement. A tooling test (`tests/tooling/deprecations.test.mjs`)
checks that every `@deprecated` name in the source is listed here with a
replacement, and that every listed name is deprecated.

`scripts/core-exports.json` holds the names of the `.` entry point and the
deprecated ones; a tooling test compares the built `index.d.ts` with it. Outside
the core, the package imports a name the entry point provides from the entry
point.

## Removed in the next version

These names were deprecated on the way to this release and are gone. 0.3.5
exported all of them except three types added since (`PatternShape`,
`FollowsSelfLoopOptions`, `NodeMarkOptions`) and marked none deprecated, so a
host moving from 0.3.5 meets them removed. The one consumer uses none of
them. Each row names what to use instead.

### `@wise/flow`

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
