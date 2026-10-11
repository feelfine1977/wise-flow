---
"@wise/flow": minor
---

`abstract` selects what a map shows by two detail shares, `activityDetail`
and `pathDetail` (0 to 1): 1 and 1 show every activity and every path
between shown activities, unchanged in their counts; a lower share shows
the most frequent activities by rank (cases, then events, then id, rounded
up, at least one, a tie whole) and the paths whose rank in the whole graph
(count, then id) lies within it. Every pair of shares is valid: every shown
activity lies on a directed way from a start to an end over shown paths.
Each activity keeps its anchors, its strongest path from and to a more
frequent activity (or the start and the end), or the way through rarer
activities whose rarest is the most frequent; an anchor outside the paths
share is an ordinary observed path with its count, tagged `anchor`
(`ANCHOR_TAG`). Where such a way passes activities that are not shown, one
edge tagged `indirect` (`INDIRECT_TAG`) without a count stands for it, with
`payload.hiddenActivities` and `payload.via`. Moving either share towards
more detail removes no element but an indirect path whose activities come
into view. Self-loops enter by the paths share only; stages are collapsed
first. Given a share, `minNodeShare`, `minEdgeShare` and `keepConnected`
are not read; a host that passes only thresholds gets the same nodes,
edges, groups and overlays as before on a graph that is not a comparison.

`meta.shown` (`ShownMeta`) states what is shown: activities and paths of
all, and for the shares the anchor-only paths (and which activities each
keeps), the indirect paths, the count of the weakest path shown by
frequency and of the strongest not shown; with thresholds and without
`keepConnected`, how many shown activities have no path. `meta.abstraction`
records the shares (`AbstractionMeta.activityDetail`, `pathDetail`), and
the map's description says how many activities and paths they show.

A mark can be declared protected (`Overlay.protected`): the activity, the
path (with both ends) or both activities of an arc it sits on are shown at
every share and with thresholds, and with stages collapsed it moves to its
stage. A mark that is not protected follows its element; `meta.shown` names
the marks not shown (`marksNotShown`) and the elements shown only for a
protected mark (`forProtected`). `abstract` reads the graph's overlays and
the new option `marks`; `<ProcessMap/>` hands it its `overlays` prop (so a
mark of the prop on an activity of a collapsed stage now moves to the
stage instead of being dropped), `buildViews` the marks of its views. A mark
the rule is not given cannot be protected. `keep` also takes path ids, which
stay with both their ends.

Changed for comparisons: in a graph made by `diff`, an element's strength
is the larger of its relative strength on side b and on side a
(`a_<metric>`), each relative to its side's strongest element, for the
detail shares and for thresholds. Before, an element with side a's metrics
only had strength 1 and no threshold removed it. On the fixture
`diff(globalScene, vendorScene)`, thresholds of 100 % and 100 % kept 31
activities and 282 paths and now keep 1 activity and 2 paths (1 and 1
without `keepConnected`); the story "Diff map (vendor vs all)" (paths at
2 %) drew 42 activities and 658 paths and now draws 42 and 87.
