import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../../fixtures/p2p_stages";
import { liteFromStages } from "../../src/bpmn/headless";
import {
  type Box,
  type ColorScheme,
  type FlowGraph,
  type FlowScene,
  type FlowSceneOptions,
  type LaneMode,
  type Overlay,
  type Positions,
  abstract,
  buildScene,
  checkTheme,
  contrastRatio,
  createPositions,
  defaultTheme,
  hexToRgb,
  layout,
  overlaysFor,
  printTheme,
  shortfallStyle,
} from "../../src/index";
import * as elements from "./element-kinds";
import * as kinds from "./overlay-kinds";
import p2pMap from "./p2p-map-positions.json";

/** The committed fixtures, each with the overlays its stories draw on it and the lanes it is drawn in. */
interface Fixture {
  graph: FlowGraph;
  positions: Positions;
  overlays?: Overlay[];
  lanes?: LaneMode;
}

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const vendor = abstract(vendorScene, { minEdgeShare: 0.02 });
const stages = abstract(globalScene, { collapse: "all" });
const roles = liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes: "role" });
// The P2P story: its abstraction, its overlays and the layout ELK gives it (committed as data).
const story = abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true });
const storyPositions = createPositions(p2pMap as Pick<Positions, "nodes" | "groups" | "edges">, "elk", "RIGHT");
const storyOverlays = overlaysFor(constraintItems("global"), { graph: globalScene, locale: "en" });

const fixtures: Record<string, Fixture> = {};

beforeAll(async () => {
  const laid = async (graph: FlowGraph) => layout(graph, { engine: "dagre" });
  Object.assign(fixtures, {
    elements: { graph: elements.graph, positions: elements.positions },
    kinds: { graph: kinds.graph, positions: kinds.positions, overlays: kinds.overlays },
    global: { graph: global, positions: await laid(global), overlays: overlaysFor(constraintItems(), { graph: global }) },
    vendor: { graph: vendor, positions: await laid(vendor), overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }) },
    stages: { graph: stages, positions: await laid(stages), overlays: overlaysFor(constraintItems(), { graph: stages }) },
    roleLanes: { graph: roles, positions: await laid(roles), lanes: "roles" },
    story: { graph: story, positions: storyPositions, overlays: storyOverlays },
    storyBands: { graph: story, positions: storyPositions, overlays: storyOverlays, lanes: "stages" },
  });
});

const scenes = (options: FlowSceneOptions = {}): [string, FlowScene][] =>
  Object.entries(fixtures).map(([name, f]) => [name, buildScene(f.graph, f.positions, { overlays: f.overlays, lanes: f.lanes, ...options })]);

const SCHEMES: ColorScheme[] = ["light", "dark"];

/** Hue (degrees) and chroma (the largest channel less the smallest, 0–1) of a hex colour. */
function hue(color: string): { hue: number; chroma: number } {
  const [r, g, b] = hexToRgb(color).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, chroma: d };
}
/** A grey: channels at most 8 % apart (the dark ramp's dimmest, #6e737d, is 6 % apart). */
const grey = (color: string) => hue(color).chroma <= 0.08;
const hueDistance = (a: string, b: string) => {
  const d = Math.abs(hue(a).hue - hue(b).hue);
  return Math.min(d, 360 - d);
};

/**
 * Paths with a count of the scene's path metric (cases, transitions where a graph gives no cases): follows edges and
 * sequence flows, but not the terminal paths from Start and to End, which are pale on purpose (the `terminal` paint,
 * a hairline gated at 1.3 : 1, its count label carrying its meaning; see `terminals.test.ts`).
 */
const counted = (scene: FlowScene) => scene.edgeMarks.filter((m) => (m.kind === "follows" || m.kind === "flow") && !m.terminal && Number.isFinite(m.edge.metrics?.[scene.scales.pathMetric]));

