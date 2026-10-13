import type { Node, Edge } from "@xyflow/react";
import type {
  AbstractOptions,
  ActivityLabelOptions,
  EdgeBudget,
  EdgeMark,
  EdgeRoute,
  StateStyle,
  Filter,
  FilterClause,
  FilterPreview,
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowNode,
  FlowPaths,
  GroupMark,
  Insets,
  Focus,
  LaneBand,
  LaneMode,
  LayoutDirection,
  LayoutOptions,
  Locale,
  LodRules,
  Measure,
  MenuAction,
  MenuTarget,
  NodeMark,
  Overlay,
  OverlayMark,
  PatternId,
  Positions,
  XY,
  Selection,
  ShownEdges,
  StyleSpec,
  TextMeasure,
  ThemeSetting,
} from "../core/index.js";
import { emptySelection } from "../core/index.js";

export type { Selection };
export { emptySelection };

export type ActivityNodeData = {
  activityLabels?: ActivityLabelOptions;
  labelWidth?: number;
  labelHeight?: number;
  node: FlowNode;
  color: string;
  pattern: PatternId;
  hatched: boolean;
  /** CSS background layers of the marks that cover the node (tints), from the scene's marks. */
  tint?: string;
  /** Marks the node carries (badges, chips, hatching), in scene coordinates. */
  marks?: OverlayMark[];
  /** Top-left corner of the node's box in scene coordinates, where its marks are drawn from. */
  origin?: XY;
  direction: LayoutDirection;
  focused: boolean;
  hovered: boolean;
  dimmed: boolean;
  locale: Locale;
  meta?: string;
  description: string;
  /** What the node looks like (`FlowScene.nodeMarks`); resolved from the fields above without it. */
  mark?: NodeMark;
  /** What the theme's rules for the node's interactive states set (`stateStyle`), already in `mark`. */
  state?: StateStyle;
};

export type GroupNodeData = {
  group: FlowGroup;
  color: string;
  /** CSS background layers of the marks that cover the group (tints), from the scene's marks; a colour before marks. */
  tint?: string;
  /** Marks the group carries (chips, hatching), in scene coordinates. */
  marks?: OverlayMark[];
  /** Top-left corner of the group's box in scene coordinates, where its marks are drawn from. */
  origin?: XY;
  description: string;
  /** The group is drawn as a lane band (see `lanes`). */
  band?: LaneBand;
  /** What the group looks like (`FlowScene.groupMarks`); resolved from the fields above without it. */
  mark?: GroupMark;
  /** What the theme's rules for the group's interactive states set (`stateStyle`), already in `mark`. */
  state?: StateStyle;
};

export type WfNode = Node<ActivityNodeData, "activity" | "stage" | "gateway" | "event" | "note">;
export type WfGroupNode = Node<GroupNodeData, "wfGroup">;

export type FollowsEdgeData = {
  edge: FlowEdge;
  route?: EdgeRoute;
  width: number;
  color: string;
  label?: string;
  reconnected: boolean;
  hovered: boolean;
  dimmed: boolean;
  focused: boolean;
  description: string;
  /** What the edge looks like (`FlowScene.edgeMarks`); resolved from the fields above without it. */
  mark?: EdgeMark;
  /** What the theme's rules for the edge's interactive states set (`stateStyle`). */
  state?: StateStyle;
};

export type WfEdge = Edge<FollowsEdgeData, "follows" | "constraint" | "flow">;

