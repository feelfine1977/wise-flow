---
"@wise/flow": patch
---

With `keepConnected`, a collapsed stage without members weighs nothing when
`abstract` chooses where to start joining the map again. Its stage node has
no metrics, so it weighed as much as the strongest activity and could be
where the joins started; nothing reached it, and nothing was joined. A
connected map of `m – r – n` with an empty stage collapsed came out with `m`
and `n` apart where `r` was removed; now `r` is re-added between them, as
without the empty stage.
