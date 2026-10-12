---
"@wise/flow": patch
---

No form control of the library paints in a colour the browser chose. Every
input, button, select and text area inside the library's components takes its
text colour from `--wf-ink`, its border colour from `--wf-line-strong` and its
placeholder from `--wf-ink-muted`, and is outlined in `--wf-focus` when focused
by keyboard, in every state; the rules have no specificity, so each control's
own rule and a host's rules win. Before, the sliders and the check box of
`<AbstractionControls/>` took the browser's colours (the sliders' grey
differs between Linux and macOS), and the check box and the tables' search
field showed the browser's focus ring.
