/**
 * Named views of one map: the same graph and positions under several metric
 * and overlay sets (for example Finance, Logistics, Compliance, Automation),
 * with colour and width scales shared across the views so that they compare.
 */
import { type AbstractOptions, abstract } from "./aggregate.js";
import { type LayoutOptions, type Positions, filterPositions, layout } from "./layout.js";
import { type FlowGraph, type Metrics, type Overlay, metric } from "./model.js";
import { type ChannelSpec, type ColorSpec, type Scales, type StyleSpec, buildScales, defaultStyle } from "./style.js";

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

export interface BuildViewsOptions {
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

function extent(values: number[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/**
 * Resolve views on known positions: every view gets its graph (base metrics
 * merged with its own), its overlays and scales. With shared scales the domain
 * of a metric on a channel is the extent of that metric over all views, so the
 * same colour or width means the same number in every view.
 */
export function resolveViews(base: FlowGraph, views: ViewSpec[], positions: Positions, options: Pick<BuildViewsOptions, "shareScales"> = {}): ViewSet {
  const share = options.shareScales ?? true;
  const graphs = views.map((v) => withMetrics(base, v));
  const domains: Record<string, number[]> = {};
  const edgeValues = (name: string): number[] => graphs.flatMap((g) => g.edges.filter((e) => e.kind !== "constraint").map((e) => metric(e, name, NaN)));
  const nodeValues = (name: string): number[] => graphs.flatMap((g) => g.nodes.map((n) => metric(n, name, NaN)));
  const isShare = (name: string) => /share/i.test(name);

  const widthDomain = (spec: ChannelSpec): [number, number] => {
    if (spec.domain) return spec.domain;
    const key = `edgeWidth:${spec.metric}`;
    if (!domains[key]) {
      const ext = extent(edgeValues(spec.metric)) ?? [0, 1];
      domains[key] = ext[0] === ext[1] ? [0, ext[1] || 1] : ext;
    }
    return domains[key] as [number, number];
  };
  const colorDomain = (channel: "edgeColor" | "nodeColor", spec: ColorSpec): number[] | undefined => {
    if (!spec.metric) return undefined;
    if (spec.domain) return spec.domain;
    const key = `${channel}:${spec.metric}`;
    if (!domains[key]) {
      const values = channel === "edgeColor" ? edgeValues(spec.metric) : nodeValues(spec.metric);
      const palette = spec.palette ?? "sequential";
      if (palette === "diverging") {
        const ext = extent(values);
        const m = ext ? Math.max(Math.abs(ext[0]), Math.abs(ext[1])) || 1 : 1;
        domains[key] = [-m, 0, m];
      } else if (isShare(spec.metric)) {
        domains[key] = [0, 1];
      } else {
        domains[key] = extent(values) ?? [0, 1];
      }
    }
    return domains[key];
  };

  const resolved: ResolvedView[] = views.map((v, i) => {
    const spec = v.style ?? defaultStyle;
    const style: StyleSpec = share
      ? {
          ...spec,
          edgeWidth: spec.edgeWidth ? { ...spec.edgeWidth, domain: widthDomain(spec.edgeWidth) } : undefined,
          edgeColor: spec.edgeColor ? { ...spec.edgeColor, domain: colorDomain("edgeColor", spec.edgeColor) } : undefined,
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
  const base = options.abstraction ? abstract(graph, options.abstraction) : graph;
  const positions = options.positions ? filterPositions(options.positions, base) : await layout(base, options.layout);
  return resolveViews(base, views, positions, options);
}

/** True when every view of the set reads its positions from the same boxes (a check for tests and stories). */
export function viewsSharePositions(set: ViewSet): boolean {
  return set.views.every((v) => v.graph.nodes.every((n) => set.positions.nodes[n.id] !== undefined));
}
