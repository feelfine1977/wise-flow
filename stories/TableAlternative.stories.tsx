import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { constraintItems, vendorScene, vendorSceneKey } from "../fixtures/bpic2019";
import { abstract, overlaysFor } from "../src/index";
import { type Selection, TableAlternative } from "../src/react/index";
import { ProcessMap } from "./maps";

const meta: Meta<typeof TableAlternative> = {
  title: "Table alternative",
  component: TableAlternative,
  parameters: { layout: "padded" },
  args: { locale: "en" },
  argTypes: { locale: { control: "radio", options: ["en", "de"] } },
};
export default meta;

type Story = StoryObj<typeof TableAlternative>;

/** Every activity of the vendor, and the 17 of 36 paths by frequency that paths of 2 % showed before. */
const VENDOR_DETAIL = { activityDetail: 1, pathDetail: 17 / 36 };

/** The vendor scene and its overlays as three accessible tables; rows select. */
export const Tables: Story = {
  name: "Vendor scene as tables",
  render: (args) => {
    const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
    const graph = useMemo(() => abstract(vendorScene, VENDOR_DETAIL), []);
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
        <ProcessMap graph={vendorScene} overlays={overlays} locale={args.locale} defaultAbstraction={VENDOR_DETAIL} view={view} onViewChange={setView} layout={{ engine: "dagre" }} />
      </div>
    );
  },
};

/** The tables of a large map: ten rows per page and a search field over all three. */
export const Paged: Story = {
  name: "Paged and searchable tables",
  args: { pageSize: 10 },
  render: (args) => {
    const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
    const overlays = useMemo(() => overlaysFor(constraintItems(vendorSceneKey), { graph: vendorScene, locale: args.locale }), [args.locale]);
    return <TableAlternative {...args} graph={vendorScene} overlays={overlays} selection={selection} onSelect={setSelection} />;
  },
};
