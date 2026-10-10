// The core entry point. Every name is listed; a name marked deprecated stays
// exported until the next major version.

export {
  /** @deprecated Leaves the entry point in the next major version; test `"source" in element`. */
  isEdge,
  metric,
  hasTag,
  indexGraph,
  validateGraph,
  normalizeGraph,
  /** @deprecated Leaves the entry point in the next major version; test `node.kind === "event" || node.kind === "gateway"`. */
  isStructuralNode,
  /** @deprecated Leaves the entry point in the next major version; compare `a.id` and `b.id`. */
  byId,
  MAP_TARGET,
} from "./model.js";
export type {
  NodeKind,
  EdgeKind,
  GroupKind,
  OverlayKind,
  Metrics,
  FlowNode,
  FlowEdge,
  FlowGroup,
  OverlayPayload,
  Overlay,
  FlowPath,
  FlowPaths,
  AbstractionMeta,
  FlowMeta,
  FlowGraph,
  /** @deprecated Leaves the entry point in the next major version; use `FlowNode | FlowEdge`. */
  FlowElement,
  GraphIndex,
  GraphIssue,
} from "./model.js";

export {
  strengths,
  collapseGroups,
  components,
  isConnected,
  abstract,
  diff,
  RECONNECTED_TAG,
  COLLAPSED_TAG,
  DIFF_TAGS,
} from "./aggregate.js";
export type {
  AbstractOptions,
  /** @deprecated Leaves the entry point in the next major version; use `NonNullable<Parameters<typeof diff>[2]>`. */
  DiffOptions,
} from "./aggregate.js";

export {
  defaultNodeSize,
  unionBoxes,
  positionsBounds,
  createPositions,
  clearLayoutCache,
  layout,
  createLayoutScope,
  unionGraph,
  layoutUnion,
  filterPositions,
  coversGraph,
  straightRoute,
  DEFAULT_SIZES,
  LayoutUnavailableError,
} from "./layout.js";
export type {
  XY,
  Box,
  EdgeRoute,
  LayoutEngine,
  LayoutDirection,
  Positions,
  NodeSize,
  LayoutOptions,
  PositionsContents,
  LayoutScopeOptions,
  LayoutScope,
} from "./layout.js";

export {
  repositionNodes,
  routeSequenceFlows,
} from "./routing.js";

export {
  hexToRgb,
  /** @deprecated Leaves the entry point in the next major version; format the rounded channels as `#rrggbb`. */
  rgbToHex,
  interpolatePalette,
  /** @deprecated Leaves the entry point in the next major version; use `contrastRatio`. */
  relativeLuminance,
  contrastRatio,
  contrastText,
  hashKey,
  lodAt,
  lodForSize,
  /** @deprecated Leaves the entry point in the next major version; use `buildScales(graph, spec).color`. */
  colorOn,
  buildScales,
  patternDefs,
  PATTERNS,
  palettes,
  fixedColors,
  defaultLod,
  defaultStyle,
  diffStyle,
} from "./style.js";
export type {
  PatternId,
  /** @deprecated Leaves the entry point in the next major version; use `NonNullable<ColorSpec["palette"]>`. */
  PaletteName,
  ChannelSpec,
  ColorSpec,
  LodRules,
  StyleSpec,
  CategoricalEntry,
  LegendItem,
  Scales,
} from "./style.js";

export {
  arrowheadExtent,
  patternTwin,
  cssVariable,
  tokenVariables,
  colorTokens,
  darkColorTokens,
  paletteTokens,
  fontTokens,
  nodeSizeTokens,
  sizeTokens,
  textSizeTokens,
  arrowheadTokens,
  patternTokens,
  hatchTokens,
  designTokens,
  themedColors,
} from "./tokens.js";
export type {
  ColorToken,
  Arrowhead,
  /** @deprecated Leaves the entry point in the next major version; use `ReturnType<typeof patternTwin>`. */
  PatternShape,
} from "./tokens.js";

export {
  constraintOverlays,
  canonicalOverlays,
  overlaysFor,
  describeOverlay,
  overlayGeometry,
  overlayMargin,
  /** @deprecated Leaves the entry point in the next major version; use `{ x: s.labelX ?? s.x + s.width / 2, y: s.labelY ?? s.y }`. */
  shapeAnchor,
} from "./overlays.js";
export type {
  ConstraintType,
  ConstraintDescription,
  ConstraintStats,
  OverlayPresetOptions,
  OverlayShape,
  OverlayGeometryOptions,
  OverlayGeometry,
} from "./overlays.js";

export {
  HitIndex,
} from "./hit.js";
export type {
  /** @deprecated Leaves the entry point in the next major version; use `HitItem["kind"]`. */
  HitKind,
  HitItem,
} from "./hit.js";

export {
  toSVG,
} from "./export.js";
export type {
  Scene,
  ExportOptions,
} from "./export.js";

export {
  formatCount,
  formatNumber,
  formatShare,
  formatDelta,
  formatHours,
  formatDays,
  formatCompact,
} from "./format.js";
export type {
  Locale,
} from "./format.js";

export {
  t,
  metricLabel,
  strings,
} from "./strings.js";
export type {
  StringKey,
} from "./strings.js";

export {
  resolveViews,
  buildViews,
  viewsSharePositions,
} from "./views.js";
export type {
  ViewSpec,
  ResolvedView,
  ViewSet,
  /** @deprecated Leaves the entry point in the next major version; use `NonNullable<Parameters<typeof buildViews>[2]>`. */
  BuildViewsOptions,
} from "./views.js";

