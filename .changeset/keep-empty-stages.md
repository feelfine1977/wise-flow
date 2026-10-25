---
"wise-flow": minor
---

WF-16 follow-up: `abstract()` dropped every stage group with no member left,
so `laneOptions.emptyLanes: "divider"` could not draw an empty stage of an
abstracted map. `AbstractOptions.keepEmptyStages` keeps the top-level stage
groups without a member, and the bands draw them as labelled dividers ("none
in this cohort"). The default is unchanged.
