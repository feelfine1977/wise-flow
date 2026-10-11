import { cleanup, render, waitFor } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, defaultTheme, edgeMark, nodeMark } from "../../src/index";
import { type WfEdge, type WfNode, ProcessMap, edgeTypes, nodeTypes } from "../../src/react/index";
import { graph, positions, style } from "../core/element-kinds";

afterEach(cleanup);

async function map(given: FlowGraph = graph) {
  const { container } = render(
    <div style={{ width: 1000, height: 400 }}>
      <ProcessMap graph={given} positions={positions} style={style} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
    </div>,
  );
  await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
  const node = (id: string) => container.querySelector(`#wf-node-${id}`)!;
  const edge = (id: string) => container.querySelector(`g.wf-edge[data-id="${id}"]`)!;
  return { node, edge };
}

describe("React Flow nodes and edges from their marks", () => {
  it("shows a gateway's glyph and a note's label at every zoom, other labels by level of detail", async () => {
    const { node } = await map();
    const glyph = node("g").querySelector(".wf-node__label")!;
    expect(glyph.textContent).toBe("+");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.className).toBe("wf-node__label");
    expect(node("n").querySelector(".wf-node__label")!.className).toBe("wf-node__label");
    expect(node("n").querySelector(".wf-node__band")).toBeNull();
    expect(node("start").querySelector(".wf-node__label")!.className).toBe("wf-node__label wf-lod-labels");
    expect([...node("s").querySelectorAll(".wf-node__label, .wf-node__meta")].map((e) => [e.textContent, e.className])).toEqual([
      ["Payment", "wf-node__label wf-lod-labels"],
      ["4 · 1,500", "wf-node__meta wf-lod-labels"],
    ]);
    expect(node("r").className).toContain("wf-node--reconnected");
    // Without cases the activity shows no count.
    expect(node("r").querySelector(".wf-node__meta")).toBeNull();
  });

  it("draws edges along the scene's route, straight between the boxes where none is given, with the count at the label point", async () => {
    const { edge } = await map();
    const path = (id: string) => edge(id).querySelector("path.react-flow__edge-path")!.getAttribute("d");
    expect(path("a->g")).toBe("M280 20L320 20");
    expect(path("g->s")).toBe("M364 20L382 20L382 28L400 28");
    const label = edge("a->g").querySelector(".wf-edge-label")!;
    expect([label.textContent, label.getAttribute("x"), label.getAttribute("y")]).toEqual(["12", "300", "16"]);
    expect(edge("g->s").querySelector(".wf-edge-label")).toBeNull();
  });

  it("shortens labels by the core rule and keeps the full name in the description", async () => {
    const long = { ...graph, nodes: graph.nodes.map((n) => (n.id === "a" ? { ...n, label: "Change Approval for Purchase Order" } : n)) };
    const { node } = await map(long);
    // Without a 2D canvas the map measures by the estimate: 121.25 beside the count "1,234", 17 characters and the ellipsis.
    expect(node("a").querySelector(".wf-node__label")!.textContent).toBe("Change Approval f…");
    expect(node("a").getAttribute("title")).toContain("Change Approval for Purchase Order");
  });
});

