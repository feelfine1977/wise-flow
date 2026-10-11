import { cleanup, render, waitFor } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, defaultTheme, edgeMark, nodeMark } from "../../src/index";
import { type WfEdge, type WfNode, ProcessMap, edgeTypes, nodeTypes } from "../../src/react/index";
import { graph, positions, style } from "../core/element-kinds";

afterEach(cleanup);

/** What a node writes: its name's lines and its number line, or its label. */
const texts = (el: Element) => [...el.querySelectorAll(".wf-node__label, .wf-activity-name > span, .wf-activity-counts > span")].map((e) => e.textContent);

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
  it("shows a gateway's glyph and a note's label at every zoom, other labels and the cards' texts by level of detail", async () => {
    const { node } = await map();
    const glyph = node("g").querySelector(".wf-node__label")!;
    expect(glyph.textContent).toBe("+");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.className).toBe("wf-node__label");
    expect(node("n").querySelector(".wf-node__label")!.className).toBe("wf-node__label");
    expect(node("n").querySelector(".wf-node__band")).toBeNull();
    expect(node("start").querySelector(".wf-node__label")!.className).toBe("wf-node__label wf-lod-labels");
    // A stage's card: its name, then its cases and their share (none: the graph has no cases of its log).
    expect(node("s").querySelector(".wf-activity-copy")!.className).toBe("wf-activity-copy wf-lod-labels");
    expect(texts(node("s"))).toEqual(["Payment", "1,500", "· –"]);
    expect(node("r").className).toContain("wf-node--reconnected");
    // Without cases the card shows a dash for its cases and their share.
    expect(texts(node("r"))).toEqual(["Re-added", "–", "· –"]);
  });

  it("draws edges along the scene's route, straight between the boxes where none is given, with the count at the label point", async () => {
    const { edge } = await map();
    const path = (id: string) => edge(id).querySelector("path.react-flow__edge-path")!.getAttribute("d");
    // Each line ends 2.25 before its route, inside its head of 12.
    expect(path("a->g")).toBe("M280 20L317.75 20");
    expect(path("g->s")).toBe("M364 20L382 20L382 28L397.75 28");
    const label = edge("a->g").querySelector(".wf-edge-label")!;
    expect([label.textContent, label.getAttribute("x"), label.getAttribute("y")]).toEqual(["12", "300", "16"]);
    expect(edge("g->s").querySelector(".wf-edge-label")).toBeNull();
  });

  it("writes a name on up to two lines, the second shortened by the core rule, and gives the whole name to hover and assistive technology", async () => {
    const label = "Change Approval for Purchase Order Item of a Framework Contract";
    const long = { ...graph, nodes: graph.nodes.map((n) => (n.id === "a" ? { ...n, label } : n)) };
    const { node } = await map(long);
    // Without a 2D canvas the map measures by the estimate: 21 characters a line of 154, the second 20 and the ellipsis.
    expect([...node("a").querySelectorAll(".wf-activity-name > span")].map((e) => e.textContent)).toEqual(["Change Approval for", "Purchase Order Item…"]);
    expect(node("a").getAttribute("title")).toBe(label);
    expect(node("a").closest(".react-flow__node")!.getAttribute("aria-label")).toContain(label);
  });
});

describe("React Flow node and edge components", () => {
  it("draw the mark they are given rather than resolving their own", async () => {
    const [, a, g] = graph.nodes;
    const flow = graph.edges[1];
    const fields = { color: "#8c8c8c", pattern: "solid" as const, hatched: false, direction: "RIGHT" as const, focused: false, hovered: false, dimmed: false, locale: "en" as const };
    // Marks whose texts and route differ from what the node and edge fields would give.
    const activity = nodeMark(a, positions.nodes.a, { color: "#8c8c8c", pattern: "solid" });
    activity.texts = activity.texts.map((t) => ({ ...t, text: t.role === "nameLine" ? "From the mark" : t.role === "countLine" ? "42" : "· 7 %" }));
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
    expect(texts(container.querySelector("#wf-node-a")!)).toEqual(["From the mark", "42", "· 7 %"]);
    expect(container.querySelector("#wf-node-g .wf-node__label")!.textContent).toBe("◇");
    // The edge runs along the mark's points, not between the handles, its count 4 above their middle.
    expect(container.querySelector("g.wf-edge path.react-flow__edge-path")!.getAttribute("d")).toBe("M10 10L107.75 10");
    const label = container.querySelector("g.wf-edge .wf-edge-label")!;
    expect([label.textContent, label.getAttribute("x"), label.getAttribute("y")]).toEqual(["99", "60", "6"]);
  });
});

