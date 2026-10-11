/**
 * What a map shows while the layout engine runs: a provisional layered
 * arrangement computed on the calling thread, or the earlier positions of the
 * nodes that are still present.
 */
import type { FlowGraph } from "./model.js";
import { type Box, type EdgeRoute, type LayoutOptions, type Positions, GROUP_PADDING, createPositions, gap as spacing, sizeOf, straightRoute, unionBoxes } from "./layout.js";

/** Counts the elementary steps of `provisionalLayout`. */
export interface ProvisionalWork {
  steps: number;
}

/**
 * A provisional arrangement: each group (and the map) places its members and
 * subgroups in ranks of the longest path along the flow direction, orders each
 * rank by one barycentre pass over the previous ranks and draws straight edges.
 * Top-level stages follow each other in their order when `orderStages` is on.
 * A group is one box in its parent's rank, so its members stay together.
 * Deterministic for the same input; the steps are linear in nodes plus edges
 * (times the depth of group nesting).
 */
export function provisionalLayout(graph: FlowGraph, o: LayoutOptions = {}, work: ProvisionalWork = { steps: 0 }): Positions {
  const direction = o.direction ?? "RIGHT";
  const flowX = direction === "RIGHT" || direction === "LEFT";
  const gap = spacing(o.spacing?.node, 28);
  const layerGap = spacing(o.spacing?.layer, 64);
  const { nodes } = graph;
  const groups = (o.groups ?? "compound") === "compound" ? graph.groups ?? [] : [];
  const N = nodes.length;
  const M = N + groups.length;
  // Items are the nodes, then the groups; item M is the map. Each item's parent is its group or the map.
  const item = new Map(groups.map((g, i) => [g.id, N + i]));
  const parent = new Int32Array(M + 1);
  const kids: number[][] = Array.from({ length: M + 1 }, () => []);
  for (let i = 0; i < M; i++) kids[(parent[i] = item.get((i < N ? nodes[i].group : groups[i - N].parent)!) ?? M)].push(i);
  // Containers outermost first; a group whose parents lead back to it sits on the map.
  const depth = new Int32Array(M + 1);
  const order: number[] = [];
  const visit = (c: number) => {
    for (let k = order.push(c) - 1; k < order.length; k++) {
      for (const i of kids[order[k]]) {
        work.steps++;
        if (i >= N && depth[i]) continue;
        depth[i] = depth[order[k]] + 1;
        if (i >= N) order.push(i);
      }
    }
  };
  visit(M);
  for (let g = N; g < M; g++) {
    if (depth[g]) continue;
    parent[g] = M;
    depth[g] = 1;
    visit(g);
  }
  // Groups without nodes are left out.
  const live = new Uint8Array(M + 1);
  live[M] = 1;
  for (let i = 0; i < N; i++) {
    for (let j = i; !live[j]; j = parent[j]) {
      work.steps++;
      live[j] = 1;
    }
  }

  // Edges between the two items under the edges' innermost common group; top-level stages in their order.
  const out: number[][] = Array.from({ length: M }, () => []);
  const into: number[][] = Array.from({ length: M }, () => []);
  const link = (s: number, t: number) => {
    out[s].push(t);
    into[t].push(s);
  };
  const stage = new Int32Array(M).fill(-1);
  if (o.orderStages ?? true) {
    let previous = -1;
    for (let i = N; i < M; i++) {
      if (!live[i] || parent[i] < M || groups[i - N].kind !== "stage" || groups[i - N].parent) continue;
      if (previous >= 0) link(previous, i);
      previous = stage[i] = i;
    }
  }
  const nodeItem = new Map(nodes.map((n, i) => [n.id, i]));
  for (const e of graph.edges) {
    let s = nodeItem.get(e.source) ?? -1;
    let t = nodeItem.get(e.target) ?? -1;
    if (s < 0 || t < 0 || s === t) continue;
    for (; depth[s] > depth[t]; work.steps++) s = parent[s];
    for (; depth[t] > depth[s]; work.steps++) t = parent[t];
    for (; parent[s] !== parent[t]; work.steps++) {
      s = parent[s];
      t = parent[t];
    }
    if (stage[t] < 0 || stage[s] < stage[t]) link(s, t);
  }

  // Longest-path ranks; when only cycles are left, the first waiting item in input order goes next.
  const rank = new Int32Array(M);
  const waiting = into.map((preds) => preds.length);
  const queued = new Uint8Array(M);
  const queue: number[] = [];
  const enqueue = (i: number) => {
    queued[i] = 1;
    queue.push(i);
  };
  for (let i = 0; i < M; i++) {
    if (!live[i]) queued[i] = 1;
    else if (!waiting[i]) enqueue(i);
  }
  for (let head = 0, next = 0; ; head++) {
    if (head === queue.length) {
      for (; next < M && queued[next]; work.steps++) next++;
      if (next === M) break;
      enqueue(next);
    }
    const u = queue[head];
    for (const v of out[u]) {
      work.steps++;
      if (queued[v]) continue;
      if (rank[u] >= rank[v]) rank[v] = rank[u] + 1;
      if (!--waiting[v]) enqueue(v);
    }
  }

  // The ranks of each container, ordered by one barycentre pass: an item moves to the mean
  // of its predecessors' relative places in earlier ranks.
  const layers: number[][][] = kids.map(() => []);
  for (let i = 0; i < M; i++) if (live[i]) (layers[parent[i]][rank[i]] ??= []).push(i);
  const place = new Float64Array(M);
  for (const c of order) {
    for (const layer of layers[c]) {
      if (!layer) continue;
      const n = layer.length;
      const buckets: number[][] = Array.from({ length: n }, () => []);
      layer.forEach((i, j) => {
        let sum = 0;
        let preds = 0;
        for (const u of into[i]) {
          work.steps++;
          if (rank[u] >= rank[i]) continue;
          sum += place[u];
          preds++;
        }
        buckets[Math.min(n - 1, Math.floor((preds ? sum / preds : (j + 0.5) / n) * n))].push(i);
      });
      buckets.flat().forEach((i, j) => {
        work.steps++;
        layer[j] = i;
        place[i] = (j + 0.5) / n;
      });
    }
  }

  // Sizes and places inside each container, the innermost groups first, then offsets from the outermost.
  const x = new Float64Array(M);
  const y = new Float64Array(M);
  const w = new Float64Array(M);
  const h = new Float64Array(M);
  for (let i = 0; i < N; i++) ({ width: w[i], height: h[i] } = sizeOf(nodes[i], o));
  for (const c of [...order].reverse()) {
    const ranks = layers[c].filter(Boolean);
    let length = -layerGap;
    let breadth = 0;
    const columns = ranks.map((layer) => {
      let along = 0;
      let across = -gap;
      for (const i of layer) {
        along = Math.max(along, flowX ? w[i] : h[i]);
        across += (flowX ? h[i] : w[i]) + gap;
      }
      const at = (length += layerGap);
      length += along;
      breadth = Math.max(breadth, across);
      return { at, along, across };
    });
    ranks.forEach((layer, r) => {
      const { at, along, across } = columns[r];
      let offset = (breadth - across) / 2;
      for (const i of layer) {
        work.steps++;
        const [size, cross] = flowX ? [w[i], h[i]] : [h[i], w[i]];
        let a = at + (along - size) / 2;
        if (direction === "LEFT" || direction === "UP") a = length - a - size;
        x[i] = flowX ? a : offset;
        y[i] = flowX ? offset : a;
        offset += cross + gap;
      }
    });
    if (c < M) {
      w[c] = (flowX ? length : breadth) + GROUP_PADDING.left + GROUP_PADDING.right;
      h[c] = (flowX ? breadth : length) + GROUP_PADDING.top + GROUP_PADDING.bottom;
    }
  }
  const boxes: Record<string, Box> = {};
  const groupBoxes: Record<string, Box> = {};
  for (const c of order) {
    for (const i of layers[c].flat()) {
      if (c < M) {
        x[i] += x[c] + GROUP_PADDING.left;
        y[i] += y[c] + GROUP_PADDING.top;
      }
      const box = { x: x[i], y: y[i], width: w[i], height: h[i] };
      if (i < N) boxes[nodes[i].id] = box;
      else groupBoxes[groups[i - N].id] = box;
    }
  }
  return createPositions({ nodes: boxes, groups: groupBoxes, edges: straightEdges(graph, boxes) }, "provisional", direction);
}

