// Heap a prepared Canvas scene retains per node and per edge, part by part.
//
//   npm run build && node scripts/scene-memory.mjs [--labels] [--straight]
//
// The graph is a sparse chain (n + 1 activities, n follows edges, cases and
// counts that repeat), on a grid; edges have routes unless `--straight`, and
// activity labels (names) are on with `--labels`. Each size runs in its own
// process with `--expose-gc`: heap used after the graph and its positions are
// built, after `prepareScene`, and after each part of the scene is dropped in
// turn, so that a part counts what only it holds. A run without edges gives
// the nodes' share; the edges' is the rest. Bytes per element are the slope
// between the smallest and the largest size.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIZES = [50_000, 100_000, 200_000];
const PARTS = {
  hit: (s) => { s.hit = undefined; },
  lookups: (s) => { s.nodeById = s.edgeById = undefined; },
  retainedNodes: (s) => { s.nodes = undefined; },
  retainedEdges: (s) => { s.edges = undefined; },
  nodeMarkTexts: (s) => { for (const m of s.nodeMarks) m.texts = undefined; },
  nodeMarks: (s) => { s.nodeMarks = undefined; },
  edgeMarkTexts: (s) => { for (const m of s.edgeMarks) m.texts = undefined; },
  edgeMarkRoutes: (s) => { for (const m of s.edgeMarks) m.points = undefined; },
  edgeMarks: (s) => { s.edgeMarks = undefined; },
};

async function measure(n, edges, labels, straight) {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const { createPositions } = await import(pathToFileURL(resolve(dist, 'index.js')).href);
  const { prepareScene } = await import(pathToFileURL(resolve(dist, 'canvas/index.js')).href);
  const heap = () => {
    for (let i = 0; i < 4; i++) globalThis.gc();
    return process.memoryUsage().heapUsed;
  };
  const start = heap();
  const graph = { nodes: [], edges: [] };
  const boxes = {};
  const routes = {};
  for (let i = 0; i <= n; i++) {
    graph.nodes.push({ id: `n${i}`, kind: 'activity', label: `Activity ${i}`, metrics: { cases: 1000 + (i % 97) } });
    boxes[`n${i}`] = { x: (i % 400) * 360, y: Math.floor(i / 400) * 100, width: labels ? 280 : 160, height: 60 };
  }
  for (let i = 0; edges && i < n; i++) {
    const id = `e${i}`;
    graph.edges.push({ id, kind: 'follows', source: `n${i}`, target: `n${i + 1}`, metrics: { count: 10 + (i % 89) } });
    const a = boxes[`n${i}`];
    const b = boxes[`n${i + 1}`];
    if (!straight) routes[id] = { points: [{ x: a.x + a.width, y: a.y + 30 }, { x: b.x, y: b.y + 30 }] };
  }
  const positions = createPositions({ nodes: boxes, groups: {}, edges: routes }, 'given', 'RIGHT');
  const built = heap();
  let scene = prepareScene(graph, positions, labels ? { activityLabels: { mode: 'names', references: {} } } : {});
  const prepared = heap();
  const out = { graphAndPositions: built - start, scene: prepared - built };
  let before = prepared;
  for (const [name, drop] of Object.entries(PARTS)) {
    drop(scene);
    const now = heap();
    out[name] = before - now;
    before = now;
  }
  scene = undefined;
  out.rest = before - heap();
  if (graph.nodes.length !== n + 1 || !positions) throw new Error('graph released early');
  return out;
}

const [mode, ...flags] = process.argv.slice(2);
if (mode === '--child') {
  const [n, edges, labels, straight] = flags.map(Number);
  process.stdout.write(JSON.stringify(await measure(n, !!edges, !!labels, !!straight)));
} else {
  const labels = process.argv.includes('--labels') ? 1 : 0;
  const straight = process.argv.includes('--straight') ? 1 : 0;
  const run = (n, edges) => JSON.parse(execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child', n, edges, labels, straight].map(String), { encoding: 'utf8', maxBuffer: 1 << 20 }));
  const runs = SIZES.map((n) => ({ n, both: run(n, 1), nodes: run(n, 0) }));
  const [first, last] = [runs[0], runs[runs.length - 1]];
  const slope = (kind, key) => (last[kind][key] - first[kind][key]) / (last.n - first.n);
  const rows = ['graphAndPositions', 'scene', ...Object.keys(PARTS), 'rest'].map((key) => {
    const node = slope('nodes', key);
    return { part: key, perNode: Math.round(node), perEdge: Math.round(slope('both', key) - node) };
  });
  console.log(`Sparse chain, ${straight ? 'straight edges' : 'routed edges'}${labels ? ', activity labels' : ''}; bytes per element between ${first.n} and ${last.n}`);
  console.table(rows);
  console.log('Scene bytes at each size (nodes and edges):', runs.map((r) => `${r.n}: ${r.both.scene}`).join(', '));
}
