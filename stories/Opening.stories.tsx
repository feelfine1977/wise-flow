import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { globalScene, vendorScene } from "../fixtures/bpic2019";
import { type AbstractOptions, type Positions, abstract, layout } from "../src/index";
import { ProcessMap } from "./maps";

const DEFAULT: AbstractOptions = { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true };
const HALF: AbstractOptions = { minNodeShare: 0.5, minEdgeShare: 0.5, keepConnected: true };
interface Args { scene: "whole-default" | "vendor-half" | "whole-half"; renderer: "svg" | "canvas"; opening: "readable" | "fit" }

const meta: Meta<Args> = {
  title: "Opening",
  parameters: { layout: "fullscreen" },
  args: { scene: "whole-default", renderer: "svg", opening: "readable" },
  argTypes: {
    scene: { control: "radio", options: ["whole-default", "vendor-half", "whole-half"] },
    renderer: { control: "radio", options: ["svg", "canvas"] },
    opening: { control: "radio", options: ["readable", "fit"] },
  },
};
export default meta;

/**
 * The committed logs at the opening settings, in a full-size area. Layouts
 * and the path rule are fixed, independent of the machine; the browser tests
 * use 1,400 × 900. The host button replaces the graph object to open it again.
 */
function OpeningMap({ scene, renderer, opening }: Args) {
  const original = scene === "vendor-half" ? vendorScene : globalScene;
  const options = scene === "whole-default" ? DEFAULT : HALF;
  const [graph, setGraph] = useState(original);
  const [abstraction, setAbstraction] = useState(options);
  const [positions, setPositions] = useState<Positions>();
  useEffect(() => {
    let live = true;
    setGraph(original);
    setAbstraction(options);
    setPositions(undefined);
    void layout(abstract(original, options)).then((p) => { if (live) setPositions(p); });
    return () => { live = false; };
  }, [original, options]);
  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {positions ? <>
        <ProcessMap graph={graph} abstraction={abstraction} onAbstractionChange={setAbstraction} positions={positions} renderer={renderer} opening={opening} minPathPx={0.5} />
        <script type="application/json" data-testid="opening-scene">{JSON.stringify({ graph: abstract(graph, abstraction), positions })}</script>
      </> : null}
      <button style={{ position: "absolute", top: 12, left: "50%" }} onClick={() => setGraph({ ...original })}>Replace the graph</button>
    </div>
  );
}

export const WholeLog: StoryObj<Args> = { name: "Whole log at default", render: (args) => <OpeningMap {...args} /> };
export const Vendor: StoryObj<Args> = { name: "One vendor at 50 %", args: { scene: "vendor-half" }, render: (args) => <OpeningMap {...args} /> };
export const Half: StoryObj<Args> = { name: "Whole log at 50 %", args: { scene: "whole-half" }, render: (args) => <OpeningMap {...args} /> };
