---
"@wise/flow": patch
---

A collapsed stage or a merged edge whose members have no weight (no `cases`,
`events` or `count` above zero) averages a metric over the members that carry
it. It divided by all members, so a value carried by one of two members was
halved: a stage of two activities without cases, one of them with
`medianNextHours` 10, showed 5 instead of 10.
