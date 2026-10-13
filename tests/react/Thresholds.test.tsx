/**
 * How the map reads across thresholds and sizes, on the React map and on the
 * Canvas map. `ProcessMap` is given the scene's graph and overlays, the
 * controls of a rung (controlled) and the Dagre layout of what it shows, in a
 * 1,200 × 800 pane, with a budget of 24 paths, and fits itself. The React map
 * is read from its DOM (`map-reading.ts`); the Canvas map's last frame is
 * drawn again, with the scene, view and options the map drew it with, into a
 * recording context, and its note and legend are read from the DOM. Every
 * rung of the two committed scenes is read on both maps; of the generated
 * scenes, one rung of each seed and magnitude, on one map in turn. The open findings are those of the
 * Canvas drawing's search (`tests/core/thresholds.test.ts`); any other
 * failure fails, with the picture of its rung attached.
 *
 * Then the layout under the controls: with the fake ELK worker, controls
 * change while layouts run and their answers arrive in any order, on the
 * React map and the Canvas map in turn; the map never shows a layout of other
 * settings, and every layout is answered or its worker stopped.
 */
import { type RenderResult, act, cleanup, render } from "@testing-library/react";
import { type TestContext, afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DrawContext, DrawOptions, PreparedScene, View } from "../../src/canvas/index";
import { type AbstractOptions, type FlowGraph, type Locale, type LodRules, type Overlay, type Positions, abstract, buildScene, defaultNodeSize, estimateTextWidth, layout, toSVG } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import { type LadderScene, type Rung, MAGNITUDES, RUNGS, collapsedGraph, committedScenes, generatedScene, optionsOf, shownGraph } from "../support/ladder";
import { type Failure, type Reading, arcLabelPlaces, checkReading, findingOf, fitView, pictureOf, readCanvas } from "../support/reading";
import { savePicture } from "../support/pictures";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { FakeLayoutWorker, layoutSignature, replyOf } from "../support/workers";
import { fittedZoom, readLegend, readReactMap } from "./map-reading";

/** The frames the Canvas map draws: the context and the arguments of each `drawScene`. */
const frames = vi.hoisted(() => [] as { ctx: unknown; scene: unknown; view: unknown; options: unknown }[]);
vi.mock(import("../../src/canvas/draw"), async (original) => {
  const module = await original();
  return {
    ...module,
    drawScene: (ctx: DrawContext, scene: PreparedScene, view: View, state?: Parameters<typeof module.drawScene>[3], options?: DrawOptions) => {
      frames.push({ ctx, scene, view, options });
      return module.drawScene(ctx, scene, view, state, options);
    },
  };
});

const BUDGET = 24;
const PANE = { width: 1200, height: 800 };
type Renderer = "react" | "canvas";

/** A 2D context that draws nothing and measures as the library estimates, in the size of the font last set: the map measures its texts with it too. */
let quietFont = "10px sans-serif";
const quiet = new Proxy({} as Record<string, unknown>, {
  get: (_t, key: string) =>
    key === "measureText" ? (s: string) => ({ width: estimateTextWidth(s, { size: parseFloat(/([\d.]+)px/.exec(quietFont)![1]) }) }) : key === "font" ? quietFont : key === "createPattern" ? () => null : () => undefined,
  set: (_t, key, value) => {
    if (key === "font") quietFont = String(value);
    return true;
  },
}) as unknown as CanvasRenderingContext2D;

