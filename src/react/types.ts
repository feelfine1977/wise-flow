import type { Node, Edge } from "@xyflow/react";
import type {
  AbstractOptions,
  ActivityLabelOptions,
  EdgeBudget,
  EdgeMark,
  EdgeRoute,
  Filter,
  FilterClause,
  FilterPreview,
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowNode,
  FlowPaths,
  Focus,
  LaneBand,
  LaneMode,
  LayoutDirection,
  LayoutOptions,
  Locale,
  LodRules,
  MenuAction,
  MenuTarget,
  NodeMark,
  Overlay,
  OverlayMark,
  PatternId,
  Positions,
  XY,
  Selection,
  StyleSpec,
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
  /** @deprecated The map draws badges from `marks`; still filled for custom node types. */
  badges: Overlay[];
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
  /** @deprecated The map draws chips from `marks`; still filled for custom node types. */
  chips: Overlay[];
  description: string;
  /** The group is drawn as a lane band (see `lanes`). */
  band?: LaneBand;
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
  /** Overlays in addition to `graph.overlays`. */
  overlays?: Overlay[];
  style?: StyleSpec;
  /** Controlled abstraction options. */
  abstraction?: AbstractOptions;
  defaultAbstraction?: AbstractOptions;
  onAbstractionChange?: (options: AbstractOptions) => void;
  /** Show the abstraction controls panel. Default true. */
  controls?: boolean;
  /** Show the legend panel. Default true. */
  legend?: boolean;
  minimap?: boolean;
  /** `svg` renders on React Flow, `canvas` on the Canvas renderer; `auto` (default) picks canvas above `canvasThreshold` elements. */
  renderer?: "auto" | "svg" | "canvas";
  /** Elements (activities plus paths) above which `auto` uses the canvas. Default 2000. */
  canvasThreshold?: number;
  /**
   * Activities plus groups above which the Canvas map lists for assistive
   * technology only the element at the keyboard position and its neighbours
   * (predecessors, successors, group), and the table view shows its rows in
   * pages with a search field. Default 500.
   */
  describedLimit?: number;
  /**
   * How many of the edges in view the map draws (`budgetEdges`): protected
   * edges (with an overlay mark on them, selected, at the keyboard
   * position or on a highlighted path) first, then by weight and id. While
   * edges are withheld the map says how many it shows; the table view lists
   * every edge. A number or `"all"` is fixed. `"adaptive"` (the default)
   * starts at 2,000 and, on the Canvas map, moves through the steps 500,
   * 1,000, 2,000, 4,000, … after several consecutive frames of a pan or zoom
   * gesture above 16.7 ms or below half of it, and only once the view is at
   * rest; the React Flow map keeps the first step.
   */
  edgeBudget?: EdgeBudget | "adaptive";
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
  /** Fit the view after layout. Default true. */
  fitView?: boolean;
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
