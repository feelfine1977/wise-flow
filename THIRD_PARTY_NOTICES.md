# Third-party distribution notices

Flow's own licence is PolyForm Noncommercial 1.0.0 (LICENSE). Copied third-party
assets retain their original licences; they are not relicensed as Flow code.

- **bpmn-js 18.31.1:** CSS and BPMN fonts copied unchanged from `dist/assets`.
  Copyright (c) 2014-present Camunda Services GmbH. The original notice and full
  licence are in `dist/licenses/bpmn-js.txt`. The bpmn.io watermark source must
  remain intact, and its linked watermark must stay fully visible and must not
  be overlapped. Source: https://github.com/bpmn-io/bpmn-js/tree/v18.31.1
- **@xyflow/react 12.11.6:** base stylesheet copied unchanged from `dist/style.css`.
  Original MIT notice and licence: `dist/licenses/@xyflow-react.txt`.
  Source: https://github.com/xyflow/xyflow
- **elkjs 0.9.3:** `lib/elk-worker.min.js` copied unchanged. Original EPL-2.0
  licence: `dist/licenses/elkjs.txt`. Corresponding source and build instructions:
  https://github.com/kieler/elkjs/tree/v0.9.3
- **@dagrejs/dagre 3.1.1** (with @dagrejs/graphlib 4.0.5 bundled in its build):
  `dist/dagre.min.js` included unchanged in `dist/dagre-worker.min.js`, wrapped
  in a function scope and followed by Flow's Dagre step. Original MIT notices
  and licences: `dist/licenses/@dagrejs-dagre.txt` and
  `dist/licenses/@dagrejs-graphlib.txt`. Source: https://github.com/dagrejs/dagre

Other runtime dependencies are installed by npm with their own licence files.
See `docs/LICENSING.md`. Preserve these notices when redistributing the assets.
