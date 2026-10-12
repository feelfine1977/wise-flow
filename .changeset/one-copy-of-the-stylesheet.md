---
"@wise/flow": patch
---

The package no longer contains `dist/react/style.css`, a second copy of
`dist/style.css` that no export path reached. Import the stylesheet as
before, through `@wise/flow/style.css`.
