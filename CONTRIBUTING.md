# Contributing

The [architecture](docs/ARCHITECTURE.md), [feature map](docs/FEATURE_MAP.md),
[roadmap](docs/ROADMAP.md) and [CI contract](docs/CI.md) define ownership and gates.

- Keep the core independent of React and the DOM. Its import boundary is checked.
  Exact case membership, conformance and scores belong to wise-pm/the host.
- Start behavior changes with a failing synthetic regression. Test repeated events,
  missing measurements and cohort replacement where relevant. Keep fixed regressions.
- Run `npm run check`. Changes to rendering also require the appropriate Storybook,
  real-browser, strict visual and packed-consumer checks; see [tests](tests/README.md).
- Public behavior/API changes need documentation and a Changeset (`npx changeset`).
  Versioning, commits and publishing are separate release-owner actions.
- Do not silently lower coverage floors, disable failures or approve screenshots in
  CI. Baseline approval is deliberate, local and OS-specific.
- Colour never carries meaning alone. Provide accessible descriptions, legends,
  keyboard interaction and a table alternative. Automated checks complement manual review.
- Distinguish process routes from observed variants, visual focus from case filters,
  exact statistics from approximations, and association from demonstrated cause.
- Add user-visible text to `src/core/strings.ts` in English and German.
- The BPIC fixture is derived data; rebuild it with `npm run fixture` only when its
  source mapping changes. Ordinary checks use committed public and synthetic fixtures.
- Review dependency advisories and the exact tarball's provenance before release.
  Never distribute an untested rebuild in place of the qualified artifact.
