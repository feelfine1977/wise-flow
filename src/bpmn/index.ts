/**
 * `@wise/flow/bpmn` — BPMN bridge: BPMN-lite graphs from a stage model or a
 * directly-follows graph, BPMN 2.0 export with DI, import with a task ↔
 * activity mapping table, the swimlane layout, and `<BpmnView/>` on bpmn-js.
 * The headless functions (`./headless.ts`) run in Node; `<BpmnView/>` loads
 * bpmn-js on demand in the browser.
 */
export * from "./headless.js";
export { BpmnView, type BpmnViewProps, type BpmnSelection, type BpmnViewHandle } from "../react/BpmnView.js";
