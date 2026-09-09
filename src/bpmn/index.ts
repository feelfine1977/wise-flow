/**
 * `@wise/flow/bpmn` — BPMN bridge: BPMN-lite graphs from a stage model or a
 * directly-follows graph, BPMN 2.0 export with DI, import with a task ↔
 * activity mapping table, the swimlane layout, and `<BpmnView/>` on bpmn-js.
 * The headless functions run in Node; `<BpmnView/>` loads bpmn-js on demand in
 * the browser.
 */
export {
  liteFromStages,
  liteFromGraph,
  stageModelFromGraph,
  liteCounts,
  gatewayLabel,
  START_ID,
  END_ID,
  TASK_TAG,
  LOOP_TAG,
  GENERATED_TAG,
  type StageModel,
  type Stage,
  type StageActivity,
  type LiteFromStagesOptions,
  type LiteFromGraphOptions,
} from "./lite.js";
export { layoutBpmn, manhattanRoute, bpmnNodeSize, BPMN_SIZES, POOL_ID, type BpmnLayoutOptions } from "./layout.js";
export { exportBpmn, validateBpmn, roundPositions, xmlId, exportableEdges, EXPORTER_NAME, EXPORTER_VERSION, TARGET_NAMESPACE, type ExportBpmnOptions, type BpmnExport, type IdMap, type BpmnValidation } from "./export.js";
export {
  importBpmn,
  matchActivities,
  applyMapping,
  mappingIndex,
  normalizeLabel,
  positionsFromDi,
  type ActivityRef,
  type MappingRow,
  type ImportBpmnOptions,
  type BpmnImport,
} from "./import.js";
export { createModdle, wiseModdleDescriptor, WISE_NS, flowIdOf, wiseAttr, isType, isAnyType, tagOfType, typeOfTag, type ModdleElement, type BpmnModdleInstance } from "./moddle.js";
export { BpmnView, type BpmnViewProps, type BpmnSelection, type BpmnViewHandle } from "../react/BpmnView.js";
