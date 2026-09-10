import assert from 'node:assert/strict';
import { layout, validateGraph, toSVG, LABEL_PX, MIN_LABEL_PX, MAX_LABEL_PX, MAX_LABEL_UNITS, MIN_READABLE_ZOOM, labelUnitsAt, smallLabelUnitsAt, mapScaleAt, labelScreenPx } from '@wise/flow';
import { prepareScene } from '@wise/flow/canvas';
const graph = { nodes: [{ id: 'a', kind: 'activity', label: 'Receive' }, { id: 'b', kind: 'activity', label: 'Complete' }], edges: [{ id: 'ab', kind: 'follows', source: 'a', target: 'b' }] };
assert.equal(typeof document, 'undefined');
assert.deepEqual([LABEL_PX, MIN_LABEL_PX, MAX_LABEL_PX, MAX_LABEL_UNITS, MIN_READABLE_ZOOM], [12, 11, 14, 64, 0.171875]);
assert.equal(labelUnitsAt(0.5), 24);
assert.equal(smallLabelUnitsAt(0.5), 22);
assert.equal(mapScaleAt(0.5), 2);
assert.equal(labelScreenPx(labelUnitsAt(0.5), 0.5), 12);
assert.deepEqual(validateGraph(graph), []);
for (const engine of ['elk', 'dagre']) {
  const positions = await layout(graph, { engine });
  assert.equal(positions.engine, engine);
  assert.equal(Object.keys(positions.nodes).length, 2);
  assert.match(toSVG({ graph, positions }), /Receive/);
  assert.ok(prepareScene(graph, positions).nodes.length >= 2);
}
console.log('Packed core: plain Node ESM, no React/DOM, ELK + Dagre, SVG + Canvas scene passed.');
