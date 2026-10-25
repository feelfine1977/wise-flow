# Public API (0.3)

The contract the 0.3 release implements: the 0.1 and 0.2 surface unchanged,
the interaction model (selection, actions menu, paths, filters, lanes) and
the Canvas renderer with `toPNG` added. Changes against the earlier draft
and between the milestones are listed at the end. Types are exported from
`wise-flow`, components from `wise-flow/react`, the BPMN bridge from
`wise-flow/bpmn`, the Canvas renderer from `wise-flow/canvas`.

## Model (`#/components/schemas/FlowGraph` of the workbench API)

```ts
export type NodeKind = "activity" | "stage" | "gateway" | "event" | "note";
export type EdgeKind = "follows" | "constraint" | "flow";
export type GroupKind = "lane" | "stage" | "pool";
export type OverlayKind = "badge" | "arc" | "hatch" | "tint" | "chip" | "selfLoop";

export interface FlowNode { id: string; kind: NodeKind; label: string; group?: string;
  metrics?: Record<string, number>; metricBasis?: Partial<Record<string, MetricBasis>>; tags?: string[]; }
export interface FlowEdge { id: string; kind: EdgeKind; source: string; target: string;
  metrics?: Record<string, number>; metricBasis?: Partial<Record<string, MetricBasis>>; tags?: string[]; payload?: unknown; }
export type MetricBasis = "atLeast" | "mean";   // a lower bound, or a mean of merged values; exact without an entry
export interface FlowGroup { id: string; kind: GroupKind; label: string; parent?: string; }
export interface Overlay { kind: OverlayKind; target: string; payload?: OverlayPayload;
  protected?: boolean; }   // a deviation that stays visible at every level of detail (see Aggregation)
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[]; groups?: FlowGroup[];
  overlays?: Overlay[]; meta?: FlowMeta; focus?: string; paths?: FlowPaths; }   // focus, paths: 0.3
export interface FlowMeta { abstraction?: number | AbstractionMeta; model?: ModelOutline; shown?: ShownMeta; [key: string]: unknown }
export interface ModelOutline { activities?: number; paths?: number; groups?: string[];   // the model before abstraction
  pathMax?: Record<string, number> }   // the largest value of each metric over its paths: the upper end of the path width's scale
export interface AbstractionMeta { minEdgeShare?: number; minNodeShare?: number; keepConnected?: boolean;
  activityDetail?: number; pathDetail?: number; collapse?: string[] | "all";
  removedEdges?: { constraint?: number; flow?: number } }   // edges removed with an element at an end; see "Aggregation"
export interface ShownMeta {                     // what `abstract` shows of the graph it abstracted
  activities: { shown: number; of: number };     // activities and stages
  paths: { shown: number; of: number };          // follows and flow edges, self-loops included; indirect paths apart
  anchorsOnly?: number;                          // detail shares: paths shown only as anchors (tagged `anchor`)
  keeps?: Record<string, string[]>;              // detail shares: per anchor-only path, the activities it keeps on a way
  indirect?: number;                             // detail shares: indirect paths (tagged `indirect`)
  byFrequency?: number;                          // detail shares: paths shown by frequency (within the paths share)
  weakestByFrequency?: number;                   // detail shares: the count of the weakest path shown by frequency
  weakestShown?: number;                         // detail shares: the count of the weakest path shown, kept ones included
  strongestNotShown?: number;                    // the count of the strongest path not shown
  withoutPath?: number;                          // thresholds without keepConnected: shown activities with no path
  events?: { shown: number; of: number };        // events of the shown activities, of all; where the graph counts them
  positions: DetailPositions;                    // where the detail sliders stand, for shares and thresholds alike
  marksNotShown: string[];                       // marks whose element is not shown, by id
  forProtected: string[];                        // activities and paths shown only because a protected mark sits on them
}
export interface DetailPositions {
  activities: number[];                          // the numbers of activities a share can show: the end of every tie, ascending
  paths: number;                                 // the measured paths: the paths share shows 0 to this many by frequency
  at: { activities: number; paths: number };     // where the shares (or the thresholds, as what they pass) stand
}

export const MAP_TARGET = "__map";      // overlay target for map-level chips
export function hasTag(el: { tags?: string[] } | undefined, tag: string): boolean;   // the element carries the tag
export function normalizeGraph(g: FlowGraph): FlowGraph;   // shallow copy with sorted, de-duplicated element arrays
export function validateGraph(g: FlowGraph): GraphIssue[];
export class InvalidGraphError extends Error {   // name "InvalidGraphError"; thrown by the exports for a reserved id
  readonly issues: GraphIssue[];                 // what validateGraph reports for the reserved ids
}
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
`abstract` also records `meta.model`, the model before any abstraction (kept
from an earlier one): its activities (a collapsed stage's members
included), its paths (follows edges between two different nodes; left out
when the graph is already collapsed, whose merged paths are not the model's)
and its groups' ids in order. A figure's caption reports how
much of it is shown, and categorical colours follow its group order, so a
filtered graph keeps its stages' colours. A host may set it itself.

`metricBasis` says which of an element's metrics are not exact: `atLeast`, a
lower bound, and `mean`, a mean of merged values. `collapseGroups` sets it
(see "Aggregation"); a host may set it for its own approximations. Every
renderer, the descriptions, the table and the exports read it: a lower bound
reads "at least 211,379" ("mindestens"), a mean of medians is named "lag, mean
of medians" and is never written as a median.

`validateGraph` is structural. It reports as errors duplicate node, edge and
group ids, an edge whose source or target names no node, a group parent that
names no group, and a cycle of group parents: every group whose chain of
parents returns to it (two groups inside each other, a group that is its own
parent) is reported once, as `group parent cycle`; a group that only lies
inside such a cycle is not. It reports as warnings a node group that names no
group and an overlay whose target names no node, edge or group. Up to 0.3.5 a
cycle of group parents passed validation; `collapseGroups(g, "all")` then
collapsed nothing and `layout` rejected with the engine's plain error.

Ids are opaque, but an id must not name a member of `Object.prototype`
(`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, …):
positions and many records of the library are plain objects keyed by id,
which cannot hold `__proto__` as their own key and find the prototype's
member under `constructor` where nothing was stored. `validateGraph` reports
such an id of a node, an edge or a group as an error, `reserved id`. The
exports refuse a graph with one: `toSVG`, `toPNGCanvas`, `toPNGDataUrl`
throw, and `toPNG` and `exportBpmn` reject, with `InvalidGraphError`, whose
`issues` are those errors and whose message names them ("reserved id:
__proto__"). Up to 0.3.5 validation passed such ids, `toSVG` threw a
`TypeError` on a node or group named so, every export on an edge named so,
and the BPMN round trip lost the node. Other functions do not check: given
such an id they may fail or drop the element.

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
warnings. The check looks at parallel gateways only. It does not report a
node other than a gateway with several outgoing flows and no gateway (BPMN
takes them all, as a parallel split), a loop without an exit, or a node that
no flow reaches; the models `liteFromGraph` and `liteFromStages` generate
never have these, while a file from another tool can. It is cautious the
other way: a sound model whose parallel branches are not nested as blocks (a
three-way split with one branch ending on its own, two splits feeding one
join, blocks that cross) completes every case but is reported too.

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
(`laneBands`), `collapseGroups` folds them into the outermost collapsed
stage, and the map's description of a group counts them: a pool whose
activities sit in its lanes reads "Pool, pool. 12 activities." (up to 0.3.5
it counted direct members only, "0 activities"). For a group without nested
groups this is the same as its direct members.

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

These helpers export the map text counter-scaling policy through `wise-flow`.
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
  activityDetail?: number;      // share of activities shown by rank, 0 to 1 (1: all); wins over the thresholds
  pathDetail?: number;          // share of paths shown by frequency, 0 to 1 (1: all between shown activities)
  minEdgeShare?: number;        // follows edges below this relative strength are removed
  minNodeShare?: number;        // activities and stages below this relative strength are removed
  keepConnected?: boolean;      // default true
  keepEmptyStages?: boolean;    // (0.6) keep top-level stage groups with no member left, for `laneOptions.emptyLanes`; default false (dropped, as before)
  collapse?: string[] | "all" | false;   // stage groups → one stage node each
  edgeMetric?: string;          // default count, then cases, then share
  nodeMetric?: string;          // default cases, then events, then share
  relativeTo?: "max" | "total"; // strength relative to the maximum (default) or the sum
  keep?: string[];              // node ids, and path ids with both ends, never removed
  marks?: Overlay[];            // marks drawn beside the graph, read with its own
}
export const ANCHOR_TAG = "anchor";       // a path shown only to keep an activity on a way from start to end
export const INDIRECT_TAG = "indirect";   // a path that stands for a way through activities not shown
export function abstract(g: FlowGraph, o?: AbstractOptions): FlowGraph;
export function collapseGroups(g: FlowGraph, groups: string[] | "all"): FlowGraph;
export function isConnected(g: FlowGraph): boolean;
export function diff(a: FlowGraph, b: FlowGraph, o?: { metrics?: string[] }): FlowGraph;
export function strengths<T extends { id: string; metrics?: Metrics }>(items: T[], candidates: string[],
  relativeTo?: "max" | "total"): Map<string, number>;   // in [0, 1], from the first of `candidates` an element has; 1 without one
export const RECONNECTED_TAG = "reconnected";   // the tag of elements `abstract` re-added
export const COLLAPSED_TAG = "collapsed";       // the tag of the stage nodes `collapseGroups` makes
export const DIFF_TAGS: { onlyA: "only-a"; onlyB: "only-b"; both: "both" };   // the tags `diff` puts on elements
```

Guarantees of `abstract`: events, gateways and the ids in `keep` are never
removed, nor the elements of a protected mark (below), with thresholds as
well as at every pair of detail shares. A constraint or flow edge is removed
only with an activity or stage at one of its ends (an edge to an element
that is not on the map cannot be drawn); by detail shares a flow edge
between shown activities is shown, as a path no metric measured is (see
"Detail shares"). `meta.abstraction.removedEdges` counts the edges removed
with an element at an end by kind (`{ constraint, flow }`, its keys in sorted
order whatever the input order, absent while none went; abstracting an
abstracted graph adds to the count it carries; up to 0.3.5 the keys followed
the input order). By detail shares a flow edge is a path, so one removed with
an element at an end is counted once, among the paths not shown
(`meta.shown.paths`, "61 of 677 paths"), and not in `removedEdges`; up to
0.3.5 it was counted in both. With
thresholds and `keepConnected` an activity re-added to keep the map
connected brings back its constraint and flow edges to elements on the map,
tagged `reconnected` like everything re-added. Collapsing a stage drops the
edges between its members, of every kind; its `internalCount` counts the
follows edges among them, by their `count`, else their `cases`, and nothing
for an edge with neither. Up to 0.3.5 every such edge counted: a constraint
edge, a flow edge or a follows edge without a `count` as one transition each;
the documentation said constraint and flow edges were never removed, nothing
counted the ones that went, and a re-added activity came back without them.
With thresholds the thresholded part is monotone (a higher threshold yields a
subset); with `keepConnected` the result is one connected component whenever
the input is, restored by a maximum spanning forest over the strongest
direct edges, then by the cheapest paths through removed nodes, then by one
edge per activity that lost all incoming or all outgoing paths; re-added
elements are tagged `reconnected`. Keep connected joins only the main part
of the input: the paths through removed nodes start from the heaviest kept
component, so in another part of the input kept activities are joined only
by direct edges between them (`x – r – y` beside a heavier `m – n` keeps
`x` and `y` apart when `r` goes). It restores flow context only from
activities still on the map: an activity whose incoming paths all came from
removed activities gets no incoming path, so the map stays in one piece while
no path from the start reaches it (`a1 → a3 → a4` with `a3` removed leaves
`a4` without an incoming path). The detail shares keep every shown activity
on a way from a start to an end instead ("Detail shares", below). Of equally cheap
reconnecting paths the one chosen depends on ids only, not on the input
order ([Architecture §2.2](ARCHITECTURE.md#22-aggregation)), and a strength
relative to the total divides by a sum taken in ascending order, which no
input order changes. A collapsed group becomes a `stage` node with the
group's id; counts are summed, `cases` and `share` are maxima, other metrics
weighted means over the members that carry them (plain means where none has
a weight; summed in id order, so that no input order changes them), internal
transitions land in `internalCount` (summed in ascending order). A stage's
`cases` is therefore a lower bound of the cases that touch it. A threshold
does not compare a stage by that bound, which may be too low: the stage
records an upper bound in `meta.collapsedCasesAtMost` (by stage id), the sum
of its activities' `cases` (an inner collapsed stage's bound in place of its
own), at most all cases of the graph (`meta.cases`) and at least its own
`cases`, and its strength is that bound against the same maximum or total
as every other activity's. Detail shares rank a stage by its own `cases`. A
stage of four activities with 25 cases each, which up to 100 cases touch,
reads 100 of 100 beside an activity of 100 cases and stays at 50 %; it still
prints "at least 25". Up to 0.3.5 it read 25 and went, with or without
`keepConnected`. Its `events` add up, so with `nodeMetric: "events"` the
stage is compared by its summed events. Edges of one kind between the same two shown
nodes, one of them a collapsed stage, merge into one, named `source->target`,
or `source->target:kind:n` where that id is taken; merged edges take their
names in the order of their smallest original id, not of the input. Parallel
paths merged into one are combined the same way. Edges between two nodes
outside every collapsed stage stay as they are, with their ids, metrics,
tags and payloads; up to 0.3.5 they merged too, and two constraint edges
between the same two activities lost their payloads. The graph holds no
case sets, so the cases of a stage (or of a merged path) cannot be computed
exactly: two activities of one
stage that one case each touches give the stage at least one case and at
most two. The values are not changed; the result says what they are in
`metricBasis` (by metric name, in the order of the names): of more than one
merged element, `cases` and `share` are `atLeast` and every averaged metric
(a median, a percentile, a shortfall share) is `mean`; summed counts
(`events`, `count`, `starts`, `ends`, `internalCount`) are exact and have no
entry. So stage Invoice of the whole-log fixture prints "at least 211,379"
cases, where the true number lies between 211,379 and 251,734, on its card,
in its description and tooltip, in the table and in both exports; a merged
path's averaged median is left out of its label and named "lag, mean of
medians" in its description and "(mean of medians)" in the table. A graph
whose nodes are stages with their own numbers carries no basis: its numbers
print as exact.

`diff(a, b)` (baseline `a`, slice `b`) carries `b`'s metrics under their own
names, `a`'s under `a_<metric>` and `b − a` under `delta_<metric>`; elements
on one side only are tagged `only-a` / `only-b`, shared ones `both`.

### Detail shares

`activityDetail` and `pathDetail` select what a map shows by detail: 1 and 1
show every activity and every path between shown activities with their
counts; a lower share shows less, and every pair of shares is valid. Given
either of them, the selection is by detail: `minNodeShare`, `minEdgeShare`
and `keepConnected` are not read, and the share left out is 1. Thresholds
work as before for a host that passes only them: on a graph that is not a
comparison, has no protected mark and no path id in `keep`, the same nodes,
edges, groups and overlays, with `meta.shown` added.

- **Activities** are ranked by cases, then events, then id (`nodeMetric`
  replaces cases). A share `p` shows the `p` most frequent share by rank,
  rounded up and at least one; activities with equal cases and events enter
  together, so a position never cuts inside a tie. Events and gateways are
  always shown, and so is an activity no metric measured (a note too); it
  does not count in the share.
- **Paths** are ranked once over the whole graph by count, then id
  (`edgeMetric` replaces count). A path whose rank lies within the share
  `pathDetail` is shown when both its ends are; its rank is its place in the
  whole graph, so a path does not disappear when more activities are shown.
  Self-loops enter through the paths share only, ranked by their count also
  when it passes every other path's. A path no metric measured, and a flow
  edge (which no threshold removes while both its ends are shown), is shown
  whenever both its ends are and does not count in the share. Constraint
  edges are shown between shown nodes.
- **The guarantee.** At every pair of shares every shown activity lies on a
  directed way from a start event to an end event that uses shown paths only.
  Each activity has two **anchors**, chosen once per graph: its strongest
  path from a more frequent node or from a start, and its strongest path to
  a more frequent node or to an end (ties by id; events and gateways count
  as more frequent than every activity, and among themselves by id; a
  self-loop is never an anchor). Only a node that a start reaches counts for
  the way in, and only one that reaches an end for the way out: an event
  that ends no way, or a more frequent activity no start reaches, anchors
  nothing. An activity without such a path is
  anchored by the way through less frequent activities whose rarest activity
  is the most frequent possible (then the fewest steps, then the smallest
  path ids from the activity on). A shown activity keeps its anchoring ways; where an anchoring node is
  not shown (only when the activity is shown for a protected mark or
  `keep`), its own anchoring ways follow, up to the first shown node. A path
  on these ways between two shown nodes is shown, tagged `anchor` when it is
  not within the paths share (`meta.shown.keeps` names the activities it
  keeps); it is an ordinary observed path with its own count, not a
  re-added one.
- **Indirect paths.** Where such a way passes activities that are not shown,
  the stretch between two shown nodes becomes one `follows` edge tagged
  `indirect`, with the hidden activities in `payload`
  (`{ hiddenActivities: n, via: [ids] }`) and without metrics: the only
  element drawn that is not a path of the graph. Its id is
  the way it stands for, `<source>-><hidden>->…-><target>:indirect`, so one
  stretch is one indirect path and an indirect path that stays as a share
  moves stands for the same way. The activities it passes stay hidden.
  The whole-log fixture has none at any share.
- **Monotony.** Within one state of the stage collapse, moving either share
  towards more detail never removes an element, with one exception: an
  indirect path is replaced by the paths it stood for (or a shorter indirect
  one) when its activities come into view.
- **Stages** are collapsed first, then ranked and anchored.
- `keep` holds node ids, and path ids that stay with both their ends (a
  selected or focused path, a highlighted route).

**Protected marks.** A mark with `protected: true` keeps the element it sits
on at every pair of shares and with thresholds: an activity (which then
gets its anchors, so the guarantee holds), a path with both its ends, both
activities of an arc. With stages collapsed it moves to the stage that holds
its element and is never dropped. A mark that is not protected follows its
element. `abstract` reads the graph's `overlays` and the `marks` given
beside it; `<ProcessMap/>` hands it its `overlays` prop with the graph's,
`buildViews` the marks of its views (and, with `collapse`, gives each view
its marks moved to their stages), `liteFromGraph` the graph's. The result's
`overlays` are the graph's own: a host that draws marks given in `marks` on
a collapsed graph moves them with `collapseGroups` (or passes them inside
the graph, whose marks the result carries on their stages). A mark
the rule is not given cannot be protected. Which deviations are protected is
the host's choice.

**What is shown** is recorded in `meta.shown` (`ShownMeta`): activities and
paths shown of all, and for detail shares how many shown paths are anchors
only and which activities each keeps, how many are indirect, the count of
the weakest path shown by frequency and of the strongest path not shown;
with thresholds and without `keepConnected`, how many shown activities have
no path. `marksNotShown` names the marks whose element is not shown, by
`<kind>:<target>:<n>`, `n` being the mark's place among the marks given
(the graph's, then `marks`) in canonical order (`canonicalOverlays`);
`forProtected` lists the activities and paths shown only because a
protected mark sits on them. `meta.abstraction` records the shares
(`activityDetail`, `pathDetail`) instead of the thresholds.

`meta.shown` also says how many paths are shown by frequency
(`byFrequency`), the count of the weakest path shown with the kept ones
(`weakestShown`), the events of the shown activities of all (`events`, where
the activities count events; not for a comparison, whose two sides are not
added up) and where the two detail sliders stand (`positions`, for shares
and thresholds alike): the activity slider's positions are the numbers of
activities a share can show (the end of every tie of cases and events), the
paths slider's 0 to `positions.paths`, and `positions.at` is where the
shares stand, or, for thresholds, how many activities and paths by
frequency they pass. The share `at.activities / activities.at(-1)` with
`at.paths / paths` shows the same activities and paths by frequency;
thresholds add the re-added elements of `keepConnected`, the shares the
anchors.

### What the detail shares show, in words

```ts
export function detailStatement(graph: FlowGraph, options?: DetailStatementOptions): DetailStatement | undefined;
export interface DetailStatementOptions { locale?: Locale;
  marks?: readonly Overlay[];          // the marks the abstraction was given, in order: names the marks not shown
  labelOf?: (id: string) => string }   // also for elements not shown; default the id
export interface StatementLine { short: string; full: string }
export interface DetailStatement {
  activities: StatementLine;           // "25 of 42 · 99.2 % of events"
  paths: StatementLine & { parts: string[]; keptPart?: string };   // "61 of 677 · 30 kept"
  marks?: StatementLine & { items: string[] };   // "3 marks not shown"; absent when none is hidden
  protected?: StatementLine;           // "2 shown for a protected deviation"; absent when none is
  kept: string[] }                     // the ids of the paths kept only so that an activity lies on a way from start to end
