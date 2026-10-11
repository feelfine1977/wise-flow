// The core entry point. Every name is listed; a name marked deprecated stays
// exported until it is removed (see "Deprecated names" in docs/API.md).

export {
  metric,
  hasTag,
  indexGraph,
  validateGraph,
  validateGateways,
  normalizeGraph,
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
  ModelOutline,
  FlowGraph,
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
  interpolatePalette,
  contrastRatio,
  contrastText,
  hashKey,
  lodAt,
  lodForSize,
  buildScales,
  orderedCategorical,
  themePalette,
  patternDefs,
  PATTERNS,
  palettes,
  fixedColors,
  defaultLod,
  defaultStyle,
  diffStyle,
  shortfallStyle,
} from "./style.js";
export type {
  PatternId,
  PatternLook,
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
  textTokens,
  radiusTokens,
  strokeTokens,
  dashTokens,
  opacityTokens,
  spaceTokens,
  zTokens,
  dimensionTokens,
  arrowheadTokens,
  patternTokens,
  hatchTokens,
  designTokens,
  themedColors,
} from "./tokens.js";
export type {
  ColorToken,
  Arrowhead,
} from "./tokens.js";
export {
  defaultTheme,
  printTheme,
  themePresets,
  resolveTheme,
  themeColors,
} from "./theme.js";
export type {
  Theme,
  ThemePalettes,
  ThemePreset,
  ThemeOverrides,
  ThemeSetting,
  ColorScheme,
  FrequencyCue,
} from "./theme.js";
export { checkTheme, type ThemeDeviation } from "./style.js";

export {
  constraintOverlays,
  canonicalOverlays,
  overlaysFor,
  describeOverlay,
  overlayGeometry,
  overlayMargin,
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
  formatPathCount,
} from "./format.js";
export type {
  Locale,
} from "./format.js";

export {
  t,
  metricLabel,
  strings,
} from "./strings.js";

export {
  metricRegistry,
  metricEntry,
  metricKind,
  metricName,
  metricUnit,
  metricBasis,
  formatMetricValue,
  elementMetric,
  metricLabelOf,
  metricMeanNote,
  channelTitle,
} from "./metrics.js";
export type {
  MetricBasis,
  MetricKind,
  MetricEntry,
  MetricFormatOptions,
} from "./metrics.js";
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
  ShownEdges,
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

export type {
  Insets,
  FitView,
  FitOptions,
} from "./viewport.js";
export {
  fitViewport,
  panelInsets,
} from "./viewport.js";

export type {
  TextMeasure,
} from "./text.js";
export {
  estimateTextWidth,
  truncateText,
  wrapText,
  fitText,
  fitLead,
} from "./text.js";

export {
  fitChars,
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
  routeMidpoint,
  edgeLabelPoint,
  edgePoints,
  gatewayGlyph,
  nodeCount,
  nodeMark,
  edgeMark,
  nodeMarks,
  edgeMarks,
  groupMark,
  groupMarks,
  edgeColor,
} from "./element-marks.js";
export type {
  ElementText,
  NodeCue,
  NodeMark,
  EdgeMark,
  GroupMark,
  BoxSide,
} from "./element-marks.js";

export {
  sceneLegend,
  legendOfScene,
  legendItemHeight,
  legendLayout,
  figureFrame,
  figureCaption,
  FIGURE_WIDTHS,
  legendMetrics,
  figureMetrics,
} from "./figure.js";
export type {
  FigurePreset,
  LegendKeyKind,
  LegendKey,
  LegendRow,
  LegendSource,
  SceneLegend,
  LegendLayout,
  FigureFrameOptions,
  FigureFrame,
  FramedScene,
} from "./figure.js";
