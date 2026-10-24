---
"wise-flow": minor
---

A theme's `rules` restyle elements by part, kind, tag and state, and reach
every renderer: an ordered list of `{ match, set }` (`ThemeRule`), where
`match` names a `part` (`node`, `edge`, `group`, `mark`) and optionally its
`kind`, a `tag` on the element (nodes and paths) and a `state`, and `set` is
a closed set of properties: `fill`, `fillOpacity`, `stroke`, `strokeWeight`
(`thin`, `strong`), `dash` (`solid`, `unobserved`), `radius` (`s`, `m`,
`full`), `opacity` (clamped to 0.2 to 1), `text` (size, weight and colour of
a card's `name`, `count` and `share` and of every other `label`) and `cue`
(the place of a card's frequency cue). The type has no field for a shape, a
pattern twin, an arrowhead, a shadow, a gradient or geometry. An element is
drawn in its kind's default, then with the rules without a state in their
order, then with the rules of the states it is in. The states `outOfScope`
and `reconnected` resolve when the scene is built, so the marks carry the
result and the SVG and PNG exports draw it; `selected`, `focused`, `hovered`
and `dimmed` resolve through `stateStyle`, which the DOM map and the Canvas
map both draw a state with. A colour is a literal or a colour role of the
theme, drawn in the scene's scheme. Neither preset has a rule, and a theme
without rules draws exactly as before.

`checkTheme` reports every entry of a rule that is unknown or out of range as
a deviation of the new kind `rule` (subject `rules[1].set.strokeWeight`);
such a rule changes nothing, and an opacity outside 0.2 to 1 is clamped and
reported.

New in `wise-flow`: the types `ThemeRule`, `RuleMatch`, `RuleSet`,
`RuleText`, `RuleTextRole`, `RuleState`, `RulePart`, `InteractiveState` and
`StateStyle`; the functions `stateStyle`, `markInState` and `ruleTextRole`;
`designTokens.rule` (the stroke weights, radii, opacity range, largest text
size and weights a rule draws at); an optional `opacity` on `NodeMark`,
`EdgeMark`, `GroupMark` and `OverlayMark`, which the SVG export writes on the
element's group; the optional `state` of `ActivityNodeData`, `GroupNodeData`
and `FollowsEdgeData` (`wise-flow/react`).

Changed types: `Theme.rules` is `readonly ThemeRule[]` (was `readonly
never[]`); `MarkPaint` adds literal colours (`` `#${string}` ``), which a
renderer draws as they are: code that resolves a `MarkPaint` by role must
pass a literal through; `ThemeDeviation.kind` adds `"rule"`. With rules,
`markedThemeKey` holds every colour of the scheme.

In the DOM map a path's label carries its size and paint as the custom
properties `--wf-text-size`, `--wf-text-weight` and `--wf-text-paint`, which
the stylesheet reads before the path label's role; its computed style is
unchanged. The stylesheet draws a state's outline from `--wf-state-outline`
where a rule of the state sets one, and an element's opacity from
`--wf-node-opacity`, `--wf-edge-opacity` and `--wf-group-opacity`.
