import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { stageChip, stageChipOverlays } from "../../fixtures/path-direction";
import { type AbstractOptions, type Box, type FlowGraph, type FlowScene, type OverlayMark, abstract, buildScene, createPositions, layout, overlaysFor } from "../../src/index";

const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The box a group's title is written in: from its baseline up a full size and down a quarter, as wide as the scene's measure finds it. */
const titles = (scene: FlowScene) =>
  scene.groupMarks.map((g) => {
    const t = g.texts[0];
    return { id: g.id, box: { x: t.x, y: t.y - t.size, width: scene.textMeasure(t.text, { size: t.size, weight: t.weight }), height: 1.25 * t.size } };
  });

/** What a chip on the map covers: stage names, activities, other chips and arc labels. */
function covered(scene: FlowScene, chip: OverlayMark): string[] {
  return [
    ...titles(scene).filter((t) => meets(t.box, chip.box)).map((t) => `title ${t.id}`),
    ...scene.nodeMarks.filter((n) => meets(n.box, chip.box)).map((n) => `node ${n.id}`),
    ...scene.marks.filter((m) => m !== chip && m.kind === "chip" && m.inMap && meets(m.box, chip.box)).map((m) => `chip ${m.id}`),
    ...scene.marks.filter((m) => m.kind === "arc" && m.pill && meets(m.pill.box, chip.box)).map((m) => `arc label ${m.id}`),
  ];
}

const chipsOf = (scene: FlowScene) => scene.marks.filter((m) => m.kind === "chip" && m.inMap);

describe("a chip of a measure that belongs to a stage", () => {
  const SETTINGS: AbstractOptions[] = [0, 0.05, 0.1, 0.25, 0.5].map((s) => ({ minNodeShare: s, minEdgeShare: s }));
  SETTINGS.splice(1, 0, { minNodeShare: 0.01, minEdgeShare: 0.03 });
  const scenes: FlowScene[] = [];
  beforeAll(async () => {
    // The P2P story's overlays on the whole log, at the six settings, with stages shown as groups.
    const overlays = overlaysFor(constraintItems("global"), { graph: globalScene, locale: "en" });
    for (const setting of SETTINGS) {
      const graph: FlowGraph = abstract(globalScene, { ...setting, keepConnected: true });
      scenes.push(buildScene(graph, await layout(graph, { engine: "elk", timeoutMs: 240_000 }), { overlays, selfLoops: false }));
    }
  }, 300_000);

  it("covers no stage name, activity, other chip or arc label on the committed scene of the whole log at the six settings", () => {
    let chips = 0;
    for (const scene of scenes) {
      for (const chip of chipsOf(scene)) {
        chips++;
        expect([chip.id, covered(scene, chip)]).toEqual([chip.id, []]);
      }
    }
    // The chip of manual touches in the order stage, at every setting.
    expect(chips).toBe(6);
  });

  it("stays in its stage's title row where it fits there, and moves above the stage where it would cover the stage's name", () => {
    const box = (x: number, y: number) => ({ x, y, width: 180, height: 64 });
    const positions = createPositions({ nodes: { enter: box(20, 44), touch: box(240, 44), ship: box(500, 44) }, groups: { manual: { x: 0, y: 0, width: 440, height: 128 }, ship: { x: 480, y: 0, width: 220, height: 128 } }, edges: {} }, "given", "RIGHT");
    const scene = buildScene(stageChip, positions, { overlays: stageChipOverlays, selfLoops: false });
    const [chip] = chipsOf(scene);
    // The chip is 260 wide (its most); from the anchor (432, 6) it would start at 172, on the name "Manual touches in the order
    // stage" (12 to 12 + 33 × 7.15 = 247.95 at 13 px by the estimate): it lies above the stage, ending at its right (440).
    expect(chip.box).toEqual({ x: 180, y: -28, width: 260, height: 24 });
    expect(covered(scene, chip)).toEqual([]);
    // With a short name the chip keeps its place in the title's row.
    const named = buildScene({ ...stageChip, groups: stageChip.groups!.map((g) => (g.id === "manual" ? { ...g, label: "Manual" } : g)) }, positions, { overlays: stageChipOverlays, selfLoops: false });
    expect(chipsOf(named)[0].box).toEqual({ x: 172, y: 6, width: 260, height: 24 });
  });

  it("goes where it covers least when no place is free", () => {
    // The stage's name and an activity fill its title row; an activity covers every row above the stage; two activities
    // cover every row below it, each place there touching both.
    const crowded: FlowGraph = {
      ...stageChip,
      nodes: [...stageChip.nodes, ...["top", "low1", "low2"].map((id) => ({ id, kind: "activity" as const, label: id }))],
    };
    const positions = createPositions(
      {
        nodes: { enter: { x: 20, y: 44, width: 180, height: 64 }, touch: { x: 250, y: 2, width: 180, height: 64 }, ship: { x: 500, y: 44, width: 180, height: 64 }, top: { x: -20, y: -130, width: 480, height: 126 }, low1: { x: -20, y: 132, width: 240, height: 120 }, low2: { x: 220, y: 132, width: 240, height: 120 } },
        groups: { manual: { x: 0, y: 0, width: 440, height: 128 }, ship: { x: 480, y: 0, width: 220, height: 128 } },
        edges: {},
      },
      "given",
      "RIGHT",
    );
    const scene = buildScene(crowded, positions, { overlays: stageChipOverlays, selfLoops: false });
    const [chip] = chipsOf(scene);
    // In the title row it covers the name and Touch Order (2); above the stage only `top` (1); below both `low1` and `low2` (2):
    // the first place that covers one, above the stage ending at its right.
    expect(chip.box).toEqual({ x: 180, y: -28, width: 260, height: 24 });
    expect(covered(scene, chip)).toEqual(["node top"]);
  });
});