export function detailNotes(base: FlowGraph, shown: FlowGraph, options?: { locale?: Locale; labelOf?: (id: string) => string }): Map<string, string>;
```

`detailStatement` reads `meta.shown` of a graph `abstract` returned
(undefined for another) and says what is shown, in a short form for beside
a slider and a full form for its title and assistive technology:

- Activities: "25 of 42 · 99.2 % of events"; in full "25 of 42 activities
  shown, carrying 99.2 % of the events; the 17 rarest are not shown."
  ("; 17 others are not shown" where an activity is shown out of its rank:
  for a protected deviation, kept by the host or re-added). The
  share of events (one decimal, never "100.0 %" for a part, nor "0.0 %" for
  some) is printed only where the graph counts events.
- Paths: "61 of 677 · 30 kept"; in full "61 of 677 paths: 31 by frequency,
  30 kept so that every activity lies on a way from start to end. Strongest
  path not shown: 20,000." Where the strongest path not shown is stronger
  than the weakest shown (a kept path can be weaker than one not shown),
  the short form adds "strongest not shown: 20,000". Indirect paths are
  counted apart in the full form ("1 dashed path stands for a way through
  activities not shown."). For thresholds the paths are counted alone
  ("38 of 677 paths shown.").
- Marks not shown (`marksNotShown`): "3 marks not shown"; in full what they
  are, a hatch "outside scope" and another mark the label of its constraint,
  the most frequent first ("3 marks not shown: 2 outside scope, 1 order of
  goods and invoice."), and one item per mark. Without the marks given the full form counts them only.
- Elements shown for a protected deviation (`forProtected`): "2 shown for a
  protected deviation", in full with their names.

`detailNotes` gives what the tooltip of a shown element adds, by id: an
activity "Passages on paths not shown: 1,234 in, 567 out." (so that what is
drawn and what is not add up to its count), a kept path "Keeps Change Price
on a way from start to end.", an indirect path "Stands for a way through
activities not shown: …", an element shown for a protected deviation
"Shown for a protected deviation." `<ProcessMap/>` adds them to the
descriptions of its elements (their tooltips and their assistive text).
An export's caption (`figureCaption`) of a graph abstracted by detail
shares carries the full statements instead of "16 of 42 activities, 38 of
677 paths shown".

**Drawing.** A kept path is an ordinary observed path: solid, with its
count and the width its count gives. An indirect path is drawn dashed (the
dash of what is not directly observed), in the line colour at the thinnest
width, labelled "via 2 activities not shown" ("über 2 nicht gezeigte
Aktivitäten") and without a number; it is neither a re-added path nor one
not evaluated (`EdgeMark.indirect`), and the legend has a key for it,
"Path through activities not shown". All four renderers draw it from the
scene.

**Comparisons.** In a graph made by `diff` (`meta.diff`), the strength and
the rank of an element are the larger of its relative strength on side b
(its own metrics) and on side a (`a_<metric>`), each relative to the
strongest element of its side; an element neither side measured has
strength 1. This holds for the detail shares and for thresholds: before,
an element with side a's metrics only had strength 1 and no threshold
removed it, so `diff(globalScene, vendorScene)` at thresholds of 100 % kept
31 activities and 282 paths; it now keeps 1 activity and 1 path (2 paths with
`keepConnected`). For graphs that are not comparisons an element nobody
measured is never removed.

## Layout

ELK puts all events tagged `start` in the first layer and all tagged `end`
in the last layer, in every reading direction. This includes disconnected
events. They sit outside stage groups, before the first stage and after
the last, with `orderStages` on or off. Without border events, layout is unchanged.

With `stages: "partition"` (0.5) stages constrain the layout instead of
wrapping it: ELK lays the graph out without compound nodes, every activity
in the partition of its top-level stage in stage order (activities without a
stage after the last, the start event before every partition, the end event
after), so an activity keeps its stage's columns whatever the cohort. A path
from a later stage back to an earlier one is laid out reversed, so the cycle
breaker keeps the stages' order, and its route is read back the way it runs.
The stages' boxes (`Positions.groups`) are drawn around their members with
`GROUP_PADDING`; they do not overlap along the flow. Dagre lays the graph out
without groups and draws the boxes the same way. The default stays
`compound`.

`FlowSceneOptions.stageView` and `ProcessMapProps.stageView` (0.5) choose how
the stages are drawn on one layout: `bands` across the map (as `lanes:
"stages"`), `lanes` (the same bands until lanes get headers of their own),
`boxes` around their members (the default), or `none`, where the scene has no
group marks and the cards are placed on their own. No view moves a card; a
`lanes` given wins. The scene carries the view as `FlowScene.stageView`.

`laneOptions` (0.5, on `FlowSceneOptions`, `ProcessMapProps` and the export
`Scene`) sets the bands' `padding`, header space (`labelSpace`) and `gap`
(`LaneOptions`), and: `emptyLanes` — a stage none of whose activities is in
the graph is left out (`hide`, the default, as before), drawn as a 12 px
labelled divider on the boundary between its neighbours in the stages' order
(`divider`) or as a 36 px lane there (`lane`), untinted, without moving a card
(`LaneBand.empty`; after `abstract()` such a stage is only there with
`AbstractOptions.keepEmptyStages`, 0.6, which sets `metrics.hiddenActivities` on a stage whose activities the detail left out; its divider then reads "2 activities not shown at this detail", `lane.hiddenByDetail`); `counts` — a band's header says "5 of 15 activities" at
its right where the group's metrics give its `activities`, "5 activities"
("1 activity") otherwise ("1 of 1 activity" for a stage of one, `lane.countOfOne`), and a divider "none in this cohort" (`lane.count`,
`lane.countShown`, `lane.none`; part `group-header`); `sticky` — on the map a
stage band's name moves along the band to stay at the view's left edge while
any part of the band is in view; exports print it once at the band's start.
The scene carries the options as `FlowScene.laneOptions`.
Dagre keeps its source/sink placement; it pins neither border layers nor stage
order. Start can still sit in the middle when its target has other incoming
paths. Provisional layouts are also unpinned. Host `positions` win;
`layoutUnion` still shares one union layout across scenes.

```ts
export interface Box { x: number; y: number; width: number; height: number }
export interface EdgeRoute { points: { x: number; y: number }[]; labelX?: number; labelY?: number }
export interface Positions {
  nodes: Record<string, Box>; groups: Record<string, Box>; edges: Record<string, EdgeRoute>;
  bounds: Box; engine: "elk" | "dagre" | "di" | "given" | "provisional"; direction: "RIGHT" | "DOWN" | "LEFT" | "UP";
  final?: boolean;   // no layout replaces them: the provisional arrangement useStableLayout keeps when the layout is unavailable
}
export interface LayoutOptions {
  engine?: "elk" | "dagre" | "auto";   // auto (default): ELK, Dagre on failure or timeout
  direction?: LayoutDirection; nodeSize?: NodeSize | ((n: FlowNode) => NodeSize);
  spacing?: { node?: number; layer?: number; group?: number };
  edgeRouting?: "ORTHOGONAL" | "POLYLINE" | "SPLINES";
  groups?: "compound" | "ignore"; orderStages?: boolean;
  stages?: "compound" | "partition";   // 0.5: stages as ELK partitions without compounds (see below)
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
export function defaultNodeSize(n: FlowNode): NodeSize;   // the box of the node's kind in the token table (`DEFAULT_SIZES`)
export function straightRoute(a: Box, b: Box): EdgeRoute;   // between the boxes' centres, clipped to their borders
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
border event tags, groups and resolved sizes (by value), edge
ids and endpoints, the groups' ids, kinds, labels and parents, and every other
option (an `elk` instance by identity). A changed graph or changed options are
laid out anew; the last `maxEntries` layouts are kept. `maxEntries` bounds
the finished layouts a scope keeps, not the layouts running: a scope runs the
layout of its latest request only (see Stopping). `dispose()` forgets the
scope's layouts and stops waiting for its latest request; the scope stays
usable. Caller keys inside a scope go to the
shared cache as above. `clearLayoutCache()` without a key forgets every cached
layout, every scope's included.

Workers. With `elkWorkerUrl` (the URL of `wise-flow/elk-worker.min.js` or
`elkjs/lib/elk-worker.min.js` as served) ELK runs in a Web Worker; with
`dagreWorkerUrl` (the URL of `wise-flow/dagre-worker.min.js`, Dagre and the
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
once and the layout timed out before the engine answered.

**Without a worker, ELK cannot be interrupted.** Pass `elkWorkerUrl` (and
`dagreWorkerUrl`) wherever a worker can be served: only a layout in a worker
is stopped when nobody waits for it any more, and only there does the page
stay responsive while it runs. In-process ELK (no `elkWorkerUrl` and no
`elk`; the default of `<ProcessMap/>`, and the only way in Node) runs on the
calling thread one layout at a time: a layout waits until the runs ahead of
it have finished, an aborted one included, and its `timeoutMs` counts from
when it starts, not from the request; aborted while it waits, it never
starts. Once started it holds the thread until it is done, so its timeout
cannot fire before, and a run that finished is answered with its layout even
when it took longer than `timeoutMs`: the timeout does not shorten in-process
ELK. An `elk` instance the caller supplies is not queued; an abort or timeout
rejects at once and its later result is discarded, but a result it sent
before its timeout could fire is taken. Up to this change the timeout counted
from the request, so a layout behind an aborted long one timed out and fell
back to Dagre although it took milliseconds (two nodes with `timeoutMs: 300`
came back from Dagre after 8.8 s), and a run past its timeout ended in its
layout or in the timeout depending on timing.

Fallback limit. Without `dagreWorkerUrl` the Dagre fallback (`engine: "auto"`
after ELK failed or timed out) runs on the calling thread only up to
`fallbackLimit` nodes plus edges (default 500; Dagre's cost grows quickly
with dense graphs, from tenths of a second at 500 to many seconds). Above it
the layout rejects with `LayoutUnavailableError` instead of freezing the page.
`engine: "dagre"` runs whatever the size. When ELK fails or times out and the
Dagre worker then fails or times out too, the layout rejects with
`LayoutUnavailableError` as well ("Neither ELK nor the Dagre worker laid out
the graph: …" with the worker's error): a map keeps its provisional scene and
says the layout is unavailable, as without a worker. Up to this change it
rejected with the worker's plain error, and the map dropped the provisional
scene and showed that message. `engine: "dagre"` in a worker that fails
rejects with its own error, and `engine: "elk"` with ELK's, which no Dagre
follows.

## Style

```ts
export interface StyleSpec { edgeWidth?: ChannelSpec; edgeColor?: ColorSpec; nodeColor?: ColorSpec; lod?: Partial<LodRules>;
  stages?: readonly string[];   // the host's full stage list in stage order: categorical colours follow it
  measure?: Measure;            // the measure the style shows: the legend states its sentence
  addedFlowLabel?: true | string; // opt in for edges tagged added-by-map: default EN/DE legend words, or the host's string
  terminals?: { statement?: boolean };   // a start or an end event writes its cases and those at a shown activity under its label (0.4)
  selectedShare?: boolean;         // a path touching a selected activity adds the share of its cases it carries: "112,924 · 48 %" (0.4)
  frequencyColorLegend?: true;  // opt in to a frequency sentence naming the actual width and alternate colour metric/classes
  nodeLine?: LineSpec;          // what an activity's number line leads with; default its cases, then their share
  pathLabel?: LineSpec;         // what a path's label leads with before its count; default the count alone
  cueAccent?: string }          // the metric whose share of an activity's cases its frequency cue draws in the accent
export interface ColorSpec { metric?: string; palette?: PaletteName; scale?: "linear" | "sqrt"; domain?: number[];
  by?: "group" | "kind" | "tag" | "layer"; tagPrefix?: string;
  bins?: readonly number[];     // classes instead of a ramp: the bounds between them; a value on a bound is in the class below
  percentile?: number;          // the domain from 0 to this percentile of the paths' values (nearest rank)
  readable?: boolean;           // the ramp over the palette's stops at 3 : 1 or more against the paper, least first
  required?: boolean }          // a path without a value of the metric is not evaluated
export type Measure = "frequency" | "shortfall" | "performance";
export interface LineSpec { metric: string;
  format?: "value" | "short" | "toNext" | "fromPrev" | "both";
  nextMetric?: string;                     // for both: matching medianNextHours or meanNextHours by default
  then?: "cases" | "share" | "none";        // what follows an activity's value after "·"; default its cases
  missing?: "dash" | "frequency" }          // without a value: "–" in its place (default), or the line as without the setting
export const measureStyles: Readonly<Record<Measure, StyleSpec>>;   // the named styles of the three measures (see "Measures")
export function measureStyle(measure?: Measure, style?: StyleSpec): StyleSpec;   // the measure's style with `style` over it, entry by entry; `style` alone, else defaultStyle, without a measure
export interface ChannelSpec { metric: string; scale?: "linear" | "sqrt" | "log";
  max?: number;                   // the upper end of the width's scale, which runs from 0 to it; default the graph's strongest path before abstraction
  domain?: [number, number];      // values the range is stretched over instead (the lower end at the thinnest line)
  range?: [number, number] }      // the thinnest line and the width of the upper end; default the theme's pathMin and pathMax, 1 and 8
export const defaultStyle: StyleSpec;   // width and colour ← cases (width: sqrt from 0 to the graph's strongest path onto 0–8 px, never under 1; colour: the neutral ramp; transitions where paths give no cases), nodes by group
export const shortfallStyle: StyleSpec; // width ← cases, colour ← violationShare on the shortfall palette (the default up to 0.3)
export const diffStyle: StyleSpec;      // width ← cases, colour ← delta_violationShare on the diverging palette
export function buildScales(g: FlowGraph, spec?: StyleSpec, theme?: Theme): Scales;   // in the theme's palettes, default `defaultTheme`
export interface Scales { edgeWidth(e): number; edgeColor(e): string; nodeColor(n): string; nodePattern(n): PatternId;
  nodeColored(n): boolean;         // the colour says something (a category or a value), not the neutral fallback: the card has a band (0.4)
  categorical(key): CategoricalEntry; color(value, palette, domain): string; legend: LegendItem[]; domains;
  pathMetric: string;              // the count paths are labelled with and their width reads: cases, or count
  notEvaluated(e): boolean;        // a follows edge without a value of pathMetric
  terminal(e): "start" | "end" | undefined }   // a path from a start or to an end event, not added-by-map (0.4)
export interface CategoricalEntry { key: string; color: string; pattern: PatternId; index: number; label?: string }   // label: the group's
export function orderedCategorical(keys: Iterable<string>, theme?: Theme): Map<string, CategoricalEntry>;
export type LegendItem =   // `title` is a string key for `t` (it was typed `string`)
  | { kind: "width"; title: StringKey; metric: string; domain: [number, number]; range: [number, number];
      samples?: { value: number; width: number; floor?: boolean }[];   // the thinnest line (floor) with the largest value it stands for, a count near the middle width, the upper end; one where every path has one value
      scale?: "graph" | "shared";                     // from 0 to the graph's strongest path, or to the style's `max`; none with a `domain`
      transitionsOnly?: boolean }                     // the paths give only transition counts
  | { kind: "sequential" | "diverging"; title: StringKey; metric: string; domain: number[]; stops: readonly string[] }
  | { kind: "classes"; title: StringKey; metric: string; bounds: readonly number[]; colors: string[] }   // ColorSpec.bins: one colour per class
  | { kind: "categorical"; title: StringKey; entries: CategoricalEntry[] };
export const palettes: { neutral; sequential; sequentialBlue; diverging; categorical };   // colour-blind safe
export function themePalette(theme: Theme, name: ColorSpec["palette"]): readonly string[];   // "sequential" is the theme's shortfall, "sequentialBlue" its performance
export function contrastText(background: string): string;  // ≥ 4.5 : 1 on every palette colour
export function contrastRatio(a: string, b: string): number;   // WCAG contrast ratio of two colours
export function hexToRgb(hex: string): [number, number, number];
export function interpolatePalette(stops: readonly string[], t: number): string;   // piecewise linear through the stops; t clamped to [0, 1]
export function hashKey(key: string): number;   // stable 32-bit FNV-1a hash; categorical colours and pattern twins hash their keys
export interface LodRules { labels; edgeLabels; badges; arcs; chips; hatch; selfLoops }  // minimum zoom per element
  // 0.4: edgeLabels: number | { minPx: number } (a path's label while it is minPx screen pixels wide or more);
  //      selectedPaths?: "label" | "none" (every path touching a selected activity shows its label; default "label")
export function pathLabelShown(width: number, zoom: number, rules: Partial<LodRules>, touchesSelection?: boolean): boolean;   // the one rule every renderer reads (0.4)
export function touchesSelection(mark: Pick<EdgeMark, "edge">, selected: ReadonlySet<string>): boolean;   // (0.4)
export function emphasisLabel(mark, selected: ReadonlySet<string>, nodeOf: (id: string) => FlowNode | undefined, locale?): string | undefined;   // "112,924 · 48 %" (0.4)
export function lodAt(zoom: number, rules?: Partial<LodRules>): Record<keyof LodRules, boolean>;
export function lodForSize(nodeCount: number, base?: Partial<LodRules>): LodRules;
export function patternDefs(prefix?: string, ink?: string, outOfScope?: string, look?: PatternLook): string;   // <pattern> tiles of the twins and the hatching; ink and outOfScope default to colorTokens.ink and .outOfScope, look to patternTokens
```

Categorical colours come with a pattern twin
(`solid | diagonal | dots | crosshatch | horizontal | vertical | diagonal-reverse | grid`).
They are assigned in stage order: `StyleSpec.stages` (the host's full stage
list), then the order `abstract` recorded of the unfiltered graph
(`meta.model.groups`), then the graph's groups and the other keys in the order
they first appear. Each key takes its hashed colour or, when an earlier key
has it, the next free colour (`orderedCategorical`), so no two stages share a
swatch until the palette is used up; then the colours are free again and the
next round shifts the pattern twins by one, so every pair of stages still
differs in colour or pattern. Filtering a graph does not recolour its stages.
Up to 0.3 the colour was the hashed key alone, and two stages could share it
(Requisition and Purchase order of the fixture did); a key outside the order
still takes its hashed colour.

Paths count cases, as activities do: the default width reads `cases`, and
paths are labelled with their cases (`Scales.pathMetric`). A graph whose paths
give only transition counts is read by `count`, and the legend's path row says
so. A follows edge without that value is not evaluated: it is drawn in the
theme's `line` colour at the thinnest width, labelled "–", and the legend gains
the row "not evaluated" ("nicht bewertet"). The edge budget ranks paths by the
same value. Up to 0.3 the width and the labels read `count`.
`ColorSpec.palette` names a palette of the theme: `neutral`, `shortfall`,
`performance`, `diverging` or `categorical`; `sequential` and `sequentialBlue`
keep working and are the theme's `shortfall` and `performance`. Data colours
are read from the theme the scales are built in, so a theme with other
palettes colours paths, activities and groups by them.

**One width scale per graph.** A path's width depends on its value alone:
a square-root scale from 0 to the strongest path of the graph the map is
given, before any abstraction, onto 0 to 8 (`range[1]`), rounded to
hundredths, and a path whose width rounds under the thinnest line (`range[0]`,
1) is drawn at it. `abstract` records the largest value of each metric over the
paths of the graph before it (`meta.model.pathMax`, kept from an earlier
abstraction, as the rest of `meta.model`), and the scales read the upper end
from there, else from the graph's own paths. So moving the map's sliders,
focusing or collapsing stages does not change the width of a path that stays;
a collapsed stage's merged path is read on the same scale (its cases are the
largest of the merged paths', a summed count above the upper end is drawn at
8). A host gives several maps one scale with `edgeWidth.max`, the upper end
(`{ ...defaultStyle, edgeWidth: { ...defaultStyle.edgeWidth, max: 250000 } }`);
`resolveViews` gives its views the strongest path of any of them, its own
metrics included. A `domain`
keeps the former reading: the range stretched over its values. The legend's
width row says whose scale it is ("Path width: cases (count) · whole
graph", German "· ganzer Graph"; "· shared scale" with `max`) and shows the
same three samples at every setting: the thinnest line with the counts it
stands for ("≤ 3,044", every path up to 3,044 cases is drawn at it), a count
near the middle width, and the upper end. Where every path shown has the same
count, it shows that one sample at the width every path is drawn at instead of
a scale from 0 (up to 0.3.5 a map whose paths all counted 9 showed "3" and
"9"); without a measured path it has no width row. The row keeps the panel's
two lines (title and samples) at 260 wide. Up to 0.3 the scale ran from the
weakest to the strongest path shown, so a path changed its width when a slider
moved (`pathScaleMax`, the upper end a graph gives, is internal).

**Paths by cases.** In the default style a path's colour and its width both
mean its count: the width on the graph's square-root scale above, the colour
on a square-root scale over the paths' values along the theme's `neutral` ramp (`ColorSpec.scale:
"sqrt"`; `"linear"`, the default, runs evenly over the domain). The ramp is a
grey that gets darker with more cases in the light scheme (`#8c8c8c` to
`#141414`) and brighter with more cases in the dark scheme (`#6e737d` to
`#f2f3f5`, the theme's `darkPalette.neutral`); its lightest stop has at least
3 : 1 against the paper in both. A path without a count takes the theme's
`neutral` colour. Constraint edges are drawn in the theme's `accent`. Up to
0.3 the default style coloured paths by their expectation shortfall share on
the orange `shortfall` ramp; that colouring is `shortfallStyle`:

```tsx
<ProcessMap graph={graph} style={shortfallStyle} />
toSVG({ graph, positions, style: shortfallStyle });
```

or, keeping the rest of a style, `{ ...style, edgeColor: { metric:
"violationShare", palette: "shortfall", domain: [0, 1] } }`.

### Measures

The map shows one of three measures, switched by the host: `measure` on
`<ProcessMap/>`, `buildScene`, `toSVG` and `toPNG` (`Scene.measure`) and Canvas
`prepareScene` (`PrepareOptions.measure`). Each is a named style
(`measureStyles`); a `style` given too changes it entry by entry, a channel's
entries too (`measureStyle`), so `{ edgeColor: { bins: [0.05, 0.2] } }` moves
the shortfall's thresholds. Without a measure the style given, else
`defaultStyle`, is drawn as before, and the legend names the measure as it did
("Frequency · cases · share of 251,734 cases"). In every measure path width is
cases, and the frequency cue's length is the share of all cases. Switching
builds the scene again and lays nothing out.

| | `frequency` | `shortfall` | `performance` |
| --- | --- | --- | --- |
| Path colour | cases on the neutral ramp, as `defaultStyle` | `violationShare` in three classes: up to 10 % the neutral colour, 10 to 30 %, over 30 % (`bins: [0.1, 0.3]`) | `medianLagHours` from 0 to the 95th percentile of the paths shown on the `performance` palette |
| Path label | "112,924" | "35 % · 820" | "12 d · 112,924" |
| Activity's number line | "1,000 · 100 %" | "35 % short · 900" (German "35 % verfehlt · 900") | "4.7 d to next · 93 %" where the host gives `medianNextHours`, else as in frequency |
| Frequency cue | share of all cases | share of all cases; the cases short in the accent from its start | share of all cases |
| Legend | "Frequency: cases. Width and shade = cases per path. Bar = share of all cases." | "Shortfall: share of cases missing an expectation. Colour = share short. Width = cases." | "Performance: median wait between activities (h, d). Colour = median lag. Width = cases." |

The legend's measure row states the sentence (German "Häufigkeit: Fälle.
Breite und Tönung = Fälle je Pfad. Balken = Anteil aller Fälle.",
"Erwartungslücke: Anteil der Fälle, die eine Erwartung verfehlen. Farbe =
Lückenanteil. Breite = Fälle.", "Durchlaufzeit: mediane Wartezeit zwischen
Aktivitäten (h, d). Farbe = Median-Wartezeit. Breite = Fälle."); the map's
one-line strip shows its first sentence. In the frequency measure the marks
are those of the default style.

For frequency colour by lag, opt in to an English/German legend naming
actual width and colour metrics (and classes, if binned):

```ts
const style: StyleSpec = {
  addedFlowLabel: true,
  frequencyColorLegend: true,
  edgeColor: { metric: "medianLagHours", palette: "performance", bins: [24, 168] },
};
```

With optional lag (`required` omitted or false), missing values retain their
count and width in the neutral class, without a "not evaluated" key. Zero is
measured; exact 24/168 h ties take the lower class. Performance remains
required. Omitting `frequencyColorLegend` preserves existing legend wording.

`addedFlowLabel` applies only to edges tagged `added-by-map`, across all
measures: neutral round dots, count labels and unchanged width calibration.
`dashTokens.addedFlow` is `[0, 3]` in stroke-width units, distinct from the
fixed `[6, 5]` re-added dash. Added flows never use measure colour or lead
labels, and do not calibrate colour domains, even with accidental metrics.
`true` supplies English/German history-boundary words; a string supplies
host words for the scene's locale. The key appears only when drawn.
Start/end node tags alone do not activate it. React, Canvas, SVG and PNG
share this look; interactive state styling still applies. Without opt-in,
existing pictures and exports remain unchanged.

**Classes** (`ColorSpec.bins`): a value on a bound is in the class below it,
so 10 % is "up to 10 %" and 30 % "10 % to 30 %". The first class is drawn in the
theme's `neutral` colour, the others along the palette's stops that stand out
more from the paper than it, from the least to the most (light: `#d94801`,
`#7f2704`; dark: `#fd8d3c` to `#fff5eb`), so the classes differ in lightness
and stand out more with more cases short in either scheme. The legend shows a
swatch per class with its bounds ("up to 10 %", "10 % to 30 %", "over 30 %";
German "bis 10 %", "10 % bis 30 %", "über 30 %"), in the thresholds given.

**Performance ramp** (`percentile: 95`, `readable: true`): from 0 to the
95th percentile of the shown paths' median lags by nearest rank (of twenty
paths the 19th), a path above it drawn at the end; along the palette's stops
with 3 : 1 or more against the paper (light `#2171b5` to `#08306b`, dark
`#2171b5` to `#f7fbff`). The legend's ramp shows its ends as durations ("0
min", "19 h"). An activity's time is the host's node metric
`medianNextHours`; without it the number line reads as in frequency. No
time of an activity is derived from its paths' medians.

**Not evaluated** (`required: true`): in the shortfall and the performance
measure a path without the value is drawn in the `line` colour at the width of
its cases, its label reads "–" before its count ("– · 820"), and the legend
gains the row "not evaluated". An activity without a share short reads "– ·
400".

**Deviations stay in the accent** in every measure. In the shortfall measure
the accent's hue colours paths too; arcs keep their form: thin curves above
the flow (below it in reverse), one width, an arrowhead and their result in a
pill, where a path is an orthogonal route whose width is its cases and whose
label has no pill. The cue's part in the accent (`NodeCue.accent`): the stripe
in the accent at the theme's `tint` opacity over the paper (none in `print`,
which has no tints) and the foot in the accent, keyed in the legend ("Bar in
the accent: share of all cases that fall short"). `checkTheme` reports a
theme whose `performance` palette has fewer than two stops at 3 : 1 or whose
`shortfall` palette has fewer than two that stand out more than the neutral
colour (`kind: "measure"`), and text under 7 : 1 (the muted ink 4.5 : 1) on
the accent's tint.

**Deviations are the one hue.** Badges, chips, constraint arcs, their labels,
tints and constraint self-loops are drawn in the theme's `accent` (orange,
`#b84a00` in the light scheme, `#ff8c42` in the dark), whatever their value;
the categorical palette leaves out Okabe–Ito's orange (`#E69F00`) and
vermilion (`#D55E00`), so no stage reads as a deviation. The six colours left
keep the pattern twins they had (`solid`, `dots`, `crosshatch`, `horizontal`,
`diagonal-reverse`, `grid`, the theme's `patterns`), so no two share one; the
print theme's five keep theirs too (`diagonal`, `crosshatch`, `horizontal`,
`vertical`, `grid`). Hashed keys fall on other colours than they did with
eight.

## Design tokens

```ts
export const colorTokens: { paper; surface; ink; inkMuted; inkStrong; line; lineStrong; cueStripe; cueFoot; focus; onFocus; pressed; onPressed;
  patternInk; selection; hover; neutral; outOfScope; accent; severity; mechanism; reservoir; pass; warn; fail };   // the light scheme; accent: deviations
// pressed, onPressed: a pressed toggle of the panels and its text (light #0072b2 and #ffffff, dark #0b1f2e and #ececec);
// patternInk: the ink of the pattern twins on the stage colours (light #1f1f1f, the light ink; dark #101114)
export const darkColorTokens: Partial<Record<ColorToken, string>>; // what the dark scheme changes
export const paletteTokens: { neutral; sequential; sequentialBlue; diverging; categorical };  // `palettes` is this object
export const fontTokens: { family; mono };                         // "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
export const nodeSizeTokens: Record<NodeKind, { width; height }>;  // `DEFAULT_SIZES` is this object; activity 180 × 64, stage 200 × 64
export const sizeTokens: { radius: 4; radiusLarge: 8; band: 8; shadow; shadowMenu };   // radius and band read the role tables below
export const textSizeTokens: { label: 13; glyph: 15; small: 11; note: 11; edgeCount: 11; nameLine: 13; countLine: 11 };  // sizes of roles of textTokens
export const textTokens: { nodeLabel; stageLabel; nodeCount; eventLabel; gatewayGlyph; noteLabel; activityName; activityNumber; activityShare;
  pathLabel; groupLabel; badge; badgeValue; chip; chipLead; arcLabel; selfLoopLabel; attribution; legendTitle; legendItem;
  legendValue; legendKey; legendChip; figureTitle; figureText; panel; panelHeading; panelTitle; panelNote; panelLabel; panelKey;
  panelSymbol; panelPlain; tooltip; activityTooltip; timelineAxis; timelineLabel; timelineNote; timelineMark; comparisonValue;
  comparisonNote; comparisonDenominator; comparisonTab; comparisonCaption; comparisonRowHeader };  // each { size?; weight?; lineHeight? }
export const radiusTokens: { node: 4; large: 8; band; swatch; control; tooltip; key; pill; circle: "50%"; filterChip; legendGradient;
  activityTooltip; comparisonBar; tint; hatch; chip; canvasSelection; timelineEvent; timelineViolation };
export const strokeTokens: { node; stage; eventStart; eventEnd; gateway; note; focus; selection; canvasSelection; group;
  canvasGroupSelected; band; halo; path; pathMin; pathMax; canvasPathHighlight; pathFocus; pathHit; arc; arcCoverage; pill;
  selfLoop; badge; chip; filterChip; legendGradient; tab; timelineSpan; timelineViolation; minimapNode };   // arcCoverage, and minimapNode since 0.6, are read by nothing
export const dashTokens: { reconnectedNode; reconnectedPath; note; constraint; group; reverseArc; timelineAnchor; bpmnOutOfScope };  // readonly number arrays; note, constraint, group and reverseArc are read by nothing
export const opacityTokens: { dimmed; dimmedPath; disabled; tint; hatch; arc; groupFill; bandFill; bandOddFill; groupStroke; legendRule; timelineGrid };
export const spaceTokens: { unit: 2; steps: readonly [1, 1.5, 2, 3, 4, 5, 6, 8] };
export const zTokens: { pathHovered; activityLabels; comparisonRowHeader; comparisonHeader; comparisonCorner; overlayPanel; bpmnTable;
  bpmnPanel; sideList; tooltip; canvasTooltip; bpmnNavigation; menu; activityTooltip; marksAbove };
export const dimensionTokens: { band: 8; mapMinHeight; viewMapMinHeight; handle; panelMaxWidth; controlLabel; controlOutput;
  legendSwatchWidth; legendSwatchHeight; legendSample; legendSampleExport; legendGlyph; legendGradient; searchMinWidth; tableSwatch;
  tooltipMaxWidth; canvasTooltipMaxWidth; activityTooltipMaxWidth; bpmnTableTop; watermarkClearance; sideList; menuMinWidth;
  menuMaxWidth; filterChipMinHeight; zoomButtonWidth; zoomButtonHeight; backgroundGap; cueFoot: 3; eventLabel: 96 };
export interface Arrowhead { size; box; length; width; overhang; outline;
  perWidth? }   // the size grows to perWidth times the width of the path it ends
export const arrowheadTokens: { edge: Arrowhead; overlay: Arrowhead };
export function arrowheadExtent(a: Arrowhead): { length; half; tip; outline };  // in user units
export type PatternId; export const PATTERNS: PatternId[];          // also exported from the style module, as before
export const patternTokens: { size: 6; strokeWidth: 1; strokeOpacity: 0.6; dotRadius: 1; dotOpacity: 0.7 };
export function patternTwin(p: PatternId): { size; lines: [x1, y1, x2, y2][]; dots: [cx, cy][] };
export const hatchTokens: { size: 8; width: 1; domPeriod: 7 };
export const designTokens: { color; darkColor; palette; darkPalette; font; nodeSize; size; textSize; text; radius; stroke; dash; opacity; space; z;
  dimension; arrowhead; pattern; hatch; minimum; readable; rule; print };   // readable: readableTokens (see "Readable at every zoom")   // darkPalette: the palettes the dark scheme changes (the path ramp)
// designTokens.rule: what a theme's rules draw at (see "Rules")
//   { strokeWeight: { thin: 1; strong: 2 }; radius: { s: 4; m: 8 }; opacity: { min: 0.2; max: 1 }; textMax: 15; weights: [400, 500, 600] }
export const themedColors: readonly ColorToken[];                  // the colours with a CSS variable
export function cssVariable(name: string): string;                 // "inkMuted" → "--wf-ink-muted"
export function tokenVariables(): { light: Record<string, string>; dark: Record<string, string> };
export function arrowMarker(id: string, a: Arrowhead): SvgElement; // the <marker> of an arrowhead, in user units
export function patternTwinSvg(id: string, p: PatternId, ink: string, look?: PatternLook): SvgElement;   // look: a theme's `pattern`, default patternTokens
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
blocks); `npm run tokens` generates it from the table and a tooling test
fails when the file and the table differ.

Every size, radius, stroke width, dash, font size and weight, opacity and
z-order the library draws has a role name in the table: text by role
(`textTokens`: the map's node, activity, path, group, badge, chip, arc and
self-loop texts, the legend, the exported figure, panels, tooltips, the trace
timeline and the cohort comparison), radii by element (`radiusTokens`),
stroke widths by element and state (`strokeTokens`), dash patterns by meaning
(`dashTokens`), state opacities (`opacityTokens`), spacing as multiples of one
unit (`spaceTokens`), the stacking order (`zTokens`) and the fixed sizes of
controls, panels and legend samples (`dimensionTokens`). The stylesheet reads
the roles it uses through CSS variables of `tokens.css`: `--wf-text-<role>`,
`--wf-weight-<role>` and `--wf-leading-<role>` (the role in kebab case, such
as `--wf-text-activity-name`), `--wf-radius-<role>`, `--wf-stroke-<role>`,
`--wf-dash-<role>`, `--wf-opacity-<role>`, `--wf-z-<role>`, `--wf-size-<role>`,
`--wf-space-<step>` (`--wf-space-1` is 2px, `--wf-space-1-5` 3px, up to
`--wf-space-8`, 16px) and `--wf-shadow-menu`. The marks, the Canvas drawing,
the SVG and PNG exports and the React components read the table for the same
roles. Where the renderers draw a role differently, the table names both
values (`legendSample` and `legendSampleExport`, `selection` and
`canvasSelection`, …).

The table's sizes are on scales: text 11, 13 and 15 px with weights 400, 500
and 600; radii 4, 8 and full (`pill`, which a mark resolves to half its
height, and `circle`); strokes 1 and 2. The widths that encode or catch rather
than draw a stroke of the scale are apart: `pathMin` to `pathMax`, the range of
a path's width, `arcCoverage` and `pathHit`. A test fails on any other value.
The default font stack starts with the system font. `nodeLabel` and
`nodeCount` are no longer read: an activity's or a stage's card writes its
name in `activityName` (a stage's in `stageLabel`), its cases in
`activityNumber` and their share in `activityShare` (see "The activity
card"); the two stay in the table, deprecated, so that themes which set them
keep type-checking.

The arrowhead rule is the maps': an edge ends in a closed triangle, at 12 3
long and 4.8 wide, outlined by 0.6 in its colour, in user units; a path wider
than 3 ends in a head 4 times its width (`perWidth`, rounded up: a path 8 wide
in a head of 32, 8 long and 14.4 wide with its outline), so the head is at
least 1.8 times as wide as its line at every width. The line ends three
quarters of the head's length before the tip (`overhang` 3.75 of 20), inside
the head, and the tip lies on the route's end: `pathArrowhead(width, rule)`
gives the head of a path (`EdgeMark.arrow`), `lineEnd(points, arrow)` where its
line ends. The rule is the theme's (`Theme.arrowhead.edge`, 0.4): the
`instrument` preset grows the head by 5 per unit of width, so that its base is
twice its path's width (a head of size s is 0.4 s wide), and gives a path
thinner than 2 (`minWidth`) no head at all, its line then ending on the
route's end; the default and print themes keep 4 and no minimum. Every
renderer paints the paths the widest first and the thinnest on top, equal
widths by id (`paintOrder`, 0.4; the SVG export drew them in id order), so
that a thin path crossing a trunk stays visible.

With `FlowSceneOptions.labelPlacement: "clear"` (0.5; default `midpoint`,
unchanged) the scene moves paths' labels clear of the cards, the groups'
titles, the other labels and the other paths (`placeEdgeLabels`): the widest
paths are placed first, ties by id; a label that covers nothing stays where it
is; else it goes to the cheapest of the candidates beside the middle of the
route's four longest segments and in 16 px steps along them (above or below a
horizontal segment, beside a vertical one; covering a card costs 60, a label or
a title 40, another path 10 + 4 × its width). Where every candidate beside the
line covers something, one 24 px further off without cover is taken and
`EdgeMark.leader` holds a hairline from the route to the label, drawn in the
`line` paint by every renderer; otherwise the cheapest candidate. The pass is
deterministic and reads the scene's `TextMeasure`; `ProcessMapProps.labelPlacement`
passes it through. The SVG export defines the marker `wf-arrow` for the head of 12 and
`wf-arrow-<size>` for each larger head it draws; the React Flow map defines
`wf-edge-arrow-<size>` with the same `arrowMarker` (it used React Flow's
`MarkerType.ArrowClosed` at 12); the Canvas map and the PNG export draw the
same triangle. Up to 0.3 every edge ended in the head of 12 with its tip on
the end of the line, so a path wider than about 4 showed no head; arcs and self-loops
end in a triangle 12 long and wide whose tip lies 1.2 beyond the path. A
pattern twin is a 6-unit tile drawn by `patternDefs` (SVG), the Canvas band
and `<PatternSwatch/>` (React) from `patternTwin`.

## Theme

```ts
export type ColorScheme = "light" | "dark";
export interface ThemePalettes { neutral: readonly string[]; shortfall: readonly string[]; performance: readonly string[];
  diverging: readonly string[]; categorical: readonly string[] }
export interface Theme {
  color: Readonly<Record<ColorToken, string>>;            // the colour roles in the light scheme
  dark: Readonly<Partial<Record<ColorToken, string>>>;    // the roles the dark scheme changes
  palette: Readonly<ThemePalettes>;                       // neutral: paths by cases, few to many
  darkPalette?: Readonly<Partial<ThemePalettes>>;         // the palettes the dark scheme changes; default: neutral dim to bright
  patterns: readonly PatternId[];                         // the pattern twin of each categorical colour, in the palette's order
  pattern: PatternLook;                                   // how pattern twins are drawn: as patternTokens (tile, widths, opacities)
  font: { family: string; mono: string };
  text: { [role in keyof typeof textTokens]: { size?; weight?; lineHeight? } }   // as textTokens, any values, and:
    & { minScreenPx: number; minFigurePt: number };       // the smallest text on the screen (px, 9) and in an exported figure (pt, 0; print 7)
  radius: { [role in keyof typeof radiusTokens]: number | string };
  stroke: { [role in keyof typeof strokeTokens]: number };
  opacity: { [role in keyof typeof opacityTokens]: number };   // the tints are tint, groupFill, bandFill, bandOddFill
  space: { unit: number; steps: readonly number[] };
  size: { band: number; shadow: string; darkShadow?: string };   // the card's stage band (8; 0 none; --wf-size-band), the panels' shadow, the dark one
  readable: { nameChars: number };                        // a card shows its name while a line holds this many characters and "…" (8)
  arrowhead: { edge: Arrowhead };                         // the paths' head rule: size, perWidth (4; instrument 2), minWidth (0; instrument 2)
  frequencyCue: FrequencyCue;                             // where a card shows its share of all cases; default "both"
  density: "comfortable" | "compact";                     // the renderers draw comfortable whatever it says
  minimum: { text: number; stroke: number };              // pt at the layout's own size (1 layout unit = 0.75 pt)
  rules: readonly ThemeRule[];                            // ordered restyling by part, kind, tag and state; none in the presets (see "Rules")
}
export type FrequencyCue = "both" | "behind" | "bottom" | "none";   // the stripe behind the texts, the foot along the bottom edge
export const defaultTheme: Theme;                          // the token table: the default look
export const printTheme: Theme;                            // defaultTheme with printTokens over it; no dark scheme
export const instrumentTheme: Theme;                       // defaultTheme with instrumentTokens over it: the WISE look, light and dark (0.4)
export const instrumentTokens: { color; dark; palette; darkPalette; patterns; font; radius; size; stroke; opacity; frequencyCue; arrowhead };
export const themePresets: Readonly<Record<ThemePreset, Theme>>;
export type ThemePreset = "default" | "print" | "instrument";
export type ThemeOverrides = /* any part of Theme, each table entry on its own */ & { preset?: ThemePreset };
export type ThemeSetting = ThemePreset | ThemeOverrides;   // a whole Theme is a ThemeOverrides too
export function resolveTheme(setting?: ThemeSetting, variables?: ThemeOverrides): Theme;   // preset, then variables, then the setting
export function themeColors(theme: Theme, scheme?: ColorScheme): Readonly<Record<ColorToken, string>>;  // the light roles with the scheme's changes
export function checkTheme(theme: Theme): ThemeDeviation[];   // empty when nothing falls short
export type PatternLook = { readonly [K in keyof typeof patternTokens]: number };
export interface ThemeDeviation { kind: "text" | "line" | "rampOrder" | "rampStart" | "textSize" | "strokeWidth" | "color" | "rule" | "measure";
  scheme?: ColorScheme; subject: string; value: number | string; minimum?: number }   // rule: subject "rules[1].set.strokeWeight"; measure: "palette.performance", value the stops that stand out
```

Appearance is scene data. `buildScene(graph, positions, { theme, scheme })`
reads the theme once and resolves the marks in it: every node, edge, group
and overlay mark carries its outline width, dash, corner radius and text
sizes and weights from the theme's tables, its data colours from the theme's
palettes, and names its paints by role (`MarkPaint`); `scene.colors` holds
each role's colour in the scene's scheme. The SVG export, the Canvas map and
the PNG export draw these values, so a theme reaches all of them alike; the
interactive map draws the marks too and paints the roles with the CSS
variables of `tokens.css`, whose dark blocks hold the same values as the
dark scheme. `defaultTheme` is the token table, and a scene without a theme
draws as before. `toSVG`, `toPNG` and `prepareScene` take `theme` and
`scheme`; `<ProcessMap/>`, `<CanvasMap/>` and `<ViewSwitcher/>` take `theme`
(see "Theme of a map in a page").

**Presets and settings.** A host sets a theme as a preset's name (`"default"`,
`"print"`) or as changes over a preset: `{ preset: "default", radius: { node:
8 }, text: { activityName: { size: 15 } } }` changes those entries and keeps the
rest of the preset (`default` unless named); a list, such as a palette,
replaces the preset's. Radii are named by element (`node`, `large`, …), as in
`radiusTokens`. `density` is held in the theme, but every renderer draws
`comfortable` for now. A whole `Theme` is such
changes too, so code that passes one keeps working. `resolveTheme(setting,
variables)` gives the theme: the preset, then `variables` (what a host wrote
as CSS variables), then the setting. Colours must be literals (`#rgb`,
`#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`); another syntax is left out (the
preset's colour stays), so every paint of an export is a literal.
`useFlowTheme` turns any CSS colour into one before. Palette stops are hex
colours (`#rgb`, `#rrggbb`), from which values are interpolated; a palette
with another stop is left out (the preset's palette stays).

**`default`** is the default look, in a light and a dark scheme, each with its own
path ramp (`palette.neutral`, and `darkPalette.neutral` for the dark scheme)
and its own accent (`color.accent`, `dark.accent`). **`print`** is
for figures: white paper and surfaces, no tints (`opacity.tint`, `groupFill`,
`bandFill`, `bandOddFill` are 0), a pattern twin on every categorical colour
(five colours, five patterns, none solid) drawn opaque (`pattern`), ramps
whose palest stop has 3 : 1 on the paper (`palette.neutral` three greys,
`shortfall` three oranges, `performance` three blues), no text or stroke in
its tables under 7 pt and 0.75 pt at the layout's own size (`minimum`; the
default's smallest text is 11 px and its thinnest stroke 1 px, so print keeps
every size), no text of an exported figure under 7 pt at the width it is
declared at (`text.minFigurePt`, see "Hit index and export"), and no dark
scheme: it draws the same in both. The values are the token table's
`printTokens`.

**Exports.** `toSVG` and `toPNG` draw the `print` preset unless given `theme`;
an export never follows the page's scheme (print has no dark one). Up to this
version they drew `default`, and a host keeps that output, byte for byte, with
`theme: "default"`: the figure is then one picture scaled to its width, its
texts at their sizes whatever the scale (`text.minFigurePt` 0). `scheme:
"dark"` draws a theme's dark scheme. `prepareScene` draws `default` unless
given a theme, as the live Canvas map does. To export what a map draws, pass
the theme `useFlowTheme` resolves for its container.

**The smallest text.** `text.minScreenPx` (9) is the smallest text on the
screen, in CSS pixels; the maps scale texts up to it and shed what does not
fit (see "Readable at every zoom"). Hosts can set it as `--wf-text-min-screen`.
`text.minFigurePt` is the smallest text of an exported figure, in points at
its declared width: 0 in `default`, 7 in `print`.

**`checkTheme(theme)`** returns what falls short, as data, in both schemes:
text against its ground under 4.5 : 1 (`ink` and `inkMuted` on `paper` and on
`surface`, `onFocus` on `focus`, `onPressed` on `pressed`, `accent` on `paper`, where deviations write
their labels, `inkMuted` on `cueStripe`) and ink on the frequency cue's
stripe under 7 : 1 (`ink` on `cueStripe`), a line against the paper under 3 : 1
(`lineStrong`, `neutral`, `focus`, `accent`; `line` draws hairlines and tracks whose
meaning a label or a neighbour carries too, and is not checked) and the cue's
foot under 4.5 : 1 (`cueFoot` on `paper`), the pattern ink under 3 : 1 on a
colour of the scheme's categorical palette (kind `line`, subject
`patternInk on #F0E442`), the path
ramp of each scheme (`palette.neutral`, in the dark scheme with `darkPalette`
over it) not rising in contrast against the paper from stop to stop
(`rampOrder`, with its scheme) or its low end under 3 : 1 against the paper,
a text size or stroke width of the tables under the
theme's `minimum` (in pt, one layout unit being 0.75 pt), and a colour that
is not a literal. Both presets pass in both schemes; the default's `minimum`
is the smallest of its scales (8.25 pt: text at 11 px; 0.75 pt: strokes of
1 px). It reports every entry of a rule that is unknown or out of range
(`kind: "rule"`, see "Rules"). The React components log what
it finds once per theme in development (`process.env.NODE_ENV` other than
`production`), and decide nothing from it. A translucent colour is measured
as it is drawn: mixed with its ground, and the ground with white.

**Greyscale.** In print, stage colours that look alike in grey are told apart
by their patterns: each categorical colour has a pattern no other has, drawn
opaque in the ink, which reaches 3 : 1 against every one of them (the lowest
is 3.18, on `#0072B2`). Each ramp a path is coloured with (`neutral`,
`shortfall`, `performance`) darkens step by step, each stop at least 1.5 : 1
from the next, from 3 : 1 against the paper, so the palest path shows and no
two classes fall together. A test checks these on the preset and on the path
strokes of a print export, paths short by 0 to 100 % and one without a value.

## The activity card

Every renderer draws an activity, and a stage node (a collapsed stage), as
one card that the scene resolves (`NodeMark`):

- a box of the theme's `radius.node` (4) on the paper, outlined 1 wide
  (`stroke.node`, a stage's `stroke.stage`) in the neutral `lineStrong`, with
  no shadow; a re-added card is dashed;
- the stage once, as the patterned band along the left edge (`band`, the
  theme's `size.band` wide: 8, 6 in `instrument`, 0 for none; in the stage's
  colour with its pattern twin); neither the outline nor the fill takes the
  stage's colour. Only a card whose colour says something has the band
  (`Scales.nodeColored`: its stage, or another category or value of the
  style's `nodeColor`); a card without a stage, whose colour would be the
  neutral fallback, has none (0.4: it had a grey band). The stylesheet reads
  `--wf-size-band` where a card has no mark of its own;
- the name on up to two lines (`nameLine`, `activityName`: 13 px, 500; a
  stage's name in `stageLabel`, 600), wrapped by the scene's text measure;
  a longer name ends its second line in an ellipsis, and the mark's `title`
  holds the whole name, which the SVG export writes as `<title>` and the
  interactive map as the card's `title` (its `aria-label` names it too);
  two names shortened alike are told apart on their last line (see
  "Readable at every zoom");
- the number line: the cases in full grouped digits, in the ink and
  semibold (`countLine`, `activityNumber`: "1,000", German "1.000"), then
  their share of all cases of the log, muted (`share`, `activityShare`:
  "· 100 %"). The share is the node's `cases` over `graph.meta.cases`; a
  missing value is "–". `activityLabels.showCounts: false` leaves the number
  line out without changing the card's size;
- the frequency cue (`cue`): a flat stripe behind the texts and a foot 3 high
  along the bottom edge, both from the inner left edge (after the band, or
  inside the outline on a card without one) and as long as the share times
  the inner width (the box less the band, or the outline, and the outline on
  the right). The stripe is `cueStripe`, on which the ink keeps
  7 : 1, the foot `cueFoot`, 4.5 : 1 on the paper. `Theme.frequencyCue` places
  it: `"both"` (default), `"behind"` (the stripe), `"bottom"` (the foot) or
  `"none"`. A card with a share of 0, or without one (no cases, or no
  `meta.cases`), shows neither.

The texts lie as one block in the middle of the card above the foot. A card
outside the scope (a `hatch` overlay on it; `NodeMark.outOfScope`) keeps its
solid outline, is hatched with 1 px lines and writes its name in the muted
ink. Hover, selection and focus change the outline (hovered in the ink,
selected in the focus colour with its ring, focused with the focus outline),
never the fill. Badges sit wholly above the card, 2 clear of its top edge.

The layout reserves the card's size once: the default activity is 180 × 64
and the default stage node 200 × 64 (`nodeSizeTokens`), and with
`activityLabels` `activityNodeSize` gives 280 × 64 for names and 140 × 64 for
references, whatever the name and whether the number line is shown. The
interactive map sizes the card to its box in the scene, so the layout's box
is the box every renderer draws.

A stage node's card shows its cases and their share; how many activities it
holds ("4 activities") is in its description (`describeNode`), which is its
accessible name and its hover title. Where the cases are a lower bound (a
collapsed stage's largest member, `metricBasis` `atLeast`), the card prints
them compactly, "≥ 211,379 · ≥ 84 %" (0.4; `MetricFormatOptions.compactBasis`),
while descriptions, tooltips and tables keep "at least 211,379"; the legend
explains the mark ("≥ a lower bound: …", key `atLeast`) only where a card
carries it. A host that knows a stage's exact numbers gives them on the group
(`FlowGroup.metrics`: `cases`, the union of the cases touching it, `events`,
`share`); `collapseGroups` takes them instead of the bound, and the card prints
plain numbers (the share is `cases` over `meta.cases` where none is given).

Stage groups are outlined by a solid hairline (`line`, 1 wide) without a
tint (`opacity.groupFill` 0; a theme that sets it tints them again), their
title in the muted ink. Start and end events keep their circles (outlined 1
and 2 wide); their label sits 4 below the circle, shortened to 96
(`dimensionTokens.eventLabel`) with the whole label as `title`. The
interactive map draws no grid of dots behind the map unless
`backgroundGrid` is set.

### Start, End and the terminal paths (0.4)

An event tagged `start` or `end` is the process's Start or End. Every
renderer draws it as its circle outlined in `lineStrong` (`stroke.eventStart`,
`stroke.eventEnd`: 1 and 2, 1 and 1 in `instrument`), with ▶ (`start`) or ■
(`end`) in the ink in its middle (`ElementText` role `glyph`, text role
`eventGlyph`, 15 px, 600; `eventGlyph(node)`) and its label below it: the
node's own `label`, or "Start" / "End" (`terminal.start`, `terminal.end`;
German "Beginn" / "Ende") where it has none. With
`style.terminals.statement` the event writes, on up to two muted lines under
its label (160 wide, `dimensionTokens.eventStatement`), how many cases start
or end there and how many of them at an activity the map shows, from its
metrics `cases` and `atShown` (`terminal.statement`: "1,000 cases · 940
(94 %) at a shown activity"). The glyph is shed with the gateways' glyphs, the
label and the statement with the events' labels (see "Readable at every
zoom").

A terminal path is a follows edge from a start event or to an end event, or
a sequence flow there that the host tags `start` or `end` (a BPMN model's own
untagged flows keep their look), that the host did not add (`added-by-map`;
`terminalOf(edge, node)`): `Scales.terminal(edge)` names it
`"start"` or `"end"` and its mark carries `EdgeMark.terminal`. It is recorded
history, the cases that start or end at an activity (an adapter weights it
by them), so it is drawn solid, in the theme's `terminal` paint (light
`#c9ced6`, dark `#4b515b`; `instrument` dark `#3a4049`) in every measure, on
the width scale every path shares, and labelled with its count alone (no
measure's value leads it). It is not part of the measure's colour domain, is
never "not evaluated" for lacking a measure's value, and dims with the rest.
The legend keys it ("─ Paths from Start and to End: cases by their first and
last activity", `legend.terminal`) beside the events' keys (▶, ■). Its
accessible description counts cases, not transitions ("path Start → Create
PO. 800 cases begin with this activity", `terminal.describeStart`,
`terminal.describeEnd`), and an event without a label is named "Start" or
"End" there too (`nodeName`). The
interactive map's path carries the state `start` or `end` (see "Styling
contract"). The opted-in host flows (`StyleSpec.addedFlowLabel` and the tag
`added-by-map`) stay neutral round dots: they are flows the map adds, not
recorded history. `checkTheme` gates `terminal` as a hairline: 1.3 : 1 on
the paper and apart from `line`.

## Readable at every zoom

```ts
export type ReadableLevel = "full" | "name" | "line" | "box";   // name and number line, name on two lines, on one line, nothing
export type ReadableLabel = "path" | "loop" | "event" | "glyph" | "note";   // texts shed below the floor, never scaled up
export interface Readable {
  level: ReadableLevel;
  boost: number;                    // how much the cards' texts are scaled up: the floor over the level's smallest text, at least 1
  floor: number;                    // the smallest text on the screen in layout units, rounded up to the ladder; 0 without a floor
  step?: number;                    // the rung of the ladder: floor = 2 ** (step / readableTokens.steps)
  labels: Readonly<Record<ReadableLabel, boolean>>;   // the kinds of label drawn
  pills: boolean;                   // deviation pills drawn; false only beyond the ladder
}
export interface ReadableRules {    // FlowScene.readable
  levels: Readonly<Record<"full" | "name" | "line", { size: number; floor: number }>>;   // smallest text, largest floor it fits at
  labels: Readonly<Record<ReadableLabel, number>>;   // each kind's text size
  pills: number;                    // the smallest text of the scene's pills, which each is scaled up by
}
export interface CardLevels { origin: XY; full: ElementText[]; name: ElementText[]; line: ElementText[] }   // NodeMark.levels
export function readableAt(rules: ReadableRules, zoom: number, minScreenPx: number, previous?: Readable): Readable;
export function readableZoom(rules: ReadableRules, minScreenPx: number, level?: "full" | "name" | "line"): number;   // the smallest zoom the level is drawn at; default "line"
export interface NameRoom { name: string; room: number; font: { size: number; weight?: number } }
export function distinctLines(items: readonly NameRoom[], max: number, measure: TextMeasure, given?: readonly (readonly string[])[]): string[][];   // wrapLines, told apart
export const readableTokens: { steps: 8; first: 16; last: 56; hysteresis: 0.1; nameChars: 8; number: { padding: 0.5; height: 1.5; link: number } };
// Theme.text.minScreenPx: 9 (CSS variable --wf-text-min-screen); Theme.text.minFigurePt: 0, print 7 (see "Hit index and export")
```

No text on the map is smaller on the screen than the theme's
`text.minScreenPx` (default 9 CSS pixels). `readableAt` decides, from the
zoom, what the texts show; the DOM map, the Canvas map and the exports all
call it, so they choose the same level at the same zoom. The floor is
`minScreenPx` over the zoom, in layout units, rounded up to a ladder of rungs
`2^(1/8)` apart (`readableTokens`: from 4 to 128); at zoom 1 with the default
floor it is 9.51, under every text of the default theme, and nothing changes
above a zoom of about 0.86.

- **Cards** (activities and stages) show the most of their texts that fits:
  `full` (the name on up to two lines and the number line), `name` (the name
  on up to two lines), `line` (the name on one line) or `box`. The texts are
  scaled up by `boost`, the floor over the smallest text of the level (the
  number line's 11 at `full`, the name's 13 below), from their start in the
  middle of the room above the frequency cue's foot (`CardLevels.origin`),
  so that the smallest is at the floor. A level fits while every card's block
  of lines fits its height at the boost, a line holds the first
  `nameChars` (8) characters of every name with the ellipsis after them and
  the number line its width, these widths by the estimate (0.55 em a
  character), so that a map's levels are the same in every font (the lines
  themselves are fitted by the scene's text measure);
  `ReadableRules.levels[level].floor` is the largest floor it fits at. When
  the floor passes it, the level is shed: first the number line, then the
  second line of the name, then the name. The scene carries each card's lines
  for each level (`NodeMark.levels`), fitted once when it is built for the
  largest boost the level is drawn at, so a name may be cut sooner at the
  `name` and `line` levels than in the card's own `texts`; at `full` with a
  boost of 1 the card draws its own `texts`, as at every zoom from 1 up.
  A card without text keeps its name as its hover title and its accessible
  name (`aria-label` in the DOM map; the tooltip and the element list of the
  Canvas map). Its box and position never change with the zoom.
  On the live maps, `box` also draws numbered markers at the screen text
  floor and a scrollable, keyboard-focusable "Activities by number" key of
  full names. Padded marker boxes stay clear of one another and other cards;
  a displaced number has a line back to its card centre. Placement depends on
  the scene and text floor, so panning keeps it. Shown SVG/PNG figures replay
  the positions and links and extend their bounds to include them.
  This applies below the ladder too; zooming back to names removes
  the numbers and key. Standalone `CanvasMap` uses the same numbering. The key sits midway up the right edge, clear of the collapsed legend and zoom controls.
- **Group titles** go with the cards' names (none at `box`) and are scaled up
  to the floor from their start.
- **Labels** that are not scaled up go once they would fall below the floor:
  paths' counts (and the labels of indirect paths), self-loop labels, event
  labels, gateway glyphs and note labels, each at its own size. With the
  default sizes paths' labels are the first texts shed.
- **Deviation pills** (a card's row of badges, from the row's bottom-right
  corner; a chip and an arc's label pill, from their middle) are scaled up by
  the floor over the scene's smallest pill text (`ReadableRules.pills`) and
  are the last texts shed: only beyond the ladder, at a floor
  above 128 (a zoom under 0.07 with the default floor). Their marks' own
  level of detail still applies; `defaultLod` draws badges, arcs and chips
  from 0.2, with the names (they went at 0.22 before, ahead of the names). A
  boosted pill can cover its neighbours where many meet.
- **Hysteresis.** Given the state it drew before, `readableAt` brings back a
  level, a kind of label or a lower rung only once the floor is 10 % below
  where it went (`hysteresis`), so a zoom that wavers at a boundary does not
  make text flicker. Shedding happens exactly where a text stops fitting.
- A `minScreenPx` of 0 keeps every text at its size.
- **The readable zoom.** `readableZoom(rules, minScreenPx, level)` is the
  smallest zoom at which every card still shows at least `level`:
  `minScreenPx` over the largest rung of the ladder at or below the level's
  floor, so that `readableAt` at that zoom gives the level and a hair below
  it does not. It is 0 without a floor or without a card (no zoom is too
  small), Infinity for a level that fits no rung. `<ProcessMap
  minZoom={{ readable: "name" }}/>` takes it as the map's smallest zoom (see
  "Controls and panels").
- **Names shortened alike.** Where two activities' names differ but their
  lines are cut to the same text, on the cards and at every level, each is
  told apart on its last line (`distinctLines`): its start, an ellipsis and
  the part from the first character that differs among them, as much of each
  as the room holds, the telling part first ("Ve…invoice", "…debit me…"
  for "Vendor creates invoice" and "Vendor creates debit memo" on a line of
  ten characters); names that still coincide are told apart again from the
  next character that differs, until each differs or nothing is left to tell
  it by. Names that are the same stay the same, and the whole name stays
  the card's title and its accessible name.

On the BPIC global map (cards 180 × 64), path labels go at a zoom of about
0.85, the number line at 0.65, the second line of the name at 0.35 and the
name at 0.3 (`ReadableRules`: full 14.1, name 24.0, line 31.1).

**DOM map.** The map writes the state on its root as classes, one string, so a
zoom change writes the root once and no card: `wf-text--plain` (the cards'
own texts, unboosted), `wf-text--full`, `--name`, `--line` or `--box`; the
rung (`wf-text-f26`), which `tokens.css` turns into `--wf-text-floor`;
`wf-text-grow` where titles and pills are scaled up at the plain level (as on
the Canvas map);
and `wf-text-hide-path`, `-loop`, `-event`, `-glyph`, `-note` and `-pills` for
what is shed. Each card holds a block of texts per level
(`.wf-activity-copy.wf-copy--plain`, `--full`, `--name`, `--line`); the
stylesheet shows the root's level and scales it with `transform`, dividing
the floor by the level's smallest text, which the map writes once per scene
on its root (`--wf-text-s-full`, `--wf-text-s-name`, `--wf-text-s-line`).
Group titles (by their own size, `--wf-text-s` on the title) and pills
(`.wf-pill-row`, chips, `.wf-arc-pill`, by `--wf-pill-size`, written on the
root with the others) are scaled the same way. The computed font
sizes stay those of the marks; the size on the screen is that times the
transforms. **Canvas map.** `drawScene` decides at `lodZoom` (the view's
zoom) with the theme's `minScreenPx`, from `DrawOptions.readableFrom`, and
returns the state it drew in (`readable`); `CanvasRenderer` passes the
previous frame's, so it picks the level per frame within the hysteresis.
`DrawOptions.readable` draws a given state. **Exports**: see "Hit index and
export".

**Replacing counter-scaling CSS.** A host that kept the map's text readable by
scaling text and its containers with the inverse of the zoom (custom
properties such as a label size in layout units, a "map scale" applied to
badges, chips and markers, line clamps and grown boxes, written by a script
on every zoom change) removes those rules and the script: they depend on the
map's private structure, change the boxes the layout placed, and cannot reach
the Canvas map or the exports. It sets the floor instead, in the theme or as
a CSS variable on the map's container:

```tsx
<ProcessMap graph={graph} theme={{ text: { minScreenPx: 11 } }} />
// or, in the host's stylesheet: .my-map { --wf-text-min-screen: 11px; }
```

Both maps then scale and shed texts by the same rule; boxes keep the size
the layout reserved, so paths still meet them. A host that wants smaller
text on the screen than 9 px sets a smaller floor; 0 turns the rule off.

## Paths around a selection (0.4)

With `lod.edgeLabels: { minPx: 2 }` a path's label is drawn while the path
is at least 2 screen pixels wide (its width times the zoom; the interactive
map decides at rest, the Canvas map and the exports at their zoom); a number
keeps the zoom rule. Every path touching a selected activity shows its label
whatever the rule (`lod.selectedPaths`, default `"label"`; `"none"` keeps the
rule), and with `style.selectedShare` the label adds the share of the selected
activity's cases the path carries (`emphasisLabel`: "800 · 89 %"; "≥" before a
lower bound), in the interactive and the Canvas map. A backward path
(`EdgeMark.backward`) is drawn `Theme.stroke.backwardStep` thinner (never
under `pathMin`) at `Theme.opacity.backward` while no activity it touches is
selected, and lifted to its width, head and opacity then (`EdgeMark.lift`);
the default theme has a step of 0 and an opacity of 1, the `instrument` preset
1 and 0.6. Exports draw nothing selected.

## Overlays

```ts
export type ConstraintType = "presence" | "singularity" | "exclusion" | "lag" | "precedence" | "balance" | "metric" | "applicability";
export interface ConstraintDescription { id; type; label?; layer?; activities?; a?; b?; group?; params?; scope?; description? }
export interface ConstraintStats { cases?; evaluated?; violations?; violationShare?; coverage?; repeatShare?; meanCount?; maxCount?;
  medianDays?; p90Days?; unit?; reverseShare?; mean?; median?; p90?; threshold?; width?; casesInScope?; inScopeShare?;
  nodeShareInScope?: Record<string, number>; [k: string]: unknown }
export function constraintOverlays(c: ConstraintDescription, stats?: ConstraintStats,
  o?: { locale?: Locale; outOfScopeMinShare?: number; graph?: FlowGraph }): Overlay[];
export function overlaysFor(items: { description; stats? }[], o?: OverlayPresetOptions): Overlay[];
export interface OverlayPresetOptions { locale?: Locale; outOfScopeMinShare?: number; graph?: FlowGraph }   // of overlaysFor and useOverlays
export function canonicalOverlays(overlays: Overlay[]): Overlay[];
export function describeOverlay(o: Overlay, locale?: Locale): string;
export function overlayGeometry(overlays: Overlay[], positions: Positions, o?: OverlayGeometryOptions): OverlayGeometry;
export function overlayMargin(o?: OverlayGeometryOptions): number;
```

Presets: presence → badge (`≥m`, missing share); singularity → badge (`≤k`)
and self-loop (repeat share); exclusion → badge (`∅`, occurrence share); lag →
arc above the map labelled with the late share of the cases evaluated
(`evaluated` in the payload; threshold in the text); precedence → arc with
`⇒` plus a reverse arc (`⇐`) below the map for the reverse share; balance / metric → chip with a gauge on the group or the
map, tint on the group; applicability → hatch on nodes whose in-scope share
is below `outOfScopeMinShare` (default 1 %) and a scope chip. Constraints
without evaluated cases read "not applicable in this scene".

`overlayGeometry` returns shapes (boxes, arc and self-loop paths, label
anchors and the boxes of the labels (`label`), minimum zoom) that never
extend beyond `overlayMargin()` around the positions' bounds. A badge is a
pill (`badgeSize`, default 18 tall) with its glyph and share in it ("≥1 ·
22 %"), wholly above its activity, 2 clear of it; the badges of an activity
run leftwards from its top-right corner, 4 apart, and start left of a
self-loop it carries. The labels' boxes are measured in the language they
are written in, `OverlayGeometryOptions.locale` (default `en`; `buildScene`
passes the scene's locale).

A self-loop is an arc at the card's top-right corner with its label beside
it by default. With `OverlayGeometryOptions.selfLoop: "pill"` (0.4) it is one
pill instead, `badgeSize` tall, outlined by a hairline in `lineStrong` on the
paper with "↻ 17 %" in the ink at the badge's 11/600, its right end at the
card's and its middle on the card's top border (`badgeAnchor: "border"`, the
default) or 2 inside it (`"inside"`): it costs the name no room, the badges
run left of it, it scales with the readable floor like the other pills
(`OverlayShape.pill`), and every renderer draws it from its mark.
`ProcessMapProps.overlayGeometry` passes the options to the map (compared by
value); `buildScene`, `prepareScene` and `toSVG` take them as before.

A chip of a group (a measure that belongs to a stage) is placed after the
badges and the self-loops: in the group's title row, ending at its chip
anchor, where it covers nothing there; otherwise above the group or below
it, 4 clear of it, ending at its right edge or starting at its left, a row
of 28 further out each time (four rows on either side). It takes the first
place that covers no activity, group title, badge, self-loop or other chip and
crosses the fewest paths (the scene's paths, in their courses; `overlayGeometry`
alone knows no paths), and where every place covers something the first that covers
fewest. Arc labels, placed after it, keep clear of it. Up to 0.3 a group's
chips were stacked downwards from the chip anchor, over the group's title
and its activities where those lay there. Map-level chips sit above the map,
as before.

An arc keeps clear of the activities between its ends where it can. Its
default course runs above the map from the tops of its ends (below from the
bottoms for a reverse arc) at a height of 22 % of its span, at least 40,
plus 14 for each earlier arc on the same pair, at most 140 (`arcHeight`). When
that course, with half its width and 4 of paper on either side, crosses the
box of a node other than its ends, the arc takes the course that crosses the fewest: first on its own
side, then on the other, each from the nearest height in steps of 14 (the
further one first when two are equally near, up to 32 steps), within the
margin. A tie keeps the earlier course. Every arc is solid and one width
(`stroke.arc`, 1); its coverage is not drawn. A reverse-order arc runs
below the flow and its label starts with ⇐. The labels are placed after the
badges and the chips: a self-loop's label right of its corner, or above the
loop, or left of it, each a step higher where that is taken; an arc's label
is a pill (the text 6 in from either end, 18 tall) centred on
the arc at the point nearest the middle (in steps of 1/32 of the curve) where
it covers no node, badge, chip, self-loop label, earlier arc label or group
title, and in `buildScene` no path's count either (as wide as the text by
the scene's measure, from one em above its baseline down to it); where none
is free, at the point that covers the fewest. Until counts were kept clear
of, a pill could sit on the count of a path running under the arc. It states the
share first and its base second: "late 35 % of 820", "order 14 % of 820",
"⇐ 14 % of 820" (German "verspätet 35 % von 820", "Reihenfolge …"), the base
being the payload's `evaluated`; an arc of another kind writes its glyph
before them, and a `displayLabel` replaces them. `buildScene` and the
renderers reading it (SVG, PNG, the Canvas map, the React map and the BPMN
view) all draw these courses and labels.

## Hit index and export

```ts
export class HitIndex { constructor(edgeTolerance?: number);
  static fromScene(p: Positions, g?: OverlayGeometry, edgeTolerance?: number,
    indexOf?: (kind: HitItem["kind"], id: string) => number | undefined,
    extentOf?: (item: HitItem) => Box | undefined,   // a box the item's bounds also cover
    diamond?: (nodeId: string) => boolean,   // nodes drawn as a diamond (gateways)
    markOf?: (shapeId: string) => OverlayMark | undefined,   // the marks the shapes are drawn as
    pathOf?: (edgeId: string) => Pick<EdgeMark, "width" | "arrow"> | undefined): HitIndex;   // the marks the edges are drawn as
  at(x, y, tolerance?): HitItem[]; within(box: Box): HitItem[] }
export interface HitItem { minX; minY; maxX; maxY; id: string; kind: "node" | "edge" | "group" | "overlay";
  segment?: [XY, XY]; shapeId?: string; index?: number;   // index: indexOf(kind, id or shape id)
  box?: Box; layer?: "below" | "between" | "above";   // box: of a node, group or overlay shape, what hit tests read; layer: of an overlay shape
  curve?: { points: XY[]; reach: number; label?: Box };   // an arc's or a self-loop's curve, half its stroke, its label's box
  diamond?: boolean;   // a node hit by its diamond
  stroke?: { line: [XY, XY]; reach: number; head?: { points: XY[]; reach: number } } }   // a path's line along the segment, half its width, its head
export interface Scene { graph; positions; overlays?; measure?: Measure; style?; title?; subtitle?; locale?; lanes?: LaneMode;
  activityLabels?: ActivityLabelOptions; selfLoops?: boolean }
export interface ExportOptions { readable?: Readable;   // replay a live map's text state and full-name key
  preset?: "single-column" | "double-column" | "slide" | "none"; width?; legend?;
  widthMm?: number;   // the width the figure is declared to be printed at; the SVG states its size in mm
  background?; fontFamily?; padding?; lodZoom?; context?;   // lodZoom: default the map's scale in a figure with a floor, else 1
  edgeBudget?: EdgeBudget | ShownEdges;   // default every edge; see "Edge budget"
  theme?: ThemeSetting; scheme?: ColorScheme;   // what the figure is drawn in; default the print preset, light
  textMeasure?: TextMeasure;   // what its texts are measured by; default estimateTextWidth (see "Text measure")
  caption?: boolean }          // the caption line under the figure (figureCaption); default true
export function toSVG(scene: Scene, o?: ExportOptions): string;   // deterministic, legend embedded

export type FigurePreset = "single-column" | "double-column" | "slide" | "none";
export const FIGURE_WIDTHS: Record<Exclude<FigurePreset, "none">, number>;   // 1000, 2000, 1600
export type LegendKeyKind = "badge" | "arc" | "reverse" | "selfLoop" | "outOfScope" | "reconnected" | "indirect" | "notEvaluated" | "addedFlow" | "shortPart" | "start" | "end";   // shortPart: the cue's part in the accent
export interface LegendKey { kind: LegendKeyKind; glyph: string; title: StringKey; label?: string }   // label: host-supplied added-flow words
export type LegendRow =
  | { kind: "measure"; text: string }                                                     // "Frequency · cases · share of 251,734 cases"; a named measure's sentence
  | { kind: "width"; title: string; samples: { width: number; text: string }[] }          // path width: three sample strokes
  | { kind: "ramp"; title: string; id: string; stops: readonly string[]; values: string[] }  // a colour ramp: low, (middle,) high
  | { kind: "swatches"; title: string; entries: { text: string; color: string; pattern: PatternId }[] }   // categories with their pattern twins
  | { kind: "key"; key: LegendKeyKind; glyph: string; text: string }                      // one kind of mark drawn
  | { kind: "chip"; chip: Overlay; label: string; text: string };                         // a map-level chip
export interface SceneLegend { title: string; rows: LegendRow[]; items: LegendItem[]; keys: LegendKey[]; chips: Overlay[] }
export interface LegendSource { scales: { legend: LegendItem[]; pathMetric?: string; spec?: Pick<StyleSpec, "measure" | "addedFlowLabel" | "frequencyColorLegend"> }; marks: readonly OverlayMark[];
  nodeMarks: readonly { reconnected: boolean; node?: FlowNode; cue?: { accent?: unknown } }[]; edgeMarks: readonly { reconnected: boolean; indirect?: boolean; notEvaluated?: boolean; addedFlow?: boolean }[];
  locale: Locale; graph?: Pick<FlowGraph, "meta"> }   // a FlowScene is one
export function legendOfScene(scene: LegendSource): SceneLegend;   // what a scene draws: FlowScene.legend
export function sceneLegend(items: LegendItem[], overlays: readonly Overlay[], locale?: Locale): SceneLegend;   // from scales and overlays alone
export const legendMetrics: { width: 188; heading: 26; itemTitle: 16; measureEnd: 6; widthScale: 20; gradient: 30; entry: 16; entriesEnd: 4;
  key: 14; chipsGap: 6; chipLabel: 13; chipText: 15 };
export function legendItemHeight(item: LegendItem): number;   // with a title of one line
export interface LegendLayout { rows: { row: LegendRow; y: number; lines: string[]; texts: string[] }[];   // lines: the title wrapped; texts: entries shortened, a key wrapped
  items: { item; y }[]; keys: { key; y }[]; chips: { chip; y }[]; height: number }
export function legendLayout(legend: SceneLegend, o?: { measure?: TextMeasure; width?: number; text?: Theme["text"] }): LegendLayout;   // default the estimate, 188, the token table
export const figureMetrics: { padding: 24; legendColumn: 220; legendInset: 16; titleHeight: 40; titleBaseline: 26;
  contextHeight: 18; contextBaseline: 44; keyLine: 16; noteRow: 16; noteBaseline: 12; noteSize: 11 };
export interface FigureFrameOptions { title?: boolean; context?: boolean; legend?: boolean; padding?: number; preset?: FigurePreset; width?: number;
  withheld?: { shown: number; total: number }; caption?: boolean; readable?: Readable;
  floor?: number }   // the smallest text in figure units; with an output width, the figure is fitted (below)
export interface FigureFrame { padding; header; map: { width; height; offset: XY; scale: number };   // scale: the map's in a fitted figure, else 1
  legend?: { layout: LegendLayout; x; y; width; rule?: { x; top; bottom } }; caption?: { lines: string[]; x; y };   // no rule below the map
  readable: Readable;   // what the map's texts show at its scale with the floor (every text without one)
  numbers?: { texts: { id: string; text: MarkText & { from?: XY; box?: Box } }[]; lines: string[]; x; y };   // the cards' numbers and the key of their names
  note?: { text: string; x; y }; key: { lines: string[]; y }; width; height; outWidth; outHeight }
export function figureFrame(scene: FramedScene, o?: FigureFrameOptions): FigureFrame;   // FramedScene: graph, activityLabels?, locale, bounds, legend, textMeasure?, theme?, readable?, nodeMarks?, positions?
export function figureCaption(g: FlowGraph, locale?: Locale, labelOf?: (id: string) => string): string | undefined;
```

Positions that hold more than the scene's graph (another scene's elements,
as `layoutUnion` gives them, or bounds wider than the graph): `toSVG`,
`toPNG` and `prepareScene` place the overlays on the positions of the
graph's own elements, as the map does, which is given only those, so the
arcs of an export take the course and label place they take on the map. The
figure's frame still holds the given positions' bounds, and a prepared
scene's hit index holds only the elements it draws, so a culled draw stays
culled and nothing it does not draw is hit. Up to this change the arcs'
course search avoided the other scene's boxes and took its room from their
bounds, so an export's arc could run at another height or on the other side
than on the map, and the extra boxes in the hit index turned culling off.
To draw the given positions alone, pass `filterPositions(positions, graph)`.

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
tests the point against what the element draws, not the bounds, so a hit
test is exact: a node's, group's or overlay shape's own box (`HitItem.box`),
an edge's segment, or with `pathOf` its stroke and head, an arc's or a
self-loop's curve and label, a gateway's diamond. A curve is hit within half the stroke of the mark `markOf` returns
for its shape, which `prepareScene` passes in the scene's theme; without it,
the default theme's stroke. `at` lists the items within `tolerance` of the point (a box when the
point is within the tolerance of it, an edge when it is within the tolerance
of one of its segments) with the one painted on top first: overlay shapes above the nodes (badges, chips, hatching,
self-loops), nodes, arcs, edges, tints, groups; among those the smaller
element first (a segment with the tolerance around it), then by id. Overlay
items carry their shape's layer (`HitItem.layer`, see `OverlayMark.layer`);
an item without one ranks above the nodes. Up to 0.3.5 every overlay shape
ranked first, so inside a tinted group every hit was the tint, and where an
arc crossed a node, the arc.

Paths are hit where they are drawn too, with `pathOf`, which `prepareScene`
passes: within `tolerance` plus half the path's width of its line, which ends
under its head as the maps draw it (`lineEnd`), or within `tolerance` plus
half the head's outline of the head's triangle, which grows with the line
(`pathArrowhead`; `HitItem.stroke`). Up to 0.3.5 the Canvas map, `CanvasRenderer.hitAt`
and the hit index of `prepareScene` hit a path within `tolerance` of its
route whatever its width: the outer part of a path 8 wide, and of its head,
which reaches 7.2 to each side, answered no hit, where the React Flow map
hits a path within 7 of its line (`strokeTokens.pathHit`, 14 wide) and on
its stroke. Without `pathOf` an edge is hit within `tolerance` of its route's
segments, as before. An item's bounds are its segment grown by
`edgeTolerance`, and with `pathOf` also by half the path's width and around
its head, so an index built without `extentOf` finds what it hits; `extentOf`
grows them further (the Canvas scene's covers the highlight stroke).

Arcs and self-loops are hit where they are drawn: within `tolerance` plus
half their stroke of their curve (`HitItem.curve`: the cubic of the path cut
into chords at equal steps, as many as its control polygon's length over 8,
at least 16 and at most 1,024, so that a chord stays within a fraction of a
unit of the curve), or within `tolerance` of the box their label takes (an
arc's pill, a self-loop's text; for a shape without one, each text 0.55 em
per character wide, from a size above its baseline to a third of a size
below). A node for which `diamond` is true (the Canvas scene passes its
gateways) is hit inside its diamond, whose half diagonals are half the box's
width, or within `tolerance` of its sides: also where a gateway wider than
tall reaches beyond its box, and not in the box's corners. The bounds of
these items are their boxes as before; `extentOf` grows them to the drawn
stroke and diamond, as the Canvas scene's does, so that the area search
finds every point a hit test accepts. Up to this change their whole box took
the hit: a path under an arc's box could not be hovered or clicked there (on
the BPIC global scene with stage lanes, 1,164 of 40,000 grid points within 4
of a path and more than 8 from every arc's curve returned the arc), and a
point inside an activity near its self-loop returned the loop. This applies
to the Canvas map's hover, click and right click, `CanvasRenderer.hitAt` and
the hit index of `prepareScene`.

The legend and the figure frame are described once. The legend is a key: an
ordered list of typed rows (`LegendRow`) in the scene's words and numbers.
First the measure the map shows, with its unit and what the shares are of
("Frequency · cases · share of 1,000 cases"; the measure is named by the path
colour's metric: none or a count is frequency, the shortfall share shortfall,
a lag performance, a difference difference; the unit is `Scales.pathMetric`;
the cases are `meta.cases`, left out when unknown). Then the scales, each
titled "channel: metric (unit)" from the metric registry ("Path width: cases
(count)", "Path colour: expectation shortfall (% of cases)", "Activity colour:
stage"): path width with three sample strokes and their values (the thinnest
line with the counts it stands for, a count near the middle width and the
graph's strongest path, written as paths are; one stroke where every path
has one count; see "One width scale per graph"), a colour ramp
with its values, the stages as swatches with their labels and pattern twins.
Where the paths give only transitions, the path row says so ("Path width:
transitions (count) · paths count transitions; no case counts given"). Then
one key per kind of mark drawn that the legend explains: one per badge glyph
("≥1 Required: share of cases missing it", "≤1 Limited: share of cases
repeating it", "∅ Excluded: share of cases where it occurs", other badges the
generic key), arcs, reverse-order arcs, self-loops, out-of-scope hatching,
paths and activities not directly observed (re-added), paths not evaluated,
the start and the end of the process; and the map-level chips.
The scene carries it as `FlowScene.legend`, built by `legendOfScene` from what
the scene draws, so a row exists exactly when its mark is drawn: a kind with
no mark on the map has no key and a kind drawn many times has one; the path
scales need a drawn path and the activity colour a drawn node. Tints and the
chips inside groups are drawn without a key, as before. `sceneLegend` builds
the same rows from scale items and overlays alone (for a legend without a
scene): a key for each overlay kind given and always one for re-added paths.
`<Legend/>`, `toSVG`, `toPNG` and the Canvas `drawLegend` render the rows; the
heading is the legend's `title`. `legendLayout` places the rows from their
heights in `legendMetrics`, so the legend's height follows from its rows, and
fits the texts an export writes by the scene's text measure: the measure and
every scale's title wrap to the width (16 a line), a key wraps 24 less than
the width (14 a line), a swatch's entry is shortened 24 less and a chip's
label and text 4 less; the map's panel writes them in full. Up to 0.3 a key
was shortened to one line, a title was not fitted, and the width row had two
samples side by side; now they stand one per line.
`figureFrame` measures an exported figure: the header (title 40, context
line 18), the map with its padding and the offset of the scene's content,
the legend column (220: a rule, 16 inset, rows 188 wide, 16 inset), the
activity key under the taller of map and legend, and the output size for a
preset or width. With `withheld` it adds the note on withheld edges
(`map.edges.withheld` in the scene's locale) in a row of 16 under the map
and the legend, its baseline 12 into the row and the activity key below it;
the legend's rule then ends beside the map, and a figure narrower than the
note (11 px, measured by the scene's text measure) is widened so that the note
fits between the paddings; the activity key is wrapped by the same measure.
Unless `caption` is false, a caption line stands under the map and the legend
(lines 16 apart, the first baseline 12 below, wrapped to the figure's width
at 11 px), before the note and the activity key: `figureCaption` of the
graph's `meta`, its parts joined by " · ": the label (`label` or `scene`), the
cases ("251,734 cases"), the period (`period`, two dates or `{ from, to }`),
the filters (`filters`, a filter or a list of clauses, in the words of the
filter chips; an empty one reads "filter: none") and how much of the model is
shown ("16 of 42 activities, 35 of 656 paths shown", from `meta.model`; the
activities of a collapsed stage count as shown, and a map with one leaves the
paths out, since its merged paths are not the model's). A
part whose data is missing is left out, and a graph without any of it has no
caption: nothing is invented. In SVG the caption is a `<g class="wf-caption">`.
`toSVG`, `toPNG` and the Canvas `drawLegend` draw from these.

**A figure with a floor.** Given `floor` (the smallest text in figure units)
and an output width (`width` or `preset`), `figureFrame` lays the figure out
at that width, one figure unit an output pixel, and scales the map into it
(`map.scale`): beside the legend's column where that leaves the map at least
half the width, otherwise with the column below the map. The frame's own
texts (title, legend, caption, note, keys) keep their sizes, and the map's
texts are kept readable at its scale with the floor (`readable`, by
`readableAt`, as on the screen at that zoom). Where the cards cannot show
their names (`level` `box`), the frame numbers them in reading order (along
the layout's direction, then across it), writes each number in the middle of
its card at the floor (`numbers.texts`, in map units) and puts the key of
names, "Activities by number" and one line per card, under the legend in the
column (`numbers.lines`). Without a width, or without a floor, the figure is
laid out at the map's size as before (`map.scale` 1).

`toSVG` and `toPNG` pass the theme's `text.minFigurePt` as the floor, in CSS
pixels (0.75 pt each): in `print` 7 pt, 9⅓ figure units; in `default` none,
so a `default` figure is the old one. `widthMm` declares the width the
figure is printed at: the figure is laid out at that many CSS pixels
(`width: 85` mm is 321.26) and the SVG states its `width` and `height` in mm,
so its texts keep 7 pt on paper. `toPNG` draws such a figure `width` CSS
pixels wide (default its laid-out width). With a floor, the title and the
context line are shortened to the figure's width, and `lodZoom` defaults to
the map's scale, so marks below their level of detail at that scale are left
out as on the screen. The SVG draws the numbers as `<g class="wf-numbers">`
in the map and the key as `<g class="wf-number-key">`; the PNG draws them
with the Canvas routines (`DrawOptions.numbers`). At 85 mm the BPIC global
map is drawn at a scale of 0.095: no card can show its name at 7 pt, so all
16 are numbered and keyed under the legend, and no text is under 7 pt.

## Formatting and strings

```ts
export type Locale = "en" | "de";
export function formatCount(v, locale?), formatNumber(v, decimals?, locale?), formatShare(v, locale?),
  formatDelta(v, locale?), formatHours(v, locale?), formatDays(v, locale?), formatCompact(v, locale?),
  formatPathCount(v, locale?);
export function t(locale: Locale, key: StringKey, vars?, overrides?: Strings): string;   // overrides: the host's wording over the table (0.4)
export type Strings = Partial<Record<StringKey, string>>;   // a host's wording by key, with the table's {placeholders} (0.4)
export type Translate = (key: StringKey, vars?) => string;
export function createStrings(locale: Locale, overrides?: Strings): Translate;   // `t` in a locale with the host's wording, as one function (0.4)
export const strings: Record<Locale, Record<StringKey, string>>;   // the table `t` reads: every key in English and German
export function metricLabel(locale: Locale, metric: string): string;
```

**The host's wording (0.4).** A host words the map's sentences itself
without forking the table: `strings` replaces a key's EN or DE text with its
own, which takes the same `{placeholders}`; a key the table does not know and
a value that is not a string are left out. `FlowSceneOptions.strings` (and so
`FlowScene.strings`), `ExportOptions.strings` (`toSVG`), `PngOptions.strings`
(`toPNG`), `PrepareOptions.strings` (`prepareScene`), `LegendProps.strings`,
`AbstractionControlsProps.strings` and `ProcessMapProps.strings` take it; the
scene builds its legend rows, the caption, Start and End and the marks' texts
with it, so the strip, the expanded key, the Canvas legend and both exports
print the same: `strings={{ "legend.measure": "Frequency · {unit}",
"legend.shareOf": "share of {total} cases" }}` prints "Frequency · cases ·
share of 251,734 cases". The detail panel (`controls.*`, the statements'
`detail.*`), the descriptions of terminal paths (`terminal.describeStart`,
`terminal.describeEnd`) and the caption's terminal sentence
(`export.terminals`) read it too. The interactive map compares it by value, so
an object written in place does not build the scene again. Keys whose text
`metrics.ts` composes (a channel's title, a metric's name) are not reached.
`ProcessMapProps.hideAttribution` (0.4, default false) hides React Flow's
credit for a host that credits it elsewhere.

The numbers follow one set of rules, in English and German:

- activities, lists and tooltips: grouped full integers ("1,000"; "1.000");
  up to 0.3 an activity's count on the map was compact ("1.0k");
- paths (`formatPathCount`): in full up to 99,999, then "113k", "1.2M"
  ("1,2M"), never "1.0k";
- percentages (`formatShare`): integers, one decimal under 1 % ("0.4 %"), and
  a share that is not zero never reads "0 %": under 0.05 % it reads "<0.1 %";
- durations (`formatHours`): minutes under an hour, hours under 48, then days;
- a missing value is "–", never 0.

`formatCompact` remains for badges and hosts; the library no longer writes
it on the map.

### Metric registry

```ts
export type MetricKind = "count" | "share" | "hours" | "number";
export interface MetricEntry { label: StringKey; unit: StringKey; kind: MetricKind; mean: StringKey; meanLabel?: StringKey; measure?: StringKey }
export const metricRegistry: Readonly<Record<string, MetricEntry>>;   // cases, count, events, starts, ends, internalCount, members, violations, share, violationShare, medianLagHours, p90LagHours, medianNextHours
export function metricEntry(name: string): MetricEntry | undefined;
export function metricKind(name: string): MetricKind;                 // delta_ and a_ read their metric; else from the name
export function metricName(name: string, locale?: Locale): string;    // "cases", "median lag", "difference …", "… (a)", else the name
export function metricUnit(name: string, locale?: Locale): string;    // "count", "% of cases", "min, h, d"; "" for a plain number
export function metricBasis(element, name: string): MetricBasis | undefined;
export interface MetricFormatOptions { basis?: MetricBasis; path?: boolean }
export function formatMetricValue(name: string, value: number | undefined, locale?: Locale, o?: MetricFormatOptions): string;
export function elementMetric(element, name: string, locale?: Locale, path?: boolean): string;   // with the element's basis
export function metricLabelOf(name: string, locale?: Locale, basis?: MetricBasis): string;     // "lag, mean of medians" for a mean
export function metricMeanNote(name: string, locale?: Locale): string;                         // "mean of medians", for a table cell
export function channelTitle(channel: StringKey, name: string, locale?: Locale): string;       // "Path width: cases (count)"
```

The registry holds for each metric the words it is named by, its unit and how
its values are written, in English and German, and the wording of a lower
bound ("at least 211,379", "mindestens 211.379") and of a mean of merged
values ("mean of medians", "Mittel der Mediane"; "weighted mean",
"gewichtetes Mittel"). The legend's rows, the descriptions, the table, the
path list and the exports read it. A metric it does not hold is named by
itself and written as a share, a duration or a count by its name, else as a
number (whole numbers in full, others with one decimal).

`formatNumber` prints between 0 and 100 decimals: fewer are taken as 0, more
as 100, a fraction is cut and `NaN` counts as 0; up to 0.3.5 a number
outside threw a `RangeError`. A value that is not a finite number (`NaN`,
an infinity, a string) prints as `–` in every formatter.

## React (`wise-flow/react`)

```ts
export function ProcessMap(props: {
  graph: FlowGraph; positions?: Positions; overlays?: Overlay[]; style?: StyleSpec;
  measure?: Measure;   // frequency, shortfall or performance (see "Measures"); from the prop, else kept by the map; style over it
  onMeasureChange?: (m: Measure) => void;   // given, the whole legend offers the three measures to switch between
  theme?: ThemeSetting;   // a preset's name or changes over a preset, over the map's --wf-* variables; see "Theme of a map in a page"
  textMeasure?: TextMeasure;   // what labels are shortened, names wrapped and boxes sized by; default the browser's (canvasTextMeasure)
  abstraction?: AbstractOptions; defaultAbstraction?: AbstractOptions; onAbstractionChange?: (o: AbstractOptions) => void;
  controls?: boolean; legend?: boolean; minimap?: boolean; renderer?: "auto" | "svg" | "canvas"; canvasThreshold?: number;
  backgroundGrid?: boolean;   // a grid of dots behind the interactive map; default false
  selection?: Selection; onSelect?: (s: Selection) => void; onHover?: (id: string | null) => void;
  lod?: Partial<LodRules>; locale?: Locale; layout?: LayoutOptions; selfLoops?: boolean;
  view?: "map" | "table"; onViewChange?: (v: "map" | "table") => void;
  ariaLabel?: string; className?: string; containerStyle?: CSSProperties; fitView?: boolean; children?: ReactNode;
  fitInsets?: Partial<Insets>;   // kept clear when the view is fitted; default: clear of the panels over the map (see "Controls and panels")
  // 0.3
  focus?: Focus | null; defaultFocus?: Focus; onFocusChange?: (f: Focus | undefined) => void; pathList?: boolean; paths?: FlowPaths;
  filters?: Filter | FilterClause[]; filterPreview?: FilterPreview | Record<string, unknown>; onFilterChange?: (f: Filter) => void;
  lanes?: LaneMode; contextMenu?: boolean;
  onContextMenu?: (target: MenuTarget, actions: MenuAction[]) => MenuAction[] | false | void;
  onAction?: (action: MenuAction, target: MenuTarget) => void | string; announce?: string;
  describedLimit?: number;   // default 500 activities plus groups; below 1 read as 1
  edgeBudget?: EdgeBudget | "adaptive";   // default "adaptive"; see "Edge budget"
  onEdgesShown?: (shown: ShownEdges | undefined) => void;   // the edges drawn while some are withheld, for toSVG and toPNG
  minPathPx?: number;   // the narrowest line on the screen a path is drawn at; default 0.5, 0 draws every path; see "Paths at a small zoom"
  opening?: "readable" | "fit";   // default "readable": fitted where that gives 0.75 or more, else 0.75 on the start with an overview; see "Controls and panels"
  minZoom?: number | { readable: "full" | "name" | "line" };   // default 0.05; a level: the zoom from which every card still shows it (readableZoom); see "Controls and panels"
  maxZoom?: number;   // default 3
  openKey?: string | number;   // opens the map again when it changes; given, a replaced graph object alone does not
  bringIntoView?: BringIntoView;   // the element brought to the centre of the view, at its zoom but at least minZoom; see "Controls and panels"
  onInView?: (shown: InView) => void;   // when the view rests on another part of the map: partInView with the zoom and the smallest zoom
}): JSX.Element;
export interface Selection { nodes: string[]; edges: string[]; groups: string[] }
export interface BringIntoView { element: ElementRef; token?: string | number }   // each new object, or token, asks again
export interface InView extends PartInView { zoom: number; minZoom: number }

export function TableAlternative(props: { graph; overlays?; scales?; locale?; selection?; onSelect?; tables?; pageSize?: number }): JSX.Element;
// A click or Enter on an activity or path row selects as a click on the map does: the row alone, nothing when it was
// selected alone, and with Shift, Ctrl or Cmd the row is added to the selection or removed from it.
// With `pageSize` every table shows one page of rows with "Previous rows" and "Next rows" buttons and a status line
// ("Rows 1–100 of 20,000"), a search field filters the rows of all tables by their text, and the tables carry
// `aria-rowcount` and their rows `aria-rowindex`. Without it (default) every row is rendered and there is no search.
// A pager button that reaches the last page ("Next rows") or the first ("Previous rows") while it has the input focus
// hands the focus to the other button, which still works there.
export function TraceTimeline(props: { traces: Trace[]; anchor?: string; annotations?: Annotation[]; locale?;
  width?; rowHeight?; colorKey?; onSelect?; table?: boolean;
  orientation?: "horizontal" | "vertical"; height?: number;   // (0.5) down a ruler, one column per case; default horizontal, 640 high
  terminals?: boolean; clusterMs?: number; timeZone?: string; stages?: readonly string[];   // (0.5)
  clusterBy?: "window" | "minute" }): JSX.Element;   // (0.6)
// A vertical timeline (0.5) draws each case down a ruler from its first event, ticked in minutes over at most two hours
// (0.6), in hours over at most two days and in days otherwise, a fractional step with its decimals ("0.5 hours", 0.6), one unit in the singular ("1 hour", 0.6); each event is a paper ring (`dimensionTokens.timelineRing` 20 across) around a dot of its colour
// (`dimensionTokens.timelineDot` 7) with its activity beside it. `terminals` adds ▶ Start and ■ End rings at the
// ruler's ends (`terminal.start`/`terminal.end`). With `clusterMs`, events that follow within it of the first of them
// are one ring labelled "7 events · SRM: Created" (`timeline.cluster`, part `timeline-cluster`); clicking it selects
// the first; with `clusterBy: "minute"` (0.6) the events of one calendar minute in `timeZone` instead, as a table's
// "same minute" column (`clusterMs` not read); the table keeps every event and adds "Elapsed (days)" and "Wait before (days)". `timeZone` (IANA) prints
// the times in that zone as "2018-03-01 15:12" and names it in the description ("Times in Europe/Berlin."); a zone the
// runtime does not know keeps UTC. With `stages`, the stage ids `colorKey` returns take the categorical colours in
// that order (`orderedCategorical`), any other key the `lineStrong` colour. The horizontal timeline is unchanged.
export function AbstractionControls(props), Legend(props), OverlayLayer(props);
export interface LegendProps { scales?: Scales; overlays?: Overlay[]; locale?: Locale; chips?: ReactNode;
  legend?: SceneLegend;   // the rows it renders: the scene's legend; without it sceneLegend(scales, overlays)
  expanded?: boolean; defaultExpanded?: boolean;   // the whole key (controlled, or where it starts; default false: the one-line strip)
  onExpandedChange?: (expanded: boolean) => void; onAnnounce?: (text: string) => void;   // see "Controls and panels"
  measure?: Measure; onMeasureChange?: (m: Measure) => void }   // both given: the whole key offers the three measures (pressed buttons in a group "Measure")
export interface AbstractionControlsProps { value; onChange; locale?; hasStages?; view?; onViewChange?;
  counts?: { activities?: KeptCount; paths?: KeptCount };   // what the sliders keep where no statement says it ("7 of 12")
  positions?: DetailPositions;      // where the sliders can stand and stand (`meta.shown.positions`); otherwise per cent of the shares
  statement?: DetailStatement;      // what is shown, beside each slider (`detailStatement`)
  drawn?: { selected: number; drawn: number };   // paths withheld at the zoom: "61 selected · 40 drawn at this zoom"
  onHighlightKept?: (on: boolean) => void;       // the kept paths' part of the statement pointed at or focused
  onAnnounce?: (text: string) => void }          // the other slider's statement, said politely; default a live region of its own
export interface KeptCount { shown: number; total: number }
export function ZoomControl(props: ZoomControlProps): JSX.Element;   // see "Controls and panels"
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
// The React Flow elements of the map, and the id of a group's compound node there.
export type WfNode = Node<ActivityNodeData, NodeKind>; export type WfGroupNode = Node<GroupNodeData, "wfGroup">;
export type WfEdge = Edge<FollowsEdgeData, EdgeKind>; export function groupNodeId(groupId: string): string;
// The props of each component by name (the components' signatures in this document spell them out):
export interface AbstractionControlsProps { value: AbstractOptions; onChange; locale?; hasStages?; view?; onViewChange? }
export interface TableAlternativeProps { graph; overlays?; scales?; locale?; selection?; onSelect?; tables?; pageSize?; className? }
export interface TraceTimelineProps { traces: Trace[]; anchor?; annotations?; locale?; width?; rowHeight?; colorKey?; onSelect?; table?; className?;
  orientation?; height?; terminals?; clusterMs?; timeZone?; stages?;   // (0.5)
  clusterBy? }   // (0.6)
export interface TraceEvent { activity: string; canonicalId?; timestamp: string | number | Date; resource?; lifecycle?; violates?: string[] }
export interface ContextMenuProps { x; y; title: string; subtitle?; note?; actions: MenuAction[]; locale?; onAction; onClose; returnFocusTo?;
  boundsRef?; className? }
export interface PathListProps { graph; focus: Focus; paths?: FlowPaths; locale?; selection?; onSelect?; onHover?; onClose?; sort?; ascending?;
  onSortChange?; className? }
export interface FilterChipsProps { filter?: Filter | FilterClause[]; preview?; locale?; labelOf?; onFilterChange?; onAnnounce?; clearable?; className? }
export interface CanvasMapProps { scene: PreparedScene | undefined; state: DrawState; edgeBudget?; onEdgesShown?; … }   // see "Canvas"
export interface FlowComparisonProps { cohorts: FlowComparisonCohort[]; noun?: string; onSelect?: (cohortId: string) => void }
export interface FlowComparisonCohort { id: string; label: string; cases: number; graph: FlowGraph }   // cases: distinct, with those without events
export type ViewSwitcherProps = Parameters<typeof ViewSwitcher>[0];   // see "Views"
export type BpmnViewProps = Parameters<typeof BpmnView>[0];   // see "BPMN"; also from wise-flow/bpmn
export const emptyBpmnSelection: BpmnSelection;   // { tasks: [], flows: [], lanes: [] }; also from wise-flow/bpmn
```

The node and edge components draw what the scene's marks say: texts,
glyph, band and dashing of nodes, route, dash and count label of edges.
Labels arrive shortened and names wrapped by the scene's text measure, and the
components write them as they are; the stylesheet adds no ellipsis of its own
(a font wider than the measure is clipped at the box), and the full name stays
in the node's description. The map's measure is `textMeasure`, by default the
browser's: `canvasTextMeasure` in the theme's font (the font the map's
`theme` and its `--wf-font` variable resolve to), created again once the
page's fonts have loaded or the font changes, and the estimate where there is
no 2D canvas (jsdom, a server). With activity labels the map sizes the boxes
by the same measure (`activityNodeSize`). Pass one measure for the life of a map, since a new one
lays the activity boxes out again, and the same measure to `toSVG` and `toPNG`
for the map's lines in the exports. `<ViewSwitcher/>`'s grid shows, per
distinct style, one legend: the scales of its first view and a key for each
kind of mark that any of its views' maps draws, built in the switcher's
`theme` and the page's scheme.

`describeMap` names the activity and path thresholds when `meta.abstraction`
is the object `abstract` records; a server's numeric threshold share is not
described.

`<ProcessMap/>` behaviour: collapse (stage view) runs before the thresholds
and gets its own layout; thresholds filter positions, so sliding the
controls never moves the surviving elements. Given `positions` are used
as long as they cover the graph. Follows self-loops become self-loop
overlays. Keyboard: arrow keys move focus between the elements with a box
(activities, events, gateways, notes and stage nodes), Alt with an arrow key
along the paths, Space selects, Enter opens the actions menu
(selects when `contextMenu` is false), Shift with an arrow key extends the
selection, Escape clears, Home and End jump to the first and the last
element with a box, left to right and top to bottom. In the table view the
keys are the table's (its rows, search field and pages); only Escape from a
row clears the selection there, as on the map. `aria-activedescendant`
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
element along the paths. The live region and the map's description then
say how many activities and paths there are and that the table view lists
all of them. Above the same limit the table view shows 100 rows per page with
a search field (`TableAlternative` with `pageSize`), whichever renderer draws
the map: a React Flow map above the limit gets the paged table too, while its
own elements stay in the DOM as before. At or below the limit nothing
changes. A limit below one is read as one, so that the list always holds the
element the keyboard is on (up to 0.3.5 a limit of 0 or less left the list
empty while `aria-activedescendant` named the keyboard position).
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
provisional. Given positions that stop covering the graph (a node added
that they do not place) hand the map to its own layout: its first scene then
starts from the map's own earlier layout, if it had one, not from the given
positions on screen. That case lies outside the first scene described here,
which is that of a map without positions; how a map moves from one set of
given positions to the next is for a later version to define.

Hiding a map with React's `<Activity mode="hidden">` runs the cleanups of its
effects, as an unmount does: its layout scope is released (the layouts kept
for earlier abstraction levels are forgotten and idle workers terminated) and
a running layout is aborted. Showing it again lays the map out again, with the
provisional arrangement first. React does not tell hiding apart from
unmounting, so the map does not keep the scope while hidden.

`useStableLayout(scenes, options)` returns `positions` from the first render:
a finished layout of the same inputs (status `"ready"`), or provisional
positions as above with `provisional: true` and status `"pending"`; when the
layout arrives, `positions` are replaced once by it (`"ready"`,
`provisional: false`). Without scenes the status is `"idle"`; a failed layout
gives `"error"` with `positions` undefined, as before, except a
`LayoutUnavailableError`: then the provisional positions stay, with
`provisional: true`, status `"error"`, the error, and `positions.final`
true: no layout will replace them (a new object; the positions shown while
pending are not changed). Until this release
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
`"error"`. So does a map given positions that are `final`, such as those
`useStableLayout` keeps then: up to this change a map given them said
"Arranging the map…" with `data-layout-status="pending"` for good. Other
layout errors are shown as before.

Stylesheets: `wise-flow/tokens.css` (design tokens, light and dark) and
`wise-flow/style.css` (components and React Flow's styles, in the cascade
layer `wf`), or, on a page with an unlayered reset, `wise-flow/style.unlayered.css`
after `wise-flow/react-flow.css` (see "Styling contract").
`tokens.css` defines `--wf-font`, `--wf-font-mono`, the themed colours
(`--wf-paper`, `--wf-surface`, `--wf-ink`, `--wf-ink-muted`, `--wf-line`,
`--wf-line-strong`, `--wf-focus`, `--wf-pressed`, `--wf-on-pressed`,
`--wf-pattern-ink`, `--wf-selection`, `--wf-hover`, `--wf-neutral`,
`--wf-out-of-scope`, `--wf-warn`, `--wf-fail`) and `--wf-color-scheme`,
`--wf-radius`, `--wf-radius-lg`, `--wf-shadow` and the default node boxes
(`--wf-node-width` and `--wf-node-height` for activities, `--wf-stage-*`,
`--wf-gateway-*`, `--wf-event-*` and `--wf-note-*` with `-width` and
`-height`), and the size, radius, stroke, dash, opacity, z-order and spacing
roles of the token table (see "Design tokens"), which the stylesheet reads.
Nodes and groups are drawn from their marks (see "Scene"): the components set
a node's `--wf-node-fill`, `--wf-node-outline`, `--wf-node-stroke`,
`--wf-node-radius` and `--wf-node-band`, a group's `--wf-group-color`,
`--wf-group-fill`, `--wf-group-radius`, a band's `--wf-group-outline`,
`--wf-group-top`, `-right`, `-bottom`, `-left` and `--wf-group-rule`, and each
text's `--wf-text-size`, `--wf-text-weight` and `--wf-text-paint` from the
mark, and the stylesheet keeps their layout and interaction. A gateway's
diamond and a dashed outline (a re-added node's) are the mark's shape in `svg.wf-node__outline`
(the node then has the class `wf-node--outlined`), a box group's
outline is `svg.wf-group__outline`. The role variables of node and group
outlines, tints and texts (`--wf-stroke-node`, `--wf-stroke-stage`,
`--wf-stroke-event-end`, `--wf-stroke-group`, `--wf-stroke-band`,
`--wf-text-node-label`, `--wf-text-node-count`, `--wf-text-event-label`,
`--wf-text-note-label`, `--wf-text-group-label`, `--wf-text-activity-name`,
`--wf-text-activity-number`, `--wf-weight-stage-label`,
`--wf-weight-gateway-glyph`, `--wf-weight-activity-name`,
`--wf-weight-group-label`, `--wf-radius-circle`, `--wf-opacity-group-fill`,
`--wf-opacity-band-fill`, `--wf-opacity-band-odd-fill`, `--wf-size-band`) are
no longer defined: those values come from the theme.
A host that sets one of them, or any other `--wf-*` variable of a theme part,
on the map's container sets that part of the map's theme (see "Theme of a map
in a page"), so the Canvas map draws it too and an export given that theme. The variables nothing read
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
// GroupNodeData.mark?: GroupMark  what the group looks like (`FlowScene.groupMarks`); resolved from `group`, `color` and `band` without it.
// The tint layers lie over the group's own tint (`background-image`), as a tint mark lies over the group in the exports.
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
redundant).

Versions. While the version is 0.x, a minor release may remove or change a
name, a type or a behaviour a host relies on; each such change is named in
its Changeset (as `minor`) and in the upgrade notes of the release. From
1.0 on, a change that breaks
a host comes only in a major version, and a name to be removed is first
deprecated (marked `@deprecated` and listed under "Deprecated names") for at
least one minor release. The names listed under "Removed in the next
version" stay removed.

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
`shareScales` (default) the domain of a metric on a colour channel is its
extent over all views, and every view's width runs from 0 to one upper end,
the strongest path of any view before abstraction, or of a view's own merged
metrics where they give more (`edgeWidth.max`, unless the view's style gives a
`max` or a `domain`), so equal colours and widths mean
equal numbers across the views; the filled-in domains and upper ends are
returned in `views[i].style` and `domains` (`"edgeWidth:count"` as `[0,
max]`, `"edgeColor:medianLagHours"`, …). Up to 0.3 the views shared the
width's `domain`, the extent of its values. A path's colour reads what its
width reads: where the style names `cases` and no path of any view gives
cases but one gives a count, both the width and the colour read the counts
(`"edgeColor:count"`), decided once for all views as the scales decide it for
one graph. Up to 0.3.5 the colour kept `cases` and took the domain `[0, 1]`,
so two paths of 5 and 500 transitions were drawn in the same colour.

## BPMN (`wise-flow/bpmn`, 0.2)

```ts
// BPMN-lite: BPMN shapes in the FlowGraph vocabulary (activity nodes tagged `task`,
// gateway nodes tagged xor/and + split/join, event nodes tagged start/end, `flow` edges, `lane` groups).
export interface StageActivity { id; label?; role?; optional?; loop?; tags?; metrics? }
export interface Stage { id; label?; activities: (StageActivity | string)[]; role?; flow?: "sequence" | "choice" | "parallel"; optional? }
export interface StageModel { id?; label?; stages: Stage[] }
export interface LiteFromStagesOptions { lanes?: "stage" | "role" | "none"; startLabel?; endLabel? }
export function liteFromStages(model: StageModel, o?: LiteFromStagesOptions): FlowGraph;
export interface LiteFromGraphOptions { abstraction?: AbstractOptions; andGateways?: boolean;   // AND only as a split/join pair
  lanes?: "groups" | "none"; selfLoops?: "marker" | "flow" | "drop" }
export function liteFromGraph(g: FlowGraph, o?: LiteFromGraphOptions): FlowGraph;
export function gatewayLabel(tags: string[] | undefined): string;   // Choice, Merge (XOR), Parallel, Join (AND)
export function stageModelFromGraph(g: FlowGraph, o?: { limit?: number; label?: string }): StageModel;
export function liteCounts(g: FlowGraph): { tasks; gateways; events; flows; lanes };
export const START_ID = "__start", END_ID = "__end", TASK_TAG = "task", LOOP_TAG = "loop", GENERATED_TAG = "generated";

// Layout for BPMN diagrams: ELK layering along the flow, lanes as stacked full-width bands in one pool,
// orthogonal sequence flows; BPMN shape sizes (task 100 × 80, gateway 50, event 36).
export function layoutBpmn(g: FlowGraph, o?: BpmnLayoutOptions): Promise<Positions>;
export interface BpmnLayoutOptions extends Omit<LayoutOptions, "direction" | "groups"> {
  lanes?: "bands" | "compound" | "ignore"; rowGap?; lanePadding?; labelWidth?; poolPadding? }
export const POOL_ID = "__pool";   // pool box in Positions.groups when the graph has lanes but no pool group
export const BPMN_SIZES: Record<NodeKind, NodeSize>;   // the shape sizes bpmn-js and Camunda Modeler draw
export function bpmnNodeSize(n: FlowNode): NodeSize;   // BPMN_SIZES of the node's kind

// Export → BPMN 2.0 XML with BPMNDiagram / BPMNShape / BPMNEdge from the positions.
export interface ExportBpmnOptions { positions?: Positions; layout?: BpmnLayoutOptions; id?; processId?; name?;
  format?: boolean; extension?: boolean; participant?: boolean }
export interface BpmnExport { xml: string; positions: Positions; ids: IdMap; warnings: string[] }
export function exportBpmn(g: FlowGraph, o?: ExportBpmnOptions): Promise<BpmnExport>;
export interface BpmnValidation { ok: boolean; warnings: string[]; counts; missingDi: string[] }
export function validateBpmn(xml: string): Promise<BpmnValidation>;
export function exportableEdges(g: FlowGraph): FlowEdge[];   // the edges the export turns into sequence flows
export const EXPORTER_NAME = "wise-flow", EXPORTER_VERSION, TARGET_NAMESPACE = "http://wise-workbench.org/bpmn";   // written into the XML
export function xmlId(id: string, taken?: Set<string>, prefix?: string): string;
export function roundPositions(p: Positions): Positions;
export interface IdMap { toBpmn: Record<string, string>; toFlow: Record<string, string> }

// Import ← BPMN 2.0 XML.
export interface ActivityRef { id: string; label?: string; aliases?: string[] }
export interface MappingRow { taskId; nodeId; label; type; lane?; activityId?; matchedBy?: "id" | "label" | "alias" | "manual" }
export interface ImportBpmnOptions { activities?: ActivityRef[]; positions?: boolean; keepIds?: boolean;
  subProcesses?: "stage" | "activity"; normalize?: (s: string) => string }
export function importBpmn(xml: string, o?: ImportBpmnOptions):
  Promise<{ graph: FlowGraph; mapping: MappingRow[]; positions?: Positions; warnings: string[]; ids: IdMap; processId? }>;
export function matchActivities(mapping: MappingRow[], activities: ActivityRef[], o?): MappingRow[];
export function applyMapping(g: FlowGraph, mapping: MappingRow[] | Record<string, string>): FlowGraph;
export function mappingIndex(mapping): { toTasks: Record<string, string[]>; toActivity: Record<string, string> };
export function normalizeLabel(s: string): string;
export function positionsFromDi(definitions: ModdleElement, ids: IdMap, warnings?: string[]): Positions | undefined;

// Ids: FlowGraph id ↔ BPMN id ↔ activity id. An element is named by its BPMN id, its FlowGraph id
// and every activity id the mapping points at either of them (the alias rule).
export type ActivityMapping = MappingRow[] | Record<string, string>;   // activity id → task (FlowGraph or BPMN id)
export interface IdResolverOptions { ids?: IdMap; mapping?: ActivityMapping }   // ids of importBpmn or exportBpmn
export function createIdResolver(o?: IdResolverOptions): IdResolver;
export type BpmnElementRef = string | ModdleElement;   // a BPMN id or a moddle element
export interface IdResolver {
  flowId(element: BpmnElementRef): string;                // BPMN id or moddle element → FlowGraph id
  bpmnId(flowId: string): string | undefined;
  activityId(flowId: string): string | undefined;
  flowIdsOfActivity(activityId: string): string[];
  names(element: BpmnElementRef): string[];               // BPMN id, FlowGraph id, mapped activity ids
  matches(element: BpmnElementRef, id: string): boolean;
}
export interface ActivityRenaming { renamed: Map<string, string>; toMapped(flowId: string): string; toFlow(mappedId: string): string }
export function renameToActivities(nodeIds: string[], r: IdResolver): ActivityRenaming;   // as applyMapping renames: <activity>#2, #3 for more
export function createIdMap(): IdMap;
export function registerId(ids: IdMap, bpmnId: string, flowId: string): void;

// bpmn-moddle with the `wise` extension (ids, kinds, tags, metrics through the XML).
export function createModdle(): BpmnModdleInstance;
export const wiseModdleDescriptor, WISE_NS = "http://wise-workbench.org/schema/flow";
export function flowIdOf(el), wiseAttr(el, name), isType(el, type), isAnyType(el, types), tagOfType(type), typeOfTag(tag);

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
export interface BpmnViewHandle { viewer(): unknown; saveXML(): Promise<string | undefined>; saveSVG(): Promise<string | undefined>;
  fit(insets?: Partial<Insets>): void }   // the diagram inside the view less the insets; default clear of the view's panels (see "Controls and panels")
export function ViewSwitcher(props: { views: ViewSet; mode?: "single" | "grid"; onModeChange?; activeView?; onActiveViewChange?;
  columns?; locale?; selection?; onSelect?; onHover?; legend?; lod?; minimap?; className?; containerStyle?;
  edgeBudget?: EdgeBudget | "adaptive"; minPathPx?: number; theme?: ThemeSetting }): JSX.Element;   // from wise-flow/react; edgeBudget, minPathPx and theme are passed to every view's map
```

Layout of a BPMN model where no `Worker` exists (Node): `layoutBpmn`, and
`exportBpmn` without `positions`, run the Dagre fallback whatever the size
(`fallbackLimit` defaults to no limit there), since there is no page to
freeze; a model whose ELK layout fails or times out is laid out by Dagre, as
up to 0.3.5. In a browser the limit of 500 nodes plus flows stays (pass
`dagreWorkerUrl` to lay out larger models when ELK fails), and a
`fallbackLimit` given is kept everywhere. Up to this change such a model
ended in `LayoutUnavailableError` in Node too.

Text in `exportBpmn`: the file is XML 1.0 that any conforming parser reads.
A character XML 1.0 does not allow (U+0000 to U+001F other than tab, line
feed and carriage return, U+FFFE, U+FFFF, an unpaired surrogate) is dropped
from every text the export writes, and `warnings` names each label (`label
of <id>: …`) and each id kept in `wise:flowId` (`id <id>: …`) that lost one.
Tab and carriage return are written as `&#9;` and `&#13;`, as a line feed is
as `&#10;`, so that a parser keeps them in names and texts alike, and the
library's import reads them back unchanged. Up to 0.3.5 they were written
as they were: other XML tools rejected a file with such a character, and a
conforming parser read a tab or a carriage return as a space or a line feed.

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
`andGateways` every gateway is XOR, as before. Edges between the same two
nodes other than constraints (two follows edges, or a follows edge and a
flow) become one flow, with the id, tags and payload of the edge with the
smallest id and their counts and cases summed; self-loops between one node
likewise become one loop marker with their counts summed. Up to 0.3.5 they
became several flows with one id, so the graph failed `validateGraph` and
its BPMN export wrote one id twice. A flow whose id another edge of the input
already has gets `:1` after it (`:2` next).

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
when the selection was cleared. The view speaks of a selection by its
FlowGraph ids (a controlled selection in activity ids is resolved through
`mapping`), so a selection that stays the same is not announced again when
only `mapping` changes or when the import arrives with a mapping; up to this
change the renaming for the table counted as a new selection, and "Selected:
…" was spoken again.
Every id the view matches (overlay targets, controlled selection, reported
selection and hover) goes through `createIdResolver` with the import's id
map and `mapping`. Stylesheets: `wise-flow/bpmn.css` (bpmn-js's
`diagram-js.css`, `bpmn-js.css` and `bpmn-font/css/bpmn.css`, shipped with the
package) in addition to the package's.

The view draws on bpmn-js 18 and reads and writes BPMN with bpmn-moddle 10;
up to 0.3.5 it was bpmn-js 17 and bpmn-moddle 8. For hosts this changes
three things. The diagram's canvas is a stop in the tab order: focused, it
shows a focus ring and takes the keyboard (Ctrl or Cmd with an arrow key
moves the diagram), since bpmn-js binds the keyboard to the canvas itself;
`keyboard.bindTo` in `viewerOptions` does nothing but log an error to the
console, and `keyboard: { bind: false }` leaves the keys alone. bpmn-js 18
draws the selection outline only in its modeler, so the view adds bpmn-js's
outline module ahead of the `additionalModules` a host passes, and a
selected task is outlined in the viewer as before; modules written for
bpmn-js 17 may need their bpmn-js 18 versions. An external label (of an
event, a gateway or a flow) is laid out in the bounds its `BPMNLabel` gives,
where bpmn-js 17 laid it out in a box 90 units wide: a label whose bounds
another modeler measured narrower than its text now breaks into lines.
`exportBpmn` writes no label bounds, so its labels are fitted to their text.

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
- New entry point `wise-flow/bpmn`; `<BpmnView/>` and `<ViewSwitcher/>`
  are also exported from `wise-flow/react`.

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
cases relative to the activity's cases, and none is derived where either
is a lower bound (a collapsed stage and its merged paths, `metricBasis`). A group focus stands for its
members, nested groups included (paths crossing the outer boundary). `pathBetween` is the shortest, then
strongest path (Dijkstra on hops with a small penalty for weak paths, so
the result is deterministic) and the reverse path when one exists.
`focusHighlight` and `<PathList/>` read a focus that is not a pair as one
id, also the missing id of a node a backend sent without one; up to 0.3.5
such a focus threw a `TypeError`.

### Filters

```ts
export type TimeMode = "case_start" | "case_end" | "active" | "events_inside";   // events_inside: deprecated, removed in the next minor version
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

**The time mode `events_inside` is deprecated** and is removed in the next
minor version; this version keeps it as it was. A time clause with it keeps
only the events inside the window and so cuts events out of cases, while a
selection is a set of whole cases. Nothing in the library makes such a
clause: it reaches the library only in `filters` from a host, which gets it
back unchanged in `onFilterChange`; `describeClause` writes it "events
inside {from} – {to}" ("Ereignisse innerhalb …"), and `changesCases` and
`<FilterChips/>` mark it as changing cases. Migration: express the window by
`case_start`, `case_end` or `active` (a case that starts, ends or is active
in it), which keeps whole cases; where a host needs only the events in a
window, it trims them itself, outside the filter. Once removed, TypeScript
reports a clause that names it, and a clause that still carries it at run
time is a time clause of a mode the library does not know.

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
`manhattanRoute` was removed from `wise-flow/bpmn`; use `routeSequenceFlows`.

### React (`wise-flow/react`, 0.3)

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
  onAnnounce?: (text: string) => void; onEdgesShown?: (shown: ShownEdges | undefined) => void;
  theme?: ThemeSetting;   // its colours and font, over its --wf-* variables; see "Theme of a map in a page"
  fitInsets?: Partial<Insets>;   // kept clear when the view is fitted; default: clear of the panels over the map (see "Controls and panels")
  minPathPx?: number;   // the narrowest line on the screen a path is drawn at; default 0.5, 0 draws every path; see "Paths at a small zoom"
  opening?: "readable" | "fit"; openKey?: string | number;   // default readable; openKey: a replacement graph, default scene.graph
  minZoom?: number; maxZoom?: number;   // default 0.05 and 3; given, a fit that cannot show the whole map at minZoom shows it from the start, with the overview
  inView?: PartInView }   // what the view shows, said to assistive technology with the overview
  & { ref?: Ref<CanvasMapHandle> }): JSX.Element;
export interface CanvasMapHandle { centerOn(id, zoom?);   // a node, a group or an edge (elementPoint)
  fit(insets?: Partial<Insets>); zoomBy(factor); screenBox(id): Box | undefined; renderer(): CanvasRenderer | null;
  moved(): boolean }   // true when the view changed since the map last opened or was fitted
```

`<CanvasMap/>` (and `<ProcessMap renderer="canvas"/>`) follows the theme: it
draws in the colours and the font `useFlowTheme` resolves for its element (its
`theme` prop over that element's `--wf-*` variables, its own and inherited,
over the preset), and redraws, without preparing the scene again, when they change
(see "Theme of a map in a page"). Sizes, radii and strokes are the scene's.
It no longer calls `readTokens`.

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

## Canvas (`wise-flow/canvas`, 0.3)

```ts
export interface PreparedScene extends FlowScene { shapes: OverlayShape[]; nodes: SceneNode[]; edges: SceneEdge[];
  groups: SceneGroup[]; bounds: Box; hit: HitIndex; size: number; nodeById; edgeById; groupById; shapeById; labelCache }
export function prepareScene(g: FlowGraph, p: Positions, o?: { activityLabels?; style?; overlays?; lod?; lodBySize?: boolean; locale?;
  lanes?: LaneMode; bands?: LaneBand[]; overlayGeometry?; selfLoops?: boolean; theme?: ThemeSetting; scheme?: ColorScheme;
  textMeasure?: TextMeasure }): PreparedScene;   // the texts are drawn as this measure fitted them
export interface DrawContext { /* the subset of CanvasRenderingContext2D the routines use */ }
export interface View { x: number; y: number; zoom: number; width: number; height: number }
export interface DrawState { selection: Selection; hovered?: string | null; focused?: string | null; bright?: { nodes: Set<string>; edges: Set<string> };
  highlighted?: ReadonlySet<string> }   // edges on a highlighted path, drawn first, heaviest first, within the edge budget
export interface DrawOptions { tokens?: CanvasTokens; cull?: boolean; background?: boolean | string; lodZoom?: number; createCanvas?;
  edgeBudget?: EdgeBudget | ShownEdges;   // default "all"
  readable?: Readable;                    // what the texts show; default readableAt at lodZoom with the theme's minScreenPx
  readableFrom?: Readable;                // the state of the frame before, whose hysteresis the decision keeps
  numbers?: readonly (MarkText & { from?: XY; box?: Box })[];   // numbers, optional card links and paper backing boxes
  pathRule?: { minPx: number; zoom?: number } }   // the paths drawn at a small zoom (pathsAtZoom) at zoom, the view's by default; default none
export function drawScene(ctx: DrawContext, scene: PreparedScene, view: View, state?: DrawState, o?: DrawOptions): { nodes; edges; shapes; culled;
  kept?: number;   // with an edge budget other than "all": the protected edges drawn, which every budget draws
  withheld?: EdgeSelection;   // present when the edge budget left edges in view out, or the path rule paths of the map
  readable: Readable };   // the state the texts were drawn in
export function drawLegend(ctx: DrawContext, scene: PreparedScene, x, y, width, tokens?, o?: { createCanvas? }): number;   // the scene's legend rows; returns their height
export function canvasTextMeasure(family?: string, context?: { font; measureText } | null): TextMeasure;   // Canvas measureText in the font; the estimate without a canvas
export function tracePath(ctx: DrawContext, d: string): { last?; beforeLast? };
export const emptyState: DrawState;   // nothing selected, hovered or focused
export function selfLoopOverlays(g: FlowGraph, locale?: Locale): Overlay[];   // followsSelfLoops, as <ProcessMap/> draws them
export function groupLabelOf(scene: PreparedScene, id: string | undefined): string | undefined;
export interface CanvasRendererOptions { tokens?; devicePixelRatio?; minZoom?; maxZoom?;
  draw?: RendererDrawOptions; clock?: () => number }   // clock: ms, read by the adaptive edge budget only; default performance.now
export class CanvasRenderer { constructor(canvas: HTMLCanvasElement, o?: CanvasRendererOptions);
  drawOptions: RendererDrawOptions;   // DrawOptions without tokens; edgeBudget may also be "adaptive"; pathRule decided at the zoom the view last rested at
  beginGesture(); endGesture();   // a pan or zoom gesture; see "Edge budget" and "Paths at a small zoom"
  resize(w, h); setScene(s); getScene(); setState(patch: Partial<DrawState>); getState(); setTokens(t);
  getViewport(); setViewport(v, notify?); fit(padding?, insets?: Partial<Insets>); panBy(dx, dy); zoomBy(factor, centre?); centerOn(point, zoom?);
  toFlow(x, y); toScreen(x, y); screenBox(id); hitAt(x, y, tolerancePx?): HitItem | undefined; requestDraw(); draw(); dispose();
  onViewportChange?: (v: Viewport) => void; lastDraw?: { nodes; edges; shapes; culled; withheld?; readable; ms };   // the next draw keeps its readable state's hysteresis
  onDraw?: (stats: { nodes; edges; shapes; culled; withheld?; ms }) => void }   // called after every draw
export interface CanvasTokens { font; paper; surface; ink; inkMuted; line; lineStrong; cueStripe?; cueFoot?; patternInk?; focus; selection; neutral; outOfScope }
// cueStripe and cueFoot: the frequency cue's colours; patternInk: the pattern twins' ink (it was `ink`); drawScene, drawLegend
// and toPNG take the scene's, in its scheme, where tokens a host builds leave them out
export const defaultTokens: CanvasTokens;   // from the token table (`colorTokens`, `fontTokens`); without `tokens` a draw takes the scene's colours and font
export function readTokens(element: Element | null | undefined, overrides?: Partial<CanvasTokens>): CanvasTokens;   // from the CSS variables (`cssVariable(key)`), as they are; <CanvasMap/> reads them with useFlowTheme instead
export interface PngOptions { readable?: Readable;   // as in ExportOptions
  preset?: FigurePreset; width?; scale?; background?; legend?; padding?; lodZoom?; tokens?; createCanvas?; context?;
  widthMm?: number;   // the width the figure is declared at, as in ExportOptions; drawn `width` CSS pixels wide (default as laid out)
  edgeBudget?: EdgeBudget | ShownEdges;   // default every edge; see "Edge budget"
  theme?: ThemeSetting; scheme?: ColorScheme;   // what the figure is drawn in (default the print preset, light); `tokens` override the scene's colours and font
  textMeasure?: TextMeasure }   // as in ExportOptions
export interface CanvasLike { width; height; getContext(kind: "2d"): unknown; toBlob?; convertToBlob?; toDataURL? }   // HTMLCanvasElement, OffscreenCanvas
export interface PngCanvas { canvas: CanvasLike; width; height; cssWidth; cssHeight; scale }   // bitmap and CSS size
export function toPNGCanvas(scene: Scene, o?: PngOptions): PngCanvas;
export function toPNG(scene: Scene, o?: PngOptions): Promise<Blob>;
export function toPNGDataUrl(scene: Scene, o?: PngOptions): string;
```

`prepareScene` is pure and runs in Node: it builds the core scene
(`buildScene`) and adds what the Canvas renderer needs, every element's box
or route, colours and labels resolved once and the R-tree that serves
hover, click and viewport culling. The hit index and the edge budget find an
element by its place in the scene's lists (`nodes`, `edges`, `groups`,
`marks`, `edgeMarks`), so a host does not replace those lists (with a
filtered copy, say): a culled draw then drops elements, and a budget draws
other edges than it chose. To draw fewer elements, filter the graph and
prepare the scene again. The overlays are `o.overlays`, or
`graph.overlays` without it, each drawn once. `lodBySize` (default true)
tightens the level of detail with the number of nodes for a fitted live
map; `bands` keeps caller-computed bands and the positions as given. `drawScene` issues plain 2D
context calls (a screen canvas, an offscreen canvas for PNG, or a
recording stub in tests): groups and bands, the scene's overlay marks below
the edges (tints), edges with arrowheads, the marks between the edges and
the nodes (arcs), nodes with pattern twins, the marks above the nodes, edge
labels; level of detail follows
`lodAt(o.lodZoom ?? view.zoom)` and each mark is drawn from its `minZoom`,
and the texts are kept readable at that zoom (`o.readable`, by default
`readableAt` with the theme's `text.minScreenPx`; see "Readable at every
zoom");
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
grown by 6, or by more where the theme draws wider (half its outline, the
selection ring's width `stroke.canvasSelection`, the focus rectangle 4
outside the box and half `stroke.focus`; by default the ring reaches 2 outside
the box and the focus rectangle 5; a gateway's diamond is as tall as it is
wide) and its texts; a group's its box grown by 1.5 or by half the widest of
its outline, its rule and the selected outline (`stroke.canvasGroupSelected`),
and the texts of its mark (its title); an overlay mark's
its box grown by half its stroke or by the reach of its arrowhead (10.8, the
base of the triangle behind the path's end) and its texts; an edge's each
segment grown by the most of half its width, half the highlight stroke
(`stroke.canvasPathHighlight`) and the reach of its arrowhead, which grows
with the path's width, at least by the hit tolerance of 4, and the segment
nearest the path's count by that count's text. A text's extent is its width
by the scene's text measure, at least 0.7 em per character, and at most its
limit (a shortened text keeps a character and the ellipsis), 1 em above an
alphabetic baseline and 0.35 em below it, 0.6 em each way from a middle
baseline, and the halo around it (at least 1.5, half `stroke.halo`); a font
wider than its measure can still lose the last pixels of a label at the edge
of a culled view. The index rounds every bound outwards to a whole unit, so an element
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
scene: overlays, follows self-loops (`Scene.selfLoops`, default shown),
level of detail at `lodZoom` (default 1, or the map's scale in a figure with
a floor, without tightening by size) and the texts the frame keeps readable
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
- New entry point `wise-flow/canvas`; `<ContextMenu/>`, `<PathList/>`,
  `<FilterChips/>` and `<CanvasMap/>` exported from `wise-flow/react`.
- New strings `selection.*`, `menu.*`, `paths.*`, `filters.*`, `clause.*`,
  `lanes.*`, `unit.*`, `map.focus`, `map.focusPair`, `map.focused`,
  `map.renderer.canvas`, `map.zoomIn`, `map.zoomOut`, `map.fit` (en, de);
  `map.instructions` names every keyboard route.


## Changes in 0.4 against 0.3 (the instrument look)

- `theme="instrument"` (`instrumentTheme`, `instrumentTokens`): the WISE look,
  light and dark, passing `checkTheme`; `Theme.size`, `Theme.readable`,
  `Theme.arrowhead`; colour role `terminal`.
- A card's band only where its colour says something (`Scales.nodeColored`).
- Start and End with ▶ / ■ and their names; terminal paths (`Scales.terminal`,
  `terminalOf`, `EdgeMark.terminal`, contract states `start`/`end`), from
  follows edges and from host-tagged sequence flows.
- The host's wording (`strings`, `Strings`, `createStrings`, `t` with
  overrides) on the scene, the map, its panels and the exports;
  `hideAttribution`.
- Names shortened after whole words (`TruncateOptions.words`).
- Panel placement (`legendPosition`, `controlsPosition`, `overviewCorner`),
  `fitInsets` added to the panels' room by default (`mode`), `minimap:
  "overflow"`; `insetBoxes`, `cornerBox`, `panelBoxes`.
- Labels by width on the screen (`lod.edgeLabels: { minPx }`), around a
  selection (`lod.selectedPaths`, `style.selectedShare`, `emphasisLabel`),
  backward paths a step thinner until selected (`EdgeMark.lift`).
- Heads from the theme with a narrowest path (`Arrowhead.minWidth`; breaking
  for readers of marks: `EdgeMark.arrow` is optional), paths painted the
  widest first (`paintOrder`).
- The self-loop as a pill on the border (`OverlayGeometryOptions.selfLoop`,
  `badgeAnchor`; `ProcessMapProps.overlayGeometry`).
- "≥" on a collapsed stage's card, exact host stage numbers
  (`FlowGroup.metrics`), legend key `atLeast`.
- Exports in the instrument look with the caption's terminal sentence; a map
  follows `data-theme` on the nearest element around it.

## Abstraction identity and interaction notes

`abstract` and `collapseGroups` preserve response `focus` and `paths` so a focused
payload cannot be relabeled as another activity's paths. Collapsed stages retain
original activity IDs in `graph.meta.collapsedMembers`; original edge IDs map to
displayed edges or containing stages in `graph.meta.collapsedEdgeTargets`; an
upper bound of each stage's cases is in `graph.meta.collapsedCasesAtMost`. These
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

`FlowComparison` from `wise-flow/react` accepts `cohorts: { id, label, cases, graph }[]`, optional plural `noun`, and optional `onSelect(cohortId)`. Import the package tokens and stylesheet.

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

The helpers the renderers share, for hosts that draw activities themselves:

```ts
export function activityLabel(n: FlowNode, o: ActivityLabelOptions): string;   // the reference ("ids") or the name ("names")
export function activityNodeCounts(n: FlowNode, o: ActivityLabelOptions, locale?: Locale): string;   // the node's one measure: distinct cases or items, grouped in full
export function activityCounts(n: FlowNode, o: ActivityLabelOptions, locale?: Locale, exact?: boolean): string;   // both measures, grouped in full
export function activityDescription(n: FlowNode, o: ActivityLabelOptions, locale?: Locale): string;   // reference, name and exact counts
export function activityLabelLines(n: FlowNode, o: ActivityLabelOptions, width: number, locale?: Locale, measure?: TextMeasure): { name: string[]; counts: string[] };
export function activityKeyLines(g: FlowGraph, o: ActivityLabelOptions | undefined, width: number, locale?: Locale, measure?: TextMeasure): string[];   // the exported key
export function wrapActivityText(value: string, width: number, fontSize?: number, measure?: TextMeasure): string[];   // `wrapText` by the measure
```

Use `nodeSize` when providing precomputed positions (`activityNodeSize(node, activityLabels, textMeasure)`; the measure no longer changes the size). Names reserve 280px width, IDs 140px, and both the card's height (64px: two name lines and the number line), whatever the name. Hiding counts does not change dimensions. `useStableLayout` compares resolved dimensions, so equivalent callbacks do not trigger layout. Invalidate an explicit layout cache key when its inputs change.

`references` maps canonical activity IDs to display references. Persist the dictionary across filters; absent entries are retained and new entries are added without renumbering. References indicate identity, not execution order. Optional `names` supplies display aliases; the original graph is unchanged.

Nodes show the card's number line: the distinct cases/items grouped in full ("1,107 items"; up to 0.3 compact, "1.1k items") and their share of the log's cases (see "The activity card"). Hover, focus and the export key show the original name plus exact item and event counts in `caseLabel`; `activityCounts` writes them in full whatever its `exact` argument says. Missing values are marked unavailable. Tooltips are dismissible with Escape and remain visible while their trigger or tooltip is hovered. Selecting an activity returns its canonical ID.

SVG and Canvas PNG exports include the canonical activity key even when the colour legend or node counts are hidden. Recorded self-loop labels describe transition occurrences; a case repeat share is reported only when the required case counts exist. Explicit constraint evidence remains separate.


## Text measure

```ts
export type TextMeasure = (text: string, font: { size: number; weight?: number }) => number;
export const estimateTextWidth: TextMeasure;   // 0.55 em per character, a full em for CJK, kana, Hangul, full-width forms and emoji
export function truncateText(text: string, maxWidth: number, font: { size: number; weight?: number }, measure?: TextMeasure, options?: TruncateOptions): string;
export interface TruncateOptions { words?: boolean }   // after whole words where one fits (0.4)
export function wrapText(text: string, width: number, font: { size: number; weight?: number }, measure?: TextMeasure): string[];
export function restOf(text: string, kept: readonly string[]): string;   // the rest of a text after the lines kept before the last
export function fitText(t: MarkText, measure?: TextMeasure): string;
export function fitLead(t: MarkText, fit: (text: string) => string): { lead: string; text: string };
// wise-flow/canvas
export function canvasTextMeasure(family?: string, context?: { font: string; measureText(s: string): { width: number } } | null): TextMeasure;
```

Text is measured once, when the scene is built: `buildScene` (and through it
`toSVG`, `toPNG`, `prepareScene` and `<ProcessMap/>`) takes a `textMeasure`
and shortens every node label and chip text to its width with it, wraps the
activity names and their case counts, sizes chips, and measures the legend's
texts, the note on withheld edges and the activity key of exported figures.
The marks carry the result: a text's `text` (and a chip's `lead`) is what is
drawn and `maxWidth` the width it was fitted to. The interactive DOM map, the
Canvas map, the SVG export and the PNG export write these texts as they are,
so with the same measure they show the same lines and the same truncation;
none measures again, and the stylesheet adds no ellipsis to map text.

`estimateTextWidth` is the default of the scene and the exports and needs no
DOM. `canvasTextMeasure` is the browser's, and `<ProcessMap/>`'s default: widths from a Canvas context's `measureText` in the font a text is
drawn in (`family`, default the default theme's), kept per font and text; it
is the estimate where there is no document or no 2D context. Create it after
the page's fonts have loaded (`document.fonts.ready`), or the widths are a
fallback font's. Activity boxes are sized before layout by the same measure
(`activityNodeSize(node, options, measure)`), so a map and its exports that
share a measure share their boxes too.

An activity's or a stage's name is wrapped into the room the interactive map
gives it: the box less the padding (16 left, 8 right) and a solid outline on
both sides, on up to two lines, the second shortened with an ellipsis where
the name needs more (`wrapLines`, an internal rule over `wrapText` and
`truncateText`).

`truncateText` keeps the longest start of a text that fits with an ellipsis,
at least one character (a width over the limit by less than a millionth, a
rounding, fits); with `{ words: true }` the start ends after a whole word
("Vendor…", never "Vendor cr…"), and only where no whole word fits is the
first word cut between characters. A card's name is shortened by words (0.4),
on its card and at every readable level, and two names shortened alike are
told apart by the word where they differ ("…invoice", "…debit…"; by
characters only where words leave them alike). Chips, legend rows and figure
texts keep the character cut. The readable ladder's name rule keeps the
theme's `readable.nameChars` characters (8). `wrapText` puts words on lines at most `width` wide (at
least the font's size) and breaks a word wider than a line between
characters; `wrapActivityText(value, width, fontSize?, measure?)`,
`activityLabelLines(node, options, width, locale?, measure?)` (the card's two
name lines in the default theme, and the cases in `caseLabel`) and
`activityKeyLines(graph, options, width, locale?, measure?)` apply it to
activity names, counts and the export's key. A chip's label is measured in
bold (`chipLead`) and its text in the chip's weight.

What is still measured otherwise, and why: the boxes that place arc labels,
group titles and badges clear of each other and of the activities, and the
extent of an observed self-loop's label, keep their fixed widths per
character. They decide where marks go, not what text is drawn, and moving
them would move the approved drawing. The filter chips above the map (a
panel, not map text) keep their CSS ellipsis.

## Scene

```ts
export interface FlowSceneOptions { overlays?: Overlay[]; measure?: Measure; style?: StyleSpec; locale?: Locale; lanes?: LaneMode;
  moved?: Readonly<Record<string, XY>>; activityLabels?: ActivityLabelOptions; selfLoops?: boolean; lod?: Partial<LodRules>; lodBySize?: boolean;
  overlayGeometry?: OverlayGeometryOptions; theme?: Theme; scheme?: ColorScheme;   // default defaultTheme, light; the marks take the scheme's neutral, accent and palettes
  textMeasure?: TextMeasure }   // default estimateTextWidth; see "Text measure"
export interface FlowScene { graph; positions; bands: LaneBand[]; activityLabels?; locale; style; theme: Theme; scheme: ColorScheme;
  colors: Readonly<Record<ColorToken, string>>; textMeasure: TextMeasure; scales: Scales;   // colors: every paint role in the scheme
  overlays: Overlay[]; lod: LodRules; geometry: OverlayGeometry; marks: OverlayMark[]; nodeMarks: NodeMark[]; edgeMarks: EdgeMark[];
  groupMarks: GroupMark[]; legend: SceneLegend; bounds: Box }
export function buildScene(g: FlowGraph, p: Positions, o?: FlowSceneOptions): FlowScene;
export function followsSelfLoops(g: FlowGraph, o?: { locale?: Locale; observed?: { caseLabel?: string } }): Overlay[];
export function withFollowsSelfLoops(g: FlowGraph, overlays: Overlay[], o?: { locale?; observed? }): Overlay[];
export function withObservedSelfLoops(g: FlowGraph, overlays: Overlay[], locale?: Locale, caseLabel?: string): Overlay[];   // with `observed`

export type MarkPaint = "ink" | "inkMuted" | "paper" | "surface" | "line" | "lineStrong" | "cueStripe" | "cueFoot" | "outOfScope" | "value" | "onValue"
  | `#${string}`;   // a colour a theme's rule sets: #rrggbb, #rrggbbaa below full alpha, drawn as it is
export interface MarkFill { paint: MarkPaint; pattern?: "outOfScope"; opacity?: number }
export interface MarkStroke { paint: MarkPaint; width: number; opacity?: number; dash?: number[] }
export interface MarkText { text: string; x: number; y: number; size: number; weight?: number; anchor: "start" | "middle" | "end";
  baseline: "middle" | "alphabetic"; paint: MarkPaint; halo: boolean; maxWidth?: number; lead?: string }
export interface MarkGauge { x: number; y: number; width: number; height: number; value: number; threshold: number } // shares 0–1
export interface OverlayMark { id: string; kind: OverlayKind; overlay: Overlay; box: Box; layer: "below" | "between" | "above"; inMap: boolean;
  minZoom: number; color: string; onColor: string; title: string; radius: number; path?: string; fill?: MarkFill;
  stroke?: MarkStroke; arrow?: { size: number; overhang: number }; texts: MarkText[]; gauge?: MarkGauge; edgeId?: string;
  pill?: { box: Box; radius: number; fill: MarkFill; stroke: MarkStroke };   // pill: the box an arc's label is written in
  opacity?: number }   // the whole mark's, where a theme's rule sets one
export function overlayMarks(shapes: OverlayShape[], locale?: Locale, theme?: Theme, measure?: TextMeasure,
  context?: { pathColor?: (edgeId: string) => string | undefined; radius?: (target: string) => number | undefined }): OverlayMark[];
export function overlayColor(o: Overlay, theme?: Theme): string;           // the theme's accent, whatever the value
export function tintColor(o: Overlay, theme?: Theme): string | undefined;  // the accent at the theme's tint opacity (TINT_OPACITY in the default theme), as CSS rgba(); none without a value
export function arcWidth(o: Overlay, theme?: Theme): number;               // the theme's arc stroke (1), whatever the coverage
export const TINT_OPACITY: number;                          // 0.18
export const overlayArrow: { size: number; overhang: number }; // 12, tip 0.1 × size beyond the path (`arrowheadTokens.overlay`)
export const chipLayout: { padding: 8; glyph: 12.4; gauge: 46; gaugeWidth: 40; gaugeHeight: 6; char: 6.2 };   // char: read by nothing
export function chipText(o: Overlay, locale?: Locale): { lead?: string; text: string }; // "label: " and text or share

export interface SvgElement { tag: string; attrs: [string, string][]; children: (SvgElement | string)[] }
export interface MarkSvgOptions { paint(mark: OverlayMark, paint: MarkPaint): string; arrowId: string; patternId: string }
export function markSvg(m: OverlayMark, o: MarkSvgOptions): SvgElement;  // the <g> that draws one mark
export function svgMarkup(e: SvgElement | string): string;
export function fitChars(text: string, maxWidth?: number): string;        // deprecated: truncateText at a chip's 10 px

export interface ElementText extends MarkText { role: "label" | "glyph" | "count" | "nameLine" | "countLine" | "share"; lod?: "labels" | "edgeLabels" }
export interface NodeCue { share: number; stripe?: { box: Box; paint: MarkPaint }; foot?: { box: Box; paint: MarkPaint };
  accent?: { share: number; stripe?: { box: Box; paint: MarkPaint }; foot?: { box: Box; paint: MarkPaint } } }   // the cases StyleSpec.cueAccent counts, over the stripe and foot from their start
export interface NodeMark { id: string; kind: NodeKind; node: FlowNode; box: Box; shape: "box" | "circle" | "diamond"; radius: number;
  color: string; pattern: PatternId; fill: MarkPaint; stroke: { paint: MarkPaint; width: number; dash?: number[] }; band?: number;
  cue?: NodeCue; texts: ElementText[]; reconnected: boolean; outOfScope: boolean; title?: string; opacity?: number }
export interface EdgeMark { id: string; kind: EdgeKind; edge: FlowEdge; points: XY[]; color: string; width: number; dash?: number[];
  arrow?: Arrowhead;               // the head at the route's end (`pathArrowhead(width, theme.arrowhead.edge)`); none under the rule's minWidth (0.4); the line ends at `lineEnd(points, arrow)`
  terminal?: "start" | "end";      // a path from a start or to an end event (`Scales.terminal`), in the terminal paint (0.4)
  lift?: { width: number; arrow?: Arrowhead; opacity?: number };   // how it is drawn while an activity it touches is selected (0.4)
  backward?: boolean;              // a path against the reading direction, drawn below the flow it returns over
  texts: ElementText[]; reconnected: boolean; notEvaluated?: boolean; opacity?: number;   // opacity: line, arrowhead and label
  addedFlow?: boolean;             // opted-in host-added flow: neutral round dots; dash lengths resolved in layout units
  indirect?: boolean }   // stands for a way through activities not shown: dashed, line colour, thinnest, "via 2 activities not shown"
export interface CourseLabel { at: XY; side: XY }   // a label beside `at` on its course, on the side the unit vector `side` points to
export interface PathCourses { positions: Positions; backward: ReadonlySet<string>; labels: ReadonlyMap<string, CourseLabel> }
export function pathCourses(g: FlowGraph, p: Positions, o: { width: (e: FlowEdge) => number; bands?: ReadonlySet<string> }): PathCourses;
export function pathArrowhead(width: number, rule?: Arrowhead): Arrowhead | undefined;   // the rule's size, or perWidth × width rounded up where more; none under rule.minWidth (0.4)
export function lineEnd(points: readonly XY[], arrow: Arrowhead | undefined): XY;        // the route's end moved back by the head's overhang; the end itself without a head
export function paintOrder(marks: readonly { width: number; id: string }[]): number[];   // the order every renderer paints paths in: the widest first, equal widths by id (0.4)
export type PathSegment = { kind: "line"; to: XY } | { kind: "curve"; c1: XY; c2: XY; to: XY };   // (0.5)
export function roundedRoute(points: readonly XY[], radius: number, end?: XY): PathSegment[];   // every bend rounded, no more than half a segment (0.5)
export interface LabelObstacles { nodes: readonly Box[]; titles: readonly Box[] }   // (0.5)
export function placeEdgeLabels(edges: readonly EdgeMark[], obstacles: LabelObstacles, measure: TextMeasure): EdgeMark[];   // labels moved clear, widest paths first; a leader where moved off the line (0.5)
export function segmentsPath(start: XY, segments: readonly PathSegment[], num?: (n: number) => string): string;   // SVG path data (0.5)
// EdgeMark.path?: PathSegment[]: the route as drawn where Theme.radius.bend > 0 (0 in default and print, 8 in instrument); every renderer
// draws its curves (cubic, close to circular arcs: the DOM map and the SVG export as `C`, the Canvas as bezierCurveTo); hit-testing keeps the polyline.
export type BoxSide = "top" | "right" | "bottom" | "left";
export interface GroupMark { id: string; kind: GroupKind; group: FlowGroup; box: Box; color: string; pattern: PatternId; band?: LaneBand;
  radius: number; fill: MarkFill; stroke: { paint: MarkPaint; width: number; dash?: number[]; sides?: BoxSide[] };
  rule?: { paint: MarkPaint; width: number; side: BoxSide }; texts: ElementText[]; chipAnchor: XY; opacity?: number }
export function nodeMark(n: FlowNode, box: Box, o: { color: string; pattern: PatternId; locale?: Locale; total?: number; outOfScope?: boolean;
  activityLabels?: ActivityLabelOptions; theme?: Theme; measure?: TextMeasure;
  line?: LineSpec;   // what the number line leads with (StyleSpec.nodeLine)
  accent?: { metric: string; stripe?: MarkPaint; foot: MarkPaint } }): NodeMark;   // total: the log's cases; accent: the cue's part in the accent (StyleSpec.cueAccent)
export function edgeMark(e: FlowEdge, points: XY[], o: { color: string; width: number; locale?: Locale; theme?: Theme;
  addedFlow?: boolean;            // low-level renderer option; edgeMarks resolves it from style opt-in plus added-by-map tag
  label?: CourseLabel; backward?: boolean;
  lead?: LineSpec }): EdgeMark;   // label: the count beside the course instead of 4 above its middle; lead: the value before the count (StyleSpec.pathLabel)
export function groupMark(g: FlowGroup, box: Box, o: { color: string; pattern: PatternId; band?: LaneBand; theme?: Theme }): GroupMark;
export function nodeMarks(g: FlowGraph, p: Positions, scales: Scales, o?: { locale?; activityLabels?; theme?; measure?; outOfScope?: ReadonlySet<string> }): NodeMark[];
export function edgeMarks(g: FlowGraph, p: Positions, scales: Scales, locale?: Locale, theme?: Theme,
  courses?: Pick<PathCourses, "labels" | "backward">): EdgeMark[];
export function groupMarks(g: FlowGraph, p: Positions, bands: readonly LaneBand[], scales: Scales, theme?: Theme): GroupMark[];
export function edgeColor(e: FlowEdge, scales: Scales, theme?: Theme): string;      // constraint edges in the theme's accent
export function gatewayGlyph(n: FlowNode): string;                  // + (and), ○ (or), × otherwise
export function nodeCount(n: FlowNode, locale?: Locale): string | undefined;  // cases; a stage's members before them
export function edgePoints(p: Positions, e: FlowEdge): XY[] | undefined;      // the route, or straight between the boxes
export function routeMidpoint(points: readonly XY[]): XY;           // half of the polyline's length
export function edgeLabelPoint(points: readonly XY[]): XY;          // 4 above the route's midpoint
```

**The direction of every path.** `buildScene` gives the paths (follows edges
between two different nodes) courses of their own where a layout draws them
as something else (`pathCourses`; the scene's `positions.edges` hold them, so
the hit index and the culling follow them too):

- A path whose target's middle lies before its source's start in the reading
  direction runs against it. It leaves its source from the side away from the
  flow (below it for a flow to the right or the left, right of it for a flow
  down or up), runs as its own line 20 below the lowest node and group of the
  graph on the stretch it returns over (groups drawn as bands are not in its
  way, nor the positions given for nodes and groups the graph does not have,
  as an export's of a larger graph may hold; up to 0.3.5 they were) and
  enters its target from that side, so that its head points against the flow.
  Several over one stretch lie 6 apart besides their half widths, shorter
  ones nearer the flow; the ends of several on one node are spread along its
  side; where a box lies below a node, the line first steps aside into the
  gap beside the node's column. Its mark says `backward`, and its count is
  written above the middle of its line. A layout draws such a path as a frame
  around the groups between its ends (ELK) or along the flow (Dagre).
- Two paths in opposite directions between the same two nodes, neither of
  them backward, are each moved half their width and 2 to their own right,
  so that they run side by side, each with its head, and each count is
  written beside its own line (`anchor` "start" or "end" beside a line across
  the flow).

Above 5,000 paths the layout's routes are kept. A map's bounds, and so an
export's figure, include the lines below the flow.

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
(`overlayColor`: the accent; for a self-loop that stands for a path, the
path's colour, `context.pathColor` in `buildScene`), `onValue` the text colour on it, and `ink`, `paper` and
`outOfScope` are tokens the renderer resolves, so a themed Canvas keeps its
colours. A tint takes the corners of the node or group it covers
(`context.radius`; `radius.tint` without one). Badges are pills of paper
outlined in the accent with their glyph and share in the accent; an arc's
label is written in the accent on a pill of paper outlined in it (`pill`),
drawn over the path; a constraint self-loop's label is in the accent, a
path's in the ink. A shape without a label box (`label`) but with a label
point gets its pill centred on the point. `toSVG` and the Canvas drawing map these primitives to their output
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
the chip's box is laid out with; its text is as wide as the scene's text
measure finds it (the lead in bold), the box from 60 to 260 wide, and a text
that does not fit is shortened together with its lead. `fixedColors.line` is
the line colour of exports.

`markSvg` turns a mark into SVG elements: a group with a title, the path or
the rounded box, an arc label's pill (`rect.wf-pill`), the gauge and the texts as the scene fitted them (a lead as
a bold `tspan`). The paint roles
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
with width and dash (notes solid on the surface colour, re-added elements
dashed and nothing else, start events 1 and end events 2 wide), and the texts: a gateway's
glyph (×, + or ○) instead of its label, an event's label below its circle at
11 px, a note's label at 11 px at every zoom. Activities and stages are
cards (see "The activity card"): the band with its pattern twin, the
frequency cue (`cue`), the name's lines 16 in from the left and the number
line, from the labels' level of detail (with `activityLabels` at every zoom,
the name or reference given by them and the exact description as `title`).
`outOfScope` says that a hatch covers the node; `nodeMark` takes the log's
cases as `total` and the state as `outOfScope`. An edge
mark carries the route (`edgePoints`: the routed points, or a straight line
between the two boxes where the positions have none), colour (`edgeColor`),
width, dash (re-added `6 5`, and no other: a dash means "not directly
observed"; constraint edges are solid in the accent) and, where the edge has a
`count`, of any kind, the count at `edgeLabelPoint`. Every text names its
`role` and the level-of-detail rule it is drawn from (`lod`; drawn at
every zoom without one). What does not differ between elements is shared and
frozen: one node outline (`stroke`) per paint, width and dash, one dash per
kind of dashed edge, one empty `texts` list for the edges without a count
and, in the Canvas scene, one empty `badges` list for the nodes without
badges. Copy such a part before changing it
(`{ ...mark, stroke: { ...mark.stroke, width: 3 } }`). Equal counts share one
string, and the optional keys of a mark and of a node's texts are present,
`undefined`, where they do not apply. A text with a `maxWidth` arrives
shortened to it by the scene's text measure, and every renderer writes it as
it is (see "Text measure").

`<ProcessMap/>` reads the same scene: one scene per graph, positions and
options gives its bands, scales, overlays, level-of-detail rules and overlay
geometry, and in Canvas mode the same scene is handed to the Canvas map.
Its overlays are `graph.overlays` and the `overlays` prop together. Since
this change the map follows the scene's rules: plain self-loop labels are
formatted in the map's `locale`; a given self-loop overlay that stands for
a follows edge (its `edgeId`, no constraint) is replaced by the derived one
instead of being drawn twice; an arc is kept only when both its endpoints
are on the map; and the Canvas map draws every graph overlay once.

`groupMarks` holds one `GroupMark` per group with a box, in the graph's
order. A group is a box with corners of 8, tinted in its categorical
colour at the theme's `groupFill` (0: no tint) and outlined by a solid
hairline in the line colour, 1 wide;
a group drawn as a lane band (`band`) is tinted at 0.06 (every other band
at 0.02), outlined in the line colour 1 wide on the two sides between bands
(`stroke.sides`: left and right along the flow, top and bottom across it)
and ruled 2 wide in its colour along the side it starts at (`rule`: top or
left). Its title is written 12 in from the left on a baseline 22 below the
top, at 13 semibold in the muted ink, and `chipAnchor` is where its chips are
placed from: their right end 8 in from the right edge, 6 below the top, where
that covers nothing (see the overlay geometry). The SVG export, the Canvas map, the PNG export and `<ProcessMap/>` draw
these marks; the Canvas scene's `SceneGroup.mark` is the group's mark.

`toSVG` draws this scene. Since this change it draws follows self-loops by
default (as the live map does), also without `activityLabels`;
`Scene.selfLoops: false` hides them, also in `toPNG`. Overlays on unknown
targets are dropped before their order is fixed.

## Edge budget

```ts
export type EdgeBudget = number | "all";
export interface EdgeProtection { selection?: { edges: readonly string[] }; focused?: string | null; highlighted?: ReadonlySet<string> }
export interface EdgeSelection { drawn: Set<number>; shown: number; total: number; kept: number;   // positions in scene.edgeMarks
  loops: readonly string[];      // the paths in view that loop on one activity, counted in shown and total
  highlightedNotShown: number;   // the highlighted edges in view the budget withholds
  pathsNotShown: number }        // the paths in view it withholds (follows and flow edges, not indirect, and loops)
export interface ShownEdges { edges: readonly string[]; total: number; shown?: number }   // reported ids and note counts; shown defaults to drawn edges plus loops
export function budgetEdges(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph" | "positions">, budget: EdgeBudget | ShownEdges | undefined,
  protection?: EdgeProtection, inView?: readonly number[], loops?: readonly string[]): EdgeSelection | undefined;
```

When tens of thousands of edges are in view (a hub, or a fitted large map),
culling cannot shorten a draw. An edge budget of n draws n of the edges in
view, chosen once in the core by `budgetEdges` so that the Canvas map and
the React Flow map draw the same ones. The order is fixed: protected edges
first, then the highlighted edges, then the others, each by the weight descending (the value the edge width reads:
`style.edgeWidth.metric`, `cases` by default, or the paths' transitions,
`count`, where no path of the graph gives cases, a path that loops on one
activity included, as the scales resolve it;
an edge without it comes last, as it is drawn at the thinnest width), then
the id. Before this version a path without cases among paths with cases was
ranked by its transitions. A budget of n draws the first n edges of that order,
and every protected edge even beyond n, so lowering the budget only removes
edges from the end of the order and never replaces a drawn edge by another
(with the same protection and highlight).

An edge is protected when it carries an overlay mark of the scene (a mark
that names it, `OverlayMark.edgeId`, as a loop's mark does, or an arc that
joins its source to its target in that direction), when it is selected, or when the keyboard
is on it (`focused`). An edge on a highlighted path (`highlighted`: the edges
of the focus of paths in effect, `mapEmphasis(...).bright.edges` while
`focusShown`, which includes the pair of activities a selection of two
names, and the kept paths the detail panel marks) is drawn before the others
but within the budget, heaviest first. The edges a selection of activities
merely brightens are neither. So Alt with an arrow key can move onto a path the budget
withholds: it is drawn while the keyboard is on it, in place of the last
edge of the order while the protected edges fit in the budget (the note's
numbers stay) and beyond it otherwise (the note counts one more), and it is
withheld again once the keyboard moves on.

Protected edges have no cap, and overlay marks and edge labels are not
budgeted at all. When more protected edges are in view than the budget, all of
them are drawn and the note counts them; when every edge in view is protected,
nothing is withheld and no note is shown. Selections, the keyboard position
and marked paths stay few. Highlighted edges are capped by the budget: a
focus on the 30 paths of a hub under a budget of 10 draws the 10 heaviest,
and the note says how many highlighted paths it does not show ("Showing 10
of 30 flows, 20 highlighted not shown", `map.edges.withheldHighlighted`,
German "10 von 30 Flüssen gezeigt, 20 hervorgehobene nicht gezeigt";
`highlightedNotShown`). The path list (`<PathList/>`) still lists every path
of the focus. Up to 0.3.5 highlighted edges were protected, so a focus on the
paths of a hub drew every path of it whatever the budget: measured in
headless Chromium on a loaded sandbox (the renderer's draw time per frame in
motion, median of 30), a hub of 2,501 activities and 5,000 paths took 44 ms
with every path highlighted against 9.3 ms under the default budget (2,000
drawn), and a hub of 25,001 activities and 50,000 paths 316 ms against 124 ms
(500 drawn; there the activities dominate the frame).

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
drawn edges are protected (`kept`), which every budget draws, the ids of
the loops (`loops`), how many highlighted edges in view it withholds
(`highlightedNotShown`; 0 for a map's report), and how many of the edges in
view it withholds are paths (`pathsNotShown`: follows and flow edges, not a
constraint edge nor an indirect path, as `meta.shown.paths` counts them; also
for a map's report, where the loops in view it does not name count too). The edges in view are `inView` (positions in
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

`<ProcessMap edgeBudget/>` and `<CanvasMap edgeBudget/>` (default
`"adaptive"`, below) apply the budget after the zoom rule over the whole
scene, keeping connecting and highlighted paths even beyond the budget
(see "Paths at a small zoom"). React Flow receives the let-through edges.
Canvas draws those its hit index finds in view; culling changes neither
the note nor the reported selection. Without a `pathRule`, low-level
`drawScene` budgets the edges in view and loops on visible activities,
or every edge in an unculled draw. Withheld edges have neither lines nor labels, and
`CanvasRenderer.hitAt` does not return an edge its last draw withheld. While
edges are withheld the map shows a note with both numbers, "Showing 2,000 of
49,999 flows" (`map.edges.withheld`, English and German), with how many
highlighted paths it does not show where it withholds some ("…, 20
highlighted not shown", `map.edges.withheldHighlighted`), as text at the
bottom centre of the map (`role="note"`), and the polite live region
announces it once its numbers have stayed the same for 400 ms, so a view
in motion does not flood it. The table view always lists every edge.

### Paths at a small zoom

```ts
export interface ZoomedPaths { through: number[]; withheld: number }   // positions in scene.edgeMarks let through, in its order; the paths withheld
export function pathsAtZoom(scene: Pick<FlowScene, "edgeMarks" | "marks" | "style" | "graph">, zoom: number, minPx: number,
  protection?: EdgeProtection): ZoomedPaths | undefined;
export const viewTokens: { openingZoom: 0.75; pathPx: 0.5; overview: { width: 200; height: 120 } };   // also designTokens.view
```

**The rule: a path is drawn while its line is at least half a pixel wide
on the screen** (`viewTokens.pathPx`, 0.5: its width on the width scale,
`EdgeMark.width`, times the zoom). At zoom 0.75, where a map that does not
fit opens, every path is drawn (the thinnest line is 1 wide); below 0.5 the
thinnest lines go, and the wider ones at smaller zooms, each at its own
zoom. Always drawn, whatever the zoom: every edge that is not a path (a
constraint edge, an indirect path), a path that loops on one activity, a
path with an overlay mark on it, a selected or focused one, one on a
highlighted path (also beyond the edge budget), and the paths that keep every
activity on a way from a start to an end: each activity's strongest path
from and to a more frequent activity, a start or an end, as the detail
shares keep them. Every activity a start reaches and that
reaches an end does so through the paths drawn, at every zoom. What it lets
through only grows as the zoom grows. `pathsAtZoom` returns undefined when
every path is let through, with `minPx` 0 and at a zoom that is not
positive; otherwise the positions in `scene.edgeMarks` of the edges let
through and how many paths it withholds. On the whole BPIC log with every
activity and path selected, fitted into 1,400 × 900 (zoom 0.078), it lets
84 of the 656 lines through (the 21 loops are drawn as loops), 84 of them
the paths that keep the activities connected; at zoom 1 it lets every path
through.

Counted path loops stay visible below the overlays' level of detail. Shown
exports keep their named loops too; default exports retain their usual LOD.

**On the maps.** `<ProcessMap minPathPx/>` and `<CanvasMap minPathPx/>`
(default `viewTokens.pathPx`, 0.5; 0 turns the rule off) apply it in both
renderers, decided when the view is at rest, as the adaptive budget moves:
the React Flow map once its view has stayed the same for 200 ms and no
pan gesture is active, the Canvas map at the zoom of its last frame drawn outside a gesture (a drag, or a run
of wheel or pinch events; the zoom buttons are no gesture), so a pan or a
zoom in progress draws the paths of the view before it. The edge budget then
chooses among the paths let through over the whole map, preserving the
connecting and protected paths even beyond the budget. Canvas culling then
draws only those chosen paths that intersect the view.
`drawScene` takes it as `DrawOptions.pathRule` (`{ minPx, zoom? }`, the
view's zoom when `zoom` is omitted; default none, so the exports and the
pinned recordings draw as before), and `CanvasRenderer` passes the zoom its
view last rested at unless `drawOptions.pathRule.zoom` names one. Stories
and tests use a fixed zoom and the default rule, so what they draw does not
depend on the machine.

While the rule or the path budget withholds a path, the map shows the note
on withheld paths and the detail panel its line ("677 selected · 105 drawn at this zoom"),
both counting selected paths over the whole map, including loops and
excluding constraints and indirect connectors. The first number counts
those let through, also outside the viewport ("Showing 105 of 677 flows"
on the fitted whole BPIC log). Where the budget withholds paths as well, they
are subtracted over the whole map; panning changes neither number. Zooming in
brings paths back in steps, one width at a time, and the note follows;
zooming out never brings one back. `onEdgesShown` reports all let-through
edge ids, the note's total and, when the ids include uncounted connectors,
its `shown` count, so `toSVG`/`toPNG` given
that report draw exactly the paths the map draws, with the same note; an
export without it draws every path. With `minPathPx={0}`, the width rule
withholds no paths; the maps still apply the budget over the whole map and preserve connecting and protected
paths. The graph, table and whole-figure exports retain every selected path.

### Adaptive budget

On live maps, pure pans keep the budget; zooming in permits only increases
and zooming out only decreases. This keeps N stable under pans and monotone
under zooms, including after gestures settle. Low-level `CanvasRenderer`
without `pathRule` retains adaptation after either kind of gesture.

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
edges it names (of those in view) and states its `total` and optional `shown`; it withholds
nothing when it names every edge in view.

Model `flow` self-loops are ordinary paths, with their normal width, colour,
arrowhead and label. Supplied courses are kept; missing ones use the
sequence-flow router and extend scene bounds and hit targets. Live maps
preserve them under the zoom rule and budget. Observed `follows` repeats
retain their own overlay representation and description.

### Exporting what the map shows

`<ProcessMap onEdgesShown/>` (and `<CanvasMap onEdgesShown/>`) is called
when its whole-map selection changes under the zoom rule or budget.
`edges` lists let-through ids in scene order, then loops. `total` counts
selected paths; optional `shown` counts let-through paths when the ids
include constraints or indirect connectors. Panning does not change the
report. Undefined restores every edge; listeners joining while paths are
withheld receive the current report. When `<ProcessMap/>` switches
renderer (`renderer="auto"` crossing its threshold), it is called with
undefined and then with what the new renderer withholds, if anything. While
the table view is shown, which lists every path, it is called with undefined
with either renderer, so an export taken there draws every path and no note;
a change of the budget or the graph meanwhile tells the host nothing more, and
once the map is shown again it is called with what the map then withholds.
Up to this change React Flow went on reporting its budgeted set in the table
view, and the Canvas map, unmounted there, left the host with its last report.

To replay the screen's texts too, pass its theme and `lodZoom`. With a
reported `ShownEdges` and a supplied `lodZoom`, both exports use the screen
text floor at that zoom, including numbered markers and their full-name key.
`readable` on `ExportOptions`, `PngOptions` and `FigureFrameOptions` overrides
that decision with an exact `Readable` state, including hysteresis. It also
works when every path is shown and the report is undefined. Default figures
retain their own text floor and every selected path.

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
class="wf-edge-note">`, and it ends the figure's accessible label, so that a
screen reader announces it: `aria-label="Process map with 9 nodes and 8
connections in 0 groups. Showing 3 of 8 flows."`, or the title, ended with a
full stop, and the note. Up to this change the label was the title or the
description alone. The figure keeps every node, group and overlay.

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
readable-size buttons: the zoom control of the maps (`<ZoomControl/>`, see
"Controls and panels") with the readable size as a fifth icon button. Readable size centres the selected task, or the first
task if none is selected. The bpmn.io attribution remains visible.

Arc `payload.displayLabel` may supply a complete, unambiguous result label,
e.g. “63% miss constraint”. It overrides the glyph/percentage label across
React, BPMN, Canvas and SVG; it does not change the underlying result value.
Hosts should provide the rule target, units and evaluated denominator alongside
the drawing. A constraint arc is not an observed process route.

### Manual activity placement

`ProcessMap` accepts `nodesDraggable` (SVG activities only, opt-in), `onNodeMove(id, absolutePosition)` for a controlled host, and `layoutResetKey` to clear internally held manual positions. Group-relative React Flow positions are converted to absolute layout coordinates. Hover, selection and zoom do not alter them. Hosts applying `onNodeMove` can call `repositionNodes(graph, basePositions, overrides)` and clear the override record to restore the exact automatic layout.

`repositionNodes` keeps supplied edge identities, directions and metrics unchanged; an edge without an id is routed like any other (up to 0.3.5 it threw a `TypeError`). It routes around all visible boxes, including a moved box obstructing an unrelated edge; self loops remain node-anchored overlays. During an overlapping drag, an unroutable edge falls back to a clipped direct route rather than throwing. Positions and routes are immutable, and bounds include the rerouted edges. Manual placement is local to the mounted map unless the host persists it.

Custom child controls should import `useReactFlow`, `useNodesInitialized` and `useStore` from `wise-flow/react`, so they share the renderer's context even when a host resolves different Node/browser entry points of React Flow.

## Theme of a map in a page

```ts
// wise-flow/react
export function useFlowTheme(host: RefObject<Element | null>, setting?: ThemeSetting): FlowTheme;
export interface FlowTheme { theme: Theme; scheme: ColorScheme }
// <ProcessMap theme?>, <CanvasMap theme?>, <ViewSwitcher theme?>: ThemeSetting
```

A host writes a map's theme as an object, as CSS variables, or both. The
precedence is: the `theme` setting, then the `--wf-*` variables of the map's
element (set on it or on its container), then the preset. `useFlowTheme` resolves it, and the map,
`<CanvasMap/>` and a host's export read what it resolves:

- **Variables.** Every part of a theme has a variable: a colour role
  `--wf-<role>` (`--wf-paper`, `--wf-ink-muted`, …), the fonts `--wf-font`
  and `--wf-font-mono`, a text role's `--wf-text-<role>` (size),
  `--wf-weight-<role>` and `--wf-leading-<role>`, `--wf-radius-<role>` (and
  `--wf-radius`, `--wf-radius-lg` for the node's and the large radius),
  `--wf-stroke-<role>` and `--wf-opacity-<role>`, roles in kebab case.
  Lengths are read in px. The map reads them on its own element, as set
  there (`className`, `containerStyle`) or inherited from its container;
  given a `theme`, it writes the theme's there, and sets those aside while it
  reads, so the setting goes over the host's variables and they go over the
  preset. A value equal to what `tokens.css` sets is `tokens.css`'s, not the
  host's, and is left out. Inside `<ProcessMap/>` the Canvas map draws the
  map's theme: a variable set on `.wf-canvas-map` alone does not reach it.
- **Colours** in any CSS syntax (a name, `hsl()`, `oklch()`, `color-mix()`,
  …) become the literal the browser paints, read back from one pixel of a
  canvas: `#rrggbb`, or `rgba()` when translucent. The same holds for the
  colours of a `theme` object; its opaque palette stops become `#rrggbb`. So
  the Canvas map and an export draw literals.
- **Scheme.** The scheme is the one `tokens.css` draws in: `data-theme` on the
  document's root, otherwise `prefers-color-scheme`. Colours read in the dark
  scheme are the theme's `dark` roles: an export, which draws the light
  scheme unless told otherwise, does not inherit them. A variable a host sets
  for both schemes is therefore read as a dark role while the page is dark,
  and an export then draws the preset's light colour for it.
- **Changes.** The hook follows the `class`, `style` and `data-theme`
  attributes of the container and its ancestors and the system's colour
  scheme. A change of a colour repaints the DOM map and the Canvas map
  without a new layout and without building the scene again. A change of
  the font does too given a `textMeasure`; the default measure is made
  again in the new font, as is any new measure. A change of a size,
  radius, stroke, opacity, of the scheme, or of the neutral colour, the
  accent or a palette (which the marks draw in) builds the scene once, without
  a new layout. `--wf-accent` sets the accent; `tokens.css` does not define
  it, since the marks carry it.
- **The DOM map** paints with the variables it inherits. Given a `theme`, the
  map writes the theme's colours, fonts and the sizes the stylesheet reads
  (the variables of `tokens.css`) on its own element, over its
  `containerStyle`, so its panels follow it too and draw what the Canvas map
  draws; without one it writes none. The pattern twins of its activities and
  legend, and the legends of a `<ViewSwitcher/>` grid, are drawn in the
  theme's ink (of the light scheme) and `pattern`; `PatternSwatch` takes the
  look as `look`.
- **Exports.** `toSVG(scene, { theme: look.theme })` draws what the map draws,
  in the light scheme; `scheme: look.scheme` draws the page's scheme.

```tsx
const ref = useRef<HTMLDivElement>(null);
const look = useFlowTheme(ref);   // the container's variables over the default preset
<div ref={ref} style={{ "--wf-paper": "#fdf6e3", "--wf-font": "Georgia, serif" }}>
  <ProcessMap graph={graph} />
</div>
const svg = toSVG({ graph, positions }, { theme: look.theme });
```

The element must be mounted when the component that calls the hook mounts.
In development the hook logs what `checkTheme` finds, once per finding.

## Controls and panels

**Placement (0.4).** `legendPosition` (default `bottom-right`) and
`controlsPosition` (default `top-left`) put the legend and the detail panel in
a corner (`PanelCorner`), on the interactive and on the Canvas map; the key of
full activity names takes the side the legend leaves. `overviewCorner` puts the
overview in a corner. `fitInsets` is room a host keeps beside the panels — a
drawer over the map's right side, `{ right: 300 }` — and the fit keeps clear
of both (`mode: "add"`, the default from 0.4; `mode: "replace"` makes the
insets the only room kept, as up to 0.3, and is what the Canvas map does in
0.4). `panelBoxes(area)`, `insetBoxes(size, insets)` and
`cornerBox(corner, size, width, height)` are exported from `wise-flow/react`.
`minimap: "overflow"` shows the library's overview (the cards' outlines and
the part in view, part `overview`) whenever part of the interactive map is
out of view at rest, in `overviewCorner` or `top-right`.
`minimap: "thumbnail"` (0.6) shows the same overview, at the same times,
as the scene itself drawn small through the Canvas drawer (bands, paths and
cards; `MapOverviewProps.thumbnail`), redrawn when the scene or the
overview's size changes, never while the view pans. The library no longer
draws React Flow's minimap: `minimap: true` is another name of `"overflow"`
(deprecated; it showed React Flow's minimap up to 0.5), and no
`.react-flow__minimap` remains in its stylesheet. The Canvas map keeps its
own opening overview.

The DOM map, the Canvas map and the BPMN view share one zoom control and one
set of panel primitives, styled through the tokens and carrying the data
attributes of the styling contract.

```ts
export interface ZoomControlProps { zoom?: number; locale?: Locale; onZoomIn(): void; onZoomOut(): void; onFit(): void;
  fitLabel?: string;   // default "Fit the map" / "Karte einpassen"
  label?: string;      // the group's name; default "Zoom"
  disabled?: boolean; children?: ReactNode; className?: string }
export function ZoomControl(props: ZoomControlProps): JSX.Element;   // wise-flow/react
// wise-flow: the fitted view, used by all three
export interface Insets { top: number; right: number; bottom: number; left: number }
export interface FitView { x: number; y: number; zoom: number }
export interface FitOptions { insets?: Partial<Insets>; padding?: number; minZoom?: number; maxZoom?: number }   // padding default 0.08
export function fitViewport(bounds: Box, area: { width; height }, options?: FitOptions): FitView;
export function panelInsets(panels: readonly Box[], area: { width; height }, bounds: Box, options?: Omit<FitOptions, "insets"> & { gap?: number }): Insets;
// wise-flow: the view a map opens at
export interface OpeningView extends FitView { fitted: boolean; overview?: Box }
export interface OpeningOptions extends Omit<FitOptions, "insets"> { panels?: readonly Box[]; insets?: Partial<Insets>; gap?: number;
  readable?: number;          // default viewTokens.openingZoom, 0.75
  start?: Box; direction?: LayoutDirection; boxes?: readonly Box[]; overview?: { width: number; height: number } }
export function openingView(bounds: Box, area: { width; height }, options?: OpeningOptions): OpeningView;
export function processStart(nodes: readonly FlowNode[], positions: Pick<Positions, "nodes" | "direction">): Box | undefined;
// wise-flow: what a view shows, and where it centres to bring an element into it
export interface PartInView { nodes: number; ofNodes: number; edges: number; ofEdges: number; whole: boolean }   // the cards and the paths in view, of all
export function partInView(scene: { nodeMarks; edgeMarks }, view: FitView, area: { width; height }, insets?: Partial<Insets>): PartInView;
export function inViewText(shown: PartInView, locale?: Locale): string;   // "17 of 42 activities and 23 of 60 paths in view"
export function elementPoint(element: ElementRef, positions: Pick<Positions, "nodes" | "groups" | "edges">, edges?: readonly FlowEdge[]): XY | undefined;
```

**Zoom.** `<ZoomControl/>` is a group (`role="group"`, named "Zoom", in the
BPMN view "Model zoom controls") of icon buttons with accessible names (zoom
in, zoom out, fit) and, between them, the current zoom as a percentage
(`data-wf-part="zoom-level"`); the BPMN view adds the readable size as a fifth
icon button ("Readable size"). The React Flow map renders it in a React Flow
panel at the bottom left and no longer renders React Flow's `<Controls/>`
(no element `.react-flow__controls` remains; `data-wf-part="controls"` is on
the zoom control). The Canvas map's three text buttons (+, −, ⤢) in a group
named "Fit the map" and the BPMN view's text pills are this control too. The
zoom steps are as before: × 1.2 on the maps, × 1.25 (up to 4, down to 0.05)
in the BPMN view.

**Fit.** `fit` takes insets: the screen pixels kept clear along each side.
`fitViewport` centres the bounds in the area less the insets, with `padding`
of their size around them, and clamps the zoom; `panelInsets` chooses, for
each panel over a map, to keep it clear across the area (an inset left or
right, on its side) or along it (at the top or the bottom), whichever leaves
the larger zoom, and adds `gap`; above 12 panels the panels of one corner
are kept clear together, the same way. By default every fit (when a layout arrives,
the fit button, `CanvasMapHandle.fit()`, `BpmnViewHandle.fit()`) keeps clear
of the panels over the map: the abstraction panel, the legend, the zoom
control, the status and the note on withheld paths, and a host's React Flow
panels (`.react-flow__panel`, `.wf-overlay-panel`, `.wf-bpmn__panel`), with a
gap of 8 px, so that no panel covers an activity at the fitted zoom.
`fitInsets` on `<ProcessMap/>` and `<CanvasMap/>`, and `fit(insets)` on the
handles and on `CanvasRenderer`, set the insets instead. The React Flow map
fits React Flow's node bounds with 4 % of their size on each side (the
`padding: 0.08` React Flow's `fitView` took) between the zoom 0.05 and 3; its
fit button now fits as the map does after a layout (it took React Flow's
default padding of 0.1). The BPMN view fits the diagram's shapes and labels
with 2 % of their size on each side, up to the zoom 1 as bpmn-js's
`fit-viewport` does; where no panel is in the way it still uses
`fit-viewport`.

**Opening.** `<ProcessMap/>` and `<CanvasMap/>` default to
`opening="readable"`: fit and centre the whole map inside the open panels'
insets when that gives a zoom of at least 0.75; otherwise open at 0.75,
with the start at the reading-direction edge of the free area, centred
across it. Activities stay clear of panels. An overview of the whole map
(`data-wf-part="overview"`, accessible name "Overview of the map") sits in
the first free corner, marks the exact viewport, and centres the view on a
click or drag. Focus it and use arrow keys to move by a tenth of the view.
The fit button still shows the whole map. `opening="fit"` gives a host the
plain fit on opening; `fitView={false}` leaves the view to the host.
After a person moves the view, control changes keep it. Replacing the
`ProcessMap` graph object applies the opening rule again. After pressing
fit, control changes fit again until the graph is replaced. On a standalone
`CanvasMap`, `fitKey` identifies a new layout and `openKey` identifies a
replacement graph (default: the scene's graph object); a new `openKey`
applies the opening rule again even if `fitKey` stays the same. Refreshing a
scene under the same keys preserves the view. Exported figures always show
the whole map; the opening view does not change exports.

**The smallest zoom.** `minZoom` on `<ProcessMap/>` and `<CanvasMap/>` is
the zoom no fit, opening, wheel or button goes below (default 0.05). On
`<ProcessMap/>` a level asks for it as a readable zoom, `{ readable: "name" }`
say: the smallest zoom at which every card still shows that level of its
texts at the theme's `text.minScreenPx` (`readableZoom` over the scene's
readable rules; see "Readable at every zoom"), derived again whenever the
scene changes and passed to the Canvas map as a number. The map opens at
0.75 or at the smallest zoom, whichever is larger. A fit that cannot show
the whole map at the smallest zoom (the fit button, a fit after a control
change, `CanvasMapHandle.fit()`) shows the map from the start of the process
at that zoom, as the opening does, with the overview; `openingView` judges
whether the whole map fits by the zoom it would fit at before the smallest
zoom clamps it. A host that keeps the whole map reachable at any size leaves
`minZoom` alone.

**The part in view.** `partInView(scene, view, area, insets)` counts the
cards (activities and stage nodes) whose box reaches into the view and the
paths whose routed line does (`isPath`: not constraints, not the dashed
stand-ins), of all of each, and whether the whole map is in view; a line or
a box that only touches the view's edge is out. `<ProcessMap/>` computes it
when the view comes to rest (200 ms after its last change, once a gesture
ended) and, while it shows another part than before, calls `onInView` with
the counts, the zoom and the smallest zoom; the detail panel says it in a
note (`data-testid="wf-in-view"`, `inViewText`: "17 of 42 activities and 23
of 60 paths in view") while part of the map is out of view, and the overview
describes itself with it for assistive technology.

**Bringing an element into view.** `bringIntoView={{ element, token? }}` on
`<ProcessMap/>` moves the view so that the element is at its centre
(`elementPoint`: a node's or a group's box centre, the middle of an edge's
route or the midpoint between its ends), at the current zoom but at least
the smallest, with the map's short movement (none under reduced motion),
once the layout holds the element and the opening fits are done; a node or
an edge takes the keyboard position (`aria-activedescendant`), a group does
not. Each new object, or a new `token`, asks again; the same object asks
once. It is the map controller's `reveal` event, which the arrow keys, Home
and End use too. `openKey` opens the map again by `opening` when it changes,
as a replaced `graph` object does; given, a replaced graph alone opens it no
more, so that a host that builds a new graph for each detail keeps the view,
and "back to the opening" is a new key.

**Legend.** `<Legend/>` opens as a one-line strip: the measure and its unit
("Frequency · cases · share of 251,734 cases"), the path width's three
samples, and a button ("Show the whole legend", `aria-expanded`) that
expands it to the whole key (the title, the measure, the scales, the stages,
the keys and the map-level chips, as before) and collapses it again ("Show
the legend as one line"). The change is announced: in the map's live region
(`onAnnounce`, which `<ProcessMap/>` and `<BpmnView/>` pass), otherwise in a
live region of the legend ("The whole legend is shown.", "The legend is shown
as one line."). `defaultExpanded` opens it in full; `expanded` with
`onExpandedChange` controls it. The legends of `<ViewSwitcher/>`'s grid and
of the BPMN view are strips too. `toSVG` and `toPNG` always draw the whole
key. Keys pressed on a control of a panel (the legend's toggle, a slider, a
button) are the control's: the map's keyboard no longer takes them (Enter on
the legend's toggle expands it instead of opening the actions menu, the
arrow keys move a slider).

**The detail panel.** `<AbstractionControls/>` is the panel "Detail"
("Detailgrad") with two sliders, no switch: "Activities" from "Most
frequent" to "All", "Paths" from "Fewest paths" to "All paths" (German
"Aktivitäten" from "Häufigste" to "Alle", "Pfade" from "Wenigste Pfade" to
"Alle Pfade"). The right end shows everything. "Keep connected" has left the
panel: its promise is the left end of "Paths" (see "Detail shares"), and the
option stays in `AbstractOptions` for hosts.

- Both are native range inputs over `positions`: "Activities" over the
  numbers of activities a share can show, so an arrow key moves one rank
  and a tie enters whole, "Paths" over 0 to every path by frequency; Page Up
  and Page Down move ten, Home and End to an end; a pointer that stops inside
  a tie takes it whole. Moving a slider calls `onChange` with both detail
  shares (`activityDetail`, `pathDetail`; `minNodeShare`, `minEdgeShare` and
  `keepConnected` dropped). Neither thumb moves by itself: the shares are
  positions of their own, so moving "Activities" only rewrites the
  statement beside "Paths". A host that controls the map with thresholds
  sees the sliders where the thresholds stand (`positions.at`) and receives
  detail shares when a slider moves. Without `positions` the sliders run
  over the shares in per cent.
- Beside each slider its statement (`statement`, see "What the detail shares
  show, in words"): the short form shown and as the slider's value text,
  the full form as its title and its description (`aria-describedby`). The
  kept paths' part ("30 kept") is a button: pointing at it, focusing it or
  pressing it (`aria-pressed`) calls `onHighlightKept(true)`, and the map
  marks exactly those paths and dims the others. When moving one slider
  changes the other's statement, its full form is said politely
  (`onAnnounce`, which `<ProcessMap/>` passes, otherwise the panel's own live
  region).
- Further lines, each only where it has something to say: "61 selected · 40
  drawn at this zoom" where the map withholds paths at its zoom or by the
  path budget (`drawn`). Both numbers count paths only, follows edges and
  self-loops, on the React Flow map and the Canvas map alike
  (`EdgeSelection.pathsNotShown`): a constraint edge the budget withholds is
  no path not drawn. Up to 0.3.5 the panel counted it as one (three paths and
  a constraint edge under a budget of 3 read "3 selected · 2 drawn at this
  zoom"). "3 marks not shown", a disclosure whose summary has
  the full form as its title and which lists the marks; "2 shown for a
  protected deviation".
- `counts` is read where no `statement` is given: the value texts say what
  each slider keeps ("7 of 12").

The sliders are drawn from the tokens: a track (`--wf-size-slider-track`)
in the ink up to the thumb and in the line colour after it, and a round
thumb (`--wf-size-slider-thumb`) outlined in the ink. `<ProcessMap/>`
passes the positions and the statement of the graph it shows; the table
view shows the same panel above its tables.

**Primitives.** Modelled on the actions menu: a panel (`.wf-panel`: paper,
a hairline in `--wf-line`, the large radius and, over the interactive map,
`--wf-shadow`; the exports draw their legend flat), a button (`.wf-button`:
paper with a `--wf-line-strong` outline and the control radius, no longer the
surface colour and a pill; `.wf-button--icon` without an outline until
hovered or focused; pressed toggles in `--wf-pressed` with `--wf-on-pressed`
outlined in `--wf-focus`, where they were filled with the focus colour), a
chip (`.wf-panel-chip`, the filter chips) and a tooltip (`.wf-tooltip`:
paper, a hairline and `--wf-shadow-menu`; the activity tooltip, the Canvas
map's tooltip and the timeline's, which was ink with paper text). The table
alternative has the paper as its ground and its search field and pager are
drawn in the tokens. Every button of the panels carries
`data-wf-part="button"`.

**Form controls.** No control of the library paints in a colour the browser
chose, whose defaults differ between systems (a slider's grey on Linux, a
field's border, the focus ring). Every input, button, select and text area
inside the map, a panel, a table, the filters, the path list, the menu, the
BPMN view, the switcher, the timeline or the comparison takes its text colour
from `--wf-ink`, its border colour from `--wf-line-strong` and its
placeholder from `--wf-ink-muted`, and when focused by keyboard it is outlined
in `--wf-focus` (`--wf-stroke-focus` wide, `--wf-space-1` away), in every
state (disabled, checked, pressed). These rules have no specificity
(`:where`), so each control's own rule and any host rule win. The sliders
and the check box of `<AbstractionControls/>` were in the browser's colours
until now; the check box and the tables' search field showed the browser's
focus ring.

**Dark scheme.** Every control has its own values in the dark scheme: the
zoom control and the panels are paper, darker than the surface; React Flow's
attribution has no ground of its own; the pressed toggle is `pressed`
(#0b1f2e, darker than the surface); the table has its paper and its header
the surface; tooltips are paper. The browser draws native controls (check
boxes, scroll bars, the search field) in the scheme of the tokens:
`tokens.css` sets `--wf-color-scheme` (`light`, in the dark blocks `dark`),
which the stylesheet gives the map, its panels, the tables, the BPMN view, the
switcher, the timeline and the comparison as `color-scheme`, and
`themeVariables` writes it for the scheme too. The pattern twins of the
stages are drawn in `patternInk` by all four renderers (the DOM map, the
Canvas map and both exports), in the dark scheme #101114, at least 3.64 : 1
on every stage colour, where they were drawn in the ink: black in the DOM map
and light (#ececec, down to 1.12 : 1 on yellow) in the Canvas map and the
exports. Group outlines take the scheme's `line` as before.

New tokens: the colours `pressed`, `onPressed` and `patternInk` (with their
`--wf-*` variables in both schemes; pressed toggles and the selected tab of
`<ViewSwitcher/>` were `--wf-focus` with `--wf-on-focus`, which nothing reads
any more and `tokens.css` no longer defines; the role `onFocus` stays in the
theme and in `checkTheme`), `--wf-color-scheme`, the sizes `icon`
(16), `sliderTrack` (4) and `sliderThumb` (16), and the stroke `icon` (2).
New strings: `map.zoom`, `map.zoomLevel`, `legend.expand`, `legend.collapse`,
`legend.expanded`, `legend.collapsed`, `controls.kept`,
`controls.activitiesKept`, `controls.pathsKept`, in English and German.

## Rules

A host restyles the map in two tiers. **Tier one, rules in the theme**, reaches
every renderer: rules are part of the theme, resolved when the scene is built
and, for the interactive states, by one core function both maps call, so they
change the interactive DOM map, the Canvas map, the SVG export and the PNG
export alike. **Tier two, CSS against the styling contract's selectors** (next
section), changes only the interactive DOM map and the panels around it.

```ts
export interface ThemeRule { match: RuleMatch; set: RuleSet }
export type RuleMatch =
  | { part: "node"; kind?: NodeKind; tag?: string; state?: RuleState }
  | { part: "edge"; kind?: EdgeKind; tag?: string; state?: "reconnected" | InteractiveState }
  | { part: "group"; kind?: GroupKind; state?: "selected" }
  | { part: "mark"; kind?: OverlayKind; state?: "hovered" };   // badge, chip, arc, selfLoop, tint, hatch
export type RulePart = RuleMatch["part"];
export type InteractiveState = "selected" | "focused" | "hovered" | "dimmed";
export type RuleState = "outOfScope" | "reconnected" | InteractiveState;
export interface RuleSet {
  fill?: string;                          // a literal colour (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) or a colour role (ink, accent, …)
  fillOpacity?: number;                   // 0 to 1
  stroke?: string;                        // the outline's colour; a path's line's
  strokeWeight?: "thin" | "strong";       // 1 or 2
  dash?: "solid" | "unobserved";          // unobserved: the dash of what was not directly observed
  radius?: "s" | "m" | "full";            // 4, 8, half the box's shorter side
  opacity?: number;                       // the whole element's, clamped to 0.2 to 1
  text?: { name?: RuleText; count?: RuleText; share?: RuleText; label?: RuleText };
  cue?: FrequencyCue;                     // the place of a card's frequency cue
}
export interface RuleText { size?: number; weight?: 400 | 500 | 600; color?: string }   // size from the theme's smallest text to 15
export type RuleTextRole = "name" | "count" | "share" | "label";
export function ruleTextRole(role?: string): RuleTextRole;   // nameLine → name, countLine → count, share → share, any other → label
export interface StateStyle { fill?: MarkPaint; stroke?: MarkPaint; width?: number; dash?: number[]; opacity?: number;
  texts?: Partial<Record<RuleTextRole, MarkPaint>> }       // dash [] is solid
export function stateStyle(scene: { theme: Theme; colors: Record<ColorToken, string> }, part: RulePart,
  mark: NodeMark | EdgeMark | GroupMark | OverlayMark, states: { selected?; focused?; hovered?; dimmed?: boolean }): StateStyle | undefined;
export function markInState<M extends NodeMark | GroupMark | OverlayMark>(m: M, s: StateStyle | undefined): M;
```

`theme.rules` is an ordered list of `{ match, set }`. A rule matches an element
of its `part` and, where it names them, of its `kind`, carrying its `tag` (nodes
and paths carry tags; groups and marks do not) and in its `state`. `set` is a
closed set of properties: there is no field for a shape, a pattern twin, an
arrowhead, a shadow, a gradient, motion or any geometry, so none of them can be
changed. The default look is written without rules, and neither preset has any.

**Order.** An element is drawn in its kind's default look, then with what every
matching rule without a state sets, in the order of the list (a later rule
overrides an earlier one), then with what every matching rule of a state the
element is in sets, again in order. So a state's rule overrides the others
wherever it stands in the list. Entries of a text merge by role: a later rule
that sets a name's colour keeps an earlier rule's size.

**Where each state resolves.** `outOfScope` (an element a hatch overlay covers)
and `reconnected` (re-added to keep the map connected) are resolved when the
scene is built: the mark builders apply the rules, so the result is in
`scene.nodeMarks`, `edgeMarks`, `groupMarks` and `marks` and reaches both
exports. `selected`, `focused`, `hovered` and `dimmed` exist only in the
interactive maps: `stateStyle(scene, part, mark, states)` gives what the
rules of the states an element is in set over its mark, and the DOM map and
the Canvas map both draw the states from it. Without such a rule (it returns
nothing) they draw a state as they do by default: hover, selection and focus
in the outline, dimmed at the theme's `dimmed` opacity. A rule of these states
replaces only what it sets: a selected activity keeps its selection ring, but
its outline is the rule's. These rules set paints only: `fill`, `fillOpacity`,
`stroke`, `strokeWeight`, `dash`, `opacity` and a text's `color`; corners,
texts' sizes and weights and the cue's place are fixed when the scene's texts
are fitted.

**What each part draws.** Nodes take every property: `radius` on a box (an
event's circle and a gateway's diamond keep theirs), `text.name`, `count` and
`share` on a card, `label` on an event's or a note's label and a gateway's
glyph, `cue` on a card. Paths take `stroke`, `dash`, `opacity` and
`text.label` (their count): their width is their cases and is not set by a
rule. Groups take all but `cue`; a band keeps its square corners and solid
sides. Marks take all but `cue`, and only the colour of their texts, since
their boxes are placed around their texts: a hatch keeps its pattern and a
tint follows the corners of what it covers.

**Validation.** `checkTheme` lists every entry of a rule that is unknown or out
of range as a deviation of kind `rule`, with the entry's place as its subject
(`rules[1].set.strokeWeight`): a rule that is not `{ match, set }`, an unknown
part, kind, state or property, a tag on a group or a mark, a property its part
or its interactive state does not draw, a colour that is neither a literal nor
a colour role, a fill opacity outside 0 to 1, a text size under the theme's
minimum or over 15, a weight other than 400, 500 or 600, a value not among the
named ones. Such a rule changes nothing. An `opacity` outside 0.2 to 1 is
clamped to it, and listed too. An entry left `undefined` is ignored, in the
match and in the set: it neither refuses the rule nor undoes an earlier one. Colour roles are drawn in the scene's scheme:
`"accent"` is `#b84a00` in the light scheme and `#ff8c42` in the dark one.

**Tier one, worked example.** Activities tagged `manual` get a strong outline,
gateways a pale fill, re-added paths their own colour, and dimmed paths are
fainter, in the DOM map, the Canvas map and both exports:

```ts
const theme: ThemeSetting = {
  rules: [
    { match: { part: "node", kind: "gateway" }, set: { fill: "#fff3c4" } },
    { match: { part: "node", tag: "manual" }, set: { strokeWeight: "strong", radius: "m", text: { name: { weight: 600 } } } },
    { match: { part: "edge", state: "reconnected" }, set: { stroke: "#b42318" } },
    { match: { part: "edge", state: "dimmed" }, set: { opacity: 0.2 } },
  ],
};
<ProcessMap graph={graph} theme={theme} />;           // the DOM map, or the Canvas map above 2,000 elements
const svg = toSVG({ graph, positions }, { theme });   // and toPNG with the same theme
```

Rules are part of the theme, resolved when the scene is built and, for the
interactive states, by the one core function both maps call, so they change
the interactive DOM map, the Canvas map, the SVG export and the PNG export
alike.

**Tier two, worked example.** A host stylesheet against the styling contract
(next section):

```css
[data-wf-part="node"][data-wf-kind="activity"][data-wf-state~="hovered"] { box-shadow: 0 0 0 3px #fde68a; }
```

**In the renderers.** Every mark carries what the rules set: a paint a rule
sets is a literal (`MarkPaint` `#rrggbb`, `#rrggbbaa`), and `opacity` on a node,
edge, group or overlay mark is the whole element's (the SVG export writes it on
the element's group). With rules, `markedThemeKey` holds every colour, so a
colour a rule names by role builds the scene again when it changes. The DOM map
gives a node, a group and an edge the state style in its data (`state` of
`ActivityNodeData`, `GroupNodeData` and `FollowsEdgeData`, with the node's and
the group's mark already drawn in it by `markInState`); the stylesheet draws a
state's outline from `--wf-state-outline` where it is set, and leaves out the
dimmed look where a rule sets the opacity (`--wf-node-opacity`,
`--wf-edge-opacity`, `--wf-group-opacity`). Without a rule for the dimmed
state, a dimmed node or path is drawn at the dimmed look's opacity in place
of one a rule set in the scene, in both maps. A path's label carries its size and
paint as `--wf-text-size`, `--wf-text-weight` and `--wf-text-paint`. A hovered
overlay mark is drawn as `markInState` gives it in both maps.

## Styling contract

The interactive DOM map (`<ProcessMap/>` with the React Flow renderer) and the
panels around it carry data attributes a host stylesheet can select: every part
has `data-wf-part`, and where the table lists them `data-wf-kind` and
`data-wf-state`. The state is a space-separated list of `selected`, `focused`,
`hovered`, `dimmed`, `outOfScope` and `reconnected`, and on a terminal path
`start` or `end` (0.4: the path from a start event or to an end event,
`EdgeMark.terminal`; the same words as the events' tags, and like
`reconnected` not an interactive state); select one with `~=`. The
classes the elements had before stay; they are not part of the contract.

CSS written against these selectors changes only the interactive DOM map and the panels around it. It does not change the Canvas map (used automatically above 2,000 elements), SVG or PNG exports, or the BPMN diagram. Anything that must look the same everywhere belongs in the theme or a rule.

| `data-wf-part` | Element | `data-wf-kind` | `data-wf-state` |
| --- | --- | --- | --- |
| `map` | the map's container | | |
| `node` | a node of the map | `activity`, `stage`, `gateway`, `event`, `note` | `selected`, `focused`, `hovered`, `dimmed`, `outOfScope`, `reconnected` |
| `node-band` | the stage band at the left edge of an activity or stage | | |
| `node-cue` | the frequency cue's stripe behind an activity's or stage's texts | | |
| `node-cue-foot` | the frequency cue's foot along an activity's or stage's bottom edge | | |
| `node-label` | the name of a node (each name line holds one line of it) | | |
| `node-count` | the number line of a node: its cases, then their share | | |
| `group` | a group box or lane band | `stage`, `lane`, `pool` | `selected` |
| `group-label` | the label of a group | | |
| `group-header` | a band's count of its activities, or an empty stage's note (`laneOptions.counts`, 0.5) | | |
| `edge` | a path between two nodes (SVG group) | `follows`, `constraint`, `flow` | `selected`, `focused`, `hovered`, `dimmed`, `reconnected`, `start`, `end` |
| `edge-path` | the drawn line of a path | | |
| `edge-label` | the count label of a path | | |
| `mark` | a deviation mark of the map or of a legend (SVG group); a `tint` is the background of its node, and the BPMN diagram's marks carry no attributes | `badge`, `chip`, `arc`, `selfLoop`, `hatch` | `hovered` |
| `controls` | the zoom control (`<ZoomControl/>`) of the DOM map, the Canvas map and the BPMN view | | |
| `button` | a button of the panels: the zoom control's, the legend's toggle, the detail panel's toggles and its kept paths' part, the table's pager, the filters' "clear" | | |
| `zoom-level` | the current zoom in the zoom control | | |
| `overview` | the overview of a map that opens on its start, in a corner | | |
| `activity-key` | the scrollable key of full activity names at the numbered screen level | | |
| `abstraction-panel` | the detail panel: the sliders, their statements and the toggles of `<AbstractionControls/>` | | |
| `legend` | `<Legend/>` | | |
| `status` | the status panel (arranging, layout error) and the note on withheld paths | | |
| `menu` | the actions menu | | |
| `menu-item` | an entry of the actions menu; `focused` is the active one | | `focused` |
| `tooltip` | the activity tooltip, the Canvas map's tooltip and the timeline's | | |
| `table` | `<TableAlternative/>` | | |
| `table-row` | a row of a node or path in the table alternative | | `selected` |
| `filters` | `<FilterChips/>` | | |
| `filter-chip` | one chip of `<FilterChips/>` | | |
| `path-list` | `<PathList/>` | | |
| `timeline` | `<TraceTimeline/>`, as a chart and as a table | | |
| `timeline-event` | an event of the timeline | | |
| `timeline-cluster` | events of a case drawn as one ring on a vertical timeline (`clusterMs`, 0.5) | | |

`docs/styling-contract.json` lists the same parts, kinds and states. A tooling
test (`tests/tooling/styling-contract.test.mjs`) renders the fixtures of every
node, edge, group and overlay kind in these states and fails when an entry is
not drawn, not listed here, or drawn but not listed. Removing an entry is a
breaking change for the host stylesheets written against it.

```css
/* An unlayered host stylesheet; it wins over the library's rules wherever it is loaded. */
[data-wf-part="node"][data-wf-state~="selected"] { outline: 2px solid #7a3cff; }
[data-wf-part="edge"][data-wf-kind="follows"] [data-wf-part="edge-path"] { stroke: #444; }
[data-wf-part="mark"][data-wf-kind="badge"] text { font-size: 12px; }
```

**Stylesheets.** `wise-flow/style.css` puts React Flow's stylesheet and the
library's rules into the cascade layer `wf`, React Flow's in the sublayer
`wf.react-flow` below the library's. Any rule of the host outside a layer wins
over both, whatever its specificity and wherever it is loaded, so host CSS needs
no specificity contest. Load `wise-flow/tokens.css` next to it, and do not load
React Flow's stylesheet (`@xyflow/react/dist/style.css` or
`wise-flow/react-flow.css`) as well: outside a layer, it would win over the
library's rules where they overlap.

An unlayered reset wins over layered rules just as well. The browser lane shows
it (`tests/browser/styling.spec.ts`): with a reset like Tailwind 3's preflight
(`*, ::before, ::after { border-width: 0; border-style: solid }`) on the page,
an activity's border disappears under `style.css`. For such a page,
`wise-flow/style.unlayered.css` holds the library's rules without a layer, as
`style.css` did before; load it after the reset and after React Flow's
stylesheet (`wise-flow/react-flow.css`). Under it, a host rule needs the
specificity of the library's rule it overrides and the later place, and the
stroke of a path is set by React Flow's rule for `.react-flow__edge-path`, so a
host rule for it needs two attribute selectors, as in the example above. A reset
that sits in a layer of its own (Tailwind 4 puts its preflight into the layer
`base`) works with `style.css` once the page declares that layer before `wf`
(`@layer base, wf;` ahead of both stylesheets): the first mention of a layer
fixes its place, and a later layer wins.

Which to use: `style.css`, unless the page has a reset outside any layer; then
`style.unlayered.css`.

**What the stylesheet now sets instead of inline styles.** No inline style on an
element of the map sets a property a host rule may want to change:

- A path's stroke colour, stroke width, dash and dimmed opacity were inline
  styles of its line. The edge now carries the scene's values as the custom
  properties `--wf-edge-color`, `--wf-edge-width` and `--wf-edge-dash`; the
  stylesheet draws the line from them (through React Flow's
  `--xy-edge-stroke`, `--xy-edge-stroke-selected` and `--xy-edge-stroke-width`)
  and from the edge's state: the focus colour when selected, hovered or
  focused, opacity 0.25 when dimmed. A focused path's width (at least 3) is
  the value of `--wf-edge-width`, as before.
- The paints of marks that follow the theme (`var(--wf-ink)` and the other
  tokens) were inline styles of their SVG elements. They are now classes, one
  per property and token: `wf-fill-ink`, `wf-fill-ink-muted`, `wf-fill-paper`,
  `wf-fill-surface`, `wf-fill-line`, `wf-fill-out-of-scope`, `wf-fill-focus`,
  and the same with `wf-stroke-`. Paints from a value stay presentation
  attributes, which any rule overrides. The BPMN view's marks keep their
  inline paints.
- The position of `<Badges/>` (top-right corner) and of the map's marker and
  pattern definitions are now in the stylesheet (`.wf-badges`, `.wf-mark-defs`).

What stays inline is geometry and stacking (positions, the box of an activity
with labels, the overlay layers' z-index, the place of menus and tooltips) and
the scene's values handed to the stylesheet as custom properties
(`--wf-node-color`, `--wf-group-color`, `--wf-tint` and the edge's three).
The legend's samples and the table's swatches show data colours inline; they
are panels, not elements of the map.

## Package name

The package is `wise-flow`, without a scope, as its repository. Up to 0.3.5
it was named `@wise/flow`; that scope belongs to another organisation on npm,
so the package was never published under it. Only the name changed: the entry
points keep their sub-paths (`wise-flow`, `wise-flow/react`,
`wise-flow/bpmn`, `wise-flow/canvas`, the stylesheets and the worker assets)
and export the same names, and class names, CSS variables (`--wf-*`) and data
attributes (`data-wf-*`) are unchanged.

Migration: a host replaces its dependency entry (`"@wise/flow": "…"` becomes
`"wise-flow": "…"`, then installs again) and every import specifier that
starts with `@wise/flow` (`@wise/flow/react` becomes `wise-flow/react`, and so
on, also for the stylesheets and the `?url` imports of the workers).

## Deprecated names

### `wise-flow`

| Name | Replacement |
| --- | --- |
| `fitChars` | the mark's `text`, which the scene's text measure has fitted; `truncateText` to shorten another text |
| `nodeLabel` | `textTokens.activityName` (`Theme.text.activityName`), the name on an activity's card; a stage node's name is `stageLabel` |
| `nodeCount` | `textTokens.activityNumber` and `activityShare`, the cases and their share on a card's number line |
| `TimeMode."events_inside"` | a time clause on `case_start`, `case_end` or `active`, which keeps whole cases; removed in the next minor version (see "Filters") |

### `wise-flow/canvas`

| Name | Replacement |
| --- | --- |
| `PreparedScene.labelCache` | the texts of the marks (`SceneNode.mark.texts`), fitted when the scene was built |

A name that is marked `@deprecated` in the
source is listed here, with the entry point as a `###` heading and a table of
name and replacement. A tooling test (`tests/tooling/deprecations.test.mjs`)
checks that every `@deprecated` name in the source is listed here with a
replacement, and that every listed name is deprecated.

`scripts/core-exports.json` holds the names of the `.` entry point and the
deprecated ones; a tooling test compares the built `index.d.ts` with it. Outside
the core, the package imports a name the entry point provides from the entry
point. This document names every name the four entry points export: a tooling
test (`tests/tooling/exports.test.mjs`) compares the names of the built
declarations with those this document gives in code (in a `ts` block or in
backticks, outside "Removed in the next version") and fails on an exported
name it does not find.

## Removed in the next version

These names were deprecated on the way to this release and are gone. 0.3.5
exported all of them except three types added since (`PatternShape`,
`FollowsSelfLoopOptions`, `NodeMarkOptions`) and marked none deprecated, so a
host moving from 0.3.5 meets them removed. The one consumer uses none of
them. Each row names what to use instead.

### `wise-flow`

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

### `wise-flow/react`

| Name | Replacement |
| --- | --- |
| `OverlayLayerProps.showArcs` | nothing: the layer draws every mark on the map from its `minZoom` at the map's zoom, or at `zoom` where given (`zoom={Infinity}` draws every mark) |
| `OverlayLayerProps.showSelfLoops` | nothing, as for `showArcs` |
| `ActivityNodeData.badges` | `ActivityNodeData.marks`, drawn at `origin` (for example with `markSvg` from `wise-flow`) |
| `GroupNodeData.chips` | `GroupNodeData.marks`, drawn at `origin` |

### `wise-flow/bpmn`

| Name | Replacement |
| --- | --- |
| `manhattanRoute` | `routeSequenceFlows` from `wise-flow` |


### Supplied activity times and path lag

Activity metrics `medianPrevHours` and `meanPrevHours` measure hours from the
previous labelled record; `medianNextHours` and `meanNextHours` measure hours to
the next one. Paths accept `medianLagHours` and `meanLagHours`. The host supplies
the statistics and the measured passage counts: `prevPassages`, `nextPassages`
and `lagPassages`. These counts are never inferred from cases or events. Both
statistics for a direction use its supplied passage count; without one the
description omits the count. All these names have English and German labels in
the metric registry, including table headings and export legends.

Use `nodeLine: { metric: "medianPrevHours", format: "fromPrev", then: "none" }`
for "3.4 d from previous", or `medianNextHours` with `toNext` for "2 min to
next". `format: "both"` leads with the previous metric and writes
"prev 3.4 d · next 2 min"; `nextMetric` can override the matching next statistic.
The paired form omits the cases/share suffix to keep the existing card size.
The existing formats and explicit `missing: "frequency"` fallback still work;
otherwise a missing time retains its direction ("– to next").

Hover and assistive descriptions list every supplied median and mean, with
passages when supplied. A collapsed stage has no own duration derivable from
activity statistics: a time number line reads "–" and the hover explains why.
Its table retains supplied aggregated statistics and their aggregation basis.
Set `edgeColor.metric: "meanLagHours"` in the performance style to name the
mean in both the performance sentence and the path colour title; the default
remains median. Positive times that round below one minute read "< 1 min";
exact zero reads "0 min", through the shared formatter in every renderer.
