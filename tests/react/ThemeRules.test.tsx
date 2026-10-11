import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay, type ThemeRule, defaultTheme } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import { graph as kinds, positions, style } from "../core/element-kinds";

afterEach(cleanup);

/** The element kinds with the activity `a` tagged `manual` and the stage `s` outside the scope (hatched). */
const graph: FlowGraph = { ...kinds, nodes: kinds.nodes.map((n) => (n.id === "a" ? { ...n, tags: ["manual"] } : n)) };
const overlays: Overlay[] = [{ kind: "hatch", target: "s" }];

const rules: ThemeRule[] = [
  { match: { part: "node", kind: "gateway" }, set: { fill: "#fff3c4" } },
  { match: { part: "node", tag: "manual" }, set: { strokeWeight: "strong", radius: "m" } },
  { match: { part: "edge", state: "reconnected" }, set: { stroke: "#b42318", opacity: 0.5 } },
  { match: { part: "node", state: "selected" }, set: { stroke: "#c2410c", text: { name: { color: "#7c2d12" } } } },
  { match: { part: "edge", state: "dimmed" }, set: { opacity: 0.2 } },
];

async function map(selected: string[] = []) {
  const { container } = render(
    <div style={{ width: 1000, height: 400 }}>
      <ProcessMap graph={graph} positions={positions} overlays={overlays} style={style} theme={{ ...defaultTheme, rules }} selection={{ nodes: selected, edges: [], groups: [] }} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
    </div>,
  );
  await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
  const node = (id: string) => container.querySelector<HTMLElement>(`#wf-node-${id}`)!;
  const edge = (id: string) => container.querySelector<SVGGElement>(`g.wf-edge[data-id="${id}"]`)!;
  return { node, edge };
}

const variable = (el: HTMLElement | SVGElement, name: string) => el.style.getPropertyValue(name);

describe("the DOM map under a theme's rules", () => {
  it("draws what the rules by kind, tag and state set in the scene", async () => {
    const { node, edge } = await map();
    expect(variable(node("g"), "--wf-node-fill")).toBe("transparent");
    // A gateway's diamond is its SVG outline, filled in the rule's colour.
    expect(node("g").querySelector(".wf-node__outline > path")!.getAttribute("fill")).toBe("#fff3c4");
    expect([variable(node("a"), "--wf-node-stroke"), variable(node("a"), "--wf-node-radius")]).toEqual(["2px", "8px"]);
    expect([variable(node("r"), "--wf-node-stroke"), variable(node("r"), "--wf-node-radius")]).toEqual(["0px", "4px"]);
    expect([variable(edge("s->r"), "--wf-edge-color"), variable(edge("s->r"), "--wf-edge-opacity")]).toEqual(["#b42318", "0.5"]);
    expect(variable(edge("start->a"), "--wf-edge-opacity")).toBe("");
    // No state: nothing replaces how a state is drawn.
    expect(variable(node("a"), "--wf-state-outline")).toBe("");
  });

  it("draws the interactive states' rules over the scene, through the core's state style", async () => {
    const { node, edge } = await map(["a"]);
    // The selected activity: the rule's outline for the stylesheet's selected state, the rule's ink for its name.
    expect(node("a").className).toContain("wf-node--selected");
    expect(variable(node("a"), "--wf-state-outline")).toBe("#c2410c");
    expect(variable(node("a"), "--wf-node-outline")).toBe("#c2410c");
    expect(variable(node("a").querySelector(".wf-activity-name")!, "--wf-text-paint")).toBe("#7c2d12");
    // Paths away from the selection are dimmed at the rule's opacity, which replaces the dimmed look.
    expect(edge("s->r").getAttribute("data-wf-state")).toContain("dimmed");
    expect(edge("s->r").getAttribute("class")).not.toContain("wf-edge--dimmed");
    expect(variable(edge("s->r"), "--wf-edge-opacity")).toBe("0.2");
    // The path into the selection is not dimmed.
    expect(edge("start->a").getAttribute("data-wf-state") ?? "").not.toContain("dimmed");
  });

  it("draws a dimmed path at the dimmed look's opacity in place of a rule's, as the Canvas map does", async () => {
    const { container } = render(
      <div style={{ width: 1000, height: 400 }}>
        <ProcessMap graph={graph} positions={positions} style={style} theme={{ ...defaultTheme, rules: rules.slice(0, 3) }} selection={{ nodes: ["a"], edges: [], groups: [] }} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
    const readded = container.querySelector<SVGGElement>('g.wf-edge[data-id="s->r"]')!;
    // The re-added path is at 0.5 by the rule and dimmed without a rule for the state: the dimmed look's 0.25 on its line, not 0.5 × 0.25.
    expect(readded.getAttribute("class")).toContain("wf-edge--dimmed");
    expect(variable(readded, "--wf-edge-opacity")).toBe("");
    expect(variable(readded, "--wf-edge-color")).toBe("#b42318");
  });

  it("draws the default states without rules for them", async () => {
    const { container } = render(
      <div style={{ width: 1000, height: 400 }}>
        <ProcessMap graph={graph} positions={positions} style={style} selection={{ nodes: ["a"], edges: [], groups: [] }} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
    const a = container.querySelector<HTMLElement>("#wf-node-a")!;
    expect([variable(a, "--wf-state-outline"), variable(a, "--wf-node-outline")]).toEqual(["", "var(--wf-line-strong)"]);
    expect(container.querySelector('g.wf-edge[data-id="s->r"]')!.getAttribute("class")).toContain("wf-edge--dimmed");
  });
});
