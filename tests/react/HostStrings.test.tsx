/**
 * The host's wording on the interactive map (WF-03) and the attribution it may
 * hide: `strings` reaches the legend strip, the detail panel and the paths'
 * descriptions; `hideAttribution` hides React Flow's credit, which shows by default.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessMap } from "../../src/react/index";
import { graph, positions } from "../support/terminals";

afterEach(cleanup);
const box = { width: 1600, height: 500 };

describe("the host's wording on the map", () => {
  it("words the legend strip, the detail panel and the terminal paths' descriptions", async () => {
    const strings = { "legend.measure": "Frequency · {unit}", "legend.shareOf": "share of {total} cases", "controls.title": "Display only", "terminal.describeStart": "{count} cases open here" };
    const { container } = render(<div style={box}><ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} strings={strings} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="legend"]')).not.toBeNull());
    expect(container.querySelector('[data-wf-part="legend"]')!.textContent).toContain("Frequency · cases · share of 1,000 cases");
    expect(container.querySelector('[data-wf-part="abstraction-panel"]')?.getAttribute("aria-label")).toBe("Display only");
    await waitFor(() => expect(container.querySelector('g.wf-edge[data-id="start->a"] title')?.textContent).toContain("800 cases open here"));
  });

  it("keeps React Flow's credit visible by default and hides it where the host asks", async () => {
    const shown = render(<div style={box}><ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} /></div>);
    await waitFor(() => expect(shown.container.querySelector(".react-flow__attribution")).not.toBeNull());
    cleanup();
    const hidden = render(<div style={box}><ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} hideAttribution /></div>);
    await waitFor(() => expect(hidden.container.querySelector("g.wf-edge")).not.toBeNull());
    expect(hidden.container.querySelector(".react-flow__attribution")).toBeNull();
  });
});
