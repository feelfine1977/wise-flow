import { layout, labelUnitsAt, smallLabelUnitsAt, mapScaleAt, labelScreenPx, type FlowGraph, type Positions } from '@wise/flow';
import { ProcessMap, BpmnView, type ProcessMapProps } from '@wise/flow/react';
import { exportBpmn, liteFromStages, type BpmnViewProps } from '@wise/flow/bpmn';
import { prepareScene } from '@wise/flow/canvas';
const graph: FlowGraph = { nodes: [], edges: [] };
const positions: Positions = await layout(graph);
const props: ProcessMapProps = { graph, positions };
const bpmn: BpmnViewProps = { graph: liteFromStages({ stages: [] }) };
void [ProcessMap, BpmnView, props, bpmn, exportBpmn, prepareScene(graph, positions)];

const textSizes: number[] = [labelUnitsAt(0.5), labelUnitsAt(0.5, 14), smallLabelUnitsAt(0.5), mapScaleAt(0.5), labelScreenPx(24, 0.5)];
void textSizes;