describe("paths in the default style", () => {
  for (const scheme of SCHEMES) {
    it(`are grey, at least 3 : 1 on the paper, and stand out more with more cases (${scheme})`, () => {
      for (const [name, scene] of scenes({ scheme })) {
        const paths = counted(scene).sort((a, b) => a.edge.metrics![scene.scales.pathMetric] - b.edge.metrics![scene.scales.pathMetric]);
        if (!paths.length) continue;
        const contrast = paths.map((m) => contrastRatio(m.color, scene.colors.paper));
        expect(Math.min(...contrast), name).toBeGreaterThanOrEqual(3);
        // Contrast against the paper never falls as the count rises: darker in the light scheme, brighter in the dark.
        contrast.forEach((c, i) => i && expect(c, `${name}: ${paths[i].id} after ${paths[i - 1].id}`).toBeGreaterThanOrEqual(contrast[i - 1] - 1e-9));
        for (const m of paths) expect(grey(m.color), `${name}: ${m.id} ${m.color}`).toBe(true);
      }
    });
  }

  it("take their colour from the count on a square-root scale over the paths and their width from the graph's square-root scale from 0", () => {
    // Counts 100 and 400 on a domain 100 … 900: the square roots 10, 20 and 30 put 400 half-way along the ramp.
    const graph: FlowGraph = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, kind: "activity", label: id })),
      edges: [
        { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 100 } },
        { id: "bc", kind: "follows", source: "b", target: "c", metrics: { count: 400 } },
        { id: "cd", kind: "follows", source: "c", target: "d", metrics: { count: 900 } },
      ],
    };
    const boxes = Object.fromEntries(["a", "b", "c", "d"].map((id, i) => [id, { x: i * 200, y: 0, width: 100, height: 40 }]));
    const positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT");
    const light = buildScene(graph, positions);
    // The light ramp #8c8c8c #6b6b6b #4d4d4d #2e2e2e #141414: its ends and its middle stop.
    expect(light.edgeMarks.map((m) => m.color)).toEqual(["#8c8c8c", "#4d4d4d", "#141414"]);
    // Widths from 0 to the strongest path onto 0 to 8: √(100 / 900) × 8 = 2.67, √(400 / 900) × 8 = 5.33 and 8.
    expect(light.edgeMarks.map((m) => m.width)).toEqual([2.67, 5.33, 8]);
    // The dark ramp #6e737d #8d929b #adb1b8 #cfd2d6 #f2f3f5 runs from dim to bright.
    expect(buildScene(graph, positions, { scheme: "dark" }).edgeMarks.map((m) => m.color)).toEqual(["#6e737d", "#adb1b8", "#f2f3f5"]);
    // The shortfall colouring is a style away: violation share 0.5 on the shortfall ramp is #fd8d3c.
    const short = { ...graph, edges: graph.edges.map((e) => ({ ...e, metrics: { ...e.metrics, violationShare: 0.5 } })) };
    expect(buildScene(short, positions, { style: shortfallStyle }).edgeMarks.map((m) => m.color)).toEqual(["#fd8d3c", "#fd8d3c", "#fd8d3c"]);
    expect(buildScene(short, positions, { style: shortfallStyle }).edgeMarks.map((m) => m.width)).toEqual([2.67, 5.33, 8]);
  });
});

describe("deviations in the default style", () => {
  for (const scheme of SCHEMES) {
    it(`are the only hue, the accent; paths are grey and no stage takes the accent's hue (${scheme})`, () => {
      for (const [name, scene] of scenes({ scheme })) {
        const accent = scene.colors.accent;
        expect(accent).toBe(scheme === "light" ? "#b84a00" : "#ff8c42");
        for (const m of scene.edgeMarks) expect(m.kind === "constraint" ? m.color === accent : grey(m.color), `${name}: path ${m.id} ${m.color}`).toBe(true);
        for (const m of scene.marks) {
          // A self-loop that stands for a path is drawn as the path; hatching is the out-of-scope grey.
          const isPath = m.kind === "selfLoop" && !!m.overlay.payload?.edgeId && !m.overlay.payload?.constraintId;
          if (m.kind === "hatch") continue;
          expect(isPath ? grey(m.color) : m.color === accent, `${name}: ${m.id} ${m.color}`).toBe(true);
          const paints = [m.fill?.paint, m.stroke?.paint, m.pill?.fill.paint, m.pill?.stroke.paint, ...m.texts.map((t) => t.paint)];
          for (const p of paints) if (p) expect(["value", "paper", "ink", "line"], `${name}: ${m.id} paints ${p}`).toContain(p);
        }
        for (const m of [...scene.nodeMarks, ...scene.groupMarks]) {
          if (grey(m.color)) continue;
          expect(hueDistance(m.color, accent), `${name}: ${m.id} ${m.color}`).toBeGreaterThan(30);
        }
      }
    });
  }

  it("leave orange and vermilion out of the stage palette; the other colours keep their pattern twins", () => {
    expect(defaultTheme.palette.categorical).toEqual(["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#F0E442", "#999999"]);
    expect(defaultTheme.patterns).toEqual(["solid", "dots", "crosshatch", "horizontal", "diagonal-reverse", "grid"]);
    expect(printTheme.palette.categorical).toEqual(["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#F0E442"]);
    expect(printTheme.patterns).toEqual(["diagonal", "crosshatch", "horizontal", "vertical", "grid"]);
    for (const theme of [defaultTheme, printTheme]) {
      expect(new Set(theme.patterns.slice(0, theme.palette.categorical.length)).size).toBe(theme.palette.categorical.length);
      for (const c of theme.palette.categorical) if (!grey(c)) expect(hueDistance(c, theme.color.accent), c).toBeGreaterThan(30);
    }
  });
});

