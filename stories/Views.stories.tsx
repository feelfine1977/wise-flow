import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useEffect, useMemo, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import { type ViewSet, type ViewSpec, abstract, buildViews, overlaysFor } from "../src/index";
import { type Selection, ViewSwitcher } from "../src/react/index";

const meta: Meta = {
  title: "Views",
  parameters: { layout: "fullscreen" },
  excludeStories: ["views"],
};
export default meta;

const base = abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true });
const items = constraintItems("global");
const byType = (...types: string[]) => items.filter((it) => types.includes(it.description.type));

/** Events per case as a rework measure, derived from the fixture's own numbers. */
const eventsPerCase = Object.fromEntries(
  base.nodes.filter((n) => n.metrics?.cases).map((n) => [n.id, { eventsPerCase: Number(((n.metrics!.events ?? 0) / n.metrics!.cases!).toFixed(3)) }]),
);

export const views: ViewSpec[] = [
  {
    id: "finance",
    label: "Finance",
    description: "Expectation shortfall on paths and activities; presence and balance constraints.",
    overlays: overlaysFor([...byType("presence", "balance")], { graph: base }),
  },
  {
    id: "logistics",
    label: "Logistics",
    description: "Median lag on paths and median time to the next event on activities (blue); lag constraints as arcs.",
    style: {
      edgeWidth: { metric: "count", scale: "sqrt", range: [1, 8] },
      edgeColor: { metric: "medianLagHours", palette: "sequentialBlue" },
      nodeColor: { metric: "medianNextHours", palette: "sequentialBlue" },
    },
    overlays: overlaysFor(byType("lag"), { graph: base }),
  },
  {
    id: "compliance",
    label: "Compliance",
    description: "Expectation shortfall with precedence, exclusion and applicability constraints.",
    overlays: overlaysFor(byType("precedence", "exclusion", "applicability"), { graph: base }),
  },
  {
    id: "automation",
    label: "Automation",
    description: "Events per case on activities (rework and touches, orange); singularity constraints with repeat shares.",
    style: {
      edgeWidth: { metric: "count", scale: "sqrt", range: [1, 8] },
      edgeColor: { metric: "share" },
      nodeColor: { metric: "eventsPerCase", palette: "sequential" },
    },
    nodeMetrics: eventsPerCase,
    overlays: overlaysFor(byType("singularity"), { graph: base }),
  },
];

/**
 * Four named views of one map — Finance, Logistics, Compliance, Automation —
 * on the same positions with their own metrics and overlays. Colour and width
 * domains are shared, so the same path has the same width in every view and
 * the same shortfall share the same colour. Tabs show one view; the grid shows
 * all four as small multiples with one legend per distinct style.
 */
export const FourViews: StoryObj = {
  name: "four views of one map",
  render: () => {
    const [set, setSet] = useState<ViewSet | undefined>();
    const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
    const [mode, setMode] = useState<"single" | "grid">("single");
    const specs = useMemo(() => views, []);
    useEffect(() => {
      let live = true;
      buildViews(base, specs, { layout: { elkWorkerUrl } }).then((s) => live && setSet(s));
      return () => {
        live = false;
      };
    }, [specs]);
    if (!set) return <p style={{ fontFamily: "var(--wf-font)", padding: 12 }}>…</p>;
    const sameWidth = set.views.every((v) => v.style.edgeWidth?.domain?.join() === set.views[0].style.edgeWidth?.domain?.join());
    return (
      <div style={{ height: "100vh", width: "100vw" }} data-testid="views" data-shared-width={sameWidth}>
        <ViewSwitcher views={set} mode={mode} onModeChange={setMode} selection={selection} onSelect={setSelection} />
      </div>
    );
  },
};

/** The same four views laid out as small multiples from the start. */
export const SmallMultiples: StoryObj = {
  name: "small multiples",
  render: () => {
    const [set, setSet] = useState<ViewSet | undefined>();
    useEffect(() => {
      let live = true;
      buildViews(base, views, { layout: { elkWorkerUrl } }).then((s) => live && setSet(s));
      return () => {
        live = false;
      };
    }, []);
    if (!set) return <p style={{ fontFamily: "var(--wf-font)", padding: 12 }}>…</p>;
    return (
      <div style={{ height: "100vh", width: "100vw" }}>
        <ViewSwitcher views={set} mode="grid" columns={2} />
      </div>
    );
  },
};
