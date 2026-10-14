import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { globalScene } from "../fixtures/bpic2019";
import { type Positions, type ShownEdges, abstract, estimateTextWidth, layout } from "../src/index";
import { prepareScene } from "../src/canvas/index";
import { type CanvasMapHandle, useReactFlow, useStore } from "../src/react/index";
import { flowLoop, flowLoopPositions } from "../tests/support/flow-loop";
import { CanvasMap, ProcessMap } from "./maps";

interface Args { renderer: "svg" | "canvas"; zoom: number; model: boolean; half: boolean }
const meta: Meta<Args> = {
  title: "Screen numbers", parameters: { layout: "fullscreen" },
  args: { renderer: "svg", zoom: 0.05, model: false, half: false },
  argTypes: { renderer: { control: "radio", options: ["svg", "canvas"] }, zoom: { control: "radio", options: [0.05, 0.1, 1] } },
};
export default meta;

function Fixed({ zoom }: { zoom: number }) {
  const rf = useReactFlow();
  const movable = useStore((s) => s.panZoom !== null);
  useEffect(() => { if (movable) void rf.setViewport({ x: 20, y: 100, zoom }); }, [movable, rf, zoom]);
  return null;
}

/** Fixed camera and path rule; a whole log's numbered fallback and a model's selected loop. */
function Numbered({ renderer, zoom, model, half }: Args) {
  const graph = useMemo(() => model ? flowLoop : abstract(globalScene, half ? { minNodeShare: 0.5, minEdgeShare: 0.5, keepConnected: true } : { activityDetail: 1, pathDetail: 1 }), [model, half]);
  const [positions, setPositions] = useState<Positions>();
  useEffect(() => {
    let live = true;
    void (model ? Promise.resolve(flowLoopPositions) : layout(graph, { engine: "elk" })).then((p) => { if (live) setPositions(p); });
    return () => { live = false; };
  }, [graph, model]);
  const scene = useMemo(() => positions ? prepareScene(graph, positions, { textMeasure: estimateTextWidth }) : undefined, [graph, positions]);
  const handle = useRef<CanvasMapHandle>(null);
  const [shown, setShown] = useState<ShownEdges>();
  useEffect(() => { if (renderer === "canvas" && scene) handle.current?.renderer()?.setViewport({ x: 20, y: 100, zoom }); }, [renderer, scene, zoom]);
  const selection = { nodes: [], edges: model ? ["aa"] : [], groups: [] };
  return <div style={{ height: "100vh", width: "100vw" }}>
    {scene && positions ? <>
      <script type="application/json" data-testid="numbered-scene">{JSON.stringify({ graph, positions, zoom, shown })}</script>
      {renderer === "svg" ?
        <ProcessMap graph={graph} positions={positions} selection={selection} onEdgesShown={setShown} fitView={false} controls={false} legend={false} minPathPx={0.5} textMeasure={estimateTextWidth}><Fixed zoom={zoom} /></ProcessMap> :
        <CanvasMap ref={handle} scene={scene} state={{ selection }} onEdgesShown={setShown} fitView={false} minPathPx={0.5} />}
    </> : null}
  </div>;
}
export const WholeLog: StoryObj<Args> = { render: (args) => <Numbered {...args} /> };
export const ModelLoop: StoryObj<Args> = { args: { model: true }, render: (args) => <Numbered {...args} /> };

export const Half: StoryObj<Args> = { args: { half: true }, render: (args) => <Numbered {...args} /> };
