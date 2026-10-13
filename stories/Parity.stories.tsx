import type { Meta, StoryObj } from "@storybook/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../fixtures/p2p_stages";
import { liteFromStages } from "../src/bpmn/index";
import { textMeasures } from "../fixtures/text-measures";
import { type ActivityLabelOptions, type FlowGraph, type LaneMode, type Locale, type Measure, type Overlay, type Positions, type Theme, abstract, activityNodeSize, constraintOverlays, defaultTheme, layout, overlaysFor } from "../src/index";
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

/**
 * What the map draws: a graph with its overlays and lanes, laid out by Dagre,
 * in a theme and a measure of the map (`mapMeasure`), with activity names
 * written out in a locale, its texts measured by a measure of
 * `fixtures/text-measures.ts` named here (the estimate without one, which the
 * browser lane's exports use too, rather than the map's default).
 */
export interface ParityScene {
  graph: FlowGraph;
  overlays: Overlay[];
  lanes?: LaneMode;
  theme?: Theme;
  activityLabels?: ActivityLabelOptions;
  locale?: Locale;
  measure?: string;
  mapMeasure?: Measure;
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

/** Another theme: cards outlined 3 wide with corners of 10, names at 15 on lines of 18, cases at 13, the cue only as the foot. */
const secondTheme: Theme = {
  ...defaultTheme,
  stroke: { ...defaultTheme.stroke, node: 3, stage: 3 },
  radius: { ...defaultTheme.radius, node: 10 },
  text: { ...defaultTheme.text, activityName: { size: 15, weight: 500, lineHeight: 18 }, activityNumber: { size: 13, weight: 600, lineHeight: 16 } },
  frequencyCue: "bottom",
};
const stages = abstract(globalScene, { collapse: "all" });

/**
 * The element kinds with the activity tagged `manual`, the log's cases (so
 * that the card has its frequency cue) and a badge, in a theme with a rule by
 * kind, one by tag and two by a state the scene resolves.
 */
const ruled: FlowGraph = { ...kinds, nodes: kinds.nodes.map((n) => (n.id === "check" ? { ...n, tags: ["manual"] } : n)), meta: { cases: 2000 } };
const rulesTheme: Theme = {
  ...defaultTheme,
  rules: [
    { match: { part: "node", kind: "gateway" }, set: { fill: "#fff3c4", stroke: "#8a6d00" } },
    { match: { part: "node", tag: "manual" }, set: { strokeWeight: "strong", radius: "m", text: { name: { weight: 600, color: "#1d4ed8" } }, cue: "bottom" } },
    { match: { part: "edge", state: "reconnected" }, set: { stroke: "#b42318", opacity: 0.5 } },
    { match: { part: "node", state: "reconnected" }, set: { fill: "#f3f4f6", opacity: 0.6 } },
  ],
};

/** Rules of the interactive states: a selected activity's outline, fill and name; dimmed paths fainter than by default. */
const stateRules: Theme = {
  ...defaultTheme,
  rules: [
    { match: { part: "node", state: "selected" }, set: { stroke: "#c2410c", fill: "#fff7ed", text: { name: { color: "#7c2d12" } } } },
    { match: { part: "edge", state: "dimmed" }, set: { opacity: 0.2 } },
  ],
};

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
  // The model's activities carry the log's metrics, so its cards show their share of the log's cases.
  roleLanes: () => ({ graph: { ...liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes: "role" }), meta: globalScene.meta }, overlays: [], lanes: "roles" }),
  kinds: () => ({ graph: kinds, overlays: [] }),
  secondTheme: () => ({ ...scenes.small(), theme: secondTheme }),
  rules: () => ({ graph: ruled, overlays: [{ kind: "badge", target: "check", payload: { glyph: "≥1", value: 0.23 } }], theme: rulesTheme }),
  hostVariables: () => ({ ...scenes.small(), variables: hostVariables }),
  names: () => ({ graph: global, overlays: overlaysFor(constraintItems(), { graph: global }), activityLabels: { mode: "names", references: {} } }),
  frequency: () => ({ ...scenes.small(), mapMeasure: "frequency" }),
  shortfall: () => ({ ...scenes.small(), mapMeasure: "shortfall" }),
  performance: () => ({ ...scenes.global(), mapMeasure: "performance" }),
  namesGerman: () => ({ graph: global, overlays: overlaysFor(constraintItems(), { graph: global }), activityLabels: { mode: "names", references: {} }, locale: "de", measure: "wide" }),
};

