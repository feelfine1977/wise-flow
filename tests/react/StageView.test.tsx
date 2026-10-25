/**
 * One layout for Bands, Lanes, Boxes and none (WF-15): switching the stage
 * view never moves a card; boxes draw the stages around their members, bands
 * across the map, none draws no stage at all.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { buildScene, layout } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(cleanup);

describe("the stage view", () => {
  it("keeps every card's box in every view of one partitioned layout", async () => {
    const positions = await layout(smallP2P, { engine: "elk", stages: "partition" });
    const views = ["boxes", "bands", "lanes", "none"] as const;
    const scenes = views.map((stageView) => buildScene(smallP2P, positions, { stageView }));
    for (const s of scenes) expect(s.nodeMarks.map((m) => [m.id, m.box])).toEqual(scenes[0].nodeMarks.map((m) => [m.id, m.box]));
    expect(scenes.map((s) => [s.groupMarks.length > 0, s.bands.length > 0])).toEqual([[true, false], [true, true], [true, true], [false, false]]);
  });

  it("draws the map's cards at the same place whichever view the host switches to", async () => {
    const positions = await layout(smallP2P, { engine: "elk", stages: "partition" });
    const boxes = async (stageView: "boxes" | "bands" | "none") => {
      const { container, unmount } = render(<div style={{ width: 1600, height: 500 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" fitView={false} stageView={stageView} /></div>);
      await waitFor(() => expect(container.querySelector(".react-flow__node-activity")).not.toBeNull());
      const out = [...container.querySelectorAll<HTMLElement>(".react-flow__node-activity")].map((n) => [n.getAttribute("data-id"), n.style.transform]).sort();
      const groups = container.querySelectorAll('[data-wf-part="group"]').length;
      unmount();
      return { out, groups };
    };
    const [a, b, c] = [await boxes("boxes"), await boxes("bands"), await boxes("none")];
    expect(b.out).toEqual(a.out);
    expect(c.out).toEqual(a.out);
    expect([a.groups > 0, b.groups > 0, c.groups]).toEqual([true, true, 0]);
  });
});
