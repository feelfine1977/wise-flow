import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { metricName } from "../../src/index";
import { TableAlternative, describeNode } from "../../src/react/index";
import { timedGraph } from "../support/activity-times";

afterEach(cleanup);
it("names supplied times and passages in the table and assistive description", () => {
  for (const locale of ["en", "de"] as const) {
    const { container, unmount } = render(<TableAlternative graph={timedGraph} locale={locale} />);
    const description = describeNode(timedGraph.nodes[0], [], locale);
    for (const key of Object.keys(timedGraph.nodes[0].metrics!).filter(k => k !== "cases")) {
      expect(screen.getAllByRole("columnheader", { name: metricName(key, locale) })).toBeTruthy();
      expect(container.textContent).not.toContain(key);
      expect(description).not.toContain(key);
    }
    for (const key of ["medianPrevHours", "meanPrevHours", "medianNextHours", "meanNextHours"]) expect(description).toContain(metricName(key, locale));
    expect(description).toContain(locale === "en" ? "8 passages" : "8 Übergänge");
    expect(description).toContain(locale === "en" ? "7 passages" : "7 Übergänge");
    expect(container.textContent).toContain("< 1 min");
    expect(container.textContent).toContain("0 min");
    expect(describeNode(timedGraph.nodes[3], [], locale)).toContain(locale === "en" ? "No stage duration" : "keine Phasendauer");
    unmount();
  }
});
