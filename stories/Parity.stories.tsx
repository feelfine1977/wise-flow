import type { Meta, StoryObj } from "@storybook/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../fixtures/p2p_stages";
import { liteFromStages } from "../src/bpmn/index";
import { type FlowGraph, type LaneMode, type Overlay, type Positions, type Theme, abstract, constraintOverlays, defaultTheme, layout, overlaysFor } from "../src/index";
import { useFlowTheme } from "../src/react/index";
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

/** What the map draws: a graph with its overlays and lanes, laid out by Dagre, in a theme. */
export interface ParityScene {
  graph: FlowGraph;
  overlays: Overlay[];
  lanes?: LaneMode;
  theme?: Theme;
  positions: Positions;
}

/** CSS variables a host sets on the map's container; the map is given no theme, and the scene is written in the theme the container's variables resolve to. */
type HostVariables = Record<`--wf-${string}`, string>;

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });

/** One node of every kind: events, an activity, a gateway, a stage, a note and a re-added activity. */
const kinds: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    { id: "check", kind: "activity", label: "Check invoice", metrics: { cases: 1234 } },
    { id: "split", kind: "gateway", label: "Parallel split", tags: ["and", "split"] },
    { id: "pay", kind: "stage", label: "Payment", metrics: { members: 4, cases: 1500 } },
    { id: "note", kind: "note", label: "Ask the vendor twice" },
    { id: "readded", kind: "activity", label: "Re-added", tags: ["reconnected"], metrics: { cases: 12 } },
    { id: "end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    { id: "start->check", kind: "follows", source: "start", target: "check", metrics: { count: 1234 } },
    { id: "check->split", kind: "flow", source: "check", target: "split", metrics: { count: 12 } },
    { id: "split->pay", kind: "constraint", source: "split", target: "pay" },
    { id: "split->readded", kind: "follows", source: "split", target: "readded", tags: ["reconnected"], metrics: { count: 3 } },
    { id: "pay->end", kind: "follows", source: "pay", target: "end", metrics: { count: 1500 } },
    { id: "readded->note", kind: "follows", source: "readded", target: "note", metrics: { count: 3 } },
  ],
};

/** Another theme: activities and stages outlined 3 wide with corners of 10, node labels at 14 and counts at 11. */
const secondTheme: Theme = {
  ...defaultTheme,
  stroke: { ...defaultTheme.stroke, node: 3 },
  radius: { ...defaultTheme.radius, node: 10 },
  text: { ...defaultTheme.text, nodeLabel: { size: 14 }, nodeCount: { size: 11 } },
};
const stages = abstract(globalScene, { collapse: "all" });

/** Only the paper, the ink, the focus colour and the font, in three CSS syntaxes. */
const hostVariables: HostVariables = { "--wf-paper": "#fdf6e3", "--wf-ink": "darkslategray", "--wf-focus": "rebeccapurple", "--wf-font": "Georgia, serif" };

const scenes: Record<string, () => Omit<ParityScene, "positions"> & { variables?: HostVariables }> = {
  small: () => ({
    graph: catalogueGraph,
    overlays: [...Object.values(examples).flatMap((e) => constraintOverlays(e.description, e.stats, { graph: catalogueGraph })), ...rawKinds],
  }),
  global: () => ({ graph: global, overlays: overlaysFor(constraintItems(), { graph: global }) }),
  stageBands: () => ({ graph: global, overlays: overlaysFor(constraintItems(), { graph: global }), lanes: "stages" }),
  stages: () => ({ graph: stages, overlays: overlaysFor(constraintItems(), { graph: stages }) }),
  roleLanes: () => ({ graph: liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes: "role" }), overlays: [], lanes: "roles" }),
  kinds: () => ({ graph: kinds, overlays: [] }),
  secondTheme: () => ({ ...scenes.small(), theme: secondTheme }),
  hostVariables: () => ({ ...scenes.small(), variables: hostVariables }),
};

function Parity({ name }: { name: string }) {
  const [scene, setScene] = useState<ParityScene & { variables?: HostVariables }>();
  const container = useRef<HTMLDivElement>(null);
  const look = useFlowTheme(container);
  useEffect(() => {
    let live = true;
    const given = scenes[name]();
    void layout(given.graph, { engine: "dagre" }).then((positions) => live && setScene({ ...given, positions }));
    return () => {
      live = false;
    };
  }, [name]);
  const variables = useMemo(() => scenes[name]().variables, [name]);
  // The scene is written once the container's variables are read.
  const written = scene && (variables ? look.theme !== defaultTheme && { ...scene, variables: undefined, theme: look.theme } : scene);
  return (
    <div ref={container} style={{ height: "100vh", width: "100vw", ...(variables as CSSProperties) }}>
      {written ? (
        <script type="application/json" data-testid="wf-parity-scene">
          {JSON.stringify(written)}
        </script>
      ) : null}
      {scene ? (
        <ProcessMap
          graph={scene.graph}
          positions={scene.positions}
          overlays={scene.overlays}
          lanes={scene.lanes}
          theme={scene.theme}
          renderer="svg"
          fitView={false}
          controls={false}
          legend={false}
          contextMenu={false}
          pathList={false}
        />
      ) : null}
    </div>
  );
}

export const Small: StoryObj = { name: "small P2P with every overlay kind", render: () => <Parity name="small" /> };
export const Global: StoryObj = { name: "BPIC global", render: () => <Parity name="global" /> };
export const StageBands: StoryObj = { name: "BPIC global in stage bands", render: () => <Parity name="stageBands" /> };
export const Stages: StoryObj = { name: "BPIC stages", render: () => <Parity name="stages" /> };
export const RoleLanes: StoryObj = { name: "role lanes", render: () => <Parity name="roleLanes" /> };
export const ElementKinds: StoryObj = { name: "element kinds", render: () => <Parity name="kinds" /> };
export const SecondTheme: StoryObj = { name: "small P2P in a second theme", render: () => <Parity name="secondTheme" /> };
export const HostVariables: StoryObj = { name: "small P2P under a host's CSS variables", render: () => <Parity name="hostVariables" /> };
