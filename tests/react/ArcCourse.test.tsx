import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type Positions, abstract, buildScene, createPositions, overlaysFor } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import p2pMap from "../core/p2p-map-positions.json";

afterEach(cleanup);

it("draws the arcs of the P2P story on the courses and with the labels of the scene", async () => {
  // The story's abstraction and overlays on the committed layout; every mark from zoom 0.
  const abstraction = { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true };
  const positions = createPositions(p2pMap as Pick<Positions, "nodes" | "groups" | "edges">, "elk", "RIGHT");
  const overlays = overlaysFor(constraintItems("global"), { graph: globalScene, locale: "en" });
  const lod = { badges: 0, chips: 0, hatch: 0, arcs: 0, selfLoops: 0 };
  const { container } = render(
    <div style={{ width: 1400, height: 900 }}>
      <ProcessMap graph={globalScene} positions={positions} overlays={overlays} defaultAbstraction={abstraction} lod={lod} controls={false} legend={false} fitView={false} />
    </div>,
  );
  const expected = buildScene(abstract(globalScene, abstraction), positions, { overlays, lod }).marks.filter((m) => m.kind === "arc");
  expect(expected).toHaveLength(12);
  await waitFor(() => expect(container.querySelectorAll(".react-flow__edgelabel-renderer [data-overlay-id^='arc:']")).toHaveLength(12));
  const drawn = [...container.querySelectorAll<SVGGElement>(".react-flow__edgelabel-renderer [data-overlay-id^='arc:']")].map((g) => {
    const text = g.querySelector("text")!;
    return [g.dataset.overlayId, g.querySelector("path")!.getAttribute("d"), Number(text.getAttribute("x")), Number(text.getAttribute("y"))];
  });
  expect(drawn).toEqual(expected.map((m) => [m.id, m.path, Number(m.texts[0].x.toFixed(2)), Number(m.texts[0].y.toFixed(2))]));
});
