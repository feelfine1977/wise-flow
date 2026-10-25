import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useState } from "react";
import { globalScene } from "../fixtures/bpic2019";
import type { AbstractOptions } from "../src/index";
import type { Selection } from "../src/react/index";
import { graph as terminals, positions as terminalPositions } from "../tests/support/terminals";
import { ProcessMap, WHOLE_LOG_DETAIL } from "./maps";

/**
 * The WISE process map's look (`theme="instrument"`): the BPI Challenge 2019
 * purchase-to-pay log at the detail shares it opens at, orthogonal routes,
 * Start and End with their pale paths, labels on paths 2 px wide or more,
 * every path around a selection labelled with the share of its cases, the
 * self-loop as a pill on the card's border, and the overview while part of
 * the map is out of view.
 */
const meta: Meta<typeof ProcessMap> = {
  title: "Instrument",
  component: ProcessMap,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ProcessMap>;

const layout = { elkWorkerUrl, edgeRouting: "ORTHOGONAL" as const };
const look = {
  theme: "instrument" as const,
  layout,
  minimap: "overflow" as const,
  lod: { edgeLabels: { minPx: 2 } },
  // A measure named: its style with these entries over it (a style alone would replace the default's width and colour).
  measure: "frequency" as const,
  style: { selectedShare: true, terminals: { statement: false } },
  overlayGeometry: { selfLoop: "pill" as const, badgeAnchor: "border" as const },
  minZoom: { readable: "name" as const },
  labelPlacement: "clear" as const,
};

function InstrumentMap({ selected, scheme, lanes }: { selected?: string; scheme?: "dark"; lanes?: boolean }) {
  const [abstraction, setAbstraction] = useState<AbstractOptions>(WHOLE_LOG_DETAIL);
  const [selection, setSelection] = useState<Selection>({ nodes: selected ? [selected] : [], edges: [], groups: [] });
  return (
    <div data-theme={scheme} style={{ height: "100vh", width: "100vw", background: scheme === "dark" ? "#0f1114" : "#f7f8fa" }}>
      <ProcessMap
        {...look}
        {...(lanes && { layout: { ...layout, stages: "partition" as const }, stageView: "bands" as const, laneOptions: { counts: true, sticky: true, emptyLanes: "divider" as const } })}
        graph={globalScene}
        abstraction={abstraction}
        onAbstractionChange={setAbstraction}
        selection={selection}
        onSelect={setSelection}
      />
    </div>
  );
}

/** The whole log at its detail shares, in the light scheme. */
export const Map: Story = { name: "map", render: () => <InstrumentMap /> };

/** Record Goods Receipt selected: every path touching it labelled with the share of its cases. */
export const Selected: Story = { name: "selected", render: () => <InstrumentMap selected="record_goods_receipt" /> };

/** Stages as bands on the partitioned layout: each header with its count, its name kept in view, empty stages as dividers. */
export const Lanes: Story = { name: "lanes", render: () => <InstrumentMap lanes /> };

/** The same map pinned to the dark scheme by `data-theme` on its container. */
export const Dark: Story = { name: "dark", render: () => <InstrumentMap scheme="dark" /> };

/** Start and End with their statements and the terminal paths, at their given positions. */
export const Terminals: Story = {
  name: "terminals",
  render: () => (
    <div style={{ height: "100vh", width: "100vw" }}>
      <ProcessMap {...look} style={{ terminals: { statement: true } }} graph={terminals} positions={terminalPositions} />
    </div>
  ),
};
