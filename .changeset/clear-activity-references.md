---
"wise-flow": minor
---

Keep activity reference numbers clear of neighbouring markers and cards at
small screen zooms. Displaced numbers have a line back to the card and paper
behind their glyphs. Placement stays fixed under panning; Canvas culling and
shown SVG/PNG figure bounds include displaced references and their links.
Ordinary figure numbering stays unchanged. Optional `from` and `box` on
`DrawOptions.numbers` replay the links and backing boxes.
`readableTokens.number` names marker padding, height and link weight as
fractions of the text floor.
