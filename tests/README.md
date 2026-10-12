# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, the source lint, workflow policies, artifact budgets and the token table and its generated `tokens.css`; the styling contract against the rendered fixtures and the API document; the emitted JavaScript without comments, the declarations with their documentation comments, and their maps | `npm run test:tooling` |
| `package/` | Separate consumer of the actual npm tarball; NodeNext types and real browser assets/lifecycle | `npm run test:package` |
| `browser/` | Production Storybook accessibility and keyboard tests, the map's paint order, host stylesheets against the styling contract and the cascade layer, the computed styles of the map and its panels against their record (only the elements inside the library's roots), the outline and fill of an activity's card when hovered, selected, focused and out of scope, the detail panel (fewer activities and paths drawn at each step of "Activities" to the left, "Paths" in place), the controls (no panel over an activity at the fitted zoom, the dark scheme's panels, controls and table cells and its pattern ink, the controls' accessibility and names in English and German, and every form control's text, border and outline colour a token in every state and both schemes), and the parity of the four renderers, in a real browser | `npm run storybook:build` then `npm run test:browser` |
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
the scene resolved in it; one story draws in a second theme (cards outlined 3
wide with corners of 10, names at 15, cases at 13, the frequency cue only as
its foot); and one gives the map no theme but sets
`--wf-paper`, `--wf-ink`, `--wf-focus` and `--wf-font` on its container (a hex
colour and two colour names), and writes the theme `useFlowTheme` resolves there,
which the other three renderers draw. The test checks that the scheme and
the theme reached what it compares, and for the host's variables that the theme
holds them as literals, that the SVG export writes them (and no `var(`, `oklch(`
or `color-mix(`) and that the DOM map paints its focus and writes its labels in
them. One story draws the element kinds in a theme with rules (a gateway's fill
and outline by kind, an activity tagged `manual` outlined 2 wide with corners of
8, its name at 600 in the rule's colour and its cue only as the foot by tag, a
re-added path's colour at half its opacity and a re-added activity's fill at
0.6 by state), and the test checks that all four renderers drew them. Each
reader draws an element at its opacity (its group's in the SVG export, the
computed opacity of it and its ancestors in the DOM map, the global alpha on
the Canvas) into every paint of it. For every node, edge, group and mark it compares the box,
outline paint and width, dash, fill, radius, shadow, colour band, a card's
frequency cue (the paint and the length, to the pixel, of its stripe and its
foot), band rule and each text's string, size, weight and paint with the SVG
export's, and for paths
their line join and arrowhead with its width (the head grows with the line), for arcs and self-loops their arrowhead and for
a mark with a label pill the pill's box, fill, outline and radius. Every
difference is listed in `browser/parity/expected.json` by renderer, element
kind, property and the two values, with its fixtures and number of elements; a
difference the list lacks fails, and so does an entry that is no longer found or
found on other elements. A change that removes a difference removes its entry;
a change that adds one fixes the drawing instead. Set `FLOW_PARITY_FOUND` to a
file name to write what was found. The readers and the check are tested in Node
by `core/renderer-parity.test.ts`.

Every renderer writes the texts the scene's text measure fitted, so the
Canvas recordings and a live Canvas map shorten labels as the SVG export does.
Two stories write BPIC global with activity names, in English with the
estimate and in German with another measure (`fixtures/text-measures.ts`),
which the test gives the exports too; it checks that the measure reached what
it compares (more name lines than the estimate).

A second test opens the interactive map and the live Canvas map side by side in
a theme with rules of the interactive states and one activity selected, records
the Canvas context's calls in the page, and checks that both draw the selected
activity's outline, fill and name in the rules' colours and every dimmed path at
the rule's opacity.

A third test opens the interactive map and the live Canvas map side by side
under the same four variables, with no theme and one activity selected, records
the Canvas context's calls in the page, and checks that the Canvas map fills the
activity, outlines it in the focus colour and writes its name in the ink and
the font the DOM map paints them in.

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
