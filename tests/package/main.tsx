import React from 'react';
import { createRoot } from 'react-dom/client';
import { layout, toSVG, type FlowGraph, type Overlay } from 'wise-flow';
import { ProcessMap } from 'wise-flow/react';
import { BpmnView, exportBpmn, layoutBpmn, liteFromStages, type BpmnSelection } from 'wise-flow/bpmn';
import { prepareScene } from 'wise-flow/canvas';
import 'wise-flow/bpmn.css';
import 'wise-flow/tokens.css';
// The recommended stylesheet: React Flow's styles and the library's in the cascade layer `wf`.
import 'wise-flow/style.css';
import elkWorkerUrl from 'wise-flow/elk-worker.min.js?url';
import dagreWorkerUrl from 'wise-flow/dagre-worker.min.js?url';

async function main() {
const graph: FlowGraph = { nodes: [{ id: 'receive', kind: 'activity', label: 'Receive' }, { id: 'complete', kind: 'activity', label: 'Complete' }], edges: [{ id: 'flow', kind: 'follows', source: 'receive', target: 'complete' }] };
const positions = await layout(graph, { engine: 'elk', elkWorkerUrl });
if (positions.engine !== 'elk') throw new Error('Worker layout failed');
// ELK fails on an unknown algorithm; the fallback may not run on this thread, so only the Dagre worker can run it.
const fallback = await layout(graph, { elkWorkerUrl, dagreWorkerUrl, fallbackLimit: 0, elkOptions: { 'elk.algorithm': 'flow.none' } });
if (fallback.engine !== 'dagre' || !(fallback.nodes.complete.x > fallback.nodes.receive.x)) throw new Error('Dagre in the worker failed');
// The shipped worker runs the same Dagre step as the calling thread: nested groups, a branch and a back edge give the same positions.
const grouped: FlowGraph = {
  nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, kind: 'activity', label: id.toUpperCase(), group: i < 2 ? 'first' : 'second' })),
  edges: [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'a']].map(([source, target]) => ({ id: `${source}-${target}`, kind: 'follows', source, target })),
  groups: [{ id: 'all', kind: 'stage', label: 'All' }, { id: 'first', kind: 'stage', label: 'First', parent: 'all' }, { id: 'second', kind: 'stage', label: 'Second', parent: 'all' }],
};
for (const direction of ['RIGHT', 'DOWN'] as const) {
  const inWorker = await layout(grouped, { engine: 'dagre', direction, dagreWorkerUrl });
  if (JSON.stringify(inWorker) !== JSON.stringify(await layout(grouped, { engine: 'dagre', direction }))) throw new Error('Dagre in the worker gave other positions');
}
if (prepareScene(graph, positions).nodes.length !== 2 || !toSVG({ graph, positions }).includes('Receive')) throw new Error('Scene export failed');
// In a browser the BPMN layout's Dagre fallback keeps its limit (in Node it has none): ELK fails on an unknown
// algorithm, and 302 nodes plus 301 flows exceed 500.
const ids = ['start', ...Array.from({ length: 300 }, (_, k) => `t${k}`), 'end'];
const row: FlowGraph = { nodes: ids.map(id => ({ id, kind: 'activity', label: id, tags: ['task'] })), edges: ids.slice(1).map((id, k) => ({ id: `f${k}`, kind: 'flow', source: ids[k], target: id })) };
const limited = await layoutBpmn(row, { elkOptions: { 'elk.algorithm': 'flow.none' } }).then(() => 'a layout', (error: Error) => error.name);
if (limited !== 'LayoutUnavailableError') throw new Error(`The BPMN layout above the fallback limit gave ${limited} in the browser`);
// A badge on a task, projected onto the viewer and again onto the modeler.
const overlays: Overlay[] = [{ kind: 'badge', target: 'receive', payload: { glyph: '≥1', value: 0.5 } }];
const { xml } = await exportBpmn(liteFromStages({ stages: [{ id: 'work', activities: ['receive', 'complete'] }] }));
function App() {
  const [mode, setMode] = React.useState<'view' | 'model'>('view');
  const [visible, setVisible] = React.useState(true);
  const [revision, setRevision] = React.useState(0);
  const [selection, setSelection] = React.useState<BpmnSelection>({ tasks: ['receive'], flows: [], lanes: [] });
  const [selectionEvents, setSelectionEvents] = React.useState(0);
  return <>
    <button onClick={() => setMode('model')}>Open modeler</button>
    <button onClick={() => setVisible(!visible)}>{visible ? 'Hide diagram' : 'Show diagram'}</button>
    <button onClick={() => setRevision(n => n + 1)}>Reload diagram</button>
    <output data-testid="bpmn-selection">{selection.tasks.join(',') || 'none'}</output>
    <output data-testid="bpmn-selection-events">{selectionEvents}</output>
    <div style={{height: 300}}><ProcessMap graph={graph} positions={positions} /></div>
    <div style={{height: 400}}>{visible && <BpmnView xml={xml + '\n'.repeat(revision)} mode={mode} overlays={overlays} selection={selection} onSelect={next => { setSelection(next); setSelectionEvents(n => n + 1); }} />}</div>
    <i className="bpmn-icon-task" aria-label="BPMN font check" />
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
document.documentElement.dataset.workerLayout = 'passed';

}
void main().catch(error => { setTimeout(() => { throw error; }); });
