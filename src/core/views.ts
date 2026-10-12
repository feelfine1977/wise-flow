/** Named views of one map: metric and overlay sets on the same graph and positions, with shared scales. */
import { type AbstractOptions, abstract, collapseGroups } from "./aggregate.js";
import { type LayoutOptions, type Positions, filterPositions, layout } from "./layout.js";
import { type FlowGraph, type Metrics, type Overlay, metric } from "./model.js";
import { type ChannelSpec, type ColorSpec, type Scales, type StyleSpec, buildScales, defaultStyle, extentOf, isShareMetric, pathMetricOf, pathScaleMax, symmetricDomain } from "./style.js";

/** What one view encodes. Metrics are merged over the base graph's metrics by id. */
export interface ViewSpec {
  id: string;
  label: string;
  description?: string;
  /** Channels of the view; defaults to `defaultStyle`. Domains are filled in and shared. */
  style?: StyleSpec;
  overlays?: Overlay[];
  /** Metrics of this view per node id and per edge id, merged over the base graph. */
  nodeMetrics?: Record<string, Metrics>;
  edgeMetrics?: Record<string, Metrics>;
  /** A whole graph on the same ids; wins over the metric records. */
  graph?: FlowGraph;
}

export interface ResolvedView {
  id: string;
  label: string;
  description?: string;
  graph: FlowGraph;
  overlays: Overlay[];
  /** The view's style with the shared domains filled in. */
  style: StyleSpec;
  scales: Scales;
}

export interface ViewSet {
  base: FlowGraph;
  positions: Positions;
  views: ResolvedView[];
  /** Domains per channel and metric, as shared by the views. */
  domains: Record<string, number[]>;
}

interface BuildViewsOptions {
  /** Positions for the base graph; computed when omitted. */
  positions?: Positions;
  layout?: LayoutOptions;
  /** Abstraction applied to the base graph before the views are derived. */
  abstraction?: AbstractOptions;
  /** Share the scale domains across views (default true); `false` scales every view on its own. */
  shareScales?: boolean;
}

function withMetrics(base: FlowGraph, view: ViewSpec): FlowGraph {
  if (view.graph) {
    const nodeIds = new Set(base.nodes.map((n) => n.id));
    const edgeIds = new Set(base.edges.map((e) => e.id));
    return {
      ...base,
      nodes: base.nodes.map((n) => view.graph!.nodes.find((m) => m.id === n.id) ?? n).filter((n) => nodeIds.has(n.id)),
      edges: base.edges.map((e) => view.graph!.edges.find((f) => f.id === e.id) ?? e).filter((e) => edgeIds.has(e.id)),
    };
  }
  if (!view.nodeMetrics && !view.edgeMetrics) return base;
  return {
    ...base,
    nodes: base.nodes.map((n) => (view.nodeMetrics?.[n.id] ? { ...n, metrics: { ...(n.metrics ?? {}), ...view.nodeMetrics[n.id] } } : n)),
    edges: base.edges.map((e) => (view.edgeMetrics?.[e.id] ? { ...e, metrics: { ...(e.metrics ?? {}), ...view.edgeMetrics[e.id] } } : e)),
  };
}

/**
 * Resolve views on known positions: every view gets its graph (base metrics
 * merged with its own), its overlays and scales. With shared scales the domain
 * of a metric on a colour channel is the extent of that metric over all views,
 * and every view's width scale runs from 0 to the strongest path of any view
 * before abstraction, or of a view's own metrics where they give more
 * (`ChannelSpec.max`), so the same colour or width means the same number in
 * every view.
 */