describe("React Flow node and edge components", () => {
  it("draw the mark they are given rather than resolving their own", async () => {
    const [, a, g] = graph.nodes;
    const flow = graph.edges[1];
    const fields = { color: "#8c8c8c", pattern: "solid" as const, hatched: false, direction: "RIGHT" as const, focused: false, hovered: false, dimmed: false, locale: "en" as const };
    // Marks whose texts and route differ from what the node and edge fields would give.
    const activity = nodeMark(a, positions.nodes.a, { color: "#8c8c8c", pattern: "solid" });
    activity.texts = activity.texts.map((t) => ({ ...t, text: t.role === "label" ? "From the mark" : "42" }));
    const gateway = nodeMark(g, positions.nodes.g, { color: "#8c8c8c", pattern: "solid" });
    gateway.texts = [{ ...gateway.texts[0], text: "◇" }];
    const nodes: WfNode[] = [
      { id: "a", type: "activity", position: { x: 0, y: 0 }, data: { ...fields, node: a, description: "a", mark: activity } },
      { id: "g", type: "gateway", position: { x: 300, y: 0 }, data: { ...fields, node: g, description: "g", mark: gateway } },
    ];
    const edges: WfEdge[] = [{
      id: flow.id, type: "flow", source: "a", target: "g",
      data: { edge: flow, width: 1.5, color: "#8c8c8c", reconnected: false, hovered: false, dimmed: false, focused: false, description: "a to g",
        mark: edgeMark({ ...flow, metrics: { count: 99 } }, [{ x: 10, y: 10 }, { x: 110, y: 10 }], { color: "#8c8c8c", width: 1.5 }) },
    }];
    const { container } = render(
      <div style={{ width: 800, height: 400 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        </ReactFlowProvider>
      </div>,
    );
    await waitFor(() => expect(container.querySelector("g.wf-edge")).not.toBeNull());
    expect([...container.querySelectorAll("#wf-node-a .wf-node__label, #wf-node-a .wf-node__meta")].map((e) => e.textContent)).toEqual(["From the mark", "42"]);
    expect(container.querySelector("#wf-node-g .wf-node__label")!.textContent).toBe("◇");
    // The edge runs along the mark's points, not between the handles, its count 4 above their middle.
    expect(container.querySelector("g.wf-edge path.react-flow__edge-path")!.getAttribute("d")).toBe("M10 10L110 10");
    const label = container.querySelector("g.wf-edge .wf-edge-label")!;
    expect([label.textContent, label.getAttribute("x"), label.getAttribute("y")]).toEqual(["99", "60", "6"]);
  });
});

describe("the look of nodes and groups, from their marks", () => {
  const prop = (el: Element, name: string) => (el as HTMLElement).style.getPropertyValue(name);

  it("gives every node kind its mark's fill, outline, radius and text styles; diamonds and dashes are drawn as SVG shapes", async () => {
    const { node } = await map();
    const look = (id: string) => ["--wf-node-fill", "--wf-node-outline", "--wf-node-stroke", "--wf-node-radius"].map((p) => prop(node(id), p));
    // An activity on paper, outlined 2 wide in its colour with corners of 6; its label at 12, its count at 9 in the muted ink.
    expect(look("a")).toEqual(["var(--wf-paper)", "#8c8c8c", "2px", "6px"]);
    const [label, count] = [node("a").querySelector(".wf-node__label")!, node("a").querySelector(".wf-node__meta")!];
    expect(["--wf-text-size", "--wf-text-weight", "--wf-text-paint"].map((p) => prop(label, p))).toEqual(["12px", "", "var(--wf-ink)"]);
    expect(["--wf-text-size", "--wf-text-paint"].map((p) => prop(count, p))).toEqual(["9px", "var(--wf-ink-muted)"]);
    // A stage outlined 3 wide; its label semibold, its count not.
    expect(look("s")[2]).toBe("3px");
    expect([...node("s").querySelectorAll(".wf-node__label, .wf-node__meta")].map((e) => prop(e, "--wf-text-weight"))).toEqual(["600", ""]);
    // Events: circles of radius 18 in the ink, the start outlined 2 wide and the end 3.
    expect(look("start")).toEqual(["var(--wf-paper)", "var(--wf-ink)", "2px", "18px"]);
    expect(look("end")[2]).toBe("3px");
    expect(node("a").querySelector(".wf-node__outline")).toBeNull();
    // A gateway's diamond: no border, the shape in its 44 box, outlined 1.5 in the ink; the glyph at 14, bold.
    expect(node("g").className).toContain("wf-node--outlined");
    expect(look("g").slice(0, 3)).toEqual(["transparent", "var(--wf-ink)", "0px"]);
    const diamond = node("g").querySelector(".wf-node__outline > path")!;
    expect([diamond.getAttribute("d"), diamond.getAttribute("stroke-width"), diamond.getAttribute("class")]).toEqual(["M22 0L44 22L22 44L0 22Z", "1.5", "wf-fill-paper wf-stroke-ink"]);
    expect(["--wf-text-size", "--wf-text-weight"].map((p) => prop(node("g").querySelector(".wf-node__label")!, p))).toEqual(["14px", "700"]);
    // A note dotted 2 and 3 on the surface colour, a re-added activity dashed 4 and 3.
    const dashed = (id: string) => node(id).querySelector(".wf-node__outline > rect")!;
    expect(["width", "height", "rx", "stroke", "stroke-width", "stroke-dasharray", "class"].map((a) => dashed("n").getAttribute(a))).toEqual(["160", "60", "6", "#8c8c8c", "2", "2 3", "wf-fill-surface"]);
    expect(dashed("r").getAttribute("stroke-dasharray")).toBe("4 3");
  });

  it("draws a second theme's outline, radius and text size", async () => {
    const theme = { ...defaultTheme, stroke: { ...defaultTheme.stroke, node: 3 }, radius: { ...defaultTheme.radius, node: 9 }, text: { ...defaultTheme.text, nodeLabel: { size: 15 } } };
    const { container } = render(
      <div style={{ width: 1000, height: 400 }}>
        <ProcessMap graph={graph} positions={positions} style={style} theme={theme} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector("#wf-node-a")).not.toBeNull());
    const a = container.querySelector("#wf-node-a")!;
    expect([prop(a, "--wf-node-stroke"), prop(a, "--wf-node-radius"), prop(a.querySelector(".wf-node__label")!, "--wf-text-size")]).toEqual(["3px", "9px", "15px"]);
  });

  it("gives a box group its tint and a dashed outline, a band its outline on two sides and its rule", async () => {
    const grouped: FlowGraph = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, group: n.id === "a" ? "order" : n.id === "s" ? "pay" : undefined })), groups: [{ id: "order", kind: "stage", label: "Order" }, { id: "pay", kind: "stage", label: "Payment" }] };
    const boxes = { ...positions, groups: { order: { x: 90, y: -10, width: 200, height: 70 }, pay: { x: 390, y: -10, width: 220, height: 76 } } };
    const draw = async (lanes: "none" | "stages") => {
      const { container, unmount } = render(
        <div style={{ width: 1000, height: 400 }}>
          <ProcessMap graph={grouped} positions={boxes} style={style} lanes={lanes} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
        </div>,
      );
      await waitFor(() => expect(container.querySelector("#wf-group-group\\:order")).not.toBeNull());
      return { group: container.querySelector("#wf-group-group\\:order")!, unmount };
    };
    const box = await draw("none");
    expect([prop(box.group, "--wf-group-fill"), prop(box.group, "--wf-group-radius")]).toEqual(["0.06", "10px"]);
    const outline = box.group.querySelector(".wf-group__outline > rect")!;
    expect(["width", "height", "rx", "fill", "stroke-width", "stroke-dasharray"].map((a) => outline.getAttribute(a))).toEqual(["200", "70", "10", "none", "1.5", "6 4"]);
    expect(["--wf-text-size", "--wf-text-weight", "--wf-text-paint"].map((p) => prop(box.group.querySelector(".wf-group__label")!, p))).toEqual(["14px", "600", "var(--wf-ink)"]);
    box.unmount();
    const band = await draw("stages");
    const color = prop(band.group, "--wf-group-color");
    expect(band.group.querySelector(".wf-group__outline")).toBeNull();
    expect(["--wf-group-outline", "--wf-group-top", "--wf-group-right", "--wf-group-bottom", "--wf-group-left", "--wf-group-radius"].map((p) => prop(band.group, p))).toEqual(["var(--wf-line)", "0px", "1px", "0px", "1px", "0px"]);
    expect(prop(band.group, "--wf-group-rule")).toBe(`inset 0 3px 0 ${color}`);
  });
});
