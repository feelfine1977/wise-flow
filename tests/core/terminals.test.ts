/**
 * Start and End (WF-02): event nodes drawn as outlined circles with ▶ and ■
 * in the ink and "Start"/"End" beneath, and the paths from a start and to an
 * end event drawn in the pale `terminal` paint whatever the measure, on the
 * width scale of every path, solid and labelled with their count; distinct
 * from the opted-in host flows `added-by-map`, which stay neutral dots.
 */
import { describe, expect, it } from "vitest";
import { type FlowScene, buildScene, dashTokens, defaultTheme, instrumentTheme, themeColors, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";
import { describeIndexedEdge } from "../../src/core/describe";
import { graph, positions } from "../support/terminals";

const edge = (s: FlowScene, id: string) => s.edgeMarks.find((m) => m.id === id)!;
const node = (s: FlowScene, id: string) => s.nodeMarks.find((m) => m.id === id)!;
const terminalIds = ["start->a", "start->b", "e->end", "d->end"];

describe("terminal paths", () => {
  it("are drawn in the terminal paint in every measure, while recorded paths take the measure's colours", () => {
    for (const measure of ["frequency", "shortfall", "performance"] as const) {
      for (const theme of [defaultTheme, instrumentTheme]) {
        for (const scheme of ["light", "dark"] as const) {
          const s = buildScene(graph, positions, { measure, theme, scheme, style: { addedFlowLabel: true } });
          const terminal = themeColors(theme, scheme).terminal;
          for (const id of terminalIds) expect(edge(s, id).color, `${measure} ${scheme} ${id}`).toBe(terminal);
          expect(edge(s, "a->c").color).not.toBe(terminal);
          expect([edge(s, "start->a").terminal, edge(s, "e->end").terminal, edge(s, "a->c").terminal]).toEqual(["start", "end", undefined]);
        }
      }
    }
    // Performance colours the recorded paths by their lag, and no terminal path is "not evaluated" for lacking one.
    const p = buildScene(graph, positions, { measure: "performance", theme: instrumentTheme });
    expect(terminalIds.map((id) => edge(p, id).notEvaluated)).toEqual([undefined, undefined, undefined, undefined]);
    expect(new Set(["a->c", "c->d", "d->e"].map((id) => edge(p, id).color)).size).toBeGreaterThan(1);
  });

  it("take their width from the scale every path shares and are labelled with their count, without a measure's value", () => {
    const s = buildScene(graph, positions, { measure: "performance", theme: instrumentTheme });
    // e→end and d→e both count 600 cases: one width.
    expect(edge(s, "e->end").width).toBe(edge(s, "d->e").width);
    expect(edge(s, "start->a").width).toBeGreaterThan(edge(s, "start->b").width);
    expect(terminalIds.map((id) => edge(s, id).texts.map((t) => t.text))).toEqual([["800"], ["140"], ["600"], ["300"]]);
    expect(edge(s, "d->e").texts[0].text).toMatch(/·/);
    expect(terminalIds.map((id) => edge(s, id).dash)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("are not the measure's colour domain: the recorded paths' colours are as without them", () => {
    const recorded = { ...graph, edges: graph.edges.filter((e) => !terminalIds.includes(e.id)) };
    const a = buildScene(graph, positions, { measure: "performance" });
    const b = buildScene(recorded, positions, { measure: "performance" });
    for (const id of ["a->c", "c->d", "b->d", "d->e"]) expect(edge(a, id).color, id).toBe(edge(b, id).color);
  });

  it("leave the opted-in host flows as they were: neutral round dots", () => {
    const s = buildScene(graph, positions, { style: { addedFlowLabel: true } });
    const added = edge(s, "a->b");
    expect([added.addedFlow, added.terminal, added.color, added.dash]).toEqual([true, undefined, defaultTheme.color.neutral, dashTokens.addedFlow.map((n) => n * added.width)]);
    // Dots and the dashes of re-added paths stay apart: their length-to-gap ratios differ.
    expect(dashTokens.addedFlow[0] / dashTokens.addedFlow[1]).not.toBe(dashTokens.reconnectedPath[0] / dashTokens.reconnectedPath[1]);
  });

  it("include sequence flows from Start and to End that the host tags start and end, but no untagged flow", () => {
    const host = { ...graph, edges: graph.edges.map((e) => (e.id === "start->a" ? { ...e, kind: "flow" as const, tags: ["start"] } : e.id === "e->end" ? { ...e, kind: "flow" as const, tags: ["end"] } : e.id === "d->end" ? { ...e, kind: "flow" as const } : e)) };
    const s = buildScene(host, positions, { measure: "performance" });
    expect([edge(s, "start->a").terminal, edge(s, "e->end").terminal, edge(s, "d->end").terminal]).toEqual(["start", "end", undefined]);
    expect(edge(s, "start->a").color).toBe(defaultTheme.color.terminal);
  });

  it("are described in cases that start or end at their activity, not in transitions", () => {
    const index = { nodes: new Map(graph.nodes.map((n) => [n.id, n])) };
    const start = { ...graph.edges[0], metrics: { count: 800, cases: 800 } };
    expect(describeIndexedEdge(start, index, "en")).toBe("path Start → Create Purchase Requisition Item. 800 cases begin with this activity.");
    expect(describeIndexedEdge({ ...graph.edges[6], kind: "flow", tags: ["end"], metrics: { count: 600 } }, index, "de")).toBe("Sequenzfluss Clear Invoice → Ende. 600 Fälle enden mit dieser Aktivität.");
    // A recorded path keeps its description.
    expect(describeIndexedEdge(graph.edges[2], index, "en")).toBe("path Create Purchase Requisition Item → Record Goods Receipt. 700 cases. median lag 30 h. 20 % expectation shortfall.");
  });

  it("are keyed in the legend with the start and end events", () => {
    const s = buildScene(graph, positions, { theme: instrumentTheme });
    expect(s.legend.rows.filter((r) => r.kind === "key").map((r) => r.kind === "key" && [r.key, r.glyph, r.text])).toEqual([
      ["terminal", "─", "Paths from Start and to End: cases by their first and last activity"],
      ["start", "▶", "Start of the process"],
      ["end", "■", "End of the process"],
    ]);
    const recorded = { ...graph, nodes: graph.nodes.filter((n) => n.kind !== "event"), edges: graph.edges.filter((e) => !terminalIds.includes(e.id)) };
    expect(buildScene(recorded, positions).legend.keys.map((k) => k.kind)).not.toContain("terminal");
  });
});

describe("start and end events", () => {
  it("are outlined circles in lineStrong with ▶ and ■ in the ink and Start and End beneath", () => {
    for (const theme of [defaultTheme, instrumentTheme]) {
      const s = buildScene(graph, positions, { theme });
      const [start, end] = [node(s, "start"), node(s, "end")];
      expect([start.shape, start.stroke.paint, start.stroke.width, end.stroke.paint, end.stroke.width]).toEqual(["circle", "lineStrong", theme.stroke.eventStart, "lineStrong", theme.stroke.eventEnd]);
      expect(start.texts.map((t) => [t.role, t.text, t.paint])).toEqual([["glyph", "▶", "ink"], ["label", "Start", "ink"]]);
      expect(end.texts.map((t) => [t.role, t.text, t.paint])).toEqual([["glyph", "■", "ink"], ["label", "End", "ink"]]);
      const glyph = start.texts[0];
      expect([glyph.size, glyph.weight, glyph.anchor, glyph.x]).toEqual([15, 600, "middle", positions.nodes.start.x + 18]);
    }
    expect([instrumentTheme.stroke.eventStart, instrumentTheme.stroke.eventEnd]).toEqual([1, 1]);
  });

  it("write Beginn and Ende in German, and a label of their own where the node has one", () => {
    const de = buildScene(graph, positions, { locale: "de" });
    expect([node(de, "start").texts[1].text, node(de, "end").texts[1].text]).toEqual(["Beginn", "Ende"]);
    const own = buildScene({ ...graph, nodes: graph.nodes.map((n) => (n.id === "start" ? { ...n, label: "Order placed" } : n)) }, positions);
    expect(node(own, "start").texts[1].text).toBe("Order placed");
  });

  it("add the host's statement under the label only where the style asks for it", () => {
    expect(node(buildScene(graph, positions), "start").texts).toHaveLength(2);
    const s = buildScene(graph, positions, { style: { terminals: { statement: true } } });
    // On up to two lines of 160 under the label, muted.
    const statement = node(s, "start").texts.slice(2);
    expect(statement.map((t) => [t.role, t.paint])).toEqual([["label", "inkMuted"], ["label", "inkMuted"]]);
    expect(statement.map((t) => t.text).join(" ")).toBe("1,000 cases · 940 (94 %) at a shown activity");
    expect(statement[0].y).toBeGreaterThan(node(s, "start").texts[1].y);
    expect(statement[1].y).toBeGreaterThan(statement[0].y);
    const de = buildScene(graph, positions, { locale: "de", style: { terminals: { statement: true } } });
    expect(node(de, "end").texts.slice(2).map((t) => t.text).join(" ")).toBe("1.000 Fälle · 900 (90 %) an einer gezeigten Aktivität");
  });

  it("are drawn alike by the SVG export and the Canvas map", () => {
    const svg = toSVG({ graph, positions }, { legend: false, theme: "instrument" });
    expect(svg).toMatch(/<g class="wf-node wf-node-event" data-id="start"><circle [^>]*stroke="#8c94a1" stroke-width="1"\/><text [^>]*font-size="15" font-weight="600" text-anchor="middle" fill="#1a1d21">▶<\/text><text [^>]*>Start<\/text>/);
    expect(svg).toMatch(/data-id="start-&gt;a"><path [^>]*stroke="#c9ced6"/);
    const texts: string[] = [];
    const strokes: string[] = [];
    const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : k === "fillText" ? (s: string) => texts.push(s) : k === "stroke" ? () => strokes.push(String(t.strokeStyle)) : () => undefined),
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as DrawContext;
    drawScene(ctx, prepareScene(graph, positions, { theme: instrumentTheme }), { x: 0, y: 0, zoom: 1, width: 2000, height: 400 }, undefined, { cull: false });
    expect(texts).toEqual(expect.arrayContaining(["▶", "Start", "■", "End"]));
    expect(strokes).toContain("#c9ced6");
  });
});
