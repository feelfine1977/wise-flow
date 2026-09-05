import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useMemo, useState } from "react";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../fixtures/bpic2019";
import { type AbstractOptions, type Positions, abstract, filterPositions, overlaysFor } from "../src/index";
import { ProcessMap, type Selection, useStableLayout } from "../src/react/index";

const meta: Meta = {
  title: "Stable layout",
  parameters: { layout: "fullscreen" },
};
export default meta;

const layoutOptions = { elkWorkerUrl };

function PositionCheck({ union, a, b }: { union: Positions | undefined; a: Positions | undefined; b: Positions | undefined }) {
  if (!union || !a || !b) return <p>…</p>;
  const shared = Object.keys(a.nodes).filter((id) => b.nodes[id]);
  const same = shared.filter((id) => a.nodes[id].x === b.nodes[id].x && a.nodes[id].y === b.nodes[id].y);
  const moved = shared.length - same.length;
  return (
    <p style={{ margin: 0, fontSize: 12 }} data-testid="position-check" data-moved={moved}>
      {shared.length} shared activities, {same.length} at identical positions, {moved} moved.
    </p>
  );
}

function SideBySide({ independent }: { independent: boolean }) {
  // The same abstraction applies to both scenes; the union of the two abstracted
  // scenes is laid out once and both maps read their positions from it.
  const [abstraction, setAbstraction] = useState<AbstractOptions>({ minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true });
  const shownGlobal = useMemo(() => abstract(globalScene, abstraction), [abstraction]);
  const shownVendor = useMemo(() => abstract(vendorScene, abstraction), [abstraction]);
  const scenes = useMemo(() => [shownGlobal, shownVendor], [shownGlobal, shownVendor]);
  const union = useStableLayout(scenes, layoutOptions);
  const onlyGlobal = useStableLayout(independent ? shownGlobal : undefined, layoutOptions);
  const onlyVendor = useStableLayout(independent ? shownVendor : undefined, layoutOptions);
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
  const globalOverlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene }), []);
  const vendorOverlays = useMemo(() => overlaysFor(constraintItems(vendorSceneKey), { graph: vendorScene }), []);
  const positionsA = independent ? onlyGlobal.positions : union.positions;
  const positionsB = independent ? onlyVendor.positions : union.positions;
  const a = positionsA ? filterPositions(positionsA, shownGlobal) : undefined;
  const b = positionsB ? filterPositions(positionsB, shownVendor) : undefined;
  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
      <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--wf-line)", display: "flex", gap: 24, alignItems: "center", fontFamily: "var(--wf-font)" }}>
        <strong>{independent ? "Independent layouts" : "Union layout"}</strong>
        <PositionCheck union={union.positions} a={a} b={b} />
        <span style={{ fontSize: 12, color: "var(--wf-ink-muted)" }}>Left: all purchase order items · Right: vendor 0128 (327 items). Selection and abstraction are shared.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
        <div style={{ borderRight: "1px solid var(--wf-line)", minHeight: 0 }}>
          <ProcessMap
            graph={globalScene}
            positions={positionsA}
            overlays={globalOverlays}
            abstraction={abstraction}
            onAbstractionChange={setAbstraction}
            selection={selection}
            onSelect={setSelection}
            layout={layoutOptions}
            legend={false}
          />
        </div>
        <div style={{ minHeight: 0 }}>
          <ProcessMap
            graph={vendorScene}
            positions={positionsB}
            overlays={vendorOverlays}
            abstraction={abstraction}
            onAbstractionChange={setAbstraction}
            selection={selection}
            onSelect={setSelection}
            layout={layoutOptions}
            controls={false}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Two filtered scenes (the whole log and one vendor) rendered from one union
 * layout: every shared activity sits at the same coordinates in both maps.
 */
export const Union: StoryObj = {
  name: "Global vs vendor (union layout)",
  render: () => <SideBySide independent={false} />,
};

/** The same two scenes laid out independently, for comparison: shared activities move. */
export const Independent: StoryObj = {
  name: "Independent layouts (for comparison)",
  render: () => <SideBySide independent />,
};
