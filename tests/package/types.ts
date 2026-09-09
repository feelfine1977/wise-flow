import { layout, type FlowGraph, type Positions } from '@wise/flow';
import { ProcessMap, BpmnView, type ProcessMapProps } from '@wise/flow/react';
import { exportBpmn, liteFromStages, type BpmnViewProps } from '@wise/flow/bpmn';
import { prepareScene } from '@wise/flow/canvas';
const graph: FlowGraph = { nodes: [], edges: [] };
const positions: Positions = await layout(graph);
const props: ProcessMapProps = { graph, positions };
const bpmn: BpmnViewProps = { graph: liteFromStages({ stages: [] }) };
void [ProcessMap, BpmnView, props, bpmn, exportBpmn, prepareScene(graph, positions)];
