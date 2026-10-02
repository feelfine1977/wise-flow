# src/bpmn

BPMN bridge, exported as `@wise/flow/bpmn`. The functions run in Node
(bpmn-moddle only); `<BpmnView/>` loads bpmn-js on demand in the browser.

| File | Content |
|---|---|
| `lite.ts` | `liteFromStages` (stage model with known activities → BPMN-lite), `liteFromGraph` (directly-follows graph → BPMN-lite with XOR/AND gateways), `stageModelFromGraph`, `liteCounts`, `gatewayLabel` |
| `layout.ts` | `layoutBpmn` (ELK layering, lanes as stacked bands in one pool, orthogonal flows), `manhattanRoute`, BPMN shape sizes |
| `export.ts` | `exportBpmn` (BPMN 2.0 XML with DI and the `wise` extension), `validateBpmn`, `xmlId`, `roundPositions` |
| `import.ts` | `importBpmn` (XML → FlowGraph, positions from DI, mapping table), `matchActivities`, `applyMapping`, `normalizeLabel`, `positionsFromDi` |
| `ids.ts` | the id resolver: `createIdResolver` (FlowGraph id ↔ BPMN id ↔ activity id and the alias rule), `renameToActivities`, `mappingIndex`, `IdMap`, `registerId` |
| `vocabulary.ts` | the BPMN vocabulary read by export and import: event definitions, gateway types, event roles, task types, loop marker, default flow, generated gateways |
| `moddle.ts` | bpmn-moddle instance with the `wise` extension, `flowIdOf`, `wiseAttr`, `isType`, tag ↔ type helpers |
| `bpmn-moddle.d.ts` | minimal typing of bpmn-moddle (the package ships none) |
| `index.ts` | the entry point; re-exports `<BpmnView/>` from `../react/BpmnView.tsx` |

BPMN-lite vocabulary: activity nodes tagged `task` (plus a sub-type tag such
as `userTask`, and `loop`), gateway nodes tagged `xor` or `and` with
`split` or `join` (`generated` when the builder inserted them), event nodes
tagged `start` or `end`, `flow` edges (`payload.origin` names the path a
flow replaces), `lane` groups.