function Parity({ name }: { name: string }) {
  const [scene, setScene] = useState<ParityScene & { variables?: HostVariables }>();
  const container = useRef<HTMLDivElement>(null);
  const look = useFlowTheme(container);
  useEffect(() => {
    let live = true;
    const given = scenes[name]();
    const labels = given.activityLabels;
    const measure = textMeasures[given.measure ?? "estimate"];
    void layout(given.graph, { engine: "dagre", nodeSize: labels && ((node) => activityNodeSize(node, labels, measure)) }).then((positions) => live && setScene({ ...given, positions }));
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
          activityLabels={scene.activityLabels}
          locale={scene.locale}
          measure={scene.mapMeasure}
          textMeasure={textMeasures[scene.measure ?? "estimate"]}
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

/** The interactive map and the Canvas map side by side under the host's variables, with no theme, each with the activity selected. */
function LiveMaps() {
  const [positions, setPositions] = useState<Positions>();
  useEffect(() => void layout(kinds, { engine: "dagre" }).then(setPositions), []);
  const selection = { nodes: ["check"], edges: [], groups: [] };
  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", ...(hostVariables as CSSProperties) }}>
      {positions
        ? (["svg", "canvas"] as const).map((renderer) => (
            <div key={renderer} style={{ flex: "1 1 0", minWidth: 0 }}>
              <ProcessMap graph={kinds} positions={positions} renderer={renderer} selection={selection} fitView={false} controls={false} legend={false} contextMenu={false} pathList={false} />
            </div>
          ))
        : null}
    </div>
  );
}
export const HostVariablesLive: StoryObj = { name: "element kinds under a host's CSS variables, live in the DOM and on the Canvas", render: () => <LiveMaps /> };
export const Rules: StoryObj = { name: "element kinds restyled by rules by kind, tag and state", render: () => <Parity name="rules" /> };

/** The interactive map and the Canvas map side by side in a theme with rules of the interactive states, the activity selected and the paths away from it dimmed. */
function StateMaps() {
  const [positions, setPositions] = useState<Positions>();
  useEffect(() => void layout(kinds, { engine: "dagre" }).then(setPositions), []);
  const selection = { nodes: ["check"], edges: [], groups: [] };
  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      {positions
        ? (["svg", "canvas"] as const).map((renderer) => (
            <div key={renderer} style={{ flex: "1 1 0", minWidth: 0 }}>
              <ProcessMap graph={kinds} positions={positions} renderer={renderer} theme={stateRules} selection={selection} fitView={false} controls={false} legend={false} contextMenu={false} pathList={false} />
            </div>
          ))
        : null}
    </div>
  );
}
export const StateRules: StoryObj = { name: "element kinds with rules of the interactive states, live in the DOM and on the Canvas", render: () => <StateMaps /> };
export const Names: StoryObj = { name: "BPIC global with activity names", render: () => <Parity name="names" /> };
export const Frequency: StoryObj = { name: "small P2P in the frequency measure", render: () => <Parity name="frequency" /> };
export const Shortfall: StoryObj = { name: "small P2P in the shortfall measure", render: () => <Parity name="shortfall" /> };
export const Performance: StoryObj = { name: "BPIC global in the performance measure", render: () => <Parity name="performance" /> };
export const NamesGerman: StoryObj = { name: "BPIC global with activity names in German, measured wide", render: () => <Parity name="namesGerman" /> };
