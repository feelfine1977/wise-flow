---
"wise-flow": patch
---

`exportBpmn` writes XML 1.0 that any conforming parser reads. Characters XML
1.0 does not allow (control characters other than tab, line feed and carriage
return, U+FFFE, U+FFFF, unpaired surrogates) are dropped from labels, ids and
every other text, and `warnings` names each label and id that lost one
(`label of <id>: characters XML 1.0 does not allow are dropped`). Tab and
carriage return are written as `&#9;` and `&#13;`, so that other parsers keep
them, where they read a space or a line feed before; a carriage return after
a line feed is no longer lost. `importBpmn` reads them back unchanged.