const px = (v: string, fallback: number) => (/^[\d.]+px$/.test(v) ? parseFloat(v) : fallback);
const saved = {
  offsetWidth: Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "offsetWidth")!,
  offsetHeight: Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "offsetHeight")!,
  rect: window.HTMLElement.prototype.getBoundingClientRect,
};
beforeAll(() => {
  // React Flow's pane and the canvas take the 1,200 × 800 of the map's box where they are sized in percent.
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { configurable: true, get() { return px((this as HTMLElement).style.width, PANE.width); } },
    offsetHeight: { configurable: true, get() { return px((this as HTMLElement).style.height, PANE.height); } },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const width = px(this.style.width, PANE.width);
    const height = px(this.style.height, PANE.height);
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };
});
afterAll(() => {
  Object.defineProperties(window.HTMLElement.prototype, { offsetWidth: saved.offsetWidth, offsetHeight: saved.offsetHeight });
  window.HTMLElement.prototype.getBoundingClientRect = saved.rect;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function reducedMotion() {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query.includes("reduce"), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

/** What the map shows at a rung: the given marks join the graph's before the abstraction, which moves them to a collapsed stage. */
const mapShown = (scene: Pick<LadderScene, "graph" | "overlays">, options: AbstractOptions) => shownGraph({ ...scene.graph, overlays: [...(scene.graph.overlays ?? []), ...scene.overlays] }, options);

/** Dagre layouts by the shown graph's structure. */
const layouts = new Map<string, Promise<Positions>>();
function positionsFor(shown: FlowGraph): Promise<Positions> {
  const key = `${shown.nodes.map((n) => `${n.id}@${n.group ?? ""}`).join()}|${shown.edges.map((e) => e.id).join()}`;
  let p = layouts.get(key);
  if (!p) layouts.set(key, (p = layout(shown, { engine: "dagre" })));
  return p;
}

interface Mounted {
  result: RenderResult;
  renderer: Renderer;
  /** The React map once more, with every level-of-detail threshold at 0. */
  everything?: RenderResult;
}

/** Level of detail that draws everything from zoom 0: the marks' geometry stays, only their thresholds go. */
const EVERYTHING: Partial<LodRules> = { labels: 0, edgeLabels: 0, badges: 0, arcs: 0, chips: 0, hatch: 0, selfLoops: 0 };

function element(renderer: Renderer, graph: FlowGraph, overlays: Overlay[], options: AbstractOptions, positions: Positions, locale: Locale, lod?: Partial<LodRules>) {
  return (
    <div style={{ width: PANE.width, height: PANE.height }}>
      <ProcessMap graph={graph} overlays={overlays} positions={positions} abstraction={options} renderer={renderer === "react" ? "svg" : "canvas"} edgeBudget={BUDGET} locale={locale} lod={lod} contextMenu={false} pathList={false} />
    </div>
  );
}

/**
 * Show a rung on a mounted map (or mount it), let it fit and read it. The React map leaves marks
 * below their zoom out of its DOM, so a second React map shows the rung with
 * every level-of-detail threshold at 0, which changes the marks' thresholds
 * and not their geometry; it is read for everything any zoom draws.
 */
async function show(mounted: Mounted | undefined, renderer: Renderer, scene: LadderScene, rung: Rung, locale: Locale) {
  const shown = mapShown(scene, optionsOf(rung));
  // A copy for each showing: positions a map was given before do not count as a new layout to fit.
  const positions = structuredClone(await positionsFor(shown));
  const el = (lod?: Partial<LodRules>) => element(renderer, scene.graph, scene.overlays, optionsOf(rung), positions, locale, lod);
  const again = mounted?.renderer === renderer;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const result = again ? (mounted.result.rerender(el()), mounted.result) : render(el());
  // React Flow fits 50 and 400 ms after the layout arrives, through d3-zoom, which moves the view on an animation frame.
  for (const ms of [60, 400]) {
    await act(async () => void vi.advanceTimersByTime(ms));
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  }
  vi.useRealTimers();
  if (renderer === "canvas") {
    const readings = readCanvasMap(result.container, locale);
    // The frame read is this rung's, at the view the map fits its scene to.
    const scene = [...frames].reverse().find((f) => f.ctx === quiet)!.scene as PreparedScene;
    expect(Object.keys(scene.positions.nodes).sort(), `the Canvas map draws the rung (${scene.graph.nodes.length} nodes)`).toEqual(shown.nodes.map((n) => n.id).sort());
    expect(readings.fitted.zoom, "the Canvas map is fitted").toBeCloseTo(fitView(scene.bounds, PANE.width, PANE.height).zoom, 9);
    return { mounted: { result, renderer }, shown, positions, readings };
  }
  const everything = again && mounted.everything ? (mounted.everything.rerender(el(EVERYTHING)), mounted.everything) : render(el(EVERYTHING));
  await act(async () => {});
  const readings = { fitted: readReactMap(result.container, locale).fitted, full: readReactMap(everything.container, locale).full };
  // Read at the view a person first sees, or not at all.
  expect(readings.fitted.zoom, `the React map is fitted (${scene.name} · ${rung.name})`).toBeCloseTo(fittedZoom(result.container, PANE), 9);
  return { mounted: { result, renderer, everything }, shown, positions, readings };
}

/** What the Canvas map shows now: its last frame at its fitted view, and drawn again with everything any zoom draws. */
function readCanvasMap(container: Element, locale: Locale): { fitted: Reading; full: Reading } {
  const last = [...frames].reverse().find((f) => f.ctx === quiet);
  if (!last) throw new Error("the Canvas map drew no frame");
  const scene = last.scene as PreparedScene;
  const view = last.view as View;
  const options = (last.options ?? {}) as DrawOptions;
  const budget = typeof options.edgeBudget === "number" ? options.edgeBudget : "all";
  const whole = { x: -scene.bounds.x, y: -scene.bounds.y, zoom: 1, width: scene.bounds.width, height: scene.bounds.height };
  // The note and the legend are the map's panels.
  const panels = { note: container.querySelector(".wf-edge-note")?.textContent ?? undefined, ...readLegend(container, locale) };
  return {
    fitted: { ...readCanvas(scene, view, { lodZoom: options.lodZoom, edgeBudget: budget }), ...panels },
    full: { ...readCanvas(scene, whole, { lodZoom: 100, edgeBudget: budget }), ...panels },
  };
}

/** Read and check a rung; failures outside the open findings are attached as the rung's picture. */
async function check(annotate: TestContext["annotate"], mounted: Mounted, readings: { fitted: Reading; full: Reading }, scene: LadderScene, rung: Rung, shown: FlowGraph, positions: Positions, locale: Locale, pictures: "every failure" | "unexpected" = "every failure") {
  const { fitted, full } = readings;
  // The legend's checks hold only where the legend was read: a map with paths writes its width row and colour ramp.
  if (shown.edges.some((e) => e.kind === "follows" && e.source !== e.target)) {
    expect(full.widthEnds, "the legend's path widths").toBeDefined();
    expect(full.colorScale, "the legend's colour ramp").toBeDefined();
    expect(full.paths.every((p) => Number.isFinite(p.width) && /^#[0-9a-f]{6}$/.test(p.color)), "every path's width and colour read").toBe(true);
  }
  const failures = checkReading({ fitted, full, expect: { graph: scene.graph, abstraction: abstract(scene.graph, optionsOf(rung)), rung, locale, positions } });
  const base = collapsedGraph(scene.graph, rung);
  // Where each arc label could go: the map's scene, built again from what the map is given.
  const places = arcLabelPlaces(buildScene(shown, positions, { locale, lodBySize: true }));
  const unexpected = failures.filter((f) => !findingOf(f, shown, base, places));
  const findings = [...new Set(failures.flatMap((f) => findingOf(f, shown, base, places) ?? []))].sort();
  const name = `${mounted.renderer === "react" ? "React map" : "Canvas map"} · ${scene.name} · ${rung.name}`;
  if (pictures === "every failure" ? failures.length : unexpected.length) {
    const svg = toSVG({ graph: shown, positions, locale }, { legend: true, edgeBudget: BUDGET });
    const path = savePicture(name, pictureOf(svg, failures, name));
    await annotate(`${name}: ${failures.length} failing, picture ${path}`, { path, contentType: "image/svg+xml" });
  }
  return { name, unexpected, findings, fitted };
}

const summary = (failures: readonly Failure[]) => failures.slice(0, 6).map((f) => `${f.property}: ${f.detail}`).join("\n  ");

/** The open findings at each rung of the committed scenes on the two maps (Dagre layouts), as written up. */
const WRITTEN_UP: Record<Renderer, Record<string, string>> = {
  react: {
    "global · 0 % · connected · stages shown": "",
    "global · default · connected · stages shown": "",
    "global · 5 % · connected · stages shown": "",
    "global · 10 % · connected · stages shown": "",
    "global · 25 % · connected · stages shown": "",
    "global · 50 % · connected · stages shown": "",
    "global · 0 % · not connected · stages shown": "",
    "global · default · not connected · stages shown": "",
    "global · 5 % · not connected · stages shown": "",
    "global · 10 % · not connected · stages shown": "path counts",
    "global · 25 % · not connected · stages shown": "",
    "global · 50 % · not connected · stages shown": "",
    "global · 0 % · connected · stages collapsed": "",
    "global · default · connected · stages collapsed": "arc label without a place",
    "global · 5 % · connected · stages collapsed": "arc label without a place",
    "global · 10 % · connected · stages collapsed": "arc label without a place",
    "global · 25 % · connected · stages collapsed": "arc label without a place",
    "global · 50 % · connected · stages collapsed": "arc label without a place",
    "global · 0 % · not connected · stages collapsed": "",
    "global · default · not connected · stages collapsed": "arc label without a place",
    "global · 5 % · not connected · stages collapsed": "arc label without a place",
    "global · 10 % · not connected · stages collapsed": "arc label without a place",
    "global · 25 % · not connected · stages collapsed": "arc label without a place",
    "global · 50 % · not connected · stages collapsed": "arc label without a place",
    "vendor · 0 % · connected · stages shown": "",
    "vendor · default · connected · stages shown": "",
    "vendor · 5 % · connected · stages shown": "",
    "vendor · 10 % · connected · stages shown": "",
    "vendor · 25 % · connected · stages shown": "",
    "vendor · 50 % · connected · stages shown": "",
    "vendor · 0 % · not connected · stages shown": "",
    "vendor · default · not connected · stages shown": "",
    "vendor · 5 % · not connected · stages shown": "",
    "vendor · 10 % · not connected · stages shown": "",
    "vendor · 25 % · not connected · stages shown": "",
    "vendor · 50 % · not connected · stages shown": "",
    "vendor · 0 % · connected · stages collapsed": "",
    "vendor · default · connected · stages collapsed": "",
    "vendor · 5 % · connected · stages collapsed": "",
    "vendor · 10 % · connected · stages collapsed": "",
    "vendor · 25 % · connected · stages collapsed": "",
    "vendor · 50 % · connected · stages collapsed": "",
    "vendor · 0 % · not connected · stages collapsed": "",
    "vendor · default · not connected · stages collapsed": "",
    "vendor · 5 % · not connected · stages collapsed": "",
    "vendor · 10 % · not connected · stages collapsed": "",
    "vendor · 25 % · not connected · stages collapsed": "",
    "vendor · 50 % · not connected · stages collapsed": "",
  },
  canvas: {
    "global · 0 % · connected · stages shown": "",
    "global · default · connected · stages shown": "",
    "global · 5 % · connected · stages shown": "",
    "global · 10 % · connected · stages shown": "",
    "global · 25 % · connected · stages shown": "",
    "global · 50 % · connected · stages shown": "",
    "global · 0 % · not connected · stages shown": "",
    "global · default · not connected · stages shown": "",
    "global · 5 % · not connected · stages shown": "",
    "global · 10 % · not connected · stages shown": "path counts",
    "global · 25 % · not connected · stages shown": "",
    "global · 50 % · not connected · stages shown": "",
    "global · 0 % · connected · stages collapsed": "",
    "global · default · connected · stages collapsed": "arc label without a place",
    "global · 5 % · connected · stages collapsed": "arc label without a place",
    "global · 10 % · connected · stages collapsed": "arc label without a place",
    "global · 25 % · connected · stages collapsed": "arc label without a place",
    "global · 50 % · connected · stages collapsed": "arc label without a place",
    "global · 0 % · not connected · stages collapsed": "",
    "global · default · not connected · stages collapsed": "arc label without a place",
    "global · 5 % · not connected · stages collapsed": "arc label without a place",
    "global · 10 % · not connected · stages collapsed": "arc label without a place",
    "global · 25 % · not connected · stages collapsed": "arc label without a place",
    "global · 50 % · not connected · stages collapsed": "arc label without a place",
    "vendor · 0 % · connected · stages shown": "",
    "vendor · default · connected · stages shown": "",
    "vendor · 5 % · connected · stages shown": "",
    "vendor · 10 % · connected · stages shown": "",
    "vendor · 25 % · connected · stages shown": "",
    "vendor · 50 % · connected · stages shown": "",
    "vendor · 0 % · not connected · stages shown": "",
    "vendor · default · not connected · stages shown": "",
    "vendor · 5 % · not connected · stages shown": "",
    "vendor · 10 % · not connected · stages shown": "",
    "vendor · 25 % · not connected · stages shown": "",
    "vendor · 50 % · not connected · stages shown": "",
    "vendor · 0 % · connected · stages collapsed": "",
    "vendor · default · connected · stages collapsed": "",
    "vendor · 5 % · connected · stages collapsed": "",
    "vendor · 10 % · connected · stages collapsed": "",
    "vendor · 25 % · connected · stages collapsed": "",
    "vendor · 50 % · connected · stages collapsed": "",
    "vendor · 0 % · not connected · stages collapsed": "",
    "vendor · default · not connected · stages collapsed": "",
    "vendor · 5 % · not connected · stages collapsed": "",
    "vendor · 10 % · not connected · stages collapsed": "",
    "vendor · 25 % · not connected · stages collapsed": "",
    "vendor · 50 % · not connected · stages collapsed": "",
  },
};

describe("how the map reads across thresholds and sizes, on the React map and the Canvas map", () => {
  for (const renderer of ["react", "canvas"] as const) {
    it(`holds every property at every rung of the committed scenes on the ${renderer === "react" ? "React" : "Canvas"} map, or fails only as written up`, async ({ annotate }) => {
      reducedMotion();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => quiet);
      const found: Record<string, string> = {};
      for (const scene of committedScenes()) {
        let mounted: Mounted | undefined;
        for (const rung of RUNGS) {
          const step = await show(mounted, renderer, scene, rung, "en");
          mounted = step.mounted;
          const { name, unexpected, findings } = await check(annotate, mounted, step.readings, scene, rung, step.shown, step.positions, "en");
          expect(unexpected, `${name}:\n  ${summary(unexpected)}`).toEqual([]);
          found[`${scene.name} · ${rung.name}`] = findings.join(", ");
        }
        cleanup();
      }
      expect(found).toEqual(WRITTEN_UP[renderer]);
    }, 300_000);
  }

  it("holds every property on generated scenes of 10², 10⁴, 10⁶ and 10⁷ events, one rung of each on one map in turn", async ({ annotate }) => {
    reducedMotion();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => quiet);
    let cells = 0;
    const tally = new Map<string, number>();
    // The maps stay mounted from seed to seed and are given each scene in turn.
    const mounted: Partial<Record<Renderer, Mounted>> = {};
    for (const seed of seeds(caseCount(20))) {
      const rng = createRandom(seed);
      const locale: Locale = seed % 2 ? "en" : "de";
      for (const [m, magnitude] of MAGNITUDES.entries()) {
        const scene = generatedScene(seed, magnitude);
        const renderer: Renderer = (seed + m) % 2 ? "canvas" : "react";
        const rung = rng.pick(RUNGS);
        const step = await show(mounted[renderer], renderer, scene, rung, locale);
        mounted[renderer] = step.mounted;
        const { name, unexpected, findings } = await check(annotate, step.mounted, step.readings, scene, rung, step.shown, step.positions, locale, "unexpected");
        for (const f of findings) tally.set(`${f} on the ${renderer === "react" ? "React" : "Canvas"} map`, (tally.get(`${f} on the ${renderer === "react" ? "React" : "Canvas"} map`) ?? 0) + 1);
        expect(unexpected, `${caseLabel(seed, `${name} · ${locale}`)}\n  ${summary(unexpected)}`).toEqual([]);
        cells++;
      }
    }
    expect(cells).toBe(caseCount(20) * MAGNITUDES.length);
    await annotate(`${cells} cells; cells with an open finding: ${[...tally].sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }, 600_000 * caseCount(1));
});

describe("the layout while the controls move", () => {
  const workers = { elkWorkerUrl: FakeLayoutWorker.elkUrl, dagreWorkerUrl: FakeLayoutWorker.dagreUrl };
  beforeAll(async () => {
    await import("elkjs/lib/elk-api.js");
  });

  /** The answer the map draws: every box's y is its serial number times 1,000 (see `FakeLayoutWorker`). */
  const drawnReply = (container: Element): number | null | undefined => {
    const ys = [...container.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => Number(/translate\([-\d.e]+px,\s*([-\d.e]+)px\)/.exec(el.style.transform)?.[1]));
    const top = new Set(ys.filter((y) => y >= 1000));
    if (!ys.length) return undefined;
    return top.size === 1 && ys.every((y) => y >= 1000 || y === 0) ? [...top][0] / 1000 : null;
  };

  it("shows only a layout of the current settings, and every layout is answered or its worker stopped", async () => {
    let steps = 0;
    let stale = 0;
    for (const seed of seeds(caseCount(10))) {
      const renderer: Renderer = seed % 2 ? "react" : "canvas";
      reducedMotion();
      vi.stubGlobal("Worker", FakeLayoutWorker);
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => quiet);
      vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
      FakeLayoutWorker.created = [];
      const rng = createRandom(seed);
      const scene = generatedScene(seed, MAGNITUDES[seed % MAGNITUDES.length]);
      // The map lays out every kind at its own size: events 36 × 36.
      const signatureOf = (r: Rung) => layoutSignature(mapShown(scene, optionsOf(r)), { ...workers, nodeSize: defaultNodeSize });
      // Serial numbers from 1; what each answer was computed for and whether its worker had been stopped.
      const replies: ({ signature: string; stopped: boolean } | undefined)[] = [undefined];
      const el = (r: Rung) => (
        <div style={{ width: PANE.width, height: PANE.height }}>
          <ProcessMap graph={scene.graph} overlays={scene.overlays} abstraction={optionsOf(r)} layout={workers} renderer={renderer === "react" ? "svg" : "canvas"} edgeBudget={BUDGET} controls={false} contextMenu={false} pathList={false} />
        </div>
      );
      // Promises and effects; then, for the Canvas map, the animation frame its effects asked for.
      const settle = async () => {
        await act(async () => {
          for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
        });
        if (renderer === "canvas") await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
      };
      const answer = (w: FakeLayoutWorker, k: number) => {
        replies.push({ signature: w.layouts[k].signature, stopped: w.terminated });
        if (w.terminated || w.layouts[k].signature !== signatureOf(rung)) stale++;
        w.answer(k, replies.length - 1);
      };
      let rung = rng.pick(RUNGS);
      const trace = [`mount at ${rung.name}`];
      const result = render(el(rung));
      await settle();
      const look = (when: string) => {
        const map = result.container.querySelector(".wf-process-map")!;
        const status = map.getAttribute("data-layout-status");
        const reply = renderer === "react" ? drawnReply(result.container) : replyOf(([...frames].reverse().find((f) => f.ctx === quiet)?.scene as PreparedScene | undefined)?.positions ?? { nodes: {} } as Positions);
        const label = `${caseLabel(seed, `${scene.name}, ${when}`)}\n  ${trace.join("\n  ")}`;
        if (status === "ready") {
          expect(reply, `${label}\n  the drawn boxes come from no single answer`).toBeTypeOf("number");
          expect(replies[reply as number]?.signature, `${label}\n  the map shows a layout of other settings`).toBe(signatureOf(rung));
          expect(replies[reply as number]?.stopped, `${label}\n  the map shows an answer its stopped worker sent`).toBe(false);
        } else expect(status, label).toBe("pending");
        return status;
      };
      for (let step = 0; step < 14; step++) {
        const op = rng.weighted([["control", 3], ["answer", 4], ["wait", 2]] as const);
        if (op === "control") {
          rung = rng.pick(RUNGS);
          trace.push(`controls to ${rung.name}`);
          result.rerender(el(rung));
        } else if (op === "answer") {
          const open = FakeLayoutWorker.created.flatMap((w) => w.pending.map((k) => [w, k] as const));
          if (open.length) {
            const [w, k] = rng.pick(open);
            trace.push(`answer layout ${k} of ${w.kind} worker ${w.index}${w.terminated ? " (stopped)" : ""}`);
            answer(w, k);
          }
        } else {
          const ms = rng.int(10, 600);
          trace.push(`wait ${ms} ms`);
          await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
        }
        await settle();
        look(`step ${step + 1}`);
        steps++;
      }
      // The layout of the settings shown is answered; the map then shows it, and no layout is left running.
      for (const w of FakeLayoutWorker.created) for (const k of w.pending) if (!w.terminated && w.layouts[k].signature === signatureOf(rung)) answer(w, k);
      trace.push("answer the current settings' layouts");
      await settle();
      await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
      await settle();
      expect(look("at the end"), caseLabel(seed, "at the end")).toBe("ready");
      for (const w of FakeLayoutWorker.created) {
        for (const k of w.pending) expect(w.terminated, `${caseLabel(seed, "at the end")}: layout ${k} of ${w.kind} worker ${w.index} (${w.layouts[k].signature.slice(0, 60)}…) neither answered nor stopped\n  ${trace.join("\n  ")}`).toBe(true);
      }
      // Once the map is gone, the module stops its workers (a microtask later) and none is left for the next seed.
      cleanup();
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(FakeLayoutWorker.created.filter((w) => !w.terminated).map((w) => `${w.kind} worker ${w.index}`), `${caseLabel(seed, "after unmounting")}\n  ${trace.join("\n  ")}`).toEqual([]);
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
    expect(steps).toBe(caseCount(10) * 14);
    // Answers of earlier settings, or from stopped workers, did arrive.
    expect(stale).toBeGreaterThan(0);
  }, 300_000 * caseCount(1));
});
