---
"wise-flow": patch
---

WF-16 follow-up: a band's header for a stage of one activity reads "1 of 1
activity" (DE "1 von 1 Aktivität"), not "1 of 1 activities"
(`lane.countOfOne`).

An empty stage kept by `keepEmptyStages` whose activities the detail left out
reads "2 activities not shown at this detail" (DE "2 Aktivitäten bei dieser
Detailstufe nicht gezeigt"; `lane.hiddenByDetail`, `lane.hiddenByDetailOne`),
from the new group metric `hiddenActivities`; "none in this cohort" is kept
for a stage with no activity in the model.

Relative to 0.6.0-rc.0 the terminal statement keeps its share with its sign:
"(100 %)" is written with a no-break space (U+00A0), and lines wrap only at
breaking spaces, so the statement under Start or End no longer splits into
"… (100" / "%) at …" (which a reader of the lines' joined text saw as
"(100%)"). The share's format itself is unchanged.
