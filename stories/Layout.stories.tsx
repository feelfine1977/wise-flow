import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useMemo, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../fixtures/p2p_stages";
import { liteFromStages } from "../src/bpmn/index";
import { type LaneMode, overlaysFor } from "../src/index";
import { ProcessMap } from "../src/react/index";

const meta: Meta = {
  title: "Layout",
  parameters: { layout: "fullscreen" },
  argTypes: {
    lanes: { control: "radio", options: ["stages", "roles", "none"] },
  },
};
export default meta;

const layout = { elkWorkerUrl };

function LaneBar({ lanes, onChange, note }: { lanes: LaneMode; onChange: (l: LaneMode) => void; note: string }) {
  return (
    <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--wf-line)", display: "flex", gap: 16, alignItems: "center", fontFamily: "var(--wf-font)", fontSize: 12 }}>
      <strong>Lanes</strong>
      {(["stages", "roles", "none"] as LaneMode[]).map((l) => (
        <label key={l}>
          <input type="radio" name="lanes" value={l} checked={lanes === l} onChange={() => onChange(l)} /> {l}
        </label>
      ))}
      <span style={{ color: "var(--wf-ink-muted)" }}>{note}</span>
    </div>
  );
}

/**
 * The stage groups of the payload (Requisition → Purchase order → Goods
 * receipt → Invoice → Payment) as ordered bands along the flow. The ELK
 * partitioning already orders the stages; the bands are cut half-way between
 * neighbouring stages and span the map, so no activity moves when the lane
 * mode changes. *none* draws the groups as boxes, as before.
 */
export const StageLanes: StoryObj<{ lanes: LaneMode }> = {
  name: "stage lanes",
  args: { lanes: "stages" },
  render: (args) => {
    const [lanes, setLanes] = useState<LaneMode>(args.lanes ?? "stages");
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene }), []);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <LaneBar lanes={lanes} onChange={setLanes} note="Stage bands follow the flow; the activities keep their positions." />
        <div style={{ minHeight: 0 }}>
          <ProcessMap graph={globalScene} overlays={overlays} defaultAbstraction={{ minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true }} lanes={lanes} layout={layout} />
        </div>
      </div>
    );
  },
};

/**
 * Role lanes: the BPMN-lite model of the purchase-to-pay stage model with
 * lanes from the roles (Requester, Purchasing, Warehouse, Accounts payable)
 * rendered natively. Lane groups become bands stacked across the flow and
 * every task moves into its lane; the flow order along the map stays.
 */
export const RoleLanes: StoryObj<{ lanes: LaneMode }> = {
  name: "role lanes",
  args: { lanes: "roles" },
  render: (args) => {
    const [lanes, setLanes] = useState<LaneMode>(args.lanes ?? "roles");
    const lite = useMemo(() => liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes: "role" }), []);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <LaneBar lanes={lanes} onChange={setLanes} note="Role lanes stack across the flow; tasks move into their lane." />
        <div style={{ minHeight: 0 }}>
          <ProcessMap graph={lite} lanes={lanes} controls={false} layout={layout} />
        </div>
      </div>
    );
  },
};
