import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useEffect, useMemo, useState } from "react";
import { constraintItems, globalScene, vendorScene } from "../fixtures/bpic2019";
import { type AbstractOptions, diff, diffStyle, overlaysFor, viewTokens } from "../src/index";
import { type Selection, useReactFlow, useStore } from "../src/react/index";
import { ProcessMap, WHOLE_LOG_DETAIL } from "./maps";

const meta: Meta<typeof ProcessMap> = {
  title: "Process map",
  component: ProcessMap,
  parameters: { layout: "fullscreen" },
  args: {
    locale: "en",
    controls: true,
    legend: true,
    minimap: false,
  },
  argTypes: {
    locale: { control: "radio", options: ["en", "de"] },
  },
};
export default meta;

type Story = StoryObj<typeof ProcessMap>;

const layout = { elkWorkerUrl };

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ height: "100vh", width: "100vw" }}>{children}</div>;
}

/**
 * The BPI Challenge 2019 purchase-to-pay log (251,734 purchase order items,
 * 1.6 M events) as a directly-follows map with stage groups, constraint
 * overlays from the fixture statistics, and the abstraction controls.
 */
export const Map: Story = {
  name: "P2P map",
  render: (args) => <P2PMap {...args} />,
};

/** The P2P map with its overlays and detail, in the measure its arguments name. */
function P2PMap(args: Story["args"] & {}) {
  const [abstraction, setAbstraction] = useState<AbstractOptions>(WHOLE_LOG_DETAIL);
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
  const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene, locale: args.locale }), [args.locale]);
  return (
    <Frame>
      <ProcessMap
        {...args}
        graph={globalScene}
        overlays={overlays}
        abstraction={abstraction}
        onAbstractionChange={setAbstraction}
        selection={selection}
        onSelect={setSelection}
        layout={layout}
      />
    </Frame>
  );
}

/**
 * The P2P map in the shortfall measure: paths coloured by their share short in
 * three classes (up to 10 %, 10 to 30 %, over 30 %), their labels and the
 * activities' number lines led by it, the cases short in the accent of each
 * activity's frequency cue.
 */
export const Shortfall: Story = {
  name: "P2P map, shortfall",
  args: { measure: "shortfall" },
  render: (args) => <P2PMap {...args} />,
};

/**
 * The P2P map in the performance measure: paths coloured by their median lag
 * from 0 to the 95th percentile of the paths shown, their labels led by it, and
 * the activities' number lines by the median time to the next activity the
 * log gives.
 */
export const Performance: Story = {
  name: "P2P map, performance",
  args: { measure: "performance" },
  render: (args) => <P2PMap {...args} />,
};

/** The same map without overlays, on the Dagre fallback engine. */
export const DagreFallback: Story = {
  name: "Dagre fallback",
  render: (args) => (
    <Frame>
      <ProcessMap {...args} graph={globalScene} defaultAbstraction={WHOLE_LOG_DETAIL} layout={{ engine: "dagre" }} />
    </Frame>
  ),
};

/** Every stage, and the 15 of 29 paths between stages by frequency that paths of 2 % showed before. */
const STAGES_DETAIL: AbstractOptions = { collapse: "all", activityDetail: 1, pathDetail: 15 / 29 };

/** Stages collapsed into one node each (semantic zoom). */
export const Stages: Story = {
  name: "Stage view",
  render: (args) => (
    <Frame>
      <ProcessMap {...args} graph={globalScene} defaultAbstraction={STAGES_DETAIL} layout={layout} />
    </Frame>
  ),
};

/**
 * Diff map: vendor 0128 against the whole log. Width follows the vendor's
 * transitions; colour shows the delta of the expectation shortfall share
 * (purple: lower than the whole log, orange: higher).
 */
/** Every activity, and the 41 of 677 paths by frequency that paths of 2 % showed before, either side's strength the larger. */
const DIFF_DETAIL: AbstractOptions = { activityDetail: 1, pathDetail: 41 / 677 };

export const Diff: Story = {
  name: "Diff map (vendor vs all)",
  render: (args) => {
    const graph = useMemo(() => diff(globalScene, vendorScene), []);
    return (
      <Frame>
        <ProcessMap {...args} graph={graph} style={diffStyle} defaultAbstraction={DIFF_DETAIL} layout={layout} />
      </Frame>
    );
  },
};

/** German locale. */
export const German: Story = {
  name: "Locale de",
  args: { locale: "de" },
  render: (args) => {
    const overlays = useMemo(() => overlaysFor(constraintItems(), { graph: globalScene, locale: "de" }), []);
    return (
      <Frame>
        <ProcessMap {...args} graph={globalScene} overlays={overlays} defaultAbstraction={WHOLE_LOG_DETAIL} layout={layout} />
      </Frame>
    );
  },
};

/**
 * Sets the view of the map it is drawn in once React Flow can move it, and
 * again when its nodes are replaced (the layout arriving): the story's fixed
 * zoom, its top left corner at (20, 20). A zoom by the person stays.
 */
function FixedView({ zoom }: { zoom: number }) {
  const rf = useReactFlow();
  const nodes = useStore((s) => s.nodes);
  const movable = useStore((s) => s.panZoom !== null);
  useEffect(() => {
    if (movable && nodes.length) void rf.setViewport({ x: 20, y: 20, zoom });
  }, [nodes, movable, rf, zoom]);
  return null;
}

/**
 * Every activity and every path of the P2P log (677 paths) at the fixed zoom
 * 0.1, with the default rule: a path is drawn while its line is at least half
 * a pixel wide on the screen, and the paths that keep each activity between
 * the start and the end are always drawn, 86 lines and the 21 loops. The note
 * and the detail panel say how many of how many; zooming in brings paths
 * back in steps, all of them from 0.5.
 */
export const PathsAtASmallZoom: Story = {
  name: "Paths at a small zoom",
  render: (args) => (
    <Frame>
      <ProcessMap {...args} graph={globalScene} defaultAbstraction={{ activityDetail: 1, pathDetail: 1 }} layout={layout} fitView={false} minPathPx={viewTokens.pathPx}>
        <FixedView zoom={0.1} />
      </ProcessMap>
    </Frame>
  ),
};
