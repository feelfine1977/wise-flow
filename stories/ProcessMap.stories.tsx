import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useMemo, useState } from "react";
import { constraintItems, globalScene, vendorScene } from "../fixtures/bpic2019";
import { type AbstractOptions, diff, diffStyle, overlaysFor } from "../src/index";
import { ProcessMap, type Selection } from "../src/react/index";

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
  render: (args) => {
    const [abstraction, setAbstraction] = useState<AbstractOptions>({ minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true });
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
  },
};

/** The same map without overlays, on the Dagre fallback engine. */
export const DagreFallback: Story = {
  name: "Dagre fallback",
  render: (args) => (
    <Frame>
      <ProcessMap {...args} graph={globalScene} defaultAbstraction={{ minNodeShare: 0.01, minEdgeShare: 0.03 }} layout={{ engine: "dagre" }} />
    </Frame>
  ),
};

/** Stages collapsed into one node each (semantic zoom). */
export const Stages: Story = {
  name: "Stage view",
  render: (args) => (
    <Frame>
      <ProcessMap {...args} graph={globalScene} defaultAbstraction={{ collapse: "all", minEdgeShare: 0.02 }} layout={layout} />
    </Frame>
  ),
};

/**
 * Diff map: vendor 0128 against the whole log. Width follows the vendor's
 * transitions; colour shows the delta of the expectation shortfall share
 * (purple: lower than the whole log, orange: higher).
 */
export const Diff: Story = {
  name: "Diff map (vendor vs all)",
  render: (args) => {
    const graph = useMemo(() => diff(globalScene, vendorScene), []);
    return (
      <Frame>
        <ProcessMap {...args} graph={graph} style={diffStyle} defaultAbstraction={{ minEdgeShare: 0.02 }} layout={layout} />
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
        <ProcessMap {...args} graph={globalScene} overlays={overlays} defaultAbstraction={{ minNodeShare: 0.01, minEdgeShare: 0.03 }} layout={layout} />
      </Frame>
    );
  },
};
