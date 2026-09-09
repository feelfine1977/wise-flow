import assert from 'node:assert/strict';
import { layout, validateGraph, toSVG } from '@wise/flow';
import { prepareScene } from '@wise/flow/canvas';
const graph = { nodes: [{ id: 'a', kind: 'activity', label: 'Receive' }, { id: 'b', kind: 'activity', label: 'Complete' }], edges: [{ id: 'ab', kind: 'follows', source: 'a', target: 'b' }] };
assert.equal(typeof document, 'undefined');
assert.deepEqual(validateGraph(graph), []);
for (const engine of ['elk', 'dagre']) {
  const positions = await layout(graph, { engine });
  assert.equal(positions.engine, engine);
  assert.equal(Object.keys(positions.nodes).length, 2);
  assert.match(toSVG({ graph, positions }), /Receive/);
  assert.ok(prepareScene(graph, positions).nodes.length >= 2);
}
console.log('Packed core: plain Node ESM, no React/DOM, ELK + Dagre, SVG + Canvas scene passed.');
