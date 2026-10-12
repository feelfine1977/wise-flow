/**
 * What a Canvas renderer keeps once its scene is cleared or it is disposed: a
 * host may keep the object reachable (a ref, a closure of an event handler), so
 * whatever it still holds stays in memory with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowNode, createPositions } from "../../src/index";
import { CanvasRenderer, type PreparedScene, defaultTokens, prepareScene } from "../../src/canvas/index";

/** A 2D context whose every method only counts its calls. */
function countingContext() {
  let calls = 0;
  const ctx = new Proxy({ font: "", measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => void calls++),
    set: (target, key, value) => ((target[key] = value), true),
  });
  return { ctx, calls: () => calls };
}

/** h on the left, t1 up and t2 down on the right; with a budget of 1 only the heavier path, h->t1, is drawn. */
function hubScene(order: "heavy first" | "light first" = "heavy first"): PreparedScene {
  const boxes = { h: { x: 0, y: 100, width: 100, height: 40 }, t1: { x: 400, y: 0, width: 100, height: 40 }, t2: { x: 400, y: 200, width: 100, height: 40 } };
  const nodes = ["h", "t1", "t2"].map((id): FlowNode => ({ id, kind: "activity", label: id }));
  const heavy: FlowEdge = { id: "h->t1", kind: "follows", source: "h", target: "t1", metrics: { count: 100 } };
  const light: FlowEdge = { id: "h->t2", kind: "follows", source: "h", target: "t2", metrics: { count: 1 } };
  const edges = order === "heavy first" ? [heavy, light] : [light, heavy];
  return prepareScene({ nodes, edges }, createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT"), { lodBySize: false });
}

function setUp() {
  const { ctx, calls } = countingContext();
  const canvas = { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { cull: false, edgeBudget: 1 }, clock: () => 0 });
  const events = { draws: 0, viewports: 0 };
  renderer.onDraw = () => void events.draws++;
  renderer.onViewportChange = () => void events.viewports++;
  renderer.resize(600, 300);
  renderer.setViewport({ x: 0, y: 0, zoom: 1 });
  return { renderer, canvas, ctx, calls, events };
}

/**
 * The first path of property names from `root` to `target`, walking own
 * properties, array items and the entries of maps and sets; `skip` are objects
 * the walk does not enter (what the host owns). Closures cannot be walked.
 */
function pathTo(root: unknown, target: object, skip: readonly object[] = []): string | undefined {
  const seen = new Set<object>(skip);
  const queue: [unknown, string][] = [[root, "renderer"]];
  while (queue.length) {
    const [value, path] = queue.shift()!;
    if (value === target) return path;
    if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) value.forEach((v, k) => queue.push([k, `${path}<key>`], [v, `${path}.get(${String(k)})`]));
    if (value instanceof Set) value.forEach((v) => queue.push([v, `${path}<item>`]));
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (d && "value" in d) queue.push([d.value, `${path}.${String(key)}`]);
    }
  }
  return undefined;
}

/** The renderer's own fields that still hold something: after disposal only its settings, its view and the host's canvas. */
const held = (r: CanvasRenderer) => Object.entries(r).filter(([, v]) => v !== undefined).map(([k]) => k).sort();
const settings = ["canvas", "clock", "disposed", "dpr", "drawOptions", "height", "lastDraw", "maxZoom", "minZoom", "state", "tokens", "viewport", "width"];

// On the light path's line (100,120 to 400,220) and on the heavy one's (100,120 to 400,20).
const onLight = (r: CanvasRenderer) => r.hitAt(250, 170)?.id;
const onHeavy = (r: CanvasRenderer) => r.hitAt(250, 70)?.id;

afterEach(() => vi.unstubAllGlobals());

