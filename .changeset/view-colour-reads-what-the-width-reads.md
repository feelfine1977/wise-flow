---
"@wise/flow": patch
---

`resolveViews` and `buildViews` colour paths by what their width reads:
where the style names `cases` and no path of any view gives cases but one
gives a count, the shared colour domain is that of the counts
(`"edgeColor:count"`), as it is for the width. Before, the colour kept
`cases` and the domain `[0, 1]`, so two paths of 5 and 500 transitions got
the same colour.
