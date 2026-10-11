# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `support/` | Seeded generators for searching tests: random stream, graph families, positions and viewports, event schedules, shrinking; a recording 2D context that says which element inked which canvas pixels | imported by `core/` and `react/` tests |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, the source lint, workflow policies and artifact budgets | `npm run test:tooling` |
| `package/` | Separate consumer of the actual npm tarball; NodeNext types and real browser assets/lifecycle | `npm run test:package` |
| `browser/` | Production Storybook accessibility and keyboard tests, and the map's paint order in a real browser | `npm run storybook:build` then `npm run test:browser` |
| `visual/` | Ten behavior checks including six screenshots and the large Canvas scene | `npm run test:visual` |

`npm run check` runs lint, typecheck, architecture/workflow guards, tooling tests
and unit/component coverage. Vitest counts all implementation files and enforces
reviewed floors (the measured values rounded down). It refuses focused `.only`
tests in CI. Reported coverage is not a claim of semantic completeness; graph
routes still differ from observed variants and grouped metric approximations
still require host evidence.

## Searching tests: seeds, deep mode and reproduction

A searching test draws its input from the generators in `support/` instead of
writing it by hand: `createRandom(seed)` is the random stream (`int`, `pick`,
`shuffle`, `weighted`, `sample`, `fork`); `families` in `graphs.ts` are graph
shapes by size and seed (chain, layered, tree, cyclic, hub, components, stages,
lanes, nested, overlaid, and long, German, right-to-left and markup-like
labels), `invalidFamilies` plant defects and say which; `positionsOf` and
`viewportOf` in `scenes.ts` arrange a graph (grid, layered, overlapping,
extreme) and look at it (ordinary, tiny, huge, far away, extreme zoom);
`schedule` and `interleave` in `schedules.ts` give event sequences on a fake
clock; `oddPositionsOf` places a point-sized, a huge and a twin node, and
`viewportAtSide` puts a view's edge across an element. `inkContext` and
`watch` in `ink.ts` record a Canvas draw: every call with its arguments, and
the box of canvas pixels each fill, stroke or text covers, attributed to the
element whose list entry was read last, so that a test can compare what was
drawn with a reference computed from the scene's data alone. Generators are
hand-written and seeded; a test adds no dependency.

The shape of a searching test:

```ts
for (const seed of seeds(caseCount(20))) {
  const graph = families.layered(30, seed);
  expect(property(graph), caseLabel(seed, "layered 30")).toBe(true);
}
```

- `caseCount(base)` is how many cases run: `base` by default, so the ordinary
  gate stays within its time, and fifty times as many with `WISE_DEEP=1`
  (`WISE_DEEP=3` runs a hundred and fifty times as many). Each searching test
  is run in deep mode at least once before it is merged, and its deep run is
  recorded with the seed range, the number of cases, the duration and the result.
- `seeds(count)` are the seeds, `1 … count` by default and `count` seeds from
  `WISE_SEED` on when it is set. Every assertion names its seed through
  `caseLabel(seed, detail)`, so the failure prints
  `seed 17 (step 3); replay with WISE_SEED=17`. To reproduce it, run the test
  with `WISE_SEED=17`: the failing case is the first one drawn, and the test
  stops at its assertion:

  ```sh
  WISE_SEED=17 npx vitest run tests/core/<file>.test.ts -t "<test name>"
  ```

- A fault that a search finds is first shrunk and then pinned: `shrinkCase`
  in `shrink.ts` tries smaller sizes of the generated case and then
  `shrinkGraph` removes nodes, edges, groups and overlays while the predicate
  still fails (a predicate that throws counts as failing). The smallest case
  becomes a small, named, deterministic regression test that does not use the
  generators, and the fix follows it.
- A naive reference implementation in a searching test is obviously correct
  however slow, and shares no code with what it checks.
- A search that finds nothing is a result too: say what was searched, how many
  cases ran, and what kinds of input the generators cannot produce.

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
