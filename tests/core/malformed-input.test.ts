/**
 * Malformed input at the synchronous functions of the core entry point
 * (`wise-flow`), the Canvas entry point's headless functions and the BPMN
 * bridge's synchronous functions. Every function runs once per malformed case
 * (`malformedCase`: the invalid families, group cycles, empty and one-activity
 * graphs, zero cases, very long and markup labels, junk overlays, unknown kinds,
 * junk meta; positions missing, not finite or extreme; junk numbers and
 * strings for the scalar parameters). A call must return or throw a plain,
 * documented error, never a `TypeError` or `RangeError`, within the time bound;
 * what it returns must hold together: no element drawn without a box, no
 * number that is not finite where a coordinate, a size or an export is built
 * from finite input. The table of these functions is `tests/invalid-input.md`.
 */
import { describe, expect, it } from "vitest";
import * as canvas from "../../src/canvas/index";
import * as bpmn from "../../src/bpmn/headless";
import {
  InvalidGraphError,
  type ActivityLabelOptions,
  type Box,
  type ColorScheme,
  type ConstraintDescription,
  type ConstraintStats,
  type FilterClause,
  type FlowPath,
  type Locale,
  type MarkText,
  type MetricBasis,
  type Positions,
  type Selection,
  type StringKey,
  type ThemeSetting,
  type XY,
  DEFAULT_SIZES,
  HitIndex,
  PATTERNS,
  abstract,
  activityCounts,
  activityDescription,
  activityKeyLines,
  activityLabel,
  activityLabelLines,
  activityNodeCounts,
  activityNodeSize,
  activityReferences,
  addClause,
  arcWidth,
  arrowMarker,
  arrowheadExtent,
  arrowheadTokens,
  asFilter,
  budgetEdges,
  buildScales,
  measureStyle,
  buildScene,
  canonicalClause,
  canonicalFilter,
  canonicalOverlays,
  changesCases,
  channelTitle,
  checkTheme,
  chipText,
  clauseForTarget,
  clauseKey,
  clearLayoutCache,
  clearSelection,
  collapseGroups,
  components,
  constraintOverlays,
  contrastRatio,
  contrastText,
  coversGraph,
  createPositions,
  cssVariable,
  defaultActions,
  defaultNodeSize,
  defaultStyle,
  defaultTheme,
  describeClause,
  describeOverlay,
  describePreview,
  describeSelection,
  detailNotes,
  detailStatement,
  diff,
  diffStyle,
  edgeColor,
  edgeLabelPoint,
  edgeMark,
  edgeMarks,
  edgePoints,
  elementMetric,
  emptyFilter,
  emptySelection,
  estimateTextWidth,
  figureCaption,
  figureFrame,
  filterEquals,
  filterPositions,
  fitChars,
  fitLead,
  fitText,
  fitViewport,
  focusHighlight,
  focusMembers,
  followsSelfLoops,
  formatCompact,
  formatCount,
  formatDays,
  formatDelta,
  formatHours,
  formatMetricValue,
  formatNumber,
  formatPathCount,
  formatShare,
  gatewayGlyph,
  groupMark,
  groupMarks,
  hasTag,
  hashKey,
  hatchSvg,
  hexToRgb,
  indexGraph,
  interpolatePalette,
  isConnected,
  isSelected,
  labelScreenPx,
  labelUnitsAt,
  laneAssignment,
  laneBands,
  laneGroups,
  laneModel,
  laneRoutes,
  legendItemHeight,
  legendLayout,
  legendOfScene,
  lineEnd,
  lodAt,
  lodForSize,
  mapScaleAt,
  markArrowhead,
  markInState,
  markSvg,
  menuTargetFor,
  menuTitle,
  metric,
  metricBasis,
  metricEntry,
  metricKind,
  metricLabel,
  metricLabelOf,
  metricMeanNote,
  metricName as nameOfMetric,
  metricUnit,
  neighbourhood,
  nodeCount,
  nodeMark,
  nodeMarks,
  normalizeFilterPreview,
  normalizeGraph,
  normalizePath,
  orderedCategorical,
  overlayColor,
  overlayGeometry,
  overlayMargin,
  overlayMarks,
  overlaysFor,
  palettes,
  panelInsets,
  pathArrowhead,
  pathBetween,
  pathCourses,
  pathRows,
  pathsFor,
  patternDefs,
  patternTwin,
  patternTwinSvg,
  positionsBounds,
  relatedToSelection,
  removeClause,
  repositionNodes,
  resolveTheme,
  readableAt,
  resolveViews,
  routeMidpoint,
  routeSequenceFlows,
  ruleTextRole,
  sceneLegend,
  selectElement,
  selectMany,
  selectionElements,
  selectionEquals,
  selectionShape,
  selectionSize,
  smallLabelUnitsAt,
  sortActions,
  spanLanes,
  stackLanes,
  stateStyle,
  straightRoute,
  strengths,
  svgMarkup,
  t,
  themeColors,
  themePalette,
  tintColor,
  toSVG,
  truncateText,
  unionBoxes,
  unionGraph,
  validateGateways,
  validateGraph,
  viewsSharePositions,
  withFollowsSelfLoops,
  withObservedSelfLoops,
  wrapActivityText,
  wrapText,
} from "../../src/index";
import { Calls, type MalformedCase, argumentsRecorder, failure, junkCoordinate, junkNumber, junkString, junkValue, malformedCase, nonFinite, someNumber } from "../support/malformed";
import { caseCount, seeds } from "../support/random";

const CASES = seeds(caseCount(300)).map((seed) => malformedCase(seed));

function must(ok: boolean, c: MalformedCase, what: () => string): void {
  if (!ok) expect.fail(failure(c, what()));
}

const fail = (message: string): never => expect.fail(message);

const finiteBox = (b: Box | undefined) => !!b && [b.x, b.y, b.width, b.height].every(Number.isFinite);

