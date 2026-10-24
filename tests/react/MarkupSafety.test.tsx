/**
 * Nothing a label, an id, a kind, a tag, a metric name or an overlay text
 * contains becomes markup. One graph carries markup-like text in every place
 * a backend fills (`<`, `>`, `&`, both quotes, script-like text, a closing tag
 * of the export's own elements); every output must show it as text: the SVG
 * export and the BPMN XML parse without error and hold no element or
 * attribute the text spelled, and read back the text as it was; the map's
 * nodes, tooltip, legend, map chips, tables, Canvas element list, live region
 * and descriptions, and the BPMN view's table, show it as text. A search over
 * the markup-label family checks the two exports for more graphs.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportBpmn, importBpmn } from "../../src/bpmn/headless";
import { type FlowGraph, type Overlay, type Positions, MAP_TARGET, activityReferences, toSVG } from "../../src/index";
import { BpmnView, FilterChips, PathList, ProcessMap, TableAlternative, TraceTimeline } from "../../src/react/index";
import { families } from "../support/graphs";
import { caseCount, caseLabel, seeds } from "../support/random";
import { positionsOf } from "../support/scenes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Each text spells markup: tags the outputs do not use, an attribute that runs script, entities, quotes, and the export's own closing tags.
const T = {
  n1: '<n1 id="x">',
  n2: "n&2",
  n3: "n3'",
  g1: "<g1>",
  e1: '<e "1">',
  label1: "<b>Check</b> & 'approve'",
  label2: '<script>alert("x")</script>',
  label3: "<img src=x onerror=alert(1)>",
  group: "</text><text>Group &amp; co",
  kind: 'odd" onmouseover="alert(1)',
  tag: "<i>tag</i>",
  metric: '<u onclick="x">metric</u>',
  badge: '<u>late</u> & "q"',
  badgeLabel: "<i>Badge</i>",
  chip: "<script>chip()</script>",
  arc: '</title><b>arc</b> & "x"',
  title: "</svg><b>Title</b>",
} as const;

const graph: FlowGraph = {
  nodes: [
    { id: T.n1, kind: "activity", label: T.label1, group: T.g1, metrics: { cases: 5, events: 7, [T.metric]: 3 }, tags: [T.tag] },
    { id: T.n2, kind: "activity", label: T.label2, metrics: { cases: 4 } },
    { id: T.n3, kind: T.kind as "activity", label: T.label3, metrics: { cases: 2 } },
  ],
  edges: [
    { id: T.e1, kind: "follows", source: T.n1, target: T.n2, metrics: { count: 3, cases: 3, [T.metric]: 0.5 } },
    { id: "e2", kind: "follows", source: T.n2, target: T.n3, metrics: { count: 2, cases: 2 } },
  ],
  groups: [{ id: T.g1, kind: "stage", label: T.group }],
  meta: { label: T.title, cases: 9 },
};

const overlays: Overlay[] = [
  { kind: "badge", target: T.n1, payload: { constraintId: T.badgeLabel, label: T.badgeLabel, text: T.badge, glyph: "<", value: 0.4, description: T.badge } },
  { kind: "chip", target: MAP_TARGET, payload: { constraintId: "map", label: T.chip, text: T.chip, value: 0.2 } },
  { kind: "chip", target: T.g1, payload: { constraintId: "group", label: T.badgeLabel, text: T.chip, value: 0.6 } },
  { kind: "arc", target: T.e1, payload: { constraintId: "arc", source: T.n1, target: T.n2, displayLabel: T.arc, label: T.arc, value: 0.3 } },
  { kind: "hatch", target: T.n2, payload: { constraintId: "scope", label: T.badgeLabel, text: T.badge } },
];

const positions: Positions = positionsOf(graph, "grid", 1, { routes: true });
const style = { edgeColor: { metric: T.metric }, nodeColor: { by: "tag" as const, tag: "" } };

/** Elements and attributes the texts spell: none may exist. */
const INJECTED = "script, img, b, i, u, n1";

