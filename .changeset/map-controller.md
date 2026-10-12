---
"@wise/flow": patch
---

`<ProcessMap/>` takes its selection, focus, keyboard and menu transitions and
the sentences of its live region from one headless map controller in the core.
Props and DOM are unchanged, and so are the callbacks, except their order
when the actions menu opens on an element that was not selected:
`onContextMenu` is asked for the entries before `onSelect` reports the
selection the opening makes (before, `onSelect` came first). Two
announcements change. Choosing
"Paths in and out" (or another `paths` action) from the actions menu now
announces the string `onAction` returns, as documented; before, the sentence
for the new focus of paths replaced it. Without a string from `onAction` the
focus sentence is announced as before. A new `announce` text that arrives
together with a new `focus` (or with `defaultFocus` on the first render) is
now announced; before, the sentence for the focus replaced it.