/** Positions whose boxes and routes all hold finite numbers. */
function finitePositions(p: Positions): boolean {
  return Object.values(p.nodes).every(finiteBox) && Object.values(p.groups).every(finiteBox) && Object.values(p.edges).every((r) => r.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
}

/** A host's number in a range it is meant for: a width, a padding, a scale. */
const within = (v: number | undefined, lo: number, hi: number) => v === undefined || (v >= lo && v <= hi);

/** A text the user reads: no number that went wrong, no object printed whole. */
const readable = (s: unknown) => typeof s === "string" && !/\bNaN\b|Infinity|\[object /.test(s);

const ids = (c: MalformedCase) => [...c.graph.nodes.map((n) => n.id), ...c.graph.edges.map((e) => e.id), ...(c.graph.groups ?? []).map((g) => g.id), "gone", junkString(c.rng)];
const locale = (c: MalformedCase): Locale => (c.rng.chance() ? "en" : "de");
const labels = (c: MalformedCase): ActivityLabelOptions => ({ mode: c.rng.chance() ? "names" : "ids", references: activityReferences(c.graph), showCounts: c.rng.chance(), caseLabel: c.rng.chance() ? junkString(c.rng) : undefined });

/**
 * The plain errors a function throws on malformed input, as its documentation
 * names them or, where it is silent, as they are thrown today (the table of
 * invalid input lists them). Any other plain error fails the search.
 */
const PLAIN_ERRORS: Record<string, readonly RegExp[]> = {
  // Documented: unroutable supplied geometry raises a descriptive error.
  repositionNodes: [/^Error: Cannot route .*Increase the layout spacing\.$/],
  routeSequenceFlows: [/^Error: Cannot route .*Increase the layout spacing\.$/],
  laneRoutes: [/^Error: Cannot route .*Increase the layout spacing\.$/],
  // Not documented: a stage model with an id twice.
  liteFromStages: [/^Error: liteFromStages: duplicate id /],
};

/** Runs `body` for every case and checks that every listed function ran once per case at least and threw no plain error but the known ones. */
function search(names: readonly string[], body: (calls: Calls, c: MalformedCase) => void): () => void {
  return () => {
    const calls = new Calls(fail);
    for (const c of CASES) body(calls, c);
    expect(calls.ranAtLeast(names, CASES.length)).toEqual([]);
    expect(calls.unknown(PLAIN_ERRORS), "plain errors that are not documented").toEqual([]);
  };
}

describe("malformed input at the core entry point", () => {
  it(
    "model and aggregation",
    search(["metric", "hasTag", "indexGraph", "validateGraph", "InvalidGraphError", "validateGateways", "normalizeGraph", "strengths", "collapseGroups", "components", "isConnected", "abstract", "diff", "unionGraph", "detailStatement", "detailNotes"], (calls, c) => {
      const g = c.graph;
      const node = g.nodes[0];
      calls.call("metric", c, () => {
        // Documented: a value that is not a finite number yields the fallback.
        const fallback = someNumber(c.rng, 0);
        const v = metric(node, c.rng.pick(["cases", "count", junkString(c.rng)]), fallback);
        must(Number.isFinite(v) || Object.is(v, fallback), c, () => `metric gave ${String(v)}`);
      });
      calls.call("hasTag", c, () => hasTag(node, junkString(c.rng)));
      calls.call("indexGraph", c, () => {
        const index = indexGraph(g);
        for (const id of ids(c)) {
          index.ancestors(id);
          index.ancestors(id, "group");
          index.allMembers(id);
          must(typeof index.label(id) === "string" || id === undefined, c, () => `label of ${id}`);
        }
      });
      const issues = calls.call("validateGraph", c, () => validateGraph(g)) ?? [];
      calls.call("InvalidGraphError", c, () => {
        const error = new InvalidGraphError(issues);
        must(error.name === "InvalidGraphError" && error.issues === issues, c, () => "the error's name and issues");
      });
      calls.call("validateGateways", c, () => validateGateways(g));
      calls.call("normalizeGraph", c, () => normalizeGraph(g));
      calls.call("strengths", c, () => strengths(g.edges, g.edges.map((e) => e.id), c.rng.pick(["max", "total"] as const)));
      calls.call("components", c, () => components(g.nodes.map((n) => n.id), g.edges));
      calls.call("isConnected", c, () => isConnected(g));
      const collapsed = calls.call("collapseGroups", c, () => collapseGroups(g, c.rng.chance() ? "all" : ids(c).slice(-3)));
      const abstracted = calls.call("abstract", c, () =>
        abstract(g, {
          minEdgeShare: someNumber(c.rng, 0.2),
          minNodeShare: someNumber(c.rng, 0.2),
          keepConnected: c.rng.chance(0.8),
          collapse: c.rng.pick([false, "all", ids(c).slice(0, 2)] as const),
          relativeTo: c.rng.pick(["max", "total"] as const),
          edgeMetric: c.rng.pick([undefined, "cases", junkString(c.rng)]),
          nodeMetric: c.rng.pick([undefined, "events", junkString(c.rng)]),
          keep: ids(c).slice(0, 2),
        }),
      );
      // By detail shares too, with shares that may be any number, and the statements and notes of what they show.
      const detailed = calls.call("abstract", c, () => abstract(g, { activityDetail: junkNumber(c.rng), pathDetail: c.rng.chance() ? junkNumber(c.rng) : undefined, collapse: c.rng.pick([false, "all"] as const), marks: g.overlays?.slice(0, 2) }));
      calls.call("detailStatement", c, () => {
        const statement = detailStatement(detailed ?? g, { locale: locale(c), marks: g.overlays, labelOf: c.rng.chance() ? (id) => `${id}:${junkString(c.rng)}` : undefined });
        must(!statement || readable(JSON.stringify(statement)), c, () => `detailStatement ${JSON.stringify(statement)}`);
      });
      calls.call("detailNotes", c, () => must([...detailNotes(g, detailed ?? g, { locale: locale(c) }).values()].every(readable), c, () => "detailNotes wrote a number that went wrong"));
      calls.call("diff", c, () => diff(g, abstracted ?? g, { metrics: c.rng.chance() ? ["count", junkString(c.rng)] : undefined }));
      calls.call("unionGraph", c, () => unionGraph([g, collapsed ?? g]));
      // What validation accepts, abstraction keeps acceptable.
      for (const [name, result] of [["collapseGroups", collapsed], ["abstract", abstracted]] as const) {
        if (c.accepted && result) must(!validateGraph(result).some((i) => i.level === "error"), c, () => `${name} made an invalid graph from a valid one: ${JSON.stringify(validateGraph(result))}`);
      }
    }),
  );

  it(
    "positions, routing and lanes",
    search(["defaultNodeSize", "unionBoxes", "positionsBounds", "createPositions", "clearLayoutCache", "filterPositions", "coversGraph", "straightRoute", "repositionNodes", "routeSequenceFlows", "laneGroups", "laneAssignment", "laneModel", "stackLanes", "spanLanes", "laneRoutes", "laneBands", "fitViewport", "panelInsets", "pathCourses"], (calls, c) => {
      const g = c.graph;
      const p = c.positions;
      const sound = finitePositions(p);
      const box = (): Box => ({ x: junkCoordinate(c.rng, 10), y: junkCoordinate(c.rng, 20), width: junkCoordinate(c.rng, 180), height: junkCoordinate(c.rng, 60) });
      for (const n of g.nodes.slice(0, 3)) calls.call("defaultNodeSize", c, () => must(finiteBox({ x: 0, y: 0, ...defaultNodeSize(n) }), c, () => `size of ${n.kind}`));
      if (!g.nodes.length) calls.call("defaultNodeSize", c, () => defaultNodeSize({ id: "x", kind: "zz" as "activity", label: "" }));
      calls.call("unionBoxes", c, () => unionBoxes([...Object.values(p.nodes), box(), box()]));
      calls.call("positionsBounds", c, () => {
        const b = positionsBounds(p);
        if (sound) must(finiteBox(b), c, () => `bounds ${JSON.stringify(b)} of finite positions`);
      });
      calls.call("createPositions", c, () => createPositions({ nodes: { ...p.nodes, junk: box() }, groups: p.groups, edges: p.edges }, c.rng.pick(["given", "elk", "provisional"] as const), c.rng.pick(["RIGHT", "DOWN"] as const)));
      calls.call("clearLayoutCache", c, () => clearLayoutCache(c.rng.chance() ? junkString(c.rng) : undefined));
      calls.call("filterPositions", c, () => {
        const f = filterPositions(p, g);
        if (sound) must(finitePositions(f) && finiteBox(f.bounds), c, () => "filterPositions made numbers that are not finite");
      });
      calls.call("coversGraph", c, () => {
        const covers = coversGraph(p, g);
        must(!covers || g.nodes.every((n) => finiteBox(p.nodes[n.id])), c, () => "coversGraph counted a node without a finite box");
      });
      calls.call("straightRoute", c, () => straightRoute(box(), box()));
      const overrides: Record<string, XY> = {};
      for (const id of ids(c).slice(0, 3)) overrides[id] = { x: junkCoordinate(c.rng, 40), y: junkCoordinate(c.rng, 40) };
      calls.call("repositionNodes", c, () => repositionNodes(g, p, overrides));
      calls.call("routeSequenceFlows", c, () => routeSequenceFlows(g, p.nodes, { allowOverlap: c.rng.chance() }));
      const lanes = calls.call("laneGroups", c, () => laneGroups(g, c.rng.pick(["stages", "roles", "none"] as const))) ?? [];
      calls.call("laneAssignment", c, () => laneAssignment(g, lanes));
      const model = calls.call("laneModel", c, () => laneModel(g, { lanes: c.rng.pick(["roles", "nested"] as const), crossLaneEdges: c.rng.pick(["direct", "routed"] as const) }));
      if (model) {
        calls.call("stackLanes", c, () => stackLanes(g, model, junkCoordinate(c.rng, 0), junkCoordinate(c.rng, 12), () => junkCoordinate(c.rng, 80)));
        calls.call("spanLanes", c, () => spanLanes(g, model, Object.fromEntries(model.lanes.map((l) => [l.id, box()])), { main: c.rng.pick(["x", "y"] as const), labelSpace: someNumber(c.rng, 24) }));
        calls.call("laneRoutes", c, () => laneRoutes(g, model, p.nodes, c.rng.chance() ? { routes: p.edges, axis: "y", offsets: new Map(g.nodes.map((n) => [n.id, someNumber(c.rng, 30)])) } : undefined));
      } else {
        for (const name of ["stackLanes", "spanLanes", "laneRoutes"]) calls.call(name, c, () => fail(failure(c, "laneModel returned nothing")));
      }
      const area = { width: junkCoordinate(c.rng, 1200), height: junkCoordinate(c.rng, 800) };
      const fitOptions = { insets: c.rng.chance() ? { top: junkNumber(c.rng), right: junkNumber(c.rng), bottom: junkNumber(c.rng), left: junkNumber(c.rng) } : undefined, padding: c.rng.chance() ? junkNumber(c.rng) : undefined, minZoom: c.rng.chance() ? junkNumber(c.rng) : undefined, maxZoom: c.rng.chance() ? junkNumber(c.rng) : undefined };
      calls.call("fitViewport", c, () => fitViewport(c.rng.chance() ? p.bounds : box(), area, fitOptions));
      calls.call("panelInsets", c, () => panelInsets([box(), box()], area, c.rng.chance() ? p.bounds : box(), { gap: c.rng.chance() ? junkNumber(c.rng) : undefined }));
      calls.call("pathCourses", c, () => {
        const width = someNumber(c.rng, 2);
        const courses = pathCourses(g, p, { width: () => width, bands: c.rng.chance() ? new Set(ids(c)) : undefined });
        if (sound && within(width, 0, 100)) must(Object.values(courses.positions.edges).every((route) => route.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))), c, () => "a course through a point that is not finite");
      });
      calls.call("laneBands", c, () => {
        const bandOptions = { padding: someNumber(c.rng, 8), labelSpace: someNumber(c.rng, 24), gap: someNumber(c.rng, 8) };
        const r = laneBands(g, p, { lanes: c.rng.pick(["stages", "roles", "none"] as const), ...bandOptions });
        if (sound && Object.values(bandOptions).every((v) => within(v, 0, 1e4))) must(r.bands.every((b) => finiteBox(b.box)), c, () => `a band without a finite box: ${JSON.stringify(r.bands)}`);
      });
    }),
  );

  it(
    "style, tokens, label sizing and formatting",
    search(["hexToRgb", "interpolatePalette", "contrastRatio", "contrastText", "hashKey", "lodAt", "lodForSize", "buildScales", "patternDefs", "arrowheadExtent", "patternTwin", "cssVariable", "labelUnitsAt", "smallLabelUnitsAt", "mapScaleAt", "labelScreenPx", "formatCount", "formatNumber", "formatShare", "formatDelta", "formatHours", "formatDays", "formatCompact", "t", "metricLabel", "orderedCategorical", "themePalette", "resolveTheme", "themeColors", "checkTheme", "formatPathCount", "metricEntry", "metricKind", "metricName", "metricUnit", "metricBasis", "formatMetricValue", "elementMetric", "metricLabelOf", "metricMeanNote", "channelTitle", "wrapText", "measureStyle", "readableAt"], (calls, c) => {
      const colour = () => c.rng.pick([junkString(c.rng), "#fff", "#1f77b4", "#ABCDEF", "#abc", "fff"]);
      calls.call("hexToRgb", c, () => hexToRgb(colour()));
      calls.call("interpolatePalette", c, () => interpolatePalette(c.rng.pick([palettes.sequential, palettes.diverging, [colour()], [colour(), colour()]]), junkNumber(c.rng)));
      calls.call("contrastRatio", c, () => contrastRatio(colour(), colour()));
      calls.call("contrastText", c, () => contrastText(colour()));
      calls.call("hashKey", c, () => must(Number.isFinite(hashKey(junkString(c.rng))), c, () => "hashKey"));
      const rules = { labels: junkNumber(c.rng), arcs: junkNumber(c.rng), badges: someNumber(c.rng, 0.5) };
      calls.call("lodAt", c, () => lodAt(junkNumber(c.rng), rules));
      calls.call("lodForSize", c, () => lodForSize(junkNumber(c.rng), rules));
      const metricName = c.rng.pick(["count", "cases", "violationShare", "medianLagHours", junkString(c.rng)]);
      calls.call("buildScales", c, () => {
        const domain = c.rng.chance() ? ([junkNumber(c.rng), junkNumber(c.rng)] as [number, number]) : undefined;
        const range = [someNumber(c.rng, 1), someNumber(c.rng, 8)] as [number, number];
        const custom = { edgeWidth: { metric: metricName, scale: c.rng.pick(["linear", "sqrt", "log"] as const), domain, range }, edgeColor: { metric: metricName, domain: domain && [domain[0], 1] }, nodeColor: { by: c.rng.pick(["group", "kind", "tag", "layer"] as const) } };
        const spec = c.rng.pick([defaultStyle, diffStyle, custom]);
        const scales = buildScales(c.graph, spec);
        // From the data alone (a host's domain and range left aside), every width is a finite number.
        const soundSpec = spec !== custom || (!domain && range.every((v) => within(v, 0, 1000)));
        for (const e of c.graph.edges) must((Number.isFinite(scales.edgeWidth(e)) || !soundSpec) && typeof scales.edgeColor(e) === "string", c, () => `edge width ${scales.edgeWidth(e)} of ${e.id}`);
        for (const n of c.graph.nodes) must(typeof scales.nodeColor(n) === "string", c, () => `node colour of ${n.id}`);
      });
      calls.call("measureStyle", c, () => {
        // A measure's style with thresholds and a percentile a host computed: every path still has a colour and a width.
        const given = c.rng.chance() ? { edgeColor: { bins: [junkNumber(c.rng), junkNumber(c.rng)], percentile: junkNumber(c.rng) } } : undefined;
        const scales = buildScales(c.graph, measureStyle(c.rng.pick(["frequency", "shortfall", "performance"] as const), given));
        for (const e of c.graph.edges) must(typeof scales.edgeColor(e) === "string" && Number.isFinite(scales.edgeWidth(e)), c, () => `edge colour ${scales.edgeColor(e)} and width ${scales.edgeWidth(e)} of ${e.id}`);
      });
      calls.call("patternDefs", c, () => patternDefs(junkString(c.rng), colour()));
      calls.call("arrowheadExtent", c, () => arrowheadExtent({ ...arrowheadTokens.edge, size: junkNumber(c.rng), length: junkNumber(c.rng) }));
      calls.call("patternTwin", c, () => patternTwin(c.rng.pick(PATTERNS)));
      calls.call("cssVariable", c, () => cssVariable(junkString(c.rng)));
      const zoom = junkNumber(c.rng);
      const target = someNumber(c.rng, 12);
      // Documented: a nonpositive or nonfinite zoom gives the base size (the supplied target for primary text, 11 for secondary text).
      const odd = !(zoom > 0) || !Number.isFinite(zoom);
      calls.call("labelUnitsAt", c, () => {
        const v = labelUnitsAt(zoom, target);
        must(odd ? Object.is(v, target) : Number.isFinite(v) || !Number.isFinite(target), c, () => `labelUnitsAt(${zoom}, ${target}) gave ${v}`);
      });
      calls.call("smallLabelUnitsAt", c, () => must(odd ? smallLabelUnitsAt(zoom) === 11 : Number.isFinite(smallLabelUnitsAt(zoom)), c, () => `smallLabelUnitsAt(${zoom}) gave ${smallLabelUnitsAt(zoom)}`));
      calls.call("mapScaleAt", c, () => must(Number.isFinite(mapScaleAt(zoom)), c, () => `mapScaleAt(${zoom}) gave ${mapScaleAt(zoom)}`));
      calls.call("labelScreenPx", c, () => labelScreenPx(junkNumber(c.rng), zoom));
      const value = junkNumber(c.rng);
      const L = locale(c);
      for (const [name, f] of [
        ["formatCount", () => formatCount(value, L)],
        ["formatNumber", () => formatNumber(value, junkNumber(c.rng), L)],
        ["formatShare", () => formatShare(value, L)],
        ["formatDelta", () => formatDelta(value, L)],
        ["formatHours", () => formatHours(value, L)],
        ["formatDays", () => formatDays(value, L)],
        ["formatCompact", () => formatCompact(value, L)],
      ] as const) {
        calls.call(name, c, () => must(readable(f()), c, () => `${name}(${String(value)}) = ${f()}`));
      }
      calls.call("t", c, () => t(L, c.rng.pick(["map.edges.withheld", "map.description", "export.context", "legend.title"] as StringKey[]), { shown: junkNumber(c.rng), total: junkString(c.rng), nodes: junkNumber(c.rng) }));
      calls.call("metricLabel", c, () => must(typeof metricLabel(L, junkString(c.rng)) === "string", c, () => "metricLabel"));
      // The theme: a preset, changes over it that may be anything, and CSS variables a host wrote.
      const setting = c.rng.pick([undefined, "default", "print", junkString(c.rng), { preset: c.rng.pick(["default", "print", junkString(c.rng)]), color: { ink: colour(), paper: colour() }, text: { activityName: { size: junkNumber(c.rng) } }, rules: [{ part: "node", set: { strokeWeight: junkString(c.rng), opacity: junkNumber(c.rng) } }] }]) as ThemeSetting;
      const theme = calls.call("resolveTheme", c, () => resolveTheme(setting, c.rng.chance() ? ({ color: { ink: colour() }, font: { family: junkString(c.rng) }, text: { activityName: { size: junkNumber(c.rng) } } } as ThemeSetting & object) : undefined)) ?? defaultTheme;
      calls.call("themeColors", c, () => themeColors(theme, c.rng.pick(["light", "dark", junkString(c.rng)] as ColorScheme[])));
      calls.call("themePalette", c, () => themePalette(theme, c.rng.pick(["neutral", "shortfall", "performance", "diverging", "categorical", "sequential", junkString(c.rng)] as Parameters<typeof themePalette>[1][])));
      calls.call("checkTheme", c, () => checkTheme(theme));
      calls.call("orderedCategorical", c, () => orderedCategorical([...ids(c), junkString(c.rng), ""], theme));
      const name = c.rng.pick(["cases", "count", "share", "violationShare", "medianLagHours", "delta_violationShare", "a_cases", junkString(c.rng)]);
      const element = { metrics: { [name]: junkValue(c.rng) as number }, metricBasis: c.rng.chance() ? { [name]: c.rng.pick(["atLeast", "mean", junkString(c.rng)] as MetricBasis[]) } : undefined };
      calls.call("formatPathCount", c, () => must(readable(formatPathCount(value, L)), c, () => `formatPathCount(${String(value)})`));
      calls.call("metricEntry", c, () => metricEntry(name));
      calls.call("metricKind", c, () => metricKind(name));
      calls.call("metricName", c, () => must(readable(nameOfMetric(name, L)), c, () => `metricName(${name})`));
      calls.call("metricUnit", c, () => metricUnit(name, L));
      calls.call("metricBasis", c, () => metricBasis(c.rng.chance() ? element : undefined, name));
      calls.call("formatMetricValue", c, () => must(readable(formatMetricValue(name, value, L, { basis: element.metricBasis?.[name], path: c.rng.chance() })), c, () => `formatMetricValue(${name}, ${String(value)})`));
      calls.call("elementMetric", c, () => must(readable(elementMetric(element, name, L, c.rng.chance())), c, () => `elementMetric(${name}, ${JSON.stringify(element)})`));
      calls.call("metricLabelOf", c, () => metricLabelOf(name, L, element.metricBasis?.[name]));
      calls.call("metricMeanNote", c, () => metricMeanNote(name, L));
      calls.call("channelTitle", c, () => channelTitle(c.rng.pick(["legend.edgeWidth", "legend.edgeColor", "legend.nodeColor"] as StringKey[]), name, L));
      calls.call("wrapText", c, () => wrapText(junkString(c.rng), junkNumber(c.rng), { size: junkNumber(c.rng), weight: c.rng.chance() ? junkNumber(c.rng) : undefined }));
      // What the texts show at a zoom a host computes, from rules of any numbers and the state before it.
      const level = () => ({ size: junkNumber(c.rng), floor: junkNumber(c.rng) });
      const readableRules = { levels: { full: level(), name: level(), line: level() }, labels: { path: junkNumber(c.rng), loop: junkNumber(c.rng), event: junkNumber(c.rng), glyph: junkNumber(c.rng), note: junkNumber(c.rng) }, pills: junkNumber(c.rng) };
      const before = calls.call("readableAt", c, () => readableAt(readableRules, junkNumber(c.rng), junkNumber(c.rng)));
      calls.call("readableAt", c, () => {
        const r = readableAt(readableRules, junkNumber(c.rng), junkNumber(c.rng), before);
        must(r.boost >= 1 && !Number.isNaN(r.floor) && ["full", "name", "line", "box"].includes(r.level), c, () => `readableAt: ${JSON.stringify(r)}`);
      });
    }),
  );

  it(
    "overlays and their marks",
    search(["constraintOverlays", "overlaysFor", "canonicalOverlays", "describeOverlay", "overlayGeometry", "overlayMargin", "overlayColor", "tintColor", "arcWidth", "markArrowhead", "chipText", "overlayMarks", "fitChars", "fitLead", "markSvg", "arrowMarker", "patternTwinSvg", "hatchSvg", "svgMarkup", "followsSelfLoops", "withFollowsSelfLoops", "withObservedSelfLoops", "HitIndex"], (calls, c) => {
      const g = c.graph;
      const someIds = () => c.rng.sample(ids(c), c.rng.int(0, 3));
      const description: ConstraintDescription = {
        id: junkString(c.rng),
        type: c.rng.pick(["presence", "singularity", "exclusion", "lag", "precedence", "balance", "metric", "applicability", "unknown"]) as ConstraintDescription["type"],
        label: c.rng.chance() ? junkString(c.rng) : undefined,
        activities: someIds(),
        a: someIds(),
        b: someIds(),
        group: c.rng.pick(ids(c)),
        params: { min: junkValue(c.rng), max: junkValue(c.rng), threshold: junkValue(c.rng), unit: junkString(c.rng) },
      };
      const n = () => (c.rng.chance(0.2) ? undefined : junkValue(c.rng));
      const stats: ConstraintStats = { cases: n(), evaluated: n(), violations: n(), violationShare: n(), coverage: n(), repeatShare: n(), meanCount: n(), maxCount: n(), medianDays: n(), p90Days: n(), reverseShare: n(), mean: n(), median: n(), p90: n(), threshold: n(), width: n(), casesInScope: n(), inScopeShare: n(), nodeShareInScope: Object.fromEntries(someIds().map((id) => [id, junkValue(c.rng)])), unit: junkString(c.rng) };
      const L = locale(c);
      const made = calls.call("constraintOverlays", c, () => constraintOverlays(description, c.rng.chance(0.8) ? stats : undefined, { locale: L, outOfScopeMinShare: someNumber(c.rng, 0.01), graph: c.rng.chance(0.8) ? g : undefined })) ?? [];
      calls.call("overlaysFor", c, () => overlaysFor([{ description, stats }, { description: { ...description, type: "presence" } }], { graph: g, locale: L }));
      const overlays = [...(g.overlays ?? []), ...made];
      calls.call("canonicalOverlays", c, () => canonicalOverlays(overlays));
      for (const o of overlays.length ? overlays.slice(0, 6) : [{ kind: "badge" as const, target: "gone" }]) {
        calls.call("describeOverlay", c, () => describeOverlay(o, L));
        calls.call("overlayColor", c, () => must(typeof overlayColor(o) === "string" && !/NaN/.test(overlayColor(o)), c, () => `overlayColor ${overlayColor(o)}`));
        calls.call("tintColor", c, () => must(!/NaN/.test(tintColor(o) ?? ""), c, () => `tintColor ${tintColor(o)}`));
        calls.call("arcWidth", c, () => must(Number.isFinite(arcWidth(o)), c, () => `arcWidth ${arcWidth(o)} of ${JSON.stringify(o.payload)}`));
        calls.call("chipText", c, () => chipText(o, L));
      }
      const options = { badgeSize: someNumber(c.rng, 16), chipHeight: someNumber(c.rng, 22), arcHeight: [someNumber(c.rng, 40), someNumber(c.rng, 140)] as [number, number], lod: { arcs: junkNumber(c.rng) } };
      calls.call("overlayMargin", c, () => overlayMargin(options));
      const junkOptions = c.rng.chance();
      const geometry = calls.call("overlayGeometry", c, () => {
        const geo = overlayGeometry(overlays, c.positions, junkOptions ? options : {});
        const soundOptions = !junkOptions || [options.badgeSize, options.chipHeight, ...options.arcHeight].every((v) => within(v, 0, 1e4));
        if (soundOptions && finitePositions(c.positions) && finiteBox(c.positions.bounds)) must(geo.shapes.every((s) => finiteBox(s)), c, () => `a shape without a finite box: ${JSON.stringify(geo.shapes.find((s) => !finiteBox(s)))}`);
        return geo;
      });
      const marks = calls.call("overlayMarks", c, () => overlayMarks(geometry?.shapes ?? [], L)) ?? [];
      calls.call("markArrowhead", c, () => markArrowhead({ size: junkNumber(c.rng), overhang: junkNumber(c.rng) }));
      calls.call("fitChars", c, () => fitChars(junkString(c.rng), junkNumber(c.rng)));
      const text: MarkText = { text: junkString(c.rng), lead: junkString(c.rng), x: junkNumber(c.rng), y: 0, size: junkNumber(c.rng), anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: junkNumber(c.rng) };
      calls.call("fitLead", c, () => fitLead(text, (s) => fitChars(s, text.maxWidth)));
      const markOptions = { paint: () => "#000", arrowId: junkString(c.rng), patternId: junkString(c.rng) };
      for (const m of marks.length ? marks.slice(0, 4) : [undefined]) {
        calls.call("markSvg", c, () => (m ? markSvg(m, markOptions) : markSvg(overlayMarks(overlayGeometry([{ kind: "badge", target: "a" }], { nodes: { a: { x: 0, y: 0, width: 10, height: 10 } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 10, height: 10 }, engine: "given", direction: "RIGHT" }).shapes)[0], markOptions)));
      }
      calls.call("arrowMarker", c, () => arrowMarker(junkString(c.rng), arrowheadTokens.overlay));
      calls.call("patternTwinSvg", c, () => patternTwinSvg(junkString(c.rng), c.rng.pick(PATTERNS), junkString(c.rng)));
      calls.call("hatchSvg", c, () => hatchSvg(junkString(c.rng), junkString(c.rng)));
      calls.call("svgMarkup", c, () => {
        const s = svgMarkup({ tag: "g", attrs: [["data-x", junkString(c.rng)]], children: [junkString(c.rng), { tag: "title", attrs: [], children: [junkString(c.rng)] }] });
        must(!/<(?!\/?(g|title)\b)/.test(s), c, () => `markup from text: ${s.slice(0, 200)}`);
      });
      calls.call("followsSelfLoops", c, () => followsSelfLoops(g, { locale: L, observed: c.rng.chance() ? { caseLabel: junkString(c.rng) } : undefined }));
      calls.call("withFollowsSelfLoops", c, () => withFollowsSelfLoops(g, overlays, { locale: L }));
      calls.call("withObservedSelfLoops", c, () => withObservedSelfLoops(g, overlays, L, junkString(c.rng)));
      calls.call("HitIndex", c, () => {
        const index = HitIndex.fromScene(c.positions, geometry, someNumber(c.rng, 4));
        index.at(junkNumber(c.rng), junkNumber(c.rng), junkNumber(c.rng));
        index.within({ x: junkNumber(c.rng), y: junkNumber(c.rng), width: junkNumber(c.rng), height: junkNumber(c.rng) });
        new HitIndex(junkNumber(c.rng)).at(0, 0);
      });
    }),
  );

  it(
    "scene, marks, legend, figure and SVG export",
    search(["buildScene", "budgetEdges", "nodeMarks", "edgeMarks", "nodeMark", "edgeMark", "edgeColor", "edgePoints", "routeMidpoint", "edgeLabelPoint", "gatewayGlyph", "nodeCount", "truncateText", "fitText", "estimateTextWidth", "sceneLegend", "legendItemHeight", "legendLayout", "figureFrame", "toSVG", "resolveViews", "viewsSharePositions", "stateStyle", "markInState", "ruleTextRole", "pathArrowhead", "lineEnd", "groupMark", "groupMarks", "legendOfScene", "figureCaption"], (calls, c) => {
      const g = c.graph;
      const L = locale(c);
      const activityLabels = c.rng.chance() ? labels(c) : undefined;
      const moved = c.rng.chance(0.2) ? Object.fromEntries(c.rng.sample(g.nodes, Math.min(2, g.nodes.length)).map((n) => [n.id, { x: junkCoordinate(c.rng, 50), y: junkCoordinate(c.rng, 50) }])) : undefined;
      const scene = calls.call(
        "buildScene",
        c,
        () =>
          buildScene(g, c.positions, {
            locale: L,
            lanes: c.rng.pick(["none", "stages", "roles"] as const),
            activityLabels,
            selfLoops: c.rng.chance(0.8),
            lod: c.rng.chance(0.3) ? { labels: junkNumber(c.rng) } : undefined,
            lodBySize: c.rng.chance(),
            moved,
          }),
      );
      if (scene) {
        const nodes = new Set(g.nodes.map((n) => n.id));
        must(scene.nodeMarks.every((m) => nodes.has(m.id) && finiteBox(m.box)), c, () => `a node drawn without a finite box: ${JSON.stringify(scene.nodeMarks.find((m) => !finiteBox(m.box))?.box)}`);
        must(scene.edgeMarks.every((m) => m.points.length >= 2 && m.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))), c, () => "an edge drawn along a point that is not finite");
        must(scene.marks.every((m) => finiteBox(m.box)), c, () => `an overlay mark without a finite box: ${scene.marks.find((m) => !finiteBox(m.box))?.kind}`);
        must(finiteBox(scene.bounds), c, () => `scene bounds ${JSON.stringify(scene.bounds)}`);
        const texts = [...scene.nodeMarks.flatMap((m) => m.texts), ...scene.edgeMarks.flatMap((m) => m.texts), ...scene.marks.flatMap((m) => m.texts)];
        must(texts.every((x) => readable(x.text) && [x.x, x.y, x.size].every(Number.isFinite)), c, () => `a text that went wrong: ${JSON.stringify(texts.find((x) => !readable(x.text) || ![x.x, x.y, x.size].every(Number.isFinite)))}`);
      }
      const s = scene ?? buildScene({ nodes: [], edges: [] }, c.positions);
      const budget = junkNumber(c.rng);
      calls.call("budgetEdges", c, () => budgetEdges(s, c.rng.chance(0.2) ? { edges: ids(c), total: s.edgeMarks.length } : budget, { selection: { edges: ids(c).slice(0, 2) }, focused: junkString(c.rng), highlighted: new Set(ids(c).slice(-2)) }, c.rng.chance() ? c.rng.sample(s.edgeMarks.map((_, i) => i), c.rng.int(0, s.edgeMarks.length)) : undefined));
      calls.call("nodeMarks", c, () => nodeMarks(g, c.positions, s.scales, { locale: L, activityLabels }));
      calls.call("edgeMarks", c, () => edgeMarks(g, c.positions, s.scales, L));
      const node = g.nodes[0] ?? { id: "x", kind: "activity", label: junkString(c.rng) };
      const edge = g.edges[0] ?? { id: "e", kind: "follows", source: "x", target: "y" };
      const box = { x: junkCoordinate(c.rng, 0), y: junkCoordinate(c.rng, 0), width: junkCoordinate(c.rng, 180), height: junkCoordinate(c.rng, 60) };
      calls.call("nodeMark", c, () => nodeMark(node, box, { color: junkString(c.rng), pattern: c.rng.pick(PATTERNS), locale: L, activityLabels }));
      const points = c.rng.pick([[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: junkNumber(c.rng), y: 3 }], [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }]]);
      calls.call("edgeMark", c, () => edgeMark(edge, points, { color: junkString(c.rng), width: junkNumber(c.rng), locale: L }));
      calls.call("edgeColor", c, () => edgeColor(edge, s.scales));
      // The interactive states a theme's rules restyle, on every kind of mark.
      const states = { selected: c.rng.chance(), hovered: c.rng.chance(), focused: c.rng.chance(), dimmed: c.rng.chance() };
      for (const [part, m] of [["node", s.nodeMarks[0]], ["edge", s.edgeMarks[0]], ["group", s.groupMarks[0]], ["mark", s.marks[0]]] as const) {
        if (!m) continue;
        const state = calls.call("stateStyle", c, () => stateStyle(s, part, m, states));
        calls.call("markInState", c, () => markInState(m, state));
      }
      if (!s.nodeMarks.length) calls.call("stateStyle", c, () => stateStyle(s, "node", nodeMark(node, box, { color: "#000000", pattern: "solid" }), states));
      if (!s.nodeMarks.length) calls.call("markInState", c, () => markInState(nodeMark(node, box, { color: "#000000", pattern: "solid" }), undefined));
      calls.call("ruleTextRole", c, () => ruleTextRole(c.rng.pick([undefined, "nameLine", "countLine", "share", "count", "label", junkString(c.rng)])));
      const head = calls.call("pathArrowhead", c, () => {
        const a = pathArrowhead(junkNumber(c.rng));
        must(Number.isFinite(a.size), c, () => `an arrowhead of size ${a.size}`);
        return a;
      });
      calls.call("lineEnd", c, () => lineEnd(points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 1, y: 0 }], head ?? arrowheadTokens.edge));
      calls.call("groupMark", c, () => groupMark(g.groups?.[0] ?? { id: "g", kind: "stage", label: junkString(c.rng) }, box, { color: junkString(c.rng), pattern: c.rng.pick(PATTERNS), band: c.rng.chance() ? s.bands[0] : undefined }));
      calls.call("groupMarks", c, () => must(groupMarks(g, c.positions, s.bands, s.scales).every((m) => finiteBox(m.box)), c, () => "a group drawn without a finite box"));
      calls.call("legendOfScene", c, () => legendOfScene({ ...s, locale: L }));
      calls.call("figureCaption", c, () => {
        const caption = figureCaption(c.rng.chance() ? g : { ...g, meta: { ...(g.meta ?? {}), cases: junkValue(c.rng), period: junkString(c.rng) } }, L, c.rng.chance() ? (id) => `<${id}>` : undefined);
        must(caption === undefined || readable(caption), c, () => `figureCaption ${caption}`);
      });
      calls.call("edgePoints", c, () => edgePoints(c.positions, edge));
      calls.call("routeMidpoint", c, () => routeMidpoint(points));
      calls.call("edgeLabelPoint", c, () => edgeLabelPoint(points));
      calls.call("gatewayGlyph", c, () => gatewayGlyph(node));
      calls.call("nodeCount", c, () => must(nodeCount(node, L) === undefined || readable(nodeCount(node, L)), c, () => `nodeCount ${nodeCount(node, L)}`));
      const font = { size: junkNumber(c.rng), weight: c.rng.chance() ? junkNumber(c.rng) : undefined };
      calls.call("truncateText", c, () => truncateText(junkString(c.rng), junkNumber(c.rng), font));
      calls.call("fitText", c, () => fitText({ text: junkString(c.rng), x: 0, y: 0, size: junkNumber(c.rng), anchor: "middle", baseline: "alphabetic", paint: "ink", halo: true, maxWidth: junkNumber(c.rng) }));
      calls.call("estimateTextWidth", c, () => estimateTextWidth(junkString(c.rng), font));
      const legend = calls.call("sceneLegend", c, () => sceneLegend(s.scales.legend, g.overlays ?? []));
      for (const item of s.scales.legend.length ? s.scales.legend : [undefined]) calls.call("legendItemHeight", c, () => (item ? legendItemHeight(item) : legendItemHeight({ kind: "categorical", title: "legend.title", entries: [] })));
      calls.call("legendLayout", c, () => legendLayout(legend ?? s.legend));
      const exportOptions = { width: c.rng.chance(0.3) ? junkNumber(c.rng) : undefined, padding: c.rng.chance(0.3) ? junkNumber(c.rng) : undefined, lodZoom: c.rng.chance(0.3) ? junkNumber(c.rng) : undefined, preset: c.rng.pick(["single-column", "double-column", "slide", "none", undefined] as const), legend: c.rng.chance(0.8), context: c.rng.chance(), edgeBudget: c.rng.chance(0.3) ? budget : undefined };
      // A padding near zero (10⁻³²⁰) on an empty map gives a figure of no width, whose height scales without bound: in the findings.
      const soundOptions = within(exportOptions.width, 1, 1e5) && (exportOptions.padding === 0 || within(exportOptions.padding, 0.01, 1e4)) && within(exportOptions.lodZoom, 0, 1e3);
      calls.call("figureFrame", c, () => {
        const frameOptions = { title: c.rng.chance(), ...exportOptions, withheld: c.rng.chance() ? { shown: junkNumber(c.rng), total: junkNumber(c.rng) } : undefined };
        const frame = figureFrame({ ...s, activityLabels }, frameOptions);
        // The legend's rows carry the scene's overlays and items as data; the frame's own numbers are what it measured.
        const measured = { ...frame, legend: frame.legend && { ...frame.legend, layout: { height: frame.legend.layout.height, rows: [...frame.legend.layout.items, ...frame.legend.layout.keys, ...frame.legend.layout.chips].map((r) => r.y) } } };
        must(nonFinite(measured).length === 0 || !soundOptions, c, () => `figure frame ${nonFinite(measured).join(", ")} with ${JSON.stringify(frameOptions)}`);
      });
      calls.call(
        "toSVG",
        c,
        () => {
          const svg = toSVG({ graph: g, positions: c.positions, locale: L, title: c.rng.chance() ? junkString(c.rng) : undefined, subtitle: c.rng.chance() ? junkString(c.rng) : undefined, lanes: c.rng.pick(["none", "stages", "roles"] as const), activityLabels, selfLoops: c.rng.chance() }, exportOptions);
          if (c.accepted && soundOptions) must(!/NaN|Infinity/.test(svg), c, () => `NaN or Infinity in the SVG: …${svg.slice(Math.max(0, svg.search(/NaN|Infinity/) - 120), svg.search(/NaN|Infinity/) + 40)}…`);
          must((svg.match(/<g\b/g) ?? []).length === (svg.match(/<\/g>/g) ?? []).length, c, () => "unbalanced groups in the SVG");
        },
      );
      const view = (id: string) => ({ id, label: junkString(c.rng), nodeMetrics: Object.fromEntries(g.nodes.slice(0, 2).map((n) => [n.id, { cases: junkValue(c.rng) }])), edgeMetrics: Object.fromEntries(g.edges.slice(0, 2).map((e) => [e.id, { count: junkValue(c.rng) }])), overlays: c.rng.chance() ? g.overlays : [{ kind: "badge" as const, target: "gone" }] });
      const set = calls.call("resolveViews", c, () => resolveViews(g, [view("a"), view("b"), { ...view("a"), graph: c.rng.chance() ? { nodes: [], edges: [] } : undefined }], c.positions, { shareScales: c.rng.chance() }));
      calls.call("viewsSharePositions", c, () => set && viewsSharePositions(set));
    }),
  );

  it(
    "selection, paths, filters and actions",
    search(["isSelected", "selectionSize", "selectionEquals", "selectionElements", "selectElement", "selectMany", "clearSelection", "selectionShape", "relatedToSelection", "describeSelection", "normalizePath", "pathsFor", "focusMembers", "neighbourhood", "pathBetween", "pathRows", "focusHighlight", "asFilter", "normalizeFilterPreview", "canonicalClause", "clauseKey", "canonicalFilter", "filterEquals", "addClause", "removeClause", "changesCases", "describeClause", "describePreview", "clauseForTarget", "menuTargetFor", "defaultActions", "sortActions", "menuTitle"], (calls, c) => {
      const g = c.graph;
      const L = locale(c);
      const pick = () => c.rng.pick(ids(c));
      const kind = () => c.rng.pick(["node", "edge", "group"] as const);
      const selection: Selection = { nodes: c.rng.sample(ids(c), 2), edges: c.rng.sample(ids(c), 1), groups: c.rng.chance() ? [pick()] : [] };
      const ref = { kind: kind(), id: pick() };
      calls.call("isSelected", c, () => isSelected(selection, ref));
      calls.call("selectionSize", c, () => selectionSize(selection));
      calls.call("selectionEquals", c, () => selectionEquals(selection, emptySelection));
      calls.call("selectionElements", c, () => selectionElements(selection));
      calls.call("selectElement", c, () => selectElement(selection, ref, c.rng.pick(["replace", "toggle", "add", "remove"] as const)));
      calls.call("selectMany", c, () => selectMany(selection, [ref, { kind: kind(), id: pick() }], c.rng.pick(["replace", "toggle", "add", "remove"] as const)));
      calls.call("clearSelection", c, () => clearSelection());
      calls.call("selectionShape", c, () => selectionShape(selection));
      calls.call("relatedToSelection", c, () => relatedToSelection(g, selection));
      calls.call("describeSelection", c, () => must(readable(describeSelection(g, selection, L)), c, () => `describeSelection: ${describeSelection(g, selection, L)}`));
      const path: FlowPath = { from: pick(), to: c.rng.chance() ? pick() : undefined, count: junkValue(c.rng), cases: junkValue(c.rng), share: junkValue(c.rng), median_lag: junkValue(c.rng), violation_share: junkValue(c.rng), medianLagHours: c.rng.chance() ? junkValue(c.rng) : undefined };
      const focus = pick();
      calls.call("normalizePath", c, () => normalizePath(path, focus, c.rng.pick(["incoming", "outgoing"] as const)));
      calls.call("pathsFor", c, () => pathsFor(g, focus, { paths: c.rng.chance() ? g.paths : { focus, incoming: [path, {}], outgoing: [path] }, sort: c.rng.pick(["count", "cases", "share", "medianLagHours", "p90LagHours", "violationShare", "label"] as const), ascending: c.rng.chance(), kinds: c.rng.chance() ? ["follows", "flow"] : undefined }));
      calls.call("focusMembers", c, () => focusMembers(g, focus));
      calls.call("neighbourhood", c, () => neighbourhood(g, focus));
      const between = calls.call("pathBetween", c, () => pathBetween(g, focus, pick()));
      calls.call("pathRows", c, () => between && pathRows(g, between, c.rng.pick(["forward", "reverse"] as const)));
      calls.call("focusHighlight", c, () => focusHighlight(g, c.rng.chance() ? focus : [focus, pick()]));
      const clause = junkClause(c, 0);
      const clauses = [clause, junkClause(c, 0), junkClause(c, 0)];
      const filter = calls.call("asFilter", c, () => asFilter(c.rng.pick([clauses, { and: clauses }, undefined, null])));
      calls.call("canonicalClause", c, () => canonicalClause(clause));
      calls.call("clauseKey", c, () => clauseKey(clause));
      calls.call("canonicalFilter", c, () => canonicalFilter(c.rng.chance() ? clauses : { and: clauses }));
      calls.call("filterEquals", c, () => filterEquals(clauses, filter ?? emptyFilter));
      const added = calls.call("addClause", c, () => addClause(filter ?? emptyFilter, clause));
      calls.call("removeClause", c, () => removeClause(added ?? emptyFilter, junkNumber(c.rng)));
      calls.call("changesCases", c, () => changesCases(clause));
      calls.call("describeClause", c, () => describeClause(clause, L, (id) => (c.rng.chance(0.8) ? (indexGraph(g).label(id) ?? id) : junkString(c.rng))));
      const raw = { cases_in: junkValue(c.rng), casesOut: junkValue(c.rng), cases_total: c.rng.chance() ? junkValue(c.rng) : undefined, per_clause: c.rng.pick([[{ clause: 0, removed_marginally: junkValue(c.rng) }], junkValue(c.rng), junkString(c.rng), null, [null]]), in_scope_by_constraint: c.rng.pick([{ a: junkValue(c.rng) }, junkString(c.rng)]) };
      const preview = calls.call("normalizeFilterPreview", c, () => normalizeFilterPreview(raw));
      calls.call("describePreview", c, () => must(describePreview(preview, L) === undefined || readable(describePreview(preview, L)), c, () => `describePreview: ${describePreview(preview, L)}`));
      const targetKind = c.rng.pick(["node", "edge", "group", "pair", "set"] as const);
      calls.call("clauseForTarget", c, () => clauseForTarget({ kind: targetKind, ids: c.rng.sample(ids(c), c.rng.int(0, 3)) }, c.rng.pick(["keep", "exclude"] as const), c.rng.chance(0.8) ? g : undefined));
      const target = calls.call("menuTargetFor", c, () => menuTargetFor(g, ref, selection));
      if (target) {
        const actions = calls.call("defaultActions", c, () => defaultActions(g, target, L, { collapsed: c.rng.chance(), hasFocus: c.rng.chance() })) ?? [];
        calls.call("sortActions", c, () => sortActions([...actions, { id: junkString(c.rng), label: junkString(c.rng), group: c.rng.pick(["filter", "export", "unknown" as "filter"]) }]));
        calls.call("menuTitle", c, () => must(readable(menuTitle(target, g, L)), c, () => `menuTitle: ${menuTitle(target, g, L)}`));
      } else {
        for (const name of ["defaultActions", "sortActions", "menuTitle"]) calls.call(name, c, () => fail(failure(c, "menuTargetFor returned nothing")));
      }
    }),
  );

  it(
    "activity labels",
    search(["activityReferences", "activityLabel", "wrapActivityText", "activityNodeCounts", "activityCounts", "activityDescription", "activityLabelLines", "activityNodeSize", "activityKeyLines"], (calls, c) => {
      const g = c.graph;
      const L = locale(c);
      const previous = c.rng.chance() ? Object.fromEntries(ids(c).slice(0, 3).map((id) => [id, junkString(c.rng)])) : undefined;
      calls.call("activityReferences", c, () => activityReferences(g, previous));
      const options = labels(c);
      if (c.rng.chance(0.3)) options.names = Object.fromEntries(ids(c).slice(0, 2).map((id) => [id, junkString(c.rng)]));
      const node = g.nodes.length ? c.rng.pick(g.nodes) : { id: junkString(c.rng), kind: "activity" as const, label: junkString(c.rng), metrics: { cases: junkValue(c.rng), events: junkValue(c.rng) } };
      calls.call("activityLabel", c, () => activityLabel(node, options));
      calls.call("wrapActivityText", c, () => wrapActivityText(node.label ?? "", junkNumber(c.rng), c.rng.chance() ? junkNumber(c.rng) : undefined));
      calls.call("activityNodeCounts", c, () => must(readable(activityNodeCounts(node, options, L)), c, () => `counts: ${activityNodeCounts(node, options, L)}`));
      calls.call("activityCounts", c, () => must(readable(activityCounts(node, options, L, c.rng.chance())), c, () => "activityCounts"));
      calls.call("activityDescription", c, () => must(readable(activityDescription(node, options, L)), c, () => `description: ${activityDescription(node, options, L)}`));
      calls.call("activityLabelLines", c, () => activityLabelLines(node, options, junkNumber(c.rng), L));
      calls.call("activityNodeSize", c, () => must(finiteBox({ x: 0, y: 0, ...activityNodeSize(node, options) }), c, () => "activityNodeSize"));
      calls.call("activityKeyLines", c, () => activityKeyLines(g, c.rng.chance() ? options : undefined, junkNumber(c.rng), L));
    }),
  );

  it(
    "the Canvas entry point's headless functions",
    search(["prepareScene", "selfLoopOverlays", "groupLabelOf", "drawScene", "drawLegend", "tracePath", "toPNGCanvas", "toPNGDataUrl", "canvasTextMeasure"], (calls, c) => {
      const g = c.graph;
      const L = locale(c);
      const prepared = calls.call("prepareScene", c, () => canvas.prepareScene(g, c.positions, { locale: L, lanes: c.rng.pick(["none", "stages", "roles"] as const), lodBySize: c.rng.chance(), selfLoops: c.rng.chance(), activityLabels: c.rng.chance() ? labels(c) : undefined }));
      calls.call("selfLoopOverlays", c, () => canvas.selfLoopOverlays(g, L));
      const ink = argumentsRecorder();
      const view = { x: junkCoordinate(c.rng, prepared?.bounds.x ?? 0), y: junkCoordinate(c.rng, prepared?.bounds.y ?? 0), zoom: junkCoordinate(c.rng, 1), width: junkCoordinate(c.rng, 800), height: junkCoordinate(c.rng, 600) };
      const sound = Object.values(view).every(Number.isFinite);
      if (prepared) {
        must(prepared.nodes.every((n) => finiteBox(n.box)), c, () => "a Canvas node without a finite box");
        calls.call("groupLabelOf", c, () => canvas.groupLabelOf(prepared, c.rng.pick(ids(c))));
        calls.call("drawScene", c, () => {
          canvas.drawScene(ink.ctx, prepared, view, { selection: { nodes: ids(c).slice(0, 1), edges: [], groups: [] }, hovered: junkString(c.rng), focused: c.rng.pick(ids(c)) }, { edgeBudget: c.rng.chance() ? junkNumber(c.rng) : "all", cull: c.rng.chance() });
          if (sound) must(nonFinite(ink.calls.map((call) => call.args)).length === 0, c, () => `drawScene drew at ${nonFinite(ink.calls.map((call) => call.args)).join(", ")}`);
        });
        calls.call("drawLegend", c, () => canvas.drawLegend(ink.ctx, prepared, someNumber(c.rng, 0), someNumber(c.rng, 0), someNumber(c.rng, 200)));
      } else {
        for (const name of ["groupLabelOf", "drawScene", "drawLegend"]) calls.call(name, c, () => fail(failure(c, "prepareScene returned nothing")));
      }
      calls.call("canvasTextMeasure", c, () => {
        // A context that measures what it is given, or none (no document in Node): the estimate.
        const measure = canvas.canvasTextMeasure(c.rng.chance() ? junkString(c.rng) : undefined, c.rng.chance() ? { font: "", measureText: (text: string) => ({ width: text.length * someNumber(c.rng, 6) }) } : null);
        measure(junkString(c.rng), { size: junkNumber(c.rng), weight: c.rng.chance() ? junkNumber(c.rng) : undefined });
      });
      calls.call("tracePath", c, () => canvas.tracePath(ink.ctx, c.rng.pick(["", "M0 0", "M0 0 C1 2 3", "Z", junkString(c.rng), "M1e400 NaN L 5 5", "M0 0 Q 1 1 2 2 L 3 3 Z"])));
      const png = argumentsRecorder();
      const createCanvas = (width: number, height: number) => ({ width, height, getContext: () => png.ctx, toDataURL: () => "data:image/png;base64," });
      const pngOptions = { createCanvas, legend: c.rng.chance(), scale: c.rng.chance(0.3) ? junkNumber(c.rng) : 1, edgeBudget: c.rng.chance(0.3) ? junkNumber(c.rng) : undefined, preset: c.rng.pick(["single-column", "slide", "none", undefined] as const) };
      calls.call(
        "toPNGCanvas",
        c,
        () => {
          const out = canvas.toPNGCanvas({ graph: g, positions: c.positions, locale: L, title: c.rng.chance() ? junkString(c.rng) : undefined, lanes: c.rng.pick(["none", "stages"] as const) }, pngOptions);
          if (c.accepted && within(pngOptions.scale, 0.1, 16)) must(nonFinite(png.calls.map((call) => call.args)).length === 0 && nonFinite({ ...out, canvas: undefined }).length === 0, c, () => `the PNG drew at ${nonFinite(png.calls.map((call) => call.args)).join(", ")}, measured ${nonFinite({ ...out, canvas: undefined }).join(", ")} with ${JSON.stringify(pngOptions)}`);
        },
      );
      calls.call("toPNGDataUrl", c, () => canvas.toPNGDataUrl({ graph: g, positions: c.positions }, { ...pngOptions, legend: false }));
    }),
  );

  it(
    "the BPMN bridge's synchronous functions",
    search(["liteFromStages", "liteFromGraph", "stageModelFromGraph", "liteCounts", "gatewayLabel", "bpmnNodeSize", "roundPositions", "xmlId", "exportableEdges", "matchActivities", "applyMapping", "mappingIndex", "normalizeLabel", "createIdResolver", "createIdMap", "registerId", "renameToActivities", "tagOfType", "typeOfTag"], (calls, c) => {
      const g = c.graph;
      const activity = () => c.rng.pick([junkString(c.rng), { id: junkString(c.rng), label: c.rng.chance() ? junkString(c.rng) : undefined, loop: c.rng.chance(), optional: c.rng.chance(), metrics: { cases: junkValue(c.rng) } }]);
      const stages = Array.from({ length: c.rng.int(0, 4) }, (_, i) => ({ id: c.rng.chance(0.8) ? `s${i}` : junkString(c.rng), label: junkString(c.rng), activities: Array.from({ length: c.rng.int(0, 3) }, activity), flow: c.rng.pick(["sequence", "choice", "parallel", undefined] as const), optional: c.rng.chance(0.2), role: c.rng.chance() ? junkString(c.rng) : undefined }));
      calls.call("liteFromStages", c, () => bpmn.liteFromStages({ id: junkString(c.rng), stages }, { lanes: c.rng.pick(["stage", "role", "none"] as const), startLabel: junkString(c.rng) }));
      const lite = calls.call("liteFromGraph", c, () =>
        bpmn.liteFromGraph(g, { abstraction: c.rng.chance(0.3) ? { minNodeShare: junkNumber(c.rng) } : undefined, andGateways: c.rng.chance(), lanes: c.rng.pick(["groups", "none"] as const), selfLoops: c.rng.pick(["marker", "flow", "drop"] as const) }),
      );
      if (lite && c.accepted) must(!validateGraph(lite).some((i) => i.level === "error"), c, () => `liteFromGraph made an invalid graph: ${JSON.stringify(validateGraph(lite).slice(0, 3))}`);
      calls.call("stageModelFromGraph", c, () => bpmn.stageModelFromGraph(g, { limit: c.rng.chance() ? junkNumber(c.rng) : undefined, label: junkString(c.rng) }));
      calls.call("liteCounts", c, () => bpmn.liteCounts(lite ?? g));
      calls.call("gatewayLabel", c, () => bpmn.gatewayLabel(c.rng.chance() ? [junkString(c.rng), "and", "split"] : undefined));
      for (const n of g.nodes.slice(0, 3)) calls.call("bpmnNodeSize", c, () => bpmn.bpmnNodeSize(n));
      if (!g.nodes.length) calls.call("bpmnNodeSize", c, () => bpmn.bpmnNodeSize({ id: "", kind: "zz" as "activity", label: "" }));
      calls.call("roundPositions", c, () => bpmn.roundPositions(c.positions));
      calls.call("xmlId", c, () => bpmn.xmlId(junkString(c.rng), new Set([junkString(c.rng)]), c.rng.chance() ? junkString(c.rng) : undefined));
      calls.call("exportableEdges", c, () => bpmn.exportableEdges(g));
      const rows = g.nodes.slice(0, 4).map((n) => ({ taskId: n.id, nodeId: n.id, label: c.rng.chance(0.8) ? n.label : junkString(c.rng), type: c.rng.pick(["bpmn:Task", "bpmn:UserTask", junkString(c.rng)]) }));
      const refs = Array.from({ length: c.rng.int(0, 4) }, () => ({ id: junkString(c.rng), label: c.rng.chance() ? junkString(c.rng) : undefined, aliases: c.rng.chance() ? [junkString(c.rng)] : undefined }));
      const matched = calls.call("matchActivities", c, () => bpmn.matchActivities(rows, refs, { normalize: c.rng.chance() ? (s: string) => s.trim() : undefined })) ?? rows;
      const mapping = c.rng.chance() ? matched : Object.fromEntries(refs.map((r) => [r.id, c.rng.pick(ids(c))]));
      calls.call("applyMapping", c, () => bpmn.applyMapping(g, mapping));
      calls.call("mappingIndex", c, () => bpmn.mappingIndex(mapping));
      calls.call("normalizeLabel", c, () => bpmn.normalizeLabel(junkString(c.rng)));
      const idMap = calls.call("createIdMap", c, () => bpmn.createIdMap()) ?? { toBpmn: {}, toFlow: {} };
      calls.call("registerId", c, () => bpmn.registerId(idMap, junkString(c.rng), junkString(c.rng)));
      const resolver = calls.call("createIdResolver", c, () => {
        const r = bpmn.createIdResolver({ ids: idMap, mapping });
        for (const id of ids(c).slice(0, 4)) {
          r.flowId(id);
          r.bpmnId(id);
          r.activityId(id);
          r.flowIdsOfActivity(id);
          r.names(id);
          r.matches(id, junkString(c.rng));
        }
        return r;
      });
      calls.call("renameToActivities", c, () => resolver && bpmn.renameToActivities(ids(c), resolver));
      calls.call("tagOfType", c, () => bpmn.tagOfType(c.rng.pick(["bpmn:UserTask", "bpmn:Task", "bpmn:", "x:y", junkString(c.rng) || "bpmn:Task"])));
      calls.call("typeOfTag", c, () => bpmn.typeOfTag(junkString(c.rng)));
    }),
  );

  it("draws on the default node sizes of every kind it knows", () => {
    // The generators place nodes at these sizes; a change here must reach them.
    expect(Object.keys(DEFAULT_SIZES).sort()).toEqual(["activity", "event", "gateway", "note", "stage"]);
  });
});

