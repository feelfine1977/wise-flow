---
"@wise/flow": patch
---

`<ProcessMap/>` takes its selection, focus, keyboard and menu transitions and
the sentences of its live region from one headless map controller in the core.
Props, callbacks and DOM are unchanged. One announcement changes: choosing
"Paths in and out" (or another `paths` action) from the actions menu now
announces the string `onAction` returns, as documented; before, the sentence
for the new focus of paths replaced it. Without a string from `onAction` the
focus sentence is announced as before.
