import type { Box, Positions, XY } from "./layout.js";
import type { FlowGraph } from "./model.js";

/** Whether the segment from `a` to `b` passes through the inside of `box` shrunk by `inset` (Liang–Barsky). */
function crossesInside(a: XY, b: XY, box: Box, inset: number): boolean {
  const [x0, y0, x1, y1] = [box.x + inset, box.y + inset, box.x + box.width - inset, box.y + box.height - inset];
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let lo = 0, hi = 1;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as const) {
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) lo = Math.max(lo, r);
      else hi = Math.min(hi, r);
      if (lo >= hi) return false;
    }
  }
  return true;
}

/**
 * The routes of `positions` that cross a card other than their own ends
 * (0.6): each as "edge id behind node id", in the graph's edge order, the
 * cards' insides taken 2 px in from their borders. Empty when every route
 * stays clear of the cards it does not join. A self-loop and an edge without a
 * route are not checked.
 */
export function routeFaults(graph: FlowGraph, positions: Positions): string[] {
  const faults: string[] = [];
  const boxes = Object.entries(positions.nodes);
  for (const e of graph.edges) {
    const route = positions.edges[e.id];
    if (!route || e.source === e.target) continue;
    const pts = route.points;
    for (const [id, box] of boxes) {
      if (id === e.source || id === e.target) continue;
      if (pts.slice(1).some((p, i) => crossesInside(pts[i], p, box, 2))) {
        faults.push(`${e.id} behind ${id}`);
        break;
      }
    }
  }
  return faults;
}
