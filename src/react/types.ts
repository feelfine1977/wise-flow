import type { Node, Edge } from "@xyflow/react";
import type {
  AbstractOptions,
  EdgeRoute,
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowNode,
  LayoutDirection,
  LayoutOptions,
  Locale,
  LodRules,
  Overlay,
  PatternId,
  Positions,
  StyleSpec,
} from "../core/index";

/** Selected element ids of a map. */
export interface Selection {
  nodes: string[];
  edges: string[];
  groups: string[];
}

export const emptySelection: Selection = { nodes: [], edges: [], groups: [] };

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
  /** `svg` renders on React Flow; `canvas` is reserved for a later milestone and falls back to `svg`. */
  renderer?: "auto" | "svg" | "canvas";
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
  children?: React.ReactNode;
}
