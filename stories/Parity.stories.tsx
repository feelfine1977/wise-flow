import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../fixtures/p2p_stages";
import { liteFromStages } from "../src/bpmn/index";
import { type FlowGraph, type LaneMode, type Overlay, type Positions, abstract, constraintOverlays, layout, overlaysFor } from "../src/index";
import { ProcessMap } from "./maps";
import { catalogueGraph, examples, rawKinds } from "./Overlays.stories";

/**
 * The committed fixtures drawn by the interactive map at zoom 1, with the
 * scene it draws written beside it as JSON, so that the browser lane can draw
 * the same scene with the SVG export, the Canvas map and the PNG export and
 * compare what the four drew, element by element.
 */
const meta: Meta = {
  title: "Parity",
  parameters: { layout: "fullscreen" },
};
export default meta;

/** What the map draws: a graph with its overlays and lanes, laid out by Dagre. */
export interface ParityScene {
  graph: FlowGraph;
  overlays: Overlay[];
  lanes?: LaneMode;
  positions: Positions;
}

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const stages = abstract(globalScene, { collapse: "all" });

const scenes: Record<string, () => Omit<ParityScene, "positions">> = {
  small: () => ({
    graph: catalogueGraph,
    overlays: [...Object.values(examples).flatMap((e) => constraintOverlays(e.description, e.stats, { graph: catalogueGraph })), ...rawKinds],
  }),
  global: () => ({ graph: global, overlays: overlaysFor(constraintItems(), { graph: global }) }),
  stageBands: () => ({ graph: global, overlays: overlaysFor(constraintItems(), { graph: global }), lanes: "stages" }),
  stages: () => ({ graph: stages, overlays: overlaysFor(constraintItems(), { graph: stages }) }),
  roleLanes: () => ({ graph: liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes: "role" }), overlays: [], lanes: "roles" }),
};

function Parity({ name }: { name: string }) {
  const [scene, setScene] = useState<ParityScene>();
  useEffect(() => {
    let live = true;
    const given = scenes[name]();
    void layout(given.graph, { engine: "dagre" }).then((positions) => live && setScene({ ...given, positions }));
    return () => {
      live = false;
    };
  }, [name]);
  if (!scene) return null;
  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <script type="application/json" data-testid="wf-parity-scene">
        {JSON.stringify(scene)}
      </script>
      <ProcessMap
        graph={scene.graph}
        positions={scene.positions}
        overlays={scene.overlays}
        lanes={scene.lanes}
        renderer="svg"
        fitView={false}
        controls={false}
        legend={false}
        contextMenu={false}
        pathList={false}
      />
    </div>
  );
}

export const Small: StoryObj = { name: "small P2P with every overlay kind", render: () => <Parity name="small" /> };
export const Global: StoryObj = { name: "BPIC global", render: () => <Parity name="global" /> };
export const StageBands: StoryObj = { name: "BPIC global in stage bands", render: () => <Parity name="stageBands" /> };
export const Stages: StoryObj = { name: "BPIC stages", render: () => <Parity name="stages" /> };
export const RoleLanes: StoryObj = { name: "role lanes", render: () => <Parity name="roleLanes" /> };
