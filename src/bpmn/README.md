# src/bpmn

BPMN bridge, exported as `@wise/flow/bpmn`. The functions run in Node
(bpmn-moddle only); `<BpmnView/>` loads bpmn-js on demand in the browser,
behind the viewer seam of `viewer.ts`.

| File | Content |
|---|---|
| `lite.ts` | `liteFromStages` (stage model with known activities → BPMN-lite), `liteFromGraph` (directly-follows graph → BPMN-lite with XOR gateways, AND only as a split/join pair), `stageModelFromGraph`, `liteCounts`, `gatewayLabel` |
| `layout.ts` | `layoutBpmn` (ELK layering, then the core's lane model: nested lanes stacked as bands in one pool, flows routed by `routeSequenceFlows`), BPMN shape sizes |
| `export.ts` | `exportBpmn` (BPMN 2.0 XML with DI and the `wise` extension), `validateBpmn`, `xmlId`, `roundPositions` |
| `import.ts` | `importBpmn` (XML → FlowGraph, positions from DI, mapping table), `matchActivities`, `applyMapping`, `normalizeLabel`, `positionsFromDi` |
| `ids.ts` | the id resolver: `createIdResolver` (FlowGraph id ↔ BPMN id ↔ activity id and the alias rule), `renameToActivities`, `mappingIndex`, `IdMap`, `registerId` |
| `vocabulary.ts` | the BPMN vocabulary read by export and import: event definitions, gateway types, event roles, task types, loop marker, default flow, generated gateways |
| `scene.ts` | the scene of a shown diagram: `registryPositions` (boxes of the rendered elements under the graph's ids), `diagramScene` (overlay targets resolved, the core scene built) |
| `projection.ts` | `projectMarks`: overlay marks and registry boxes → overlays on elements (offset, zoom, scale, class, marker) and paths in the SVG layer (with the elements a click selects) |
| `viewer.ts` | the viewer seam `<BpmnView/>` uses (`BpmnViewer`, `ConnectViewer`, `ViewerEvents`), `BpmnSelection`, and the ids a selection or hover reports (`selectionOf`, `hoverOf`, `elementsNamed`) |
| `bpmn-js.ts` | `connectBpmnJs`: the bpmn-js adapter of the seam (NavigatedViewer or Modeler, imported on demand) |
| `headless.ts` | every name of the entry point except `<BpmnView/>`; Node code and tests import the bridge from here |
| `moddle.ts` | bpmn-moddle instance with the `wise` extension, `flowIdOf`, `wiseAttr`, `isType`, tag ↔ type helpers |
| `bpmn-moddle.d.ts` | minimal typing of bpmn-moddle (the package ships none) |
| `index.ts` | the entry point: `headless.ts` and `<BpmnView/>` from `../react/BpmnView.tsx`; the only module of the bridge that loads React |

BPMN-lite vocabulary: activity nodes tagged `task` (plus a sub-type tag such
as `userTask`, and `loop`), gateway nodes tagged `xor` or `and` with
`split` or `join` (`generated` when the builder inserted them), event nodes
tagged `start` or `end`, `flow` edges (`payload.origin` names the path a
flow replaces), `lane` groups.
