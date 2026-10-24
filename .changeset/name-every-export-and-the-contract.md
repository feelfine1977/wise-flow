---
"wise-flow": patch
---

`docs/API.md` names every name the four entry points export, among them the
nineteen long-standing helpers of `wise-flow` it did not name (`hasTag`,
`hashKey`, `hexToRgb`, `interpolatePalette`, `normalizeGraph`,
`straightRoute`, `defaultNodeSize`, the tags `COLLAPSED_TAG`, `DIFF_TAGS`,
`RECONNECTED_TAG`, `OverlayPresetOptions`, `withObservedSelfLoops`,
`wrapActivityText` and the `activity*` helpers, and also `contrastRatio`,
`strengths` and `strings`), the props and options types that appeared only
inline (`IdResolverOptions`, `BpmnElementRef` and `ActivityRenaming` of
`wise-flow/bpmn` among them), and a tooling test keeps it so.

It states the contract for versions: while the version is 0.x a minor
release may remove or change a name, named in its Changeset and the upgrade
notes; from 1.0 on breaking changes come only in major versions after a
deprecation. The names removed in this release stay removed.

It also says that hiding a map with `<Activity mode="hidden">` releases its
layout scope and showing it lays out again, that given positions that stop
covering the graph start the first scene from the map's own earlier layout,
and that a host does not replace the lists of a prepared scene.
