/** The inputs of a layout as one string; internal to the package. */
import type { ELK } from "elkjs/lib/elk-api.js";
import type { FlowGraph } from "./model.js";
import { type LayoutOptions, type NodeSize, defaultNodeSize } from "./layout.js";

const engineIds = new WeakMap<ELK, number>();
let engines = 0;

/** Each node's box as the layout will use it; size callbacks run once per node. */
export function resolvedSizes(graph: FlowGraph, { nodeSize }: LayoutOptions): Map<string, NodeSize> {
  return new Map(graph.nodes.map((n) => [n.id, typeof nodeSize === "function" ? nodeSize(n) : nodeSize ?? defaultNodeSize(n)]));
}

/**
 * What the engines read: nodes with their resolved sizes (callbacks count by what
 * they return), edges, groups and every option but the signal, an ELK instance by identity.
 */
export function layoutInputKey(graph: FlowGraph, options: LayoutOptions, sizes = resolvedSizes(graph, options)): string {
  const { elk, elkWorkerUrl } = options;
  if (elk && !engineIds.has(elk)) engineIds.set(elk, ++engines);
  return JSON.stringify([
    graph.nodes.map((n) => [n.id, n.label, n.group, sizes.get(n.id)]),
    graph.edges.map((e) => [e.id, e.source, e.target]),
    graph.groups?.map((g) => [g.id, g.kind, g.label, g.parent]),
    { ...options, nodeSize: 0, cacheKey: 0, signal: undefined, elk: elk && engineIds.get(elk), elkWorkerUrl: elkWorkerUrl && String(elkWorkerUrl) },
  ]);
}
