---
"@wise/flow": patch
---

An arc's label keeps clear of badges and of the paths' counts as it keeps
clear of activities, earlier arc labels and group titles: it moves along the
arc to the nearest point where it covers none of them, and where no point is
free, to the one that covers the fewest. It could sit on a badge of its own
end, or on the count of a path running under the arc; on the BPIC map at
50 %, the reverse arc's "⇐ 52 %" covered the count "110k" of the path from
"Vendor creates invoice" back to "Record Goods Receipt". `overlayGeometry`
keeps arc labels clear of badges; `buildScene`, and so the SVG export,
`toPNG`, the Canvas map, the React map and the BPMN view, of the counts too.
An arc label whose box (11 per character, 18 high) reached neither stays
where it was, unless the label of an earlier arc moves into its place.
