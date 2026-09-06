import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useEffect, useMemo, useRef, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import { type Box, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Overlay, type Positions, abstract, layout as layoutGraph, overlaysFor, positionsBounds } from "../src/index";
import { toPNG } from "../src/canvas/index";
import { ProcessMap } from "../src/react/index";

const meta: Meta = {
  title: "Canvas",
  parameters: { layout: "fullscreen" },
};
export default meta;

/** Deterministic pseudo-random numbers (mulberry32) so the story renders the same map every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A synthetic layered process: `layers` × `perLayer` activities in `stages`
 * stage groups, every activity followed by `fanOut` activities of the next
 * layer, positions on a grid (the map takes them as given).
 */
function syntheticScene(options: { layers: number; perLayer: number; stages: number; fanOut: number; seed?: number }): { graph: FlowGraph; positions: Positions; overlays: Overlay[] } {
  const { layers, perLayer, stages, fanOut } = options;
  const random = rng(options.seed ?? 7);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = Array.from({ length: stages }, (_, i) => ({ id: `stage_${i}`, kind: "stage", label: `Stage ${i + 1}` }));
  const boxes: Record<string, Box> = {};
  const layersPerStage = Math.max(1, Math.ceil(layers / stages));
  const id = (l: number, k: number) => `a_${l}_${k}`;
  for (let l = 0; l < layers; l++) {
    for (let k = 0; k < perLayer; k++) {
      const cases = Math.round(1000 + random() * 250000);
      nodes.push({ id: id(l, k), kind: "activity", label: `Activity ${l + 1}.${k + 1}`, group: `stage_${Math.min(stages - 1, Math.floor(l / layersPerStage))}`, metrics: { cases, events: Math.round(cases * (1 + random() * 0.4)), violationShare: Number(random().toFixed(3)) } });
      boxes[id(l, k)] = { x: l * 260, y: k * 72, width: 180, height: 48 };
    }
  }
  for (let l = 0; l + 1 < layers; l++) {
    for (let k = 0; k < perLayer; k++) {
      const targets = new Set<number>();
      while (targets.size < Math.min(fanOut, perLayer)) targets.add(Math.floor(random() * perLayer));
      for (const tk of targets) {
        const count = Math.round(10 + random() * 60000);
        edges.push({ id: `${id(l, k)}->${id(l + 1, tk)}`, kind: "follows", source: id(l, k), target: id(l + 1, tk), metrics: { count, cases: count, violationShare: Number(random().toFixed(3)), medianLagHours: Number((random() * 300).toFixed(1)) } });
      }
    }
  }
  const groupBoxes: Record<string, Box> = {};
  for (const g of groups) {
    const members = nodes.filter((n) => n.group === g.id).map((n) => boxes[n.id]);
    if (!members.length) continue;
    const b = positionsBounds({ nodes: Object.fromEntries(members.map((m, i) => [String(i), m])), groups: {}, edges: {} });
    groupBoxes[g.id] = { x: b.x - 20, y: b.y - 44, width: b.width + 40, height: b.height + 64 };
  }
  const overlays: Overlay[] = nodes.filter((_, i) => i % 97 === 0).map((n) => ({ kind: "badge", target: n.id, payload: { constraintId: `c_${n.id}`, constraintType: "presence", label: `${n.label} present`, glyph: "≥1", value: Number(random().toFixed(2)), text: "missing share" } }));
  const partial = { nodes: boxes, groups: groupBoxes, edges: {} };
  return {
    graph: { nodes, edges, groups, meta: { label: "Synthetic process", cases: 250000, events: nodes.length * 1000 } },
    positions: { ...partial, bounds: positionsBounds(partial), engine: "given", direction: "RIGHT" },
    overlays,
  };
}

const SIZES: Record<string, { layers: number; perLayer: number; stages: number; fanOut: number }> = {
  "2,500 activities / 10,000 paths": { layers: 50, perLayer: 50, stages: 10, fanOut: 4 },
  "5,000 activities / 20,000 paths": { layers: 100, perLayer: 50, stages: 10, fanOut: 4 },
  "1,000 activities / 4,000 paths": { layers: 20, perLayer: 50, stages: 5, fanOut: 4 },
};