export {
  isSelected,
  selectionSize,
  selectionEquals,
  selectionElements,
  selectElement,
  selectMany,
  clearSelection,
  selectionShape,
  relatedToSelection,
  describeSelection,
  emptySelection,
} from "./selection.js";
export type {
  Selection,
  ElementKind,
  ElementRef,
  SelectMode,
  SelectionShape,
} from "./selection.js";

export {
  normalizePath,
  pathsFor,
  focusMembers,
  neighbourhood,
  pathBetween,
  pathRows,
  focusHighlight,
} from "./paths.js";
export type {
  PathRow,
  ActivityPaths,
  PathSortKey,
  /** @deprecated Leaves the entry point in the next major version; use `NonNullable<Parameters<typeof pathsFor>[2]>`. */
  PathsOptions,
  PathBetween,
  Focus,
} from "./paths.js";

export {
  asFilter,
  normalizeFilterPreview,
  canonicalClause,
  clauseKey,
  canonicalFilter,
  filterEquals,
  addClause,
  removeClause,
  changesCases,
  describeClause,
  describePreview,
  clauseForTarget,
  emptyFilter,
} from "./filters.js";
export type {
  TimeMode,
  TimeClause,
  AttributeClause,
  /** @deprecated Leaves the entry point in the next major version; use `ActivityClause["op"]`. */
  ActivityOp,
  ActivityClause,
  FollowsClause,
  LagClause,
  CountClause,
  OpenClause,
  ConstraintClause,
  SliceClause,
  AnyClause,
  FilterClause,
  Filter,
  FilterPreview,
  FilterTarget,
} from "./filters.js";

export {
  laneGroups,
  laneAssignment,
  laneModel,
  stackLanes,
  spanLanes,
  laneRoutes,
  laneBands,
} from "./lanes.js";
export type {
  LaneMode,
  LaneOptions,
  LaneBand,
  LaneResult,
  LaneModelOptions,
  LaneModel,
  LaneSlot,
} from "./lanes.js";

export {
  menuTargetFor,
  defaultActions,
  sortActions,
  menuTitle,
  MENU_GROUP_ORDER,
} from "./actions.js";
export type {
  MenuGroup,
  MenuTarget,
  MenuAction,
  /** @deprecated Leaves the entry point in the next major version; use `NonNullable<Parameters<typeof defaultActions>[3]>`. */
  DefaultActionOptions,
} from "./actions.js";

export {
  labelUnitsAt,
  smallLabelUnitsAt,
  LABEL_PX,
  MIN_LABEL_PX,
  MAX_LABEL_PX,
  MAX_LABEL_UNITS,
  MIN_READABLE_ZOOM,
  mapScaleAt,
  labelScreenPx,
} from "./label-sizing.js";

export {
  activityReferences,
  activityLabel,
  wrapActivityText,
  activityNodeCounts,
  activityCounts,
  activityDescription,
  activityLabelLines,
  activityNodeSize,
  activityKeyLines,
} from "./activity-labels.js";
export type {
  ActivityLabelOptions,
} from "./activity-labels.js";

export {
  followsSelfLoops,
  withFollowsSelfLoops,
  withObservedSelfLoops,
} from "./observed-loops.js";
export type {
  /** @deprecated Leaves the entry point in the next major version; use `NonNullable<Parameters<typeof followsSelfLoops>[1]>`. */
  FollowsSelfLoopOptions,
} from "./observed-loops.js";

export {
  buildScene,
} from "./scene.js";
export type {
  FlowSceneOptions,
  FlowScene,
} from "./scene.js";

export {
  budgetEdges,
} from "./edge-budget.js";
export type {
  EdgeBudget,
  EdgeProtection,
  EdgeSelection,
} from "./edge-budget.js";

export {
  overlayColor,
  tintColor,
  arcWidth,
  markArrowhead,
  chipText,
  overlayMarks,
  TINT_OPACITY,
  overlayArrow,
  chipLayout,
} from "./overlay-marks.js";
export type {
  MarkPaint,
  MarkFill,
  MarkStroke,
  MarkText,
  MarkGauge,
  OverlayMark,
} from "./overlay-marks.js";

export {
  fitChars,
  fitLead,
  markSvg,
  arrowMarker,
  patternTwinSvg,
  hatchSvg,
  svgMarkup,
} from "./mark-svg.js";
export type {
  SvgElement,
  MarkSvgOptions,
} from "./mark-svg.js";

export {
  truncateText,
  fitText,
  routeMidpoint,
  edgeLabelPoint,
  edgePoints,
  gatewayGlyph,
  nodeCount,
  nodeMark,
  edgeMark,
  nodeMarks,
  edgeMarks,
  edgeColor,
  estimateTextWidth,
} from "./element-marks.js";
export type {
  TextMeasure,
  ElementText,
  NodeMark,
  EdgeMark,
  /** @deprecated Leaves the entry point in the next major version; use `Parameters<typeof nodeMark>[2]`. */
  NodeMarkOptions,
} from "./element-marks.js";

export {
  sceneLegend,
  legendItemHeight,
  legendLayout,
  figureFrame,
  FIGURE_WIDTHS,
  legendMetrics,
  figureMetrics,
} from "./figure.js";
export type {
  FigurePreset,
  LegendKeyKind,
  LegendKey,
  SceneLegend,
  LegendLayout,
  FigureFrameOptions,
  FigureFrame,
  FramedScene,
} from "./figure.js";
