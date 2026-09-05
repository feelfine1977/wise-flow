# Licensing notes

| Dependency | Licence | Note |
|---|---|---|
| @xyflow/react (React Flow) | MIT | pro examples are paid, not required |
| elkjs | EPL-2.0 | usable from MIT/Apache code; keep the notice; `elk-worker.min.js` is served by the application for the worker |
| @dagrejs/dagre (+ @dagrejs/graphlib) | MIT | maintained fork of dagre with ESM and types |
| d3-scale (+ d3-interpolate, d3-format, d3-time, d3-array, d3-color as transitive) | ISC | |
| rbush (+ quickselect) | MIT | |
| bpmn-js, diagram-js, bpmn-moddle (0.2) | bpmn.io licence | MIT-like; the bpmn.io watermark in rendered diagrams must stay |
| cytoscape (optional, later) | MIT | |

Development only: TypeScript (Apache-2.0), Vite and Vitest (MIT), Storybook
(MIT), Playwright (Apache-2.0), ESLint and typescript-eslint (MIT),
Testing Library (MIT), jsdom (MIT), Changesets (MIT).

The fixture `fixtures/bpic2019_p2p.json` is derived from the BPI Challenge
2019 event log (4TU.ResearchData, CC-BY-4.0); the source CSV is not part of
the repository.

Recommended licence for this library: MIT (simplest for adoption) or
Apache-2.0 (explicit patent grant). Decide before the first commit and add
`LICENSE` and the SPDX field in `package.json` (currently
`SEE LICENSE IN docs/LICENSING.md`).
