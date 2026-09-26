import type { FlowGraph } from "./model.js";

/** Original activity ids represented by a collapsed stage, including nested collapses. */
export function collapsedActivityIds(graph: FlowGraph, id: string): string[] | undefined {
  const mapping = graph.meta?.collapsedMembers;
  if (!mapping || typeof mapping !== "object" || !Object.hasOwn(mapping, id)) return undefined;
  const ids = (mapping as Record<string, unknown>)[id];
  return Array.isArray(ids) && ids.every((value) => typeof value === "string") ? ids : undefined;
}

