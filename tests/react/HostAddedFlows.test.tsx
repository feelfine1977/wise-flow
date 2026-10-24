import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProcessMap } from "../../src/react/index";
import { graph, positions, style } from "../core/element-kinds";

afterEach(cleanup);

it("draws round dotted host-added flows in the element renderer only when opted in", async () => {
  const tagged = { ...graph, edges: graph.edges.map((e) => e.id === "start->a" ? { ...e, tags: ["added-by-map"] } : e) };
  const component = (opted: boolean) => <div style={{ width: 1000, height: 400 }}>
    <ProcessMap graph={tagged} positions={positions} style={opted ? { ...style, addedFlowLabel: true } : style} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
  </div>;
  const { container, rerender } = render(component(false));
  const edge = () => container.querySelector<SVGGElement>('g.wf-edge[data-id="start->a"]')!;
  const path = () => edge().querySelector<SVGPathElement>("path.react-flow__edge-path")!;
  await waitFor(() => expect(edge()).not.toBeNull());
  expect(path().style.strokeLinecap).toBe("");
  expect(edge().style.getPropertyValue("--wf-edge-dash")).toBe("");
  rerender(component(true));
  await waitFor(() => expect(path().style.strokeLinecap).toBe("round"));
  expect(edge().style.getPropertyValue("--wf-edge-dash")).toBe("0 3");
  expect(edge().style.getPropertyValue("--wf-edge-color")).toBe("#8c8c8c");
  const recorded = container.querySelector<SVGGElement>('g.wf-edge[data-id="s->r"]')!;
  expect(recorded.style.getPropertyValue("--wf-edge-dash")).toBe("6 5");
  expect(recorded.querySelector<SVGPathElement>("path.react-flow__edge-path")!.style.strokeLinecap).toBe("");
});
