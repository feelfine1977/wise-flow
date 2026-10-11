# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, the source lint, workflow policies, artifact budgets and the token table and its generated `tokens.css`; the styling contract against the rendered fixtures and the API document | `npm run test:tooling` |
| `package/` | Separate consumer of the actual npm tarball; NodeNext types and real browser assets/lifecycle | `npm run test:package` |
| `browser/` | Production Storybook accessibility and keyboard tests, the map's paint order, host stylesheets against the styling contract and the cascade layer, the computed styles of the map and its panels against their record, and the parity of the four renderers, in a real browser | `npm run storybook:build` then `npm run test:browser` |
| `visual/` | Ten behavior checks including six screenshots and the large Canvas scene | `npm run test:visual` |

`npm run check` runs lint, typecheck, architecture/workflow guards, tooling tests
and unit/component coverage. Vitest counts all implementation files and enforces
reviewed floors (the measured values rounded down). It refuses focused `.only`
tests in CI. Reported coverage is not a claim of semantic completeness; graph
routes still differ from observed variants and grouped metric approximations
still require host evidence.

## Parity of the four renderers

`browser/parity.spec.ts` opens each parity story (`stories/Parity.stories.tsx`),
reads what the interactive DOM map drew from computed styles and geometry, and
draws the scene the story wrote beside the map with the SVG export (parsed),
the Canvas map (recorded calls, one element at a time) and the PNG export
(recorded calls of the whole figure, each given to the element that draws the
same operation), in the theme the story wrote with its scene. Three stories
are drawn a second time in the dark scheme: the map in a page that prefers it,
the scene resolved in it; one story draws in a second theme (activities outlined
3 wide with corners of 10, labels at 14). The test checks that the scheme and
the theme reached what it compares. For every node, edge, group and mark it compares the box,
outline paint and width, dash, fill, radius, shadow, colour band, band rule and
each text's string, size, weight and paint with the SVG export's. Every
difference is listed in `browser/parity/expected.json` by renderer, element
kind, property and the two values, with its fixtures and number of elements; a
difference the list lacks fails, and so does an entry that is no longer found or
found on other elements. A change that removes a difference removes its entry;
a change that adds one fixes the drawing instead. Set `FLOW_PARITY_FOUND` to a
file name to write what was found. The readers and the check are tested in Node
by `core/renderer-parity.test.ts`.

The Canvas recordings measure text with the core's estimate, as the Node tests
do, so they shorten labels as the SVG export does; a browser's font metrics can
shorten them differently on a live Canvas map.

## Strict visual CI and deliberate approval

Strict visual tests use `updateSnapshots: "none"`; missing or changed baselines
fail without recording. CI pins Playwright 1.61.1 and runs Ubuntu 24.04 Chromium.
The hosted OS image can change independently and must still pass. For an intended
visual change, outside CI on the corresponding OS:

```sh
npm run test:visual:approve
npm run test:visual -- --update-snapshots=none
```

Approval refuses to run in CI. Review every proposed image and its behavior.
Never rename a `darwin` baseline to `linux`. Linux approval requires the matching
Linux environment. Failure artifacts contain actual/diff images and traces,
not automatically approved snapshots.

The origin of the current reference images is recorded in
[visual/baseline-provenance.json](visual/baseline-provenance.json): the source
commit, the date of the owner's approval, the macOS version and the container
image the Linux images were captured in, and the SHA-256 of all twelve files.
The Linux images were captured in that container, not on the hosted runner; a
strict run on the hosted runner is what qualifies them there.
