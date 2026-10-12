---
"wise-flow": minor
---

The package is now named `wise-flow`, without a scope; it was `@wise/flow`,
whose npm scope belongs to another organisation. Nothing else changes: the
entry points keep their sub-paths (`wise-flow`, `wise-flow/react`,
`wise-flow/bpmn`, `wise-flow/canvas`, the stylesheets and the worker assets)
and their exports, and class names, CSS variables (`--wf-*`) and data
attributes stay as they are. A host edits its dependency entry (`"@wise/flow"`
becomes `"wise-flow"`) and its import specifiers (`@wise/flow/react` becomes
`wise-flow/react`, and so on). See `docs/API.md` ("Package name").
