import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TableAlternative, describeNode } from "../../src/react/index";
import { timedGraph } from "../support/activity-times";

afterEach(cleanup);
it("names supplied times and passages in the table and assistive description", () => {
  for (const locale of ["en", "de"] as const) {
    const { container, unmount } = render(<TableAlternative graph={timedGraph} locale={locale} />);
    const description = describeNode(timedGraph.nodes[0], [], locale);
    const headings = locale === "en" ? [
      "median time from previous event", "mean time from previous event", "median time to next event", "mean time to next event",
      "passages from previous", "passages to next", "median lag", "mean lag", "timed passages",
    ] : [
      "Median seit dem vorherigen Ereignis", "Mittlere Zeit seit dem vorherigen Ereignis", "Median bis zum nächsten Ereignis", "Mittlere Zeit bis zum nächsten Ereignis",
      "Übergänge vom vorherigen Ereignis", "Übergänge zum nächsten Ereignis", "Median-Wartezeit", "Mittlere Wartezeit", "Übergänge mit Zeitmessung",
    ];
    for (const heading of headings) expect(screen.getAllByRole("columnheader", { name: heading })).toHaveLength(1);
    const displayed = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(displayed.indexOf(headings[0])).toBeLessThan(displayed.indexOf(headings[2]));
    expect(displayed.indexOf(headings[1])).toBeLessThan(displayed.indexOf(headings[3]));
    for (const key of [...Object.keys(timedGraph.nodes[0].metrics!), ...Object.keys(timedGraph.edges[0].metrics!)].filter(k => k !== "cases")) {
      expect(container.textContent).not.toContain(key);
      expect(description).not.toContain(key);
    }
    expect(description).toContain(locale === "en"
      ? "median time from previous event 3.4 d (8 passages). mean time from previous event 4.0 d (8 passages). median time to next event 2 min (7 passages). mean time to next event 3 min (7 passages)."
      : "Median seit dem vorherigen Ereignis 3,4 d (8 Übergänge). Mittlere Zeit seit dem vorherigen Ereignis 4,0 d (8 Übergänge). Median bis zum nächsten Ereignis 2 min (7 Übergänge). Mittlere Zeit bis zum nächsten Ereignis 3 min (7 Übergänge).");
    expect(container.textContent).toContain("< 1 min");
    expect(container.textContent).toContain("0 min");
    expect(describeNode(timedGraph.nodes[3], [], locale)).toContain(locale === "en" ? "No stage duration" : "keine Phasendauer");
    unmount();
  }
});
