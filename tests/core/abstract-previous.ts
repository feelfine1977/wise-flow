import type { Thresholded } from "../../src/core/aggregate";
import { byId, isStructuralNode } from "../../src/core/model";
import { type FlowEdge, type FlowNode, RECONNECTED_TAG, components, indexGraph } from "../../src/index";

/**
 * The reconnection's first step before it became one growing search, kept as the
 * oracle the recorded cases are measured against: the growing search must join
 * the same components there at the same total cost. Equally cheap paths were
 * taken in the order the search met them, which followed the input order.
 */

/** What a re-added edge costs a reconnecting path: 1, plus 1 for an edge of strength 0. */
export const joinCost = (e: FlowEdge, edgeStrength: Map<string, number>) => 1 + (1 - (edgeStrength.get(e.id) ?? 1));

/** The total cost of the edges a first step re-added, summed in id order. */
export function addedCost(kept: Thresholded, joined: { edges: FlowEdge[] }): number {
  const keptIds = new Set(kept.edges.map((e) => e.id));
  return joined.edges
    .filter((e) => !keptIds.has(e.id))
    .sort(byId)
    .reduce((sum, e) => sum + joinCost(e, kept.edgeStrength), 0);
}

const tagged = <T extends FlowNode | FlowEdge>(el: T): T => ({ ...el, tags: [...new Set([...(el.tags ?? []), RECONNECTED_TAG])] });

function undirectedAdjacency(edges: FlowEdge[], nodeIds: Set<string>) {
  const neighbours = new Map<string, { edge: FlowEdge; other: string }[]>();
  for (const id of nodeIds) neighbours.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    neighbours.get(e.source)!.push({ edge: e, other: e.target });
    neighbours.get(e.target)!.push({ edge: e, other: e.source });
  }
  return { neighbours };
}

/** Entries leave by key, then by `tie`, then in the order they were pushed. */
class MinHeap<T> {
  private items: { key: number; tie: string; order: number; value: T }[] = [];
  private counter = 0;
  push(key: number, value: T, tie = "") {
    const a = this.items;
    a.push({ key, tie, order: this.counter++, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): { value: T } | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
  private less(a: { key: number; tie: string; order: number }, b: { key: number; tie: string; order: number }) {
    return a.key < b.key || (a.key === b.key && (a.tie < b.tie || (a.tie === b.tie && a.order < b.order)));
  }
}

/**
 * Step 1 of the reconnection as released in 0.3.5: one search from the heaviest
 * component per join. With `ties: "id"` its searches take equally near nodes by
 * id and enter each node by the tight edge with the smallest id, the tie-break of
 * the one growing search that replaced it; otherwise ties fall as they did.
 */
export function previousJoinComponents(
  { base: original, nodes: keptNodes, edges: keptEdges, edgeStrength, nodeStrength }: Thresholded,
  { ties = "insertion" }: { ties?: "insertion" | "id" } = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const tie = (id: string) => (ties === "id" ? id : "");
  const originalIdx = indexGraph(original);
  const nodes = [...keptNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [...keptEdges];
  const edgeIds = new Set(edges.map((e) => e.id));
  const addEdge = (e: FlowEdge) => {
    if (edgeIds.has(e.id)) return;
    edgeIds.add(e.id);
    edges.push(tagged(e));
  };
  const addNode = (id: string) => {
    if (nodeIds.has(id)) return;
    const n = originalIdx.nodes.get(id);
    if (!n) return;
    nodeIds.add(id);
    nodes.push(tagged(n));
  };
  const allIds = new Set(original.nodes.map((n) => n.id));
  const adj = undirectedAdjacency(original.edges, allIds);
  const cost = (e: FlowEdge) => joinCost(e, edgeStrength);
  // Costs do not change during a reconnection, so each node's neighbours are sorted once.
  const sortedNeighbours = new Map<string, { edge: FlowEdge; other: string }[]>();
  const neighboursByCost = (id: string) => {
    let ns = sortedNeighbours.get(id);
    if (!ns) {
      ns = [...(adj.neighbours.get(id) ?? [])].sort((a, b) => cost(a.edge) - cost(b.edge) || byId(a.edge, b.edge));
      sortedNeighbours.set(id, ns);
    }
    return ns;
  };

  // 1a. Maximum spanning forest over the original edges between present nodes:
  //     the strongest direct edges that join two components are re-added first.
  const joinDirect = (): number => {
    let comp = components(nodeIds, edges);
    let count = new Set(comp.values()).size;
    if (count <= 1) return count;
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const [id, c] of comp) parent.set(id, `#${c}`);
    const direct = original.edges
      .filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target) && !edgeIds.has(e.id))
      .sort((a, b) => cost(a) - cost(b) || byId(a, b));
    for (const e of direct) {
      const ra = find(e.source);
      const rb = find(e.target);
      if (ra === rb) continue;
      parent.set(ra, rb);
      addEdge(e);
      count--;
      if (count <= 1) break;
    }
    comp = components(nodeIds, edges);
    return new Set(comp.values()).size;
  };

  // 1b. Remaining components are reached through the cheapest path of the original
  //     graph (re-adding the removed nodes on it), starting from the heaviest component.
  for (let guard = 0; guard < original.nodes.length; guard++) {
    if (joinDirect() <= 1) break;
    const comp = components(nodeIds, edges);
    const weight = new Map<number, number>();
    for (const n of nodes) {
      const c = comp.get(n.id) ?? 0;
      weight.set(c, (weight.get(c) ?? 0) + (isStructuralNode(n) ? 0 : (nodeStrength.get(n.id) ?? 1)));
    }
    let mainComp = 0;
    let best = -1;
    for (const [c, w] of [...weight.entries()].sort((a, b) => a[0] - b[0])) {
      if (w > best) {
        best = w;
        mainComp = c;
      }
    }
    const dist = new Map<string, number>();
    const prev = new Map<string, { edge: FlowEdge; from: string }>();
    const heap = new MinHeap<string>();
    for (const [id, c] of comp) {
      if (c === mainComp) {
        dist.set(id, 0);
        heap.push(0, id, tie(id));
      }
    }
    let hit: string | undefined;
    while (heap.size) {
      const { value: cur } = heap.pop()!;
      const d = dist.get(cur)!;
      const c = comp.get(cur);
      if (c !== undefined && c !== mainComp) {
        hit = cur;
        break;
      }
      for (const { edge, other } of neighboursByCost(cur)) {
        const nd = d + cost(edge);
        const od = dist.get(other);
        if (od === undefined || nd < od) {
          dist.set(other, nd);
          prev.set(other, { edge, from: cur });
          heap.push(nd, other, tie(other));
        } else if (ties === "id" && nd === od && od > 0 && edge.id < prev.get(other)!.edge.id) prev.set(other, { edge, from: cur });
      }
    }
    if (!hit) break; // the original graph is disconnected itself
    let cur = hit;
    while (prev.has(cur)) {
      const { edge, from } = prev.get(cur)!;
      addNode(cur);
      addNode(from);
      addEdge(edge);
      cur = from;
    }
  }
  return { nodes, edges };
}