describe("the look of nodes and groups, from their marks", () => {
  const prop = (el: Element, name: string) => (el as HTMLElement).style.getPropertyValue(name);

  it("gives every node kind its mark's fill, outline, radius and text styles; diamonds and dashes are drawn as SVG shapes", async () => {
    const { node } = await map();
    const look = (id: string) => ["--wf-node-fill", "--wf-node-outline", "--wf-node-stroke", "--wf-node-radius"].map((p) => prop(node(id), p));
    // An activity's card on paper, outlined 1 wide in the strong line colour with corners of 4, as large as its box; its
    // name at 13 medium in the ink, its cases at 11 semibold in the ink, their share at 11 in the muted ink.
    expect(look("a")).toEqual(["var(--wf-paper)", "var(--wf-line-strong)", "1px", "4px"]);
    expect([(node("a") as HTMLElement).style.width, (node("a") as HTMLElement).style.height]).toEqual(["180px", "40px"]);
    const style = (el: Element) => ["--wf-text-size", "--wf-text-weight", "--wf-text-paint"].map((p) => prop(el, p));
    const [count, share] = node("a").querySelectorAll(".wf-activity-counts > span");
    expect(style(node("a").querySelector(".wf-activity-name")!)).toEqual(["13px", "500", "var(--wf-ink)"]);
    expect(style(count)).toEqual(["11px", "600", "var(--wf-ink)"]);
    expect(style(share)).toEqual(["11px", "", "var(--wf-ink-muted)"]);
    // A stage's card outlined 1 wide; its name semibold.
    expect(look("s")[2]).toBe("1px");
    expect(style(node("s").querySelector(".wf-activity-name")!)).toEqual(["13px", "600", "var(--wf-ink)"]);
    // Events: circles of radius 18 in the ink, the start outlined 1 wide and the end 2.
    expect(look("start")).toEqual(["var(--wf-paper)", "var(--wf-ink)", "1px", "18px"]);
    expect(look("end")[2]).toBe("2px");
    expect(node("a").querySelector(".wf-node__outline")).toBeNull();
    // A gateway's diamond: no border, the shape in its 44 box, outlined 1 in the ink; the glyph at 15, semibold.
    expect(node("g").className).toContain("wf-node--outlined");
    expect(look("g").slice(0, 3)).toEqual(["transparent", "var(--wf-ink)", "0px"]);
    const diamond = node("g").querySelector(".wf-node__outline > path")!;
    expect([diamond.getAttribute("d"), diamond.getAttribute("stroke-width"), diamond.getAttribute("class")]).toEqual(["M22 0L44 22L22 44L0 22Z", "1", "wf-fill-paper wf-stroke-ink"]);
    expect(["--wf-text-size", "--wf-text-weight"].map((p) => prop(node("g").querySelector(".wf-node__label")!, p))).toEqual(["15px", "600"]);
    // A note on the surface colour with a solid border 1 wide; only the re-added activity is dashed, 4 and 3.
    expect(look("n")).toEqual(["var(--wf-surface)", "#8c8c8c", "1px", "4px"]);
    expect(node("n").querySelector(".wf-node__outline")).toBeNull();
    const dashed = (id: string) => node(id).querySelector(".wf-node__outline > rect")!;
    expect(["width", "height", "rx", "stroke", "stroke-width", "stroke-dasharray", "class"].map((a) => dashed("r").getAttribute(a))).toEqual(["180", "40", "4", null, "1", "4 3", "wf-fill-paper wf-stroke-line-strong"]);
  });

  it("lets no rule of a hovered, selected, focused or out-of-scope node touch its fill or dash its outline", () => {
    const sheet = readFileSync("src/react/style.css", "utf8").replace(/\/\*[^]*?\*\//g, "");
    const rules = [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const states = rules.filter((r) => /\.wf-node--(hovered|selected|focused|hatched)|data-wf-state/.test(r.selector) && r.selector.includes("wf-node"));
    // The rules there are: the outline of a hovered and of a selected node (border, or the SVG shape's stroke), the selection's ring and the focus outline.
    expect(states.length).toBeGreaterThanOrEqual(5);
    for (const r of states) {
      expect(r.body, r.selector).not.toMatch(/(^|[\s;])(background|background-color|fill)\s*:/);
      expect(r.body, r.selector).not.toMatch(/dashed|dotted|stroke-dasharray/);
    }
  });

  it("draws a card's frequency cue where the mark puts it, inside the border, in the cue's colours", async () => {
    const { node } = await map({ ...graph, meta: { cases: 2468 } });
    // 1,234 of 2,468 cases: half of the inner width 171, from the band's end (108) less the border (100 + 1); the foot the lowest 3 inside it.
    const [stripe, foot] = [...node("a").querySelectorAll(".wf-node__cue")] as HTMLElement[];
    const at = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height, el.style.background, el.getAttribute("data-wf-part")];
    expect(at(stripe)).toEqual(["7px", "0px", "85.5px", "38px", "var(--wf-cue-stripe)", "node-cue"]);
    expect(at(foot)).toEqual(["7px", "35px", "85.5px", "3px", "var(--wf-cue-foot)", "node-cue-foot"]);
    expect(texts(node("a"))).toEqual(["Check invoice", "1,234", "· 50 %"]);
    // Under the band and the texts.
    expect([...node("a").children].map((c) => c.className.split(" ")[0]).filter((c) => c.startsWith("wf-"))).toEqual(["wf-node__cue", "wf-node__cue", "wf-node__band", "wf-activity-copy"]);
  });

  it("draws a second theme's outline, radius and text size", async () => {
    const theme = { ...defaultTheme, stroke: { ...defaultTheme.stroke, node: 3 }, radius: { ...defaultTheme.radius, node: 9 }, text: { ...defaultTheme.text, activityName: { size: 15, weight: 500, lineHeight: 18 } } };
    const { container } = render(
      <div style={{ width: 1000, height: 400 }}>
        <ProcessMap graph={graph} positions={positions} style={style} theme={theme} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector("#wf-node-a")).not.toBeNull());
    const a = container.querySelector("#wf-node-a")!;
    expect([prop(a, "--wf-node-stroke"), prop(a, "--wf-node-radius"), prop(a.querySelector(".wf-activity-name")!, "--wf-text-size")]).toEqual(["3px", "9px", "15px"]);
  });

  it("gives a box group a solid hairline without a tint and a muted title, a band its outline on two sides and its rule", async () => {
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
    expect([prop(box.group, "--wf-group-fill"), prop(box.group, "--wf-group-radius")]).toEqual(["0", "8px"]);
    const outline = box.group.querySelector(".wf-group__outline > rect")!;
    expect(["width", "height", "rx", "fill", "stroke-width", "stroke-dasharray", "class"].map((a) => outline.getAttribute(a))).toEqual(["200", "70", "8", "none", "1", null, "wf-stroke-line"]);
    expect(["--wf-text-size", "--wf-text-weight", "--wf-text-paint"].map((p) => prop(box.group.querySelector(".wf-group__label")!, p))).toEqual(["13px", "600", "var(--wf-ink-muted)"]);
    box.unmount();
    const band = await draw("stages");
    const color = prop(band.group, "--wf-group-color");
    expect(band.group.querySelector(".wf-group__outline")).toBeNull();
    expect(["--wf-group-outline", "--wf-group-top", "--wf-group-right", "--wf-group-bottom", "--wf-group-left", "--wf-group-radius"].map((p) => prop(band.group, p))).toEqual(["var(--wf-line)", "0px", "1px", "0px", "1px", "0px"]);
    expect(prop(band.group, "--wf-group-rule")).toBe(`inset 0 2px 0 ${color}`);
  });
});
