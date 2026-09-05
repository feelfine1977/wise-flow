import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { constraintItems, vendorScene, vendorSceneKey } from "../fixtures/bpic2019";
import { abstract, overlaysFor } from "../src/index";
import { ProcessMap, type Selection, TableAlternative } from "../src/react/index";

const meta: Meta<typeof TableAlternative> = {
  title: "Table alternative",
  component: TableAlternative,
  parameters: { layout: "padded" },
  args: { locale: "en" },
  argTypes: { locale: { control: "radio", options: ["en", "de"] } },
};
export default meta;

type Story = StoryObj<typeof TableAlternative>;

/** The vendor scene and its overlays as three accessible tables; rows select. */
export const Tables: Story = {
  name: "Vendor scene as tables",
  render: (args) => {
    const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
    const graph = useMemo(() => abstract(vendorScene, { minEdgeShare: 0.02 }), []);
    const overlays = useMemo(() => overlaysFor(constraintItems(vendorSceneKey), { graph, locale: args.locale }), [graph, args.locale]);
    return <TableAlternative {...args} graph={graph} overlays={overlays} selection={selection} onSelect={setSelection} />;
  },
};

/** The map with the table view switched on through its controls. */
export const InsideMap: Story = {
  name: "Map in table view",
  render: (args) => {
    const [view, setView] = useState<"map" | "table">("table");
    const overlays = useMemo(() => overlaysFor(constraintItems(vendorSceneKey), { graph: vendorScene, locale: args.locale }), [args.locale]);
    return (
      <div style={{ height: "90vh" }}>
        <ProcessMap graph={vendorScene} overlays={overlays} locale={args.locale} defaultAbstraction={{ minEdgeShare: 0.02 }} view={view} onViewChange={setView} layout={{ engine: "dagre" }} />
      </div>
    );
  },
};