/**
 * A map above the element threshold (2,000 activities plus paths) is drawn
 * on a canvas: the same overlays (badges, self-loops, arcs), hover through the
 * core's R-tree with the element's description as a tooltip, click and
 * Shift-click selection, the actions menu on a right click, the keyboard
 * routes of the React Flow renderer, level of detail by zoom, and the
 * abstraction controls and legend. Drag to pan, Ctrl or Cmd with the wheel
 * (or the buttons) to zoom.
 */
export const LargeMap: StoryObj<{ size: string }> = {
  name: "large map",
  args: { size: "5,000 activities / 20,000 paths" },
  argTypes: { size: { control: "select", options: Object.keys(SIZES) } },
  render: (args) => {
    const scene = useMemo(() => syntheticScene(SIZES[args.size] ?? SIZES["5,000 activities / 20,000 paths"]), [args.size]);
    const ref = useRef<HTMLDivElement>(null);
    const [renderer, setRenderer] = useState<string>("");
    useEffect(() => {
      const el = ref.current?.querySelector(".wf-process-map");
      setRenderer(el?.getAttribute("data-renderer") ?? "");
    }, [scene]);
    return (
      <div ref={ref} style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--wf-line)", display: "flex", gap: 16, fontFamily: "var(--wf-font)", fontSize: 12 }}>
          <strong data-testid="canvas-size">
            {scene.graph.nodes.length.toLocaleString("en")} activities · {scene.graph.edges.length.toLocaleString("en")} paths · {scene.graph.groups?.length} stages
          </strong>
          <span data-testid="canvas-renderer">renderer: {renderer || "…"}</span>
          <span style={{ color: "var(--wf-ink-muted)" }}>Hover for the description, click to select, right click for the actions menu, drag to pan, Ctrl/Cmd + wheel to zoom.</span>
        </div>
        <div style={{ minHeight: 0 }}>
          <ProcessMap graph={scene.graph} positions={scene.positions} overlays={scene.overlays} renderer="auto" controls={false} lanes="stages" />
        </div>
      </div>
    );
  },
};

/**
 * The P2P map forced onto the canvas renderer (below the threshold it would
 * use React Flow): the same map, overlays and interaction on a canvas.
 */
export const P2POnCanvas: StoryObj = {
  name: "P2P map on canvas",
  render: () => {
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene }), []);
    return (
      <div style={{ height: "100vh", width: "100vw" }}>
        <ProcessMap graph={globalScene} overlays={overlays} defaultAbstraction={{ minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true }} renderer="canvas" layout={{ elkWorkerUrl }} />
      </div>
    );
  },
};

/**
 * `toPNG` draws a scene with the canvas routines into a bitmap with the same
 * figure presets and embedded legend as `toSVG`. The button renders the
 * abstracted P2P map (single-column preset, 2× density) and shows the result.
 */
export const PngExport: StoryObj = {
  name: "PNG export",
  render: () => {
    const [url, setUrl] = useState<string | undefined>();
    const [size, setSize] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const shown = useMemo(() => abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true }), []);
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: shown }), [shown]);
    const [positions, setPositions] = useState<Positions | undefined>();
    useEffect(() => {
      let live = true;
      layoutGraph(shown, { elkWorkerUrl }).then((p) => live && setPositions(p));
      return () => {
        live = false;
      };
    }, [shown]);
    const render = async () => {
      if (!positions) return;
      setBusy(true);
      const blob = await toPNG({ graph: shown, positions, overlays, title: "Purchase-to-pay", subtitle: "BPIC 2019, all items", lanes: "stages" }, { preset: "single-column", scale: 2 });
      if (url) URL.revokeObjectURL(url);
      setUrl(URL.createObjectURL(blob));
      setSize(`${Math.round(blob.size / 1024)} kB`);
      setBusy(false);
    };
    return (
      <div style={{ padding: 12, fontFamily: "var(--wf-font)", fontSize: 12, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" className="wf-button" onClick={render} disabled={!positions || busy} data-testid="png-button">
            {busy ? "…" : "Render PNG"}
          </button>
          {url ? (
            <a href={url} download="p2p-map.png" data-testid="png-link">
              Download p2p-map.png ({size})
            </a>
          ) : (
            <span style={{ color: "var(--wf-ink-muted)" }}>{positions ? "Ready." : "Laying out…"}</span>
          )}
        </div>
        {url ? <img src={url} alt="The purchase-to-pay map as a PNG figure with its legend" data-testid="png-preview" style={{ maxWidth: "100%", border: "1px solid var(--wf-line)" }} /> : null}
      </div>
    );
  },
};
