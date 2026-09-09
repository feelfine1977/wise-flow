import type { Node, Edge } from "@xyflow/react";
import type {
  AbstractOptions,
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
  Overlay,
  PatternId,
  Positions,
  Selection,
  StyleSpec,
} from "../core/index.js";
import { emptySelection } from "../core/index.js";

export type { Selection };
export { emptySelection };

export type ActivityNodeData = {
  node: FlowNode;
  color: string;
  pattern: PatternId;
  badges: Overlay[];
  hatched: boolean;
  direction: LayoutDirection;
  focused: boolean;
  hovered: boolean;
  dimmed: boolean;
  locale: Locale;
  meta?: string;
  description: string;
};

export type GroupNodeData = {
  group: FlowGroup;
  color: string;
  tint?: string;
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
};

export type WfEdge = Edge<FollowsEdgeData, "follows" | "constraint" | "flow">;

export interface ProcessMapProps {
  graph: FlowGraph;
  /** Positions from `layout` or `layoutUnion`; computed when omitted. */
  positions?: Positions;
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
