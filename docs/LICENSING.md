# Licensing

`@wise/flow` is licensed under **PolyForm Noncommercial 1.0.0**, as declared in
`package.json` and the root [LICENSE](../LICENSE). This cleanup does not relicense
Flow. Public distribution is not an unrestricted commercial-use grant. Refer
to the licence's permitted purposes, organisation provisions and notice terms;
commercial uses outside those grants need separate permission from the copyright
holder. No separate commercial licence is provided by this repository.

Dependencies keep their own licences. The packed package includes the original
licences for copied distribution assets under `dist/licenses/`, plus
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

| Dependency | Licence in the installed dependency | Distribution note |
| --- | --- | --- |
| bpmn-js | bpmn.io licence | Copyright Camunda Services GmbH; preserve the bpmn.io watermark code, link and full visibility, with no overlapping elements |
| diagram-js, bpmn-moddle | MIT | Separate packages; the bpmn-js watermark condition must not be attributed to all BPMN dependencies |
| @xyflow/react, @xyflow/system | MIT | React Flow base CSS is copied without modification |
| elkjs | EPL-2.0 | Worker copied without modification; licence and source location accompany the package |
| @dagrejs/dagre, @dagrejs/graphlib | MIT | Installed runtime dependencies |
| d3-scale | ISC | See installed dependency and transitive package notices |
| rbush, quickselect | MIT | Installed runtime dependencies |

The bpmn-js asset directory contains the BPMN CSS and font files copied by the
build. Applications must retain the bpmn.io watermark in view and model modes,
including resized panels and full-window layouts. Importing Flow's CSS is not
permission to hide, cover or remove attribution.

The ELK worker's corresponding source is available in the upstream
[elkjs v0.9.3 source tree](https://github.com/kieler/elkjs/tree/v0.9.3).
The package build copies its EPL-2.0 licence; future dependency updates must
update these notices and preserve source availability.

The development fixture `fixtures/bpic2019_p2p.json` is derived from the BPI
Challenge 2019 event log (4TU.ResearchData, CC-BY-4.0). The original CSV is not
included. The npm artifact excludes fixtures, screenshots and development tests.