function injected(root: ParentNode): string[] {
  const found = [...root.querySelectorAll(INJECTED)].map((el) => `<${el.tagName.toLowerCase()}>`);
  for (const el of root.querySelectorAll("*")) for (const a of el.attributes) if (/^on/i.test(a.name)) found.push(`${el.tagName.toLowerCase()}[${a.name}]`);
  return found;
}

/** Every text and attribute value of a parsed document, as a reader would get it. */
function readBack(doc: Document | Element): string[] {
  return [...(doc instanceof Document ? doc.documentElement : doc).querySelectorAll("*")].flatMap((el) => [...[...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? ""), ...[...el.attributes].map((a) => a.value)]);
}

describe("markup in the data of a graph", () => {
  it("is text in the SVG export: it parses, spells no element or attribute, and reads back as it was", () => {
    const svg = toSVG({ graph, positions, overlays, style, title: T.title, subtitle: T.group, activityLabels: { mode: "names", references: activityReferences(graph) } }, { context: true });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(injected(doc)).toEqual([]);
    const values = readBack(doc);
    for (const text of [T.n1, T.n2, T.n3, T.g1, T.e1]) expect(values, text).toContain(text);
    for (const text of [T.label1, T.label2, T.group, T.badge, T.chip, T.title, T.tag]) expect(values.some((v) => v.includes(text)), text).toBe(true);
    // A node of a kind the library does not know is drawn as a card: its name on two lines (21 characters a line at
    // 13 px in the 154 inside a card 180 wide), still as text.
    expect(values, T.label3).toEqual(expect.arrayContaining(["<img src=x", "onerror=alert(1)>"]));
    expect([...doc.querySelectorAll("[data-id]")].find((el) => el.getAttribute("data-id") === T.n3)?.getAttribute("class")).toBe(`wf-node wf-node-${T.kind}`);
  });

  it("is text in the BPMN XML: names, ids and metric names parse and read back as they were", async () => {
    const { xml } = await exportBpmn({ ...graph, overlays });
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(injected(doc)).toEqual([]);
    const values = readBack(doc);
    for (const text of [T.n1, T.n2, T.n3, T.e1, T.label1, T.label2, T.label3, T.group, T.metric, T.tag, T.title, T.kind]) expect(values.some((v) => v.includes(text)), text).toBe(true);
    const back = await importBpmn(xml);
    expect(back.graph.nodes.map((n) => [n.id, n.label])).toEqual(graph.nodes.map((n) => [n.id, n.label]));
    expect(back.graph.nodes[0].metrics?.[T.metric]).toBe(3);
  });

  it("is text on the map: nodes, tooltip, legend, map chips, descriptions and the live region", async () => {
    const { container } = render(
      <div style={{ width: 1000, height: 700 }}>
        <ProcessMap graph={graph} positions={positions} overlays={overlays} style={style} renderer="svg" edgeBudget="all" fitView={false} activityLabels={{ mode: "names", references: activityReferences(graph), showCounts: true }} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(2));
    const node = [...container.querySelectorAll<HTMLElement>(".react-flow__node")].find((n) => n.getAttribute("data-id") === T.n1)!;
    expect(node).toBeTruthy();
    fireEvent.mouseEnter(node);
    expect((await screen.findByRole("tooltip")).textContent).toContain(T.label1);
    fireEvent.mouseLeave(node);
    fireEvent.click(node);
    await waitFor(() => expect(container.querySelector("[aria-live=polite]")?.textContent).toContain(T.label1));
    // The legend opens as a strip; the whole legend lists the tags and shows the map chips.
    fireEvent.click(within(screen.getByRole("region", { name: "Legend" })).getByRole("button", { name: "Show the whole legend" }));
    expect(injected(document.body)).toEqual([]);
    const shown = [document.body.textContent ?? "", ...[...document.body.querySelectorAll("[aria-label], [title]")].flatMap((el) => [el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? ""])].join("\n");
    for (const text of [T.label1, T.label2, T.label3, T.group, T.chip, T.badgeLabel, T.tag]) expect(shown, text).toContain(text);
    expect(container.querySelector(".wf-map-chips")?.textContent).toContain(T.chip);
    expect(container.querySelector(".wf-legend")?.textContent).toContain(T.tag);
  });

  it("is text in the Canvas map's element list and in the table view", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string | symbol, unknown>, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) }) as unknown as CanvasRenderingContext2D);
    const { container, rerender } = render(<div style={{ width: 1000, height: 700 }}><ProcessMap graph={graph} positions={positions} overlays={overlays} renderer="canvas" edgeBudget="all" /></div>);
    await waitFor(() => expect(container.querySelectorAll("[role=img][data-id]").length).toBeGreaterThan(2));
    const listed = [...container.querySelectorAll("[role=img][data-id]")].map((el) => [el.getAttribute("data-id"), el.getAttribute("aria-label")]);
    expect(listed.map(([id]) => id)).toEqual(expect.arrayContaining([T.n1, T.n2, T.n3]));
    expect(listed.find(([id]) => id === T.n2)?.[1]).toContain(T.label2);
    rerender(<div style={{ width: 1000, height: 700 }}><ProcessMap graph={graph} positions={positions} overlays={overlays} style={style} view="table" /></div>);
    const cells = [...container.querySelectorAll("td, th, caption")].map((el) => el.textContent ?? "");
    for (const text of [T.label1, T.label2, T.label3, T.group, T.badge, T.metric]) expect(cells.some((c) => c.includes(text)), text).toBe(true);
    expect(injected(document.body)).toEqual([]);
  });

  it("is text in the other components: table alternative, path list, filter chips, timeline and the BPMN view's table", async () => {
    const onError = vi.fn();
    render(
      <div>
        <TableAlternative graph={graph} overlays={overlays} pageSize={10} />
        <PathList graph={graph} focus={T.n2} />
        <FilterChips filter={[{ kind: "activity", op: "contains", activity: T.n1 }, { kind: "constraint", constraint: "c", state: "violating", label: T.badgeLabel }]} labelOf={(id) => graph.nodes.find((n) => n.id === id)?.label ?? id} />
        <TraceTimeline traces={[{ caseId: T.e1, events: [{ activity: T.label1, timestamp: "2024-01-01T08:00:00Z", resource: T.tag }, { activity: T.label2, timestamp: "2024-01-02T08:00:00Z" }] }]} table />
        <BpmnView graph={graph} layout={{ engine: "dagre" }} view="table" onError={onError} />
      </div>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(document.body.querySelectorAll(".wf-bpmn table").length).toBeGreaterThan(0));
    expect(injected(document.body)).toEqual([]);
    const shown = [document.body.textContent ?? "", ...[...document.body.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") ?? "")].join("\n");
    for (const text of [T.label1, T.label2, T.label3, T.badgeLabel, T.tag, T.e1]) expect(shown, text).toContain(text);
    expect(document.body.querySelector(".wf-bpmn")?.textContent).toContain(T.label2);
  });

  it("is text in both exports of every markup-label graph of a search", async () => {
    for (const seed of seeds(caseCount(10))) {
      const g = families.markupLabels(8, seed);
      const p = positionsOf(g, "grid", seed, { routes: true });
      const svg = new DOMParser().parseFromString(toSVG({ graph: g, positions: p, title: g.nodes[0]?.label }), "image/svg+xml");
      expect(svg.querySelector("parsererror"), caseLabel(seed, "SVG")).toBeNull();
      expect(injected(svg), caseLabel(seed, "SVG")).toEqual([]);
      const xml = new DOMParser().parseFromString((await exportBpmn(g, { positions: p })).xml, "application/xml");
      expect(xml.querySelector("parsererror"), caseLabel(seed, "BPMN")).toBeNull();
      expect(injected(xml), caseLabel(seed, "BPMN")).toEqual([]);
      const names = [...xml.getElementsByTagNameNS("*", "task")].map((t) => t.getAttribute("name"));
      expect(names, caseLabel(seed, "BPMN names")).toEqual(g.nodes.map((n) => n.label));
    }
  });
});