export function resolveViews(base: FlowGraph, views: ViewSpec[], positions: Positions, options: Pick<BuildViewsOptions, "shareScales"> = {}): ViewSet {
  const share = options.shareScales ?? true;
  const graphs = views.map((v) => withMetrics(base, v));
  const domains: Record<string, number[]> = {};
  const edgeValues = (name: string): number[] => graphs.flatMap((g) => g.edges.filter((e) => e.kind !== "constraint").map((e) => metric(e, name, NaN)));
  const nodeValues = (name: string): number[] => graphs.flatMap((g) => g.nodes.map((n) => metric(n, name, NaN)));

  // Paths count cases, or transitions where no view gives cases for them (as `buildScales` decides for one graph), for their width and colour alike.
  const pathMetric = pathMetricOf(graphs.flatMap((g) => g.edges));
  // The width scales of all views run from 0 to one upper end: the strongest path of any of them before abstraction,
  // or a view's own strongest path where its metrics give more (the base recorded its upper end before they were merged).
  const widthMax = (spec: ChannelSpec): number => {
    if (spec.max !== undefined) return spec.max;
    const key = `edgeWidth:${spec.metric}`;
    if (!domains[key]) domains[key] = [0, graphs.reduce((m, g) => Math.max(m, pathScaleMax(g, spec.metric) ?? 0), extentOf(edgeValues(spec.metric))?.[1] ?? 0) || 1];
    return domains[key][1];
  };
  const colorDomain = (channel: "edgeColor" | "nodeColor", spec: ColorSpec): number[] | undefined => {
    if (!spec.metric) return undefined;
    if (spec.domain) return spec.domain;
    const key = `${channel}:${spec.metric}`;
    if (!domains[key]) {
      const values = channel === "edgeColor" ? edgeValues(spec.metric) : nodeValues(spec.metric);
      const palette = spec.palette ?? "sequential";
      if (palette === "diverging") {
        domains[key] = symmetricDomain(values);
      } else if (isShareMetric(spec.metric)) {
        domains[key] = [0, 1];
      } else {
        domains[key] = extentOf(values) ?? [0, 1];
      }
    }
    return domains[key];
  };

  const resolved: ResolvedView[] = views.map((v, i) => {
    const spec = v.style ?? defaultStyle;
    const edgeColor = spec.edgeColor && { ...spec.edgeColor, ...(spec.edgeColor.metric && { metric: pathMetric(spec.edgeColor.metric) }) };
    const style: StyleSpec = share
      ? {
          ...spec,
          edgeWidth: spec.edgeWidth ? { ...spec.edgeWidth, metric: pathMetric(spec.edgeWidth.metric), ...(!spec.edgeWidth.domain && { max: widthMax({ ...spec.edgeWidth, metric: pathMetric(spec.edgeWidth.metric) }) }) } : undefined,
          edgeColor: edgeColor ? { ...edgeColor, domain: colorDomain("edgeColor", edgeColor) } : undefined,
          nodeColor: spec.nodeColor ? { ...spec.nodeColor, domain: colorDomain("nodeColor", spec.nodeColor) } : undefined,
        }
      : spec;
    return { id: v.id, label: v.label, description: v.description, graph: graphs[i], overlays: v.overlays ?? [], style, scales: buildScales(graphs[i], style) };
  });
  return { base, positions, views: resolved, domains };
}

/**
 * Lay out the base graph once (or take the given positions) and resolve the
 * views on it, so that every view renders the same map at the same positions.
 */
export async function buildViews(graph: FlowGraph, views: ViewSpec[], options: BuildViewsOptions = {}): Promise<ViewSet> {
  // The abstraction sees the marks every view draws, so that a protected one keeps its element.
  const drawn = views.flatMap((v) => v.overlays ?? []);
  const marks = [...(options.abstraction?.marks ?? []), ...drawn];
  const base = options.abstraction ? abstract(graph, marks.length ? { ...options.abstraction, marks } : options.abstraction) : graph;
  const positions = options.positions ? filterPositions(options.positions, base) : await layout(base, options.layout);
  // With stages collapsed, the views' marks move to the stage that holds their element, as the graph's own do.
  const collapse = options.abstraction?.collapse;
  if (!collapse || !drawn.length) return resolveViews(base, views, positions, options);
  const moved = collapseGroups({ ...graph, overlays: drawn }, collapse).overlays ?? drawn;
  let at = 0;
  return resolveViews(base, views.map((v) => (v.overlays ? { ...v, overlays: moved.slice(at, (at += v.overlays.length)) } : v)), positions, options);
}

/** True when every view of the set reads its positions from the same boxes (a check for tests and stories). */
export function viewsSharePositions(set: ViewSet): boolean {
  return set.views.every((v) => v.graph.nodes.every((n) => set.positions.nodes[n.id] !== undefined));
}
