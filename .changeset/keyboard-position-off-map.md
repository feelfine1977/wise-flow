---
"@wise/flow": patch
---

A keyboard position whose element left the map counts as none. When the
element the keyboard is on is no longer on the map (a collapsed stage
expanded from its actions menu, a threshold or a host filter that removes
it), `<ProcessMap/>` no longer names it in `aria-activedescendant`, and
Space and Enter no longer select it or open a menu on it; the next key starts
as from no keyboard position (from the first selected activity on the map,
else from the one Home goes to). The map controller's keys do the same for an
`active` element or a first selected activity that has no box or is not in
the graph.
In the table view `<ProcessMap/>` names no element in
`aria-activedescendant` either, since that view renders neither the element
list nor the map's elements; back in the map view it names the keyboard
position again.
