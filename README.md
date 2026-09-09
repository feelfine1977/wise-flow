# wise-flow (`@wise/flow`)

Process-flow visualisation for applications that supply activities, stages,
directly-follows counts and metrics. Flow provides a headless TypeScript core,
React and Canvas renderers, BPMN import/export and a bpmn-js viewer/modeler.
It handles layout, abstraction, overlays, selection and drawing; the host owns
data, analysis, persistence and the meaning of actions.

## Install

Supported development and CI runtimes: Node 22 or 24 LTS, npm. React components
require React and React DOM 18 or later; the packed consumer is tested with the
versions in this repository's lockfile. The package is ESM with TypeScript
declarations; CommonJS `require()` is not a supported entry point.

Version **0.3.1 is a local packaging candidate, not a published release**. Given
a supplied tarball, place it in your application's `vendor/` directory and run:

```sh
npm install --save-exact ./vendor/wise-flow-0.3.1.tgz react react-dom
```

Commit the tarball and application lockfile for a standalone `npm ci`. No sibling
checkout, source alias, stub, or postinstall build is needed. Check its SHA256
against the supplied `.sha256` and `.provenance.json` files. A future published
release can replace the file dependency with an exact registry version.

To produce and verify the tarball from this checkout:

```sh
npm ci
npx playwright install chromium
npm run test:package
```

This rebuilds with `npm pack`, installs the actual tarball into a temporary
consumer outside the checkout, and checks Node ESM, TypeScript NodeNext,
production browser bundling, Map, BPMN viewer/modeler, CSS, fonts and the ELK
worker. Outputs are in `artifacts/`: tarball, SHA256, source patch and provenance.
The provenance distinguishes the base commit from any uncommitted modifications;
a version number alone does not identify an unpublished candidate.

## Entry points

| Import | Purpose |
| --- | --- |
| `@wise/flow` | Headless graph model, aggregation, abstraction, layout, scales, overlays, selection, paths, filters, lanes, SVG export |
| `@wise/flow/react` | `ProcessMap`, `BpmnView`, Canvas wrapper, table alternative, timeline and controls |
| `@wise/flow/bpmn` | BPMN-lite, XML import/export with diagram interchange, mapping and `BpmnView` |
| `@wise/flow/canvas` | Scene preparation, Canvas renderer, PNG export |
| `@wise/flow/tokens.css` | Theme variables |
| `@wise/flow/react-flow.css` | React Flow's required base styles |
| `@wise/flow/style.css` | Flow component styles |
| `@wise/flow/bpmn.css` | All required bpmn-js styles and font references |
| `@wise/flow/bpmn/assets/*` | Copied BPMN asset tree, including `bpmn-font/font/bpmn.woff2` |
| `@wise/flow/elk-worker.min.js` | Optional ELK worker asset |

The root entry does not load React or require a DOM. The package still installs
renderer dependencies and React peers; it is not a separate minimal core package.
`@wise/flow/bpmn` retains its React component re-export for compatibility.

## Headless example

```js
import { layout, toSVG } from '@wise/flow';

const graph = {
  nodes: [
    { id: 'receive', kind: 'activity', label: 'Receive' },
    { id: 'complete', kind: 'activity', label: 'Complete' },
  ],
  edges: [{ id: 'flow', kind: 'follows', source: 'receive', target: 'complete' }],
};
const positions = await layout(graph);
const svg = toSVG({ graph, positions, title: 'Example process' });
```

ELK runs in-process by default, with Dagre fallback. For a browser worker in Vite:

```ts
import elkWorkerUrl from '@wise/flow/elk-worker.min.js?url';
const positions = await layout(graph, { elkWorkerUrl });
```

Other bundlers can copy the exported worker and pass its served URL. Serve it
from an origin permitted by your application's worker policy.

## React and BPMN

Import the styles once in your application's entry file. Their package exports
work with normal bundler resolution; no dependency-directory traversal is needed.

```tsx
import '@wise/flow/react-flow.css';
import '@wise/flow/bpmn.css';
import '@wise/flow/tokens.css';
import '@wise/flow/style.css';
import { ProcessMap, BpmnView } from '@wise/flow/react';

// Supply graph from the host and XML from an import or exportBpmn().
<>
  <div style={{ height: 500 }}>
    <ProcessMap graph={graph} onSelect={selection => console.log(selection)} />
  </div>
  <div style={{ height: 500 }}>
    <BpmnView xml={xml} mode="view" />
  </div>
</>
```

`bpmn.css` includes diagram-js, bpmn-js and icon font CSS. Its relative font URLs
are preserved in the tarball; keep that tree together if copying assets manually.
Keep the bpmn.io watermark fully visible, unobscured and linked. See
[licensing](docs/LICENSING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

```ts
import { liteFromStages, exportBpmn, importBpmn } from '@wise/flow/bpmn';
const model = liteFromStages({
  stages: [{ id: 'work', label: 'Work', activities: ['receive', 'complete'] }],
});
const { xml } = await exportBpmn(model);
const { graph, mapping } = await importBpmn(xml);
```

See the [API](docs/API.md), [architecture](docs/ARCHITECTURE.md) and Storybook
stories for overlays, shared layouts, actions, lanes, views and Canvas rendering.

## Limits

- Flow displays supplied metrics. It does not perform conformance checking,
  determine root causes, calculate a business roadmap or persist user actions.
- BPMN-lite is a visual model generated from stages or directly-follows data;
  it is not proof of executable BPMN semantics. Import/export maps supported
  elements and returns warnings; do not assume arbitrary models round-trip losslessly.
- Components require a browser and a container with nonzero dimensions. Canvas
  drawing/PNG export needs Canvas APIs; Node users must supply a compatible canvas.
- Dense graphs can produce small or overlapping labels. Abstraction, zoom and
  the table alternative help inspection; screenshots are regression checks,
  not a guarantee of readability for every input.
- Screenshot baselines are platform-specific. Linux CI asserts the committed
  Linux files; macOS results cannot establish Linux pixel equivalence.
- The package is under a noncommercial licence. Public source availability does
  not grant unrestricted commercial or organisational use.

## Develop

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:package
npm run storybook
npm run test:visual
```

Unit tests use public fixtures and synthetic graphs. Rebuilding the optional
BPIC fixture requires an external CSV; ordinary checks need no private dataset
or model server. See [testing](tests/README.md) for separate screenshot approval,
and [contributing](CONTRIBUTING.md). Roadmap and checkpoint documents describe
historical milestones or proposals, not current release guarantees.

## Licence

Flow remains under [PolyForm Noncommercial 1.0.0](LICENSE). The licence defines
permitted purposes, notices and distribution conditions, including provisions
for specified noncommercial organisations. Commercial uses outside those grants
need separate permission from the copyright holder. No alternate commercial
licence is bundled or promised. Dependency licences remain separate; see
[licensing notes](docs/LICENSING.md).