export interface ProcessMapProps {
  activityLabels?: ActivityLabelOptions;
  graph: FlowGraph;
  /** Positions from `layout` or `layoutUnion`; computed when omitted. */
  positions?: Positions;
  /** Enable manual activity placement in the SVG renderer. Default false. */
  nodesDraggable?: boolean;
  /** When supplied, the host applies this absolute position to its controlled positions. */
  onNodeMove?: (id: string, position: XY) => void;
  /** Change to clear internal manual positions and restore the supplied/automatic layout. */
  layoutResetKey?: string | number;
  /**
   * Overlays in addition to `graph.overlays`. The abstraction reads them with
   * the graph's: a protected one keeps its element shown, and a collapse moves
   * one to the stage that holds its element.
   */
  overlays?: Overlay[];
  /**
   * What the map shows: `frequency` (cases), `shortfall` (the share of cases
   * missing an expectation) or `performance` (the median lag), each a named
   * style (`measureStyles`); path width is cases in all three, and switching
   * builds the scene again without a layout. A `style` given too changes the
   * measure's entry by entry, `{ edgeColor: { bins: [0.05, 0.2] } }` the
   * shortfall's classes, say. Taken from the prop when given, kept by the map
   * otherwise. Default: `style`, else frequency as the default style draws it.
   */
  measure?: Measure;
  /**
   * Called when the measure is switched. Given, the expanded legend offers
   * the three measures to switch between.
   */
  onMeasureChange?: (measure: Measure) => void;
  /** Channels of the map's style; over the measure's named style where a `measure` is given. */
  style?: StyleSpec;
  /**
   * What the map is drawn in: a preset's name (`"default"`, `"print"`) or
   * changes over a preset (`{ preset: "default", radius: { node: 4 } }`; a whole
   * `Theme` is such changes too). It overrides the `--wf-*` CSS variables of the
   * map's element, set there or inherited, which override the preset
   * (`useFlowTheme`). Given, its colours, fonts and the sizes the stylesheet
   * reads are written on the map's element as those variables, over
   * `containerStyle`, so the panels follow it too, and set aside while the
   * map reads its element's. Default: the `default` preset under the map's
   * variables.
   */
  theme?: ThemeSetting;
  /**
   * What the map's texts are measured by: labels are shortened, activity names
   * wrapped and boxes sized by it, in the DOM and on the Canvas alike. Default
   * the browser's (`canvasTextMeasure` in the theme's font, created again once
   * the page's fonts have loaded), the estimate (`estimateTextWidth`) where
   * there is no 2D canvas. Pass the same measure to `toSVG` and `toPNG` for
   * the same lines in the exports, and keep one measure for the life of a map.
   */
  textMeasure?: TextMeasure;
  /** Controlled abstraction options. */
  abstraction?: AbstractOptions;
  defaultAbstraction?: AbstractOptions;
  onAbstractionChange?: (options: AbstractOptions) => void;
  /** Show the abstraction controls panel. Default true. */
  controls?: boolean;
  /** Show the legend panel. Default true. */
  legend?: boolean;
  minimap?: boolean;
  /** Draw a grid of dots behind the interactive map. Default false. */
  backgroundGrid?: boolean;
  /** `svg` renders on React Flow, `canvas` on the Canvas renderer; `auto` (default) picks canvas above `canvasThreshold` elements. */
  renderer?: "auto" | "svg" | "canvas";
  /** Elements (activities plus paths) above which `auto` uses the canvas. Default 2000. */
  canvasThreshold?: number;
  /**
   * Activities plus groups above which the Canvas map lists for assistive
   * technology only the element at the keyboard position and its neighbours
   * (predecessors, successors, group), and the table view shows its rows in
   * pages with a search field. Default 500; a limit below one is one.
   */
  describedLimit?: number;
  /**
   * How many of the edges in view the map draws (`budgetEdges`): protected
   * edges (with an overlay mark on them, selected, at the keyboard
   * position) first, then those on a highlighted path, then the others, each
   * by weight and id. While edges are withheld the map says how many it shows
   * (and how many highlighted ones it does not); the table view lists every
   * edge. A number or `"all"` is fixed. `"adaptive"` (the default)
   * starts at 2,000 and, on the Canvas map, moves through the steps 500,
   * 1,000, 2,000, 4,000, … after several consecutive frames of a pan or zoom
   * gesture above 16.7 ms or below half of it, and only once the view is at
   * rest; the React Flow map keeps the first step.
   */
  edgeBudget?: EdgeBudget | "adaptive";
  /**
   * Called when the edges the map draws change: while the edge budget or a
   * small zoom withholds some, with the ids drawn and the total the note states;
   * undefined once every edge is drawn again. Pass the last value as
   * `edgeBudget` to `toSVG` or `toPNG` to export what the map shows.
   */
  onEdgesShown?: (shown: ShownEdges | undefined) => void;
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
  onHover?: (id: string | null) => void;
  lod?: Partial<LodRules>;
  locale?: Locale;
  layout?: LayoutOptions;
  /** Draw self-loop follows edges as self-loop overlays. Default true. */
  selfLoops?: boolean;
  /** Current view; the controls offer a toggle. Default `map`. */
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
  /** Label announced to assistive technology; defaults to a generated description. */
  ariaLabel?: string;
  className?: string;
  /** Inline style of the outer element (height is required by React Flow). */
  containerStyle?: React.CSSProperties;
  /** Open the view after layout (`opening`). Default true; false leaves the view where it is. */
  fitView?: boolean;
  /**
   * The view the map opens at when it is shown first or its graph is
   * replaced: `"readable"` (default) fits it where the whole map fits at a
   * zoom of 0.75 or more, and otherwise opens at 0.75 on the start of the
   * process, at the edge of the room the panels leave, with an overview of
   * the whole map in a corner no panel occupies; `"fit"` always fits it. Once
   * the person moved the view, a change of the controls keeps it; once they
   * pressed "fit", it fits the map again; a new `graph` opens it again.
   */
  opening?: "readable" | "fit";
  /**
   * The narrowest line, in screen pixels, of a path the map draws: below it a
   * path is not drawn, unless it is marked, selected, focused, highlighted or
   * keeps an activity on a way from a start to an end (`pathsAtZoom`),
   * decided when the view is at rest. Default `viewTokens.pathPx` (0.5); 0
   * draws every path at every zoom. The selection, the table view and the
   * exports of the whole figure are not affected.
   */
  minPathPx?: number;
  /**
   * Room kept clear along each side of the map when its view is fitted, in
   * screen pixels. By default the fitted map keeps clear of the panels over it
   * (the abstraction panel, the legend, the zoom control, notes and a host's
   * React Flow panels), so that none covers an activity.
   */
  fitInsets?: Partial<Insets>;
  /**
   * Activity or stage whose paths are shown (predecessors and successors bright,
   * the rest dimmed, side list), or two activity ids for the path between them.
   * `null` means controlled without focus; omit it for the uncontrolled form.
   */
  focus?: Focus | null;
  defaultFocus?: Focus;
  onFocusChange?: (focus: Focus | undefined) => void;
  /** Show the side list of paths while a focus is set. Default true. */
  pathList?: boolean;
  /** Paths of the focused activity from the API; defaults to `graph.paths`, else computed from the map. */
  paths?: FlowPaths;
  /** Filter clauses shown as chips above the map; the map never filters, it calls `onFilterChange`. */
  filters?: Filter | FilterClause[];
  filterPreview?: FilterPreview | Record<string, unknown>;
  onFilterChange?: (filter: Filter) => void;
  /** Stage groups as bands along the flow, lane groups as bands across it, or groups as boxes (`none`, default). */
  lanes?: LaneMode;
  /** Offer the actions menu (right click, Enter). Default true. */
  contextMenu?: boolean;
  /**
   * Called before the menu opens with the default actions; return actions to
   * replace them (with `run` handlers or not), `false` to suppress the menu,
   * nothing to keep the defaults.
   */
  onContextMenu?: (target: MenuTarget, actions: MenuAction[]) => MenuAction[] | false | void;
  /** Called when an action was chosen; a returned string is announced. */
  onAction?: (action: MenuAction, target: MenuTarget) => void | string;
  /** Text to announce through the map's live region (e.g. the result of a filter). */
  announce?: string;
  children?: React.ReactNode;
}
