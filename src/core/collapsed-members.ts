import type { FlowGraph } from "./model.js";

/** Original activity ids represented by a collapsed stage, including nested collapses. */
export function collapsedActivityIds(graph: FlowGraph, id: string): string[] | undefined {
  const mapping = graph.meta?.collapsedMembers;
  if (!mapping || typeof mapping !== "object" || !Object.hasOwn(mapping, id)) return undefined;
  const ids = (mapping as Record<string, unknown>)[id];
  return Array.isArray(ids) && ids.every((value) => typeof value === "string") ? ids : undefined;
}


/** The activities a graph shows, a collapsed stage's members included, and whether it has a collapsed stage. */
export function shownActivityIds(graph: FlowGraph): { ids: Set<string>; collapsed: boolean } {
  const ids = new Set<string>();
  let collapsed = false;
  for (const n of graph.nodes) {
    const members = n.kind === "stage" ? collapsedActivityIds(graph, n.id) : undefined;
    if (members) collapsed = true;
    for (const id of members ?? (n.kind === "activity" ? [n.id] : [])) ids.add(id);
  }
  return { ids, collapsed };
}
