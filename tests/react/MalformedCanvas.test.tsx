/**
 * Malformed input at the Canvas map, the Canvas renderer, `readTokens` and the
 * BPMN view: each runs once per malformed case (see
 * `tests/core/malformed-input.test.ts`). The renderer is driven through every
 * method with junk sizes, viewports, zooms, points and ids; the BPMN view
 * shows the case's graph, its export or a mutated file, as a diagram on the
 * in-memory viewer (with overlays, a mapping and a selection that name
 * nothing) and as the table. Nothing may throw an untyped error or be logged
 * as an error, and where the input and the host's numbers are sound the canvas
 * is drawn with finite numbers only.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasRenderer, prepareScene, readTokens } from "../../src/canvas/index";
import { exportBpmn, importBpmn } from "../../src/bpmn/headless";
import { type Locale, emptySelection } from "../../src/index";
import { BpmnView } from "../../src/bpmn/index";
import { createBpmnView } from "../../src/react/BpmnView";
import { CanvasMap } from "../../src/react/index";
import { mutate } from "../support/bpmn-files";
import { Calls, caseSettled, eachCase, type MalformedCase, failure, junkCoordinate, junkNumber, junkString, malformedCase, nonFinite, SEARCH_TIMEOUT } from "../support/malformed";
import { caseCount, seeds } from "../support/random";
import { memoryViewers } from "./memory-viewer";

afterEach(async () => {
  await caseSettled();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fixture = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
const CASES = seeds(caseCount(300)).map((seed) => malformedCase(seed, { maxSize: 5 }));
const fail = (message: string): never => expect.fail(message);
function must(ok: boolean, c: MalformedCase, what: () => string): void {
  if (!ok) expect.fail(failure(c, what()));
}

/** A 2D context that keeps the arguments of every call. */
function recordingCanvas(): unknown[][] {
  const calls: unknown[][] = [];
  const ctx = new Proxy({ measureText: (text: string) => ({ width: String(text).length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : (...args: unknown[]) => void calls.push(args)),
    set: (target, key, value) => {
      if (typeof value === "number") calls.push([key, value]);
      target[key] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return calls;
}

/**
 * What may be logged: React's key warnings where the graph, or the file shown (`twice`), has an id twice or an
 * element without one (in the findings), and, around the public view, bpmn-js failing on jsdom's missing SVG
 * geometry (not the library's).
 */
function logged(c: MalformedCase, bpmnJs = false): (twice?: boolean) => string[] {
  const out: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void out.push(args.map(String).join(" ").slice(0, 300)));
  const keys = c.issues.some((i) => i.message.startsWith("duplicate")) || [...c.graph.nodes, ...c.graph.edges].some((e) => e.id === undefined || e.id === "");
  return (twice = false) => out.filter((m) => !((keys || twice) && /^Each child in a list should have a unique "key" prop|^Encountered two children with the same key/.test(m)) && !(bpmnJs && /^unhandled error in event listener TypeError: Cannot read properties of undefined \(reading 'baseVal'\)/.test(m)));
}

const viewers = memoryViewers();
const DiagramView = createBpmnView(viewers.connect);

describe("malformed input at the Canvas map and renderer and the BPMN view", () => {
  it("draws every case on the Canvas map and drives the renderer through every method", async ({ signal }) => {
    const calls = new Calls(fail, 20_000);
    // The checks of what was drawn hold only if something was: frames come at once instead of every 16 ms.
    let drawn = 0;
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => setTimeout(() => frame(performance.now()), 0));
    await eachCase(CASES, signal, async (c) => {
      const canvas = recordingCanvas();
      const errors = logged(c);
      const locale: Locale = c.rng.chance() ? "en" : "de";
      const scene = prepareScene(c.graph, c.positions, { locale, lodBySize: c.rng.chance() });
      const ids = [...c.graph.nodes.map((n) => n.id), "gone", junkString(c.rng)];
      const budget = c.rng.pick([junkNumber(c.rng), "all" as const, "adaptive" as const]);
      await calls.callAsync("CanvasMap", c, async () => {
        render(
          <div style={{ width: 800, height: 600 }}>
            <CanvasMap
              scene={c.rng.chance(0.9) ? scene : undefined}
              state={{ selection: { nodes: c.rng.sample(ids, 2), edges: ["gone"], groups: [] }, hovered: c.rng.pick(ids), focused: c.rng.pick(ids) }}
              locale={locale}
              fitKey={junkString(c.rng)}
              fitView={c.rng.chance()}
              edgeBudget={budget}
              clock={() => junkNumber(c.rng)}
              describe={() => (c.rng.chance() ? junkString(c.rng) : undefined)}
              descendants={c.rng.sample(ids, 2).map((id) => ({ id, kind: "node" as const, description: junkString(c.rng) }))}
            />
          </div>,
        );
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        if (c.accepted && budget !== "adaptive" && (typeof budget !== "number" || Number.isFinite(budget))) must(nonFinite(canvas).length === 0, c, () => `the Canvas map drew at ${nonFinite(canvas).join(", ")}`);
        drawn += canvas.length;
      });
      cleanup();
      canvas.length = 0;
      calls.call("CanvasRenderer", c, () => {
        const sound = [junkCoordinate(c.rng, 1), junkCoordinate(c.rng, 0.05), junkCoordinate(c.rng, 3)];
        const renderer = new CanvasRenderer(document.createElement("canvas"), { devicePixelRatio: sound[0], minZoom: sound[1], maxZoom: sound[2], draw: { edgeBudget: c.rng.pick([junkNumber(c.rng), "all" as const, "adaptive" as const]), cull: c.rng.chance() }, clock: () => junkNumber(c.rng) });
        const size = [junkCoordinate(c.rng, 800), junkCoordinate(c.rng, 600)];
        renderer.resize(size[0], size[1]);
        renderer.setScene(scene);
        renderer.setState({ selection: c.rng.chance() ? emptySelection : { nodes: ids.slice(0, 2), edges: [], groups: [] }, hovered: c.rng.pick(ids) });
        renderer.fit(junkCoordinate(c.rng, 24));
        renderer.beginGesture();
        renderer.panBy(junkCoordinate(c.rng, 10), junkCoordinate(c.rng, 10));
        renderer.zoomBy(junkCoordinate(c.rng, 1.2), c.rng.chance() ? { x: junkCoordinate(c.rng, 10), y: 0 } : undefined);
        renderer.endGesture();
        renderer.centerOn({ x: junkCoordinate(c.rng, 0), y: junkCoordinate(c.rng, 0) }, c.rng.chance() ? junkCoordinate(c.rng, 1) : undefined);
        const viewport = { x: junkCoordinate(c.rng, 0), y: junkCoordinate(c.rng, 0), zoom: junkCoordinate(c.rng, 1) };
        renderer.setViewport(viewport, c.rng.chance());
        renderer.toFlow(junkCoordinate(c.rng, 5), 5);
        renderer.toScreen(junkCoordinate(c.rng, 5), 5);
        renderer.screenBox(c.rng.pick(ids));
        renderer.hitAt(junkCoordinate(c.rng, 5), junkCoordinate(c.rng, 5), c.rng.chance() ? junkCoordinate(c.rng, 4) : undefined);
        renderer.draw();
        renderer.dispose();
        renderer.draw();
      });
      calls.call("readTokens", c, () => readTokens(c.rng.chance() ? document.body : null, c.rng.chance() ? { ink: junkString(c.rng), font: junkString(c.rng) } : undefined));
      vi.restoreAllMocks();
      must(errors().length === 0, c, () => `logged: ${errors()[0]}`);
      vi.restoreAllMocks();
    });
    expect(drawn).toBeGreaterThan(CASES.length);
    expect(calls.ranAtLeast(["CanvasMap", "CanvasRenderer", "readTokens"], CASES.length)).toEqual([]);
    expect(calls.unknown({}), "plain errors").toEqual([]);
  });

  it("shows every case's graph, its export or a broken file in the BPMN view, as a diagram and as the table", async ({ signal }) => {
    const calls = new Calls(fail, 20_000);
    await eachCase(CASES, signal, async (c) => {
      const errors = logged(c, true);
      const exported = await exportBpmn(c.graph, { positions: c.positions, layout: { engine: "dagre" } }).catch(() => undefined);
      const xml = exported && c.rng.chance() ? exported.xml : mutate(exported?.xml ?? fixture, c.rng).xml;
      // A mutated file may name one flow id on two elements: its graph has an id twice, as validation reports.
      const twice = (await importBpmn(xml, { positions: false }).catch(() => undefined))?.warnings.some((w) => w.startsWith("duplicate")) ?? false;
      const ids = [...c.graph.nodes.map((n) => n.id), "gone", junkString(c.rng)];
      const props = {
        overlays: c.rng.chance() ? c.graph.overlays : [{ kind: "badge" as const, target: "gone" }],
        mapping: c.rng.chance() ? { [junkString(c.rng)]: c.rng.pick(ids) } : undefined,
        selection: { tasks: c.rng.sample(ids, 2), flows: ["gone"], lanes: [] },
        locale: (c.rng.chance() ? "en" : "de") as Locale,
        onError: () => {},
      };
      const fromGraph = c.rng.chance(0.3);
      // The public view on bpmn-js shows the table here (jsdom cannot lay out SVG); the in-memory viewer shows the diagram.
      await calls.callAsync("BpmnView", c, async () => {
        render(<div style={{ width: 800, height: 600 }}>{fromGraph ? <BpmnView graph={c.graph} layout={{ engine: "dagre" }} view="table" {...props} /> : <BpmnView xml={xml} view="table" {...props} />}</div>);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        cleanup();
        render(<div style={{ width: 800, height: 600 }}>{fromGraph ? <DiagramView graph={c.graph} layout={{ engine: "dagre" }} {...props} /> : <DiagramView xml={xml} {...props} />}</div>);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      });
      cleanup();
      vi.restoreAllMocks();
      must(errors(twice).length === 0, c, () => `logged: ${errors(twice)[0]}`);
      // An unmounted view leaves no viewer alive; the list is emptied so that a deep run does not keep every viewer.
      must(viewers.instances.every((v) => v.destroyed), c, () => "a viewer outlived its view");
      viewers.instances.length = 0;
    });
    expect(calls.ranAtLeast(["BpmnView"], CASES.length)).toEqual([]);
    expect(calls.unknown({}), "plain errors").toEqual([]);
  }, SEARCH_TIMEOUT);
});
