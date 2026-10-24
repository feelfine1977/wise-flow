---
"wise-flow": minor
---

A card's name is shortened after whole words in every renderer and at every
readable level: "Vendor creates…", never "Vendor cr…" (`truncateText` and the
new `TruncateOptions` with `words: true`; a single word wider than its line is
still cut between characters). Names shortened alike are told apart by the
word where they differ ("…invoice", "…debit…"), by characters only where
words leave them alike, and names that are the same stay the same. The
readable ladder reads the theme's `readable.nameChars`. Chips, legend rows and
figure texts keep the character cut.