/** A filter clause as a backend or a stored URL may hold it: unknown kinds and ops, missing and junk fields, nested groups. */
function junkClause(c: MalformedCase, depth: number): FilterClause {
  const id = () => c.rng.pick(ids(c));
  const n = () => (c.rng.chance(0.3) ? undefined : junkValue(c.rng));
  const clause = c.rng.pick([
    () => ({ kind: "time", field: c.rng.pick(["case_start", "active", junkString(c.rng)]), from: junkString(c.rng), to: c.rng.chance() ? junkString(c.rng) : undefined }),
    () => ({ kind: "attribute", field: junkString(c.rng), in: c.rng.chance() ? [junkString(c.rng), junkValue(c.rng), null] : undefined, not_in: c.rng.chance() ? [junkString(c.rng)] : undefined, range: c.rng.chance() ? [n(), n()] : undefined, missing: c.rng.chance() }),
    () => ({ kind: "activity", op: c.rng.pick(["contains", "not_contains", "starts_with", "ends_with", "never", "sometimes"]), activity: c.rng.chance(0.9) ? id() : undefined }),
    () => ({ kind: "follows", a: id(), b: id(), directly: c.rng.chance(), never: c.rng.chance() }),
    () => ({ kind: "lag", a: id(), b: id(), unit: c.rng.pick(["D", "H", "M", "S", "W", undefined]), min: n(), max: n(), directly: c.rng.chance() }),
    () => ({ kind: "count", activity: id(), min: n(), max: n() }),
    () => ({ kind: "open", value: c.rng.pick([true, false, "yes", undefined]) }),
    () => ({ kind: "constraint", constraint: junkString(c.rng), state: c.rng.pick(["violating", "satisfied", "in_scope", "out_of_scope", "maybe"]), label: c.rng.chance() ? junkString(c.rng) : undefined }),
    () => ({ kind: "slice", slicing: junkString(c.rng), key: c.rng.pick([junkString(c.rng), junkValue(c.rng), null, { a: 1 }]) }),
    () => ({ kind: "any", clauses: depth < 2 ? Array.from({ length: c.rng.int(0, 3) }, () => junkClause(c, depth + 1)) : [] }),
    () => ({ kind: c.rng.pick(["unknown", "", "ANY", "any"]) }),
  ])();
  return clause as unknown as FilterClause;
}
