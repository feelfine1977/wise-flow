---
"@wise/flow": minor
---

Ids named like a member of `Object.prototype` (`__proto__`, `constructor`,
`toString`, `hasOwnProperty`, `valueOf`, …) are reserved. Positions and many
records of the library are plain objects keyed by id and cannot hold them.

- `validateGraph` reports such an id of a node, an edge or a group as an
  error, `reserved id`; it passed them before.
- The exports refuse a graph with one: `toSVG`, `toPNGCanvas` and
  `toPNGDataUrl` throw, and `toPNG` and `exportBpmn` reject, with the new
  `InvalidGraphError` (named so, its `issues` the validation's errors, its
  message "reserved id: __proto__"). Before, `toSVG` threw a `TypeError` on a
  node or group named so, every export on an edge named so, and the BPMN
  round trip lost such a node.

A host whose backend names an element so must rename it.