describe("arcs, their labels and dashes", () => {
  for (const scheme of SCHEMES) {
    it(`draw every arc at one width, label it with share and base, and dash only what was not directly observed (${scheme})`, () => {
      let arcs = 0;
      let reverse = 0;
      for (const [name, scene] of scenes({ scheme })) {
        for (const m of scene.marks.filter((x) => x.kind === "arc")) {
          arcs++;
          expect(m.stroke, `${name}: ${m.id}`).toEqual({ paint: "value", width: 1, opacity: 0.9 });
          const label = m.texts.map((t) => t.text).join(" ");
          // The fixture's arcs carry the cases they were evaluated on; the overlay kinds' arcs have none.
          if (name !== "kinds") expect(label, `${name}: ${m.id}`).toMatch(/^(late|order|⇐) \d+(\.\d)? % of [\d,]+$/);
          if (m.overlay.payload?.reverse) {
            reverse++;
            expect(label.startsWith("⇐ "), `${name}: ${m.id} ${label}`).toBe(true);
          }
          expect(m.pill, `${name}: ${m.id}`).toMatchObject({ fill: { paint: "paper" }, stroke: { paint: "value", width: 1 } });
        }
        const dashed = [
          ...scene.nodeMarks.filter((m) => m.stroke.dash).map((m) => [m.id, m.reconnected] as const),
          ...scene.edgeMarks.filter((m) => m.dash).map((m) => [m.id, m.reconnected] as const),
          ...scene.groupMarks.filter((m) => m.stroke.dash).map((m) => [m.id, false] as const),
          ...scene.marks.filter((m) => m.stroke?.dash || m.pill?.stroke.dash).map((m) => [m.id, false] as const),
        ];
        for (const [id, observed] of dashed) expect(observed, `${name}: ${id} is dashed`).toBe(true);
      }
      expect(arcs).toBeGreaterThan(20);
      expect(reverse).toBeGreaterThan(3);
    });
  }

  it("write the base in the locale and the reverse sign in German too", () => {
    const f = fixtures.global;
    const labels = buildScene(f.graph, f.positions, { overlays: overlaysFor(constraintItems(), { graph: global, locale: "de" }), locale: "de" })
      .marks.filter((m) => m.kind === "arc")
      .map((m) => m.texts[0].text);
    // The lag and precedence constraints of the fixture were evaluated on 11,129 cases.
    expect([...new Set(labels)].sort()).toEqual(["Reihenfolge 52 % von 11.129", "verspätet 19 % von 11.129", "⇐ 52 % von 11.129"]);
  });
});

const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("the labels of deviations on the P2P map with all overlays", () => {
  for (const lanes of ["none", "stages"] as const) {
    it(`cover no other label and no activity (lanes: ${lanes})`, () => {
      const scene = buildScene(story, storyPositions, { overlays: storyOverlays, lanes, lodBySize: true });
      const labels: [string, Box][] = [];
      scene.marks.forEach((m, i) => {
        if (m.kind === "arc" && m.pill) labels.push([m.id, m.pill.box]);
        if (m.kind === "badge" || (m.kind === "chip" && m.inMap)) labels.push([m.id, m.box]);
        const label = scene.geometry.shapes[i].label;
        if (m.kind === "selfLoop" && label) labels.push([m.id, label]);
      });
      // Twelve arc pills; badges on Clear Invoice, Record Invoice Receipt and Cancel Invoice Receipt; the manual touches chip
      // in the Purchase order group; the labels of three repeated paths and of the singularity loop on Record Invoice Receipt.
      const count = (kind: string) => labels.filter(([id]) => id.startsWith(`${kind}:`)).length;
      expect(["arc", "badge", "chip", "selfLoop"].map(count)).toEqual([12, 3, 1, 4]);
      for (const [i, [id, box]] of labels.entries()) {
        expect(labels.filter(([, other], j) => j !== i && meets(box, other)).map(([o]) => o), id).toEqual([]);
        expect(Object.entries(scene.positions.nodes).filter(([, b]) => meets(b, box)).map(([n]) => n), id).toEqual([]);
      }
    });
  }
});

describe("the presets", () => {
  it("pass checkTheme in both schemes, the accent and the path ramp of each scheme included", () => {
    expect(checkTheme(defaultTheme)).toEqual([]);
    expect(checkTheme(printTheme)).toEqual([]);
    // A dark ramp that runs the wrong way (its contrast on the paper falls with the cases), or an accent too faint
    // for its labels (#5a2a10 has 1.5 : 1 on #16181d), is reported for its scheme.
    const ramp = defaultTheme.darkPalette!.neutral!;
    const wrong = checkTheme({ ...defaultTheme, darkPalette: { neutral: [...ramp].reverse() }, dark: { ...defaultTheme.dark, accent: "#5a2a10" } });
    expect(wrong).toEqual([
      { kind: "rampOrder", scheme: "dark", subject: "palette.neutral", value: [...ramp].reverse().join(" ") },
      { kind: "text", scheme: "dark", subject: "accent on paper", value: 1.5, minimum: 4.5 },
      { kind: "line", scheme: "dark", subject: "accent on paper", value: 1.5, minimum: 3 },
    ]);
  });
});