describe("a Canvas renderer whose scene is cleared", () => {
  it("forgets the scene it drew", () => {
    const { renderer, canvas } = setUp();
    const scene = hubScene();
    renderer.setScene(scene);
    renderer.draw();
    expect([onLight(renderer), onHeavy(renderer)]).toEqual([undefined, "h->t1"]);
    renderer.setScene(undefined);
    expect(renderer.getScene()).toBeUndefined();
    expect(pathTo(renderer, scene, [canvas])).toBeUndefined();
    expect(renderer.hitAt(250, 70)).toBeUndefined();
  });

  it("still leaves out the paths its last draw withheld when another scene comes before the next draw", () => {
    const { renderer } = setUp();
    renderer.setScene(hubScene());
    renderer.draw();
    renderer.setScene(undefined);
    // The same map with its paths in the other order, not drawn yet: the light path is not hit until a draw shows it.
    renderer.setScene(hubScene("light first"));
    expect([onLight(renderer), onHeavy(renderer)]).toEqual([undefined, "h->t1"]);
    renderer.draw();
    expect([onLight(renderer), onHeavy(renderer)]).toEqual([undefined, "h->t1"]);
    renderer.drawOptions = { cull: false };
    renderer.draw();
    expect([onLight(renderer), onHeavy(renderer)]).toEqual(["h->t2", "h->t1"]);
  });
});

describe("a disposed Canvas renderer", () => {
  it("holds no reference to its scene, its drawing context or its callbacks", () => {
    const { renderer, canvas, ctx } = setUp();
    const scene = hubScene();
    const onDraw = renderer.onDraw!;
    const onViewportChange = renderer.onViewportChange!;
    renderer.setScene(scene);
    renderer.beginGesture();
    renderer.draw();
    // Cleared after a draw that withheld a path: the renderer holds the ids that draw drew.
    renderer.setScene(undefined);
    renderer.dispose();
    expect(held(renderer)).toEqual(settings);
    for (const [name, target] of [["scene", scene], ["context", ctx], ["onDraw", onDraw], ["onViewportChange", onViewportChange]] as const) {
      expect(pathTo(renderer, target, [canvas]), name).toBeUndefined();
    }
  });

  it("returns early from every method that changes something, and no callback fires", () => {
    const frames = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", frames);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const { renderer, canvas, calls, events } = setUp();
    const scene = hubScene();
    renderer.setScene(scene);
    renderer.draw();
    renderer.dispose();
    const before = { calls: calls(), frames: frames.mock.calls.length, events: { ...events }, size: renderer.size, viewport: renderer.getViewport(), state: renderer.getState(), tokens: renderer.tokens, canvas: { width: canvas.width, height: canvas.height, style: { ...canvas.style } } };
    // One call of each public method; the list must name them all.
    const called = {
      resize: () => renderer.resize(100, 50),
      setScene: () => renderer.setScene(hubScene()),
      getScene: () => expect(renderer.getScene()).toBeUndefined(),
      setState: () => renderer.setState({ hovered: "h" }),
      getState: () => renderer.getState(),
      setTokens: () => renderer.setTokens({ ...defaultTokens, font: "serif" }),
      getViewport: () => renderer.getViewport(),
      setViewport: () => renderer.setViewport({ x: 5, y: 5, zoom: 2 }),
      fit: () => renderer.fit(),
      panBy: () => renderer.panBy(10, 10),
      zoomBy: () => renderer.zoomBy(2),
      centerOn: () => renderer.centerOn({ x: 10, y: 10 }),
      toFlow: () => renderer.toFlow(1, 1),
      toScreen: () => renderer.toScreen(1, 1),
      screenBox: () => expect(renderer.screenBox("h")).toBeUndefined(),
      hitAt: () => expect(renderer.hitAt(250, 70)).toBeUndefined(),
      requestDraw: () => renderer.requestDraw(),
      draw: () => renderer.draw(),
      beginGesture: () => renderer.beginGesture(),
      endGesture: () => renderer.endGesture(),
      dispose: () => renderer.dispose(),
    };
    const methods = Object.getOwnPropertyNames(CanvasRenderer.prototype).filter((k) => k !== "constructor" && typeof Object.getOwnPropertyDescriptor(CanvasRenderer.prototype, k)?.value === "function");
    expect(Object.keys(called).sort()).toEqual(methods.sort());
    for (const [name, call] of Object.entries(called)) {
      call();
      // Not even a gesture's frame timing starts again.
      expect(held(renderer), name).toEqual(settings);
    }
    expect({ calls: calls(), frames: frames.mock.calls.length, events, size: renderer.size, viewport: renderer.getViewport(), state: renderer.getState(), tokens: renderer.tokens, canvas: { width: canvas.width, height: canvas.height, style: { ...canvas.style } } }).toEqual(before);
    expect(pathTo(renderer, scene, [canvas])).toBeUndefined();
  });
});
