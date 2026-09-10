import React from 'react';
import { createRoot } from 'react-dom/client';
import { layout, toSVG, type FlowGraph } from '@wise/flow';
import { ProcessMap } from '@wise/flow/react';
import { BpmnView, exportBpmn, liteFromStages, type BpmnSelection } from '@wise/flow/bpmn';
import { prepareScene } from '@wise/flow/canvas';
import '@wise/flow/react-flow.css';
import '@wise/flow/bpmn.css';
import '@wise/flow/tokens.css';
import '@wise/flow/style.css';
import elkWorkerUrl from '@wise/flow/elk-worker.min.js?url';

async function main() {
const graph: FlowGraph = { nodes: [{ id: 'receive', kind: 'activity', label: 'Receive' }, { id: 'complete', kind: 'activity', label: 'Complete' }], edges: [{ id: 'flow', kind: 'follows', source: 'receive', target: 'complete' }] };
const positions = await layout(graph, { engine: 'elk', elkWorkerUrl });
if (positions.engine !== 'elk') throw new Error('Worker layout failed');
if (prepareScene(graph, positions).nodes.length !== 2 || !toSVG({ graph, positions }).includes('Receive')) throw new Error('Scene export failed');
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
    <div style={{height: 400}}>{visible && <BpmnView xml={xml + '\n'.repeat(revision)} mode={mode} selection={selection} onSelect={next => { setSelection(next); setSelectionEvents(n => n + 1); }} />}</div>
    <i className="bpmn-icon-task" aria-label="BPMN font check" />
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
document.documentElement.dataset.workerLayout = 'passed';

}
void main().catch(error => { setTimeout(() => { throw error; }); });