/** Straight routes between placed ends; a route of `keep` stays where both ends kept their boxes. */
function straightEdges(graph: FlowGraph, boxes: Record<string, Box>, keep?: Positions): Record<string, EdgeRoute> {
  const routes: Record<string, EdgeRoute> = {};
  for (const e of graph.edges) {
    const a = boxes[e.source];
    const b = boxes[e.target];
    if (!a || !b || e.source === e.target) continue;
    const kept = keep?.edges[e.id];
    routes[e.id] = kept && same(a, keep.nodes[e.source]) && same(b, keep.nodes[e.target]) ? kept : straightRoute(a, b);
  }
  return routes;
}

const same = (a: Box, b: Box | undefined) => !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Earlier positions for a changed graph: the nodes still present keep their
 * centres; every other node keeps the offset a provisional arrangement of the
 * graph gives it from the placed neighbour it is first reached from (from the
 * first node still present when no path leads to it); groups enclose their
 * members. Undefined when no node of the graph has an earlier position.
 */
export function reusePositions(graph: FlowGraph, previous: Positions, o: LayoutOptions = {}): Positions | undefined {
  const fresh = provisionalLayout(graph, o);
  const boxes: Record<string, Box> = {};
  const placed: string[] = [];
  for (const n of graph.nodes) {
    const b = previous.nodes[n.id];
    if (!b) continue;
    const { width, height } = fresh.nodes[n.id];
    boxes[n.id] = { x: b.x + (b.width - width) / 2, y: b.y + (b.height - height) / 2, width, height };
    placed.push(n.id);
  }
  if (!placed.length) return undefined;
  const near = new Map<string, string[]>();
  const link = (a: string, b: string) => (near.get(a) ?? near.set(a, []).get(a)!).push(b);
  for (const e of graph.edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const beside = (id: string, from: string) => {
    const f = fresh.nodes[from];
    const n = fresh.nodes[id];
    boxes[id] = { ...n, x: n.x + boxes[from].x - f.x, y: n.y + boxes[from].y - f.y };
  };
  for (let k = 0; k < placed.length; k++) {
    for (const id of near.get(placed[k]) ?? []) {
      if (boxes[id] || !fresh.nodes[id]) continue;
      beside(id, placed[k]);
      placed.push(id);
    }
  }
  for (const n of graph.nodes) if (!boxes[n.id]) beside(n.id, placed[0]);
  const direction = o.direction ?? "RIGHT";
  return createPositions({ nodes: boxes, groups: enclosing(graph, boxes, o, previous), edges: straightEdges(graph, boxes, previous) }, "provisional", direction);
}

/** Group boxes around their members and subgroups; an earlier box stays when it still holds them. */
function enclosing(graph: FlowGraph, boxes: Record<string, Box>, o: LayoutOptions, previous: Positions): Record<string, Box> {
  const out: Record<string, Box> = {};
  if ((o.groups ?? "compound") !== "compound") return out;
  const groups = new Map((graph.groups ?? []).map((g) => [g.id, g]));
  const depth = new Map<string, number>();
  for (const g of groups.values()) {
    let d = 0;
    for (let p = g.parent; p !== undefined && groups.has(p) && d <= groups.size; p = groups.get(p)!.parent) d++;
    depth.set(g.id, d);
  }
  const inside = new Map<string, Box[]>();
  const add = (id: string | undefined, b: Box) => id !== undefined && groups.has(id) && (inside.get(id) ?? inside.set(id, []).get(id)!).push(b);
  for (const n of graph.nodes) add(n.group, boxes[n.id]);
  for (const g of [...groups.values()].sort((a, b) => depth.get(b.id)! - depth.get(a.id)!)) {
    const content = inside.get(g.id);
    if (!content) continue;
    const u = unionBoxes(content);
    const p = GROUP_PADDING;
    const before = previous.groups[g.id];
    const box =
      before && before.x <= u.x - p.left && before.y <= u.y - p.top && before.x + before.width >= u.x + u.width + p.right && before.y + before.height >= u.y + u.height + p.bottom
        ? before
        : { x: u.x - p.left, y: u.y - p.top, width: u.width + p.left + p.right, height: u.height + p.top + p.bottom };
    out[g.id] = box;
    add(g.parent, box);
  }
  return out;
}
