# Changesets

Public API changes ship with a changeset: `npx changeset` describes the change
and its semver level; `npx changeset version` folds pending changesets into
`CHANGELOG.md` and bumps `package.json` before a release. Milestone 0.1 was
written into `CHANGELOG.md` directly; later changes go through this folder.
