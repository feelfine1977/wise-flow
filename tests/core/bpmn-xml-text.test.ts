// @vitest-environment jsdom
/**
 * The text of a BPMN export as a conforming XML 1.0 parser reads it: the
 * characters XML 1.0 does not allow are dropped with a warning, and tab and
 * carriage return are written as references, which such a parser keeps. The
 * second parser is jsdom's `DOMParser` (saxes), which checks well-formedness;
 * the library's own reads the file back.
 */
import { describe, expect, it } from "vitest";
import { exportBpmn, importBpmn, liteFromGraph } from "../../src/bpmn/headless";
import { type FlowGraph, type Positions, createPositions, validateGraph } from "../../src/index";

const BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL";
const WISE = "http://wise-workbench.org/schema/flow";
/** What XML 1.0 does not allow anywhere in a document (its `Char` production, read the other way round). */
const NOT_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;
const dropped = (id: string) => `label of ${id}: characters XML 1.0 does not allow are dropped`;

/** The document a conforming parser reads; it must find no error. */
function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")[0]?.textContent, "well-formed").toBeUndefined();
  return doc;
}

/** Two activities a and b, a note n, all in one lane, a flow from a to b, on fixed boxes. */
function model(labels: { a: string; b: string; note: string; flow: string; lane: string }): { graph: FlowGraph; positions: Positions } {
  const graph: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: labels.a, group: "lane" },
      { id: "b", kind: "activity", label: labels.b, group: "lane" },
      { id: "n", kind: "note", label: labels.note },
    ],
    edges: [{ id: "a->b", kind: "flow", source: "a", target: "b", payload: { label: labels.flow } }],
    groups: [{ id: "lane", kind: "lane", label: labels.lane }],
  };
  const box = (x: number) => ({ x, y: 20, width: 100, height: 80 });
  const positions = createPositions({ nodes: { a: box(50), b: box(250), n: box(450) }, groups: { lane: { x: 0, y: 0, width: 600, height: 120 } }, edges: {} }, "dagre", "RIGHT");
  return { graph, positions };
}

describe("labels in a BPMN export", () => {
  it("lose the characters XML 1.0 does not allow, with a warning for each label", async () => {
    const { graph, positions } = model({ a: "Bell\u0007 rings", b: "Form\u000Cfeed ￿\uD800end", note: "Note\u001F", flow: "yes\u0000", lane: "Lane\u0001" });
    const out = await exportBpmn(graph, { positions });
    expect(out.warnings).toEqual([dropped("a"), dropped("b"), dropped("n"), dropped("a->b"), dropped("lane")]);
    expect(NOT_XML.test(out.xml)).toBe(false);
    const doc = parse(out.xml);
    expect([...doc.getElementsByTagNameNS(BPMN, "task")].map((el) => el.getAttribute("name"))).toEqual(["Bell rings", "Formfeed end"]);
    expect(doc.getElementsByTagNameNS(BPMN, "text")[0].textContent).toBe("Note");
    const back = await importBpmn(out.xml);
    expect(back.warnings).toEqual([]);
    expect(back.graph.nodes.map((n) => n.label)).toEqual(["Bell rings", "Formfeed end", "Note"]);
    expect(back.graph.edges.find((e) => e.id === "a->b")?.payload).toMatchObject({ label: "yes" });
    expect(back.graph.groups?.find((g) => g.id === "lane")?.label).toBe("Lane");
  });

  it("and ids lose them too, with a warning", async () => {
    const { graph, positions } = model({ a: "A", b: "B", note: "N", flow: "F", lane: "L" });
    graph.nodes[1] = { ...graph.nodes[1], id: "b\u0002" };
    graph.edges[0] = { ...graph.edges[0], target: "b\u0002" };
    const out = await exportBpmn(graph, { positions: { ...positions, nodes: { ...positions.nodes, "b\u0002": positions.nodes.b } } });
    expect(out.warnings).toEqual(["id b\u0002: characters XML 1.0 does not allow are dropped"]);
    parse(out.xml);
    const back = await importBpmn(out.xml);
    expect(back.graph.nodes.map((n) => n.id)).toEqual(["a", "b", "n"]);
    expect(back.graph.edges.map((e) => [e.source, e.target])).toEqual([["a", "b"]]);
  });

  it("keep tab and carriage return, written as references, for a conforming parser and for the library", async () => {
    // A tab, a lone return, a return before and after a line feed.
    const text = "Tab\there, return\rthere, both\r\nand\n\rback";
    const { graph, positions } = model({ a: text, b: "B", note: text, flow: text, lane: text });
    const out = await exportBpmn(graph, { positions });
    expect(out.warnings).toEqual([]);
    expect(out.xml).toContain('name="Tab&#9;here, return&#13;there, both&#13;&#10;and&#10;&#13;back"');
    expect(out.xml).not.toMatch(/[\t\r]/);
    const doc = parse(out.xml);
    expect(doc.getElementsByTagNameNS(BPMN, "task")[0].getAttribute("name")).toBe(text);
    expect(doc.getElementsByTagNameNS(BPMN, "text")[0].textContent).toBe(text);
    expect(doc.getElementsByTagNameNS(BPMN, "sequenceFlow")[0].getAttribute("name")).toBe(text);
    expect(doc.getElementsByTagNameNS(BPMN, "lane")[0].getAttribute("name")).toBe(text);
    const back = await importBpmn(out.xml);
    expect(back.graph.nodes.map((n) => n.label)).toEqual([text, "B", text]);
    expect(back.graph.edges[0].payload).toMatchObject({ label: text });
    expect(back.graph.groups?.find((g) => g.id === "lane")?.label).toBe(text);
  });
});

describe("a BPMN export of a graph with a control character and two edges between the same nodes", () => {
  it("is read back by the library and is well-formed for a second parser", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "Check\u0001 invoice", metrics: { cases: 4 } },
        { id: "b", kind: "activity", label: "Pay", metrics: { cases: 3 } },
        { id: "c", kind: "activity", label: "Reject", metrics: { cases: 1 } },
      ],
      edges: [
        { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 2 } },
        { id: "a->b flow", kind: "flow", source: "a", target: "b", metrics: { count: 1 } },
        { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { count: 1 } },
      ],
    };
    const lite = liteFromGraph(graph);
    expect(validateGraph(lite)).toEqual([]);
    const out = await exportBpmn(lite, { layout: { engine: "dagre" } });
    expect(out.warnings).toEqual([dropped("a")]);
    const doc = parse(out.xml);
    // Every id and every original id once; one sequence flow per flow of the model.
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    const flowIds = [...doc.getElementsByTagNameNS(BPMN, "sequenceFlow")].map((el) => el.getAttributeNS(WISE, "flowId") ?? el.getAttribute("id"));
    expect([...flowIds].sort()).toEqual(lite.edges.map((e) => e.id).sort());
    const back = await importBpmn(out.xml);
    expect(back.warnings).toEqual([]);
    expect(validateGraph(back.graph)).toEqual([]);
    expect(back.graph.nodes.find((n) => n.id === "a")?.label).toBe("Check invoice");
    expect(back.graph.edges.map((e) => e.id).sort()).toEqual(lite.edges.map((e) => e.id).sort());
    // The two paths from a to b are one flow that carries both.
    expect(back.graph.edges.filter((e) => e.target === "b").map((e) => e.metrics)).toEqual([{ count: 3 }]);
  });
});
