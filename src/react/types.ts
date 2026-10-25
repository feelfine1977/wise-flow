import type { Node, Edge } from "@xyflow/react";
import type {
  OverlayGeometryOptions,
  FlowSceneOptions,
  Strings,
  AbstractOptions,
  ActivityLabelOptions,
  EdgeBudget,
  EdgeMark,
  EdgeRoute,
  ElementRef,
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
  PartInView,
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
import type { PanelCorner } from "./primitives.js";

export type { Selection };
export { emptySelection };

/** An element a host asks the map to bring into view (`ProcessMapProps.bringIntoView`): each new object, or a new `token`, asks again. */
export interface BringIntoView {
  element: ElementRef;
  token?: string | number;
}

/** What a view at rest shows (`ProcessMapProps.onInView`): the part of the map (`partInView`), its zoom and the smallest zoom. */
export interface InView extends PartInView {
  zoom: number;
  minZoom: number;
}

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
  /** The band's name follows the view while any part of the band is in it (`laneOptions.sticky`, 0.5). */
  sticky?: boolean;
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
  /** The path touches a selected activity: drawn lifted (`EdgeMark.lift`) and labelled (0.4). */
  touching?: boolean;
  /** Whether its label shows: by the root's zoom class (`rule`, default), or always or never by its width on the screen or the selection (0.4). */
  labelShown?: "rule" | "always" | "never";
  /** The label written where it differs from the mark's: with the share of the selected activity's cases (`emphasisLabel`). */
  labelText?: string;
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
  /**
   * How the stages are drawn on the one layout (0.5): `bands`, `lanes`,
   * `boxes` or `none` (`FlowSceneOptions.stageView`); switching never moves a
   * card. Lay the map out with `layout.stages: "partition"` so that bands and
   * boxes come from the same positions. `lanes` stays for role lanes.
   */
  stageView?: "bands" | "lanes" | "boxes" | "none";
  /** Where paths' labels sit (0.5): `midpoint` (default) or moved `clear` of cards, titles, labels and paths (`FlowSceneOptions.labelPlacement`). */
  labelPlacement?: "midpoint" | "clear";
  /**
   * How stage and role bands are laid out and headed (0.5): their padding,
   * header space and gap (`LaneOptions`), empty stages as dividers or narrow
   * lanes (`emptyLanes`), "5 of 15 activities" in the header (`counts`) and
   * the stage's name kept in view while any part of its band is (`sticky`;
   * exports print it once at the band's start).
   */
  laneOptions?: FlowSceneOptions["laneOptions"];
  /** The corner the legend sits in (0.4). Default `bottom-right`. The key of full activity names takes the other side. */
  legendPosition?: PanelCorner;
  /** The corner the detail panel sits in (0.4). Default `top-left`. */
  controlsPosition?: PanelCorner;
  /** The corner the map's overview opens in (0.4). Default: a corner no panel takes, `top-right` with `minimap: "overflow"`. */
  overviewCorner?: PanelCorner;
  /**
   * An overview of the map: `"overflow"` (0.4) shows the library's overview
   * of card outlines with the part in view whenever part of the map is out of
   * view at rest, and never React Flow's minimap; `true` shows React Flow's
   * minimap (kept for compatibility); default false: only while the map
   * opens on its start.
   */
  minimap?: boolean | "overflow";
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
   * How many edges of the whole map are let through after the zoom rule:
   * marked, selected, focused and highlighted paths and the paths connecting
   * each activity from start to end always stay, even beyond the budget;
   * the others follow by weight and id. Canvas culling then draws those in
   * view. While edges are withheld the map says how many it lets through;
   * the table view lists every edge. A number or `"all"` is fixed. `"adaptive"` (the default)
   * starts at 2,000 and, on the Canvas map, moves through the steps 500,
   * 1,000, 2,000, 4,000, … after several consecutive frames of a zoom
   * gesture above 16.7 ms or below half of it, decreasing only when zooming
   * out and increasing only when zooming in, once the view is at
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
  /**
   * The host's wording of some strings over the library's EN and DE table
   * (`Strings`): the legend's sentence ("Frequency · {unit}",
   * `legend.measure`; `legend.shareOf`; `measure.sentence.*`), the detail
   * panel (`controls.*`, `detail.*`), Start and End (`terminal.*`) and the
   * descriptions of terminal paths. Compared by value: an object written in
   * place does not rebuild the scene.
   */
  strings?: Strings;
  /**
   * Hide React Flow's attribution in the corner of the interactive map.
   * Default false: the credit is visible; a host that credits React Flow
   * elsewhere (an About view) may hide it here.
   */
  hideAttribution?: boolean;
  /**
   * Where the overlay marks are placed (`OverlayGeometryOptions`): with
   * `{ selfLoop: "pill", badgeAnchor: "border" }` a self-loop is one pill on
   * the card's top-right border (0.4). Compared by value.
   */
  overlayGeometry?: OverlayGeometryOptions;
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
  fitInsets?: Partial<Insets> & {
    /**
     * `add` (0.4, the default): the insets are room the host keeps beside the
     * panels (a drawer over the map's right side), and the fit keeps clear of
     * both; `replace`: they are the only room kept, as up to 0.3.
     */
    mode?: "add" | "replace";
  };
  /**
   * The smallest zoom of the map, which no fit, opening, wheel or button goes
   * below: a number (default 0.05), or `{ readable: level }`, the smallest zoom
   * at which every card still shows that level of its texts at the theme's
   * smallest screen text (`readableZoom`): `"line"` its name on one line,
   * `"name"` its name on two, `"full"` its name and its number line. A fit
   * that cannot show the whole map at the smallest zoom shows the map from
   * the start of the process at that zoom, with the overview.
   */
  minZoom?: number | { readable: "full" | "name" | "line" };
  /** The largest zoom. Default 3. */
  maxZoom?: number;
  /**
   * Opens the map again by `opening` when it changes, as a replaced `graph`
   * object does; given, a replaced graph alone opens it no more, so that a
   * host that builds a new graph for each detail keeps the view.
   */
  openKey?: string | number;
  /**
   * An element to bring into view: the view moves, at its zoom but at least
   * `minZoom`, so that the element is at the centre (`elementPoint`), once
   * the layout holds the element and the map has opened; a node or an edge
   * takes the keyboard position. Each new object, or a new `token`, moves
   * again.
   */
  bringIntoView?: BringIntoView;
  /** Called when the view comes to rest and shows another part of the map (`partInView`), with its zoom and the smallest zoom. */
  onInView?: (shown: InView) => void;
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
