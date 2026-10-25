/**
 * Word-aware shortening (WF-04): a name shortened on a card ends with whole
 * words and an ellipsis, never "Ve…" for "Vendor creates invoice"; a single
 * word too wide for the line is cut between characters, as before; chips,
 * legend rows and figure texts keep the character cut. The readable ladder's
 * name rule reads the theme's `readable.nameChars`.
 */
import { describe, expect, it } from "vitest";
import { type FlowGraph, buildScene, createPositions, defaultTheme, distinctLines, estimateTextWidth, readableZoom, truncateText } from "../../src/index";
import { wrapLines } from "../../src/core/text";

const font = { size: 10 };
// The estimate: 5.5 per character at 10.
const chars = (n: number) => n * 5.5;

describe("truncateText with words", () => {
  it("keeps whole words before the ellipsis", () => {
    // Room for ten characters: "Vendor cre…" by characters, "Vendor…" by words.
    expect(truncateText("Vendor creates invoice", chars(10), font)).toBe("Vendor cr…");
    expect(truncateText("Vendor creates invoice", chars(10), font, estimateTextWidth, { words: true })).toBe("Vendor…");
    expect(truncateText("Vendor creates invoice", chars(15), font, estimateTextWidth, { words: true })).toBe("Vendor creates…");
  });

  it("cuts a word between characters only where no whole word fits", () => {
    expect(truncateText("Supercalifragilisticexpialidocious receipt", chars(10), font, estimateTextWidth, { words: true })).toBe("Supercali…");
    expect(truncateText("Ve", chars(1), font, estimateTextWidth, { words: true })).toBe("V…");
  });

  it("leaves a text that fits and a text of a script without spaces as they are", () => {
    expect(truncateText("Vendor creates invoice", chars(30), font, estimateTextWidth, { words: true })).toBe("Vendor creates invoice");
    // Wide script: a full em per character, no spaces to break at: the character cut.
    expect(truncateText("請求書を作成する", 35, font, estimateTextWidth, { words: true })).toBe(truncateText("請求書を作成する", 35, font));
  });
});

describe("a card's name", () => {
  it("never ends its last line in an ellipsis after a partial word", () => {
    const lines = wrapLines("Approve the purchase requisition of a vendor", chars(18), font, 2, estimateTextWidth, { words: true });
    expect(lines).toEqual(["Approve the", "purchase…"]);
    for (const l of lines.slice(-1)) expect("Approve the purchase requisition of a vendor".split(" ")).toContain(l.replace(/…$/, ""));
  });

  it("is shortened by words on every card of a scene", () => {
    const names = ["Vendor creates invoice", "Record Service Entry Sheet with an approval step", "Change Approval for Purchase Order of the department"];
    const graph: FlowGraph = { nodes: names.map((label, i) => ({ id: `n${i}`, kind: "activity" as const, label, metrics: { cases: 10 } })), edges: [] };
    const positions = createPositions({ nodes: Object.fromEntries(names.map((_, i) => [`n${i}`, { x: i * 200, y: 0, width: 120, height: 64 }])), groups: {}, edges: {} }, "given", "RIGHT");
    const scene = buildScene(graph, positions);
    for (const m of scene.nodeMarks) {
      const words = m.node.label.split(" ");
      for (const levels of [m.texts, m.levels!.full, m.levels!.name, m.levels!.line]) {
        const last = levels.filter((t) => t.role === "nameLine").at(-1)!.text;
        if (last.endsWith("…")) expect(words, `${m.node.label}: ${last}`).toContain(last.replace(/…$/, "").split(" ").at(-1));
      }
    }
  });

  it("is still told apart from a name shortened alike", () => {
    const items = ["Record Invoice Receipt for the vendor", "Record Invoice Receipt for the customer"].map((name) => ({ name, room: chars(16), font }));
    const [a, b] = distinctLines(items, 2, estimateTextWidth);
    expect(a.at(-1)).not.toBe(b.at(-1));
  });
});

describe("the readable ladder's name rule", () => {
  it("reads the theme's nameChars", () => {
    const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "Create Purchase Requisition Item", metrics: { cases: 1 } }], edges: [] };
    const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");
    const zoom = (nameChars: number) => readableZoom(buildScene(graph, positions, { theme: { ...defaultTheme, readable: { nameChars } } }).readable, 9, "line");
    expect(zoom(8)).toBe(readableZoom(buildScene(graph, positions).readable, 9, "line"));
    // Fewer characters to keep: the name holds at a smaller zoom.
    expect(zoom(4)).toBeLessThan(zoom(8));
  });
});
