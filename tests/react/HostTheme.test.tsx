import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Counts the scenes built and the layouts asked for.
vi.mock("../../src/core/scene.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/scene.js")>();
  return { ...original, buildScene: vi.fn(original.buildScene) };
});
const layouts = vi.fn();
vi.mock("../../src/core/layout.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/layout.js")>();
  return {
    ...original,
    createLayoutScope: (...args: Parameters<typeof original.createLayoutScope>) => {
      const scope = original.createLayoutScope(...args);
      const run = scope.layout.bind(scope);
      scope.layout = (...given: Parameters<typeof run>) => (layouts(), run(...given));
      return scope;
    },
  };
});

const { buildScene } = await import("../../src/core/scene.js");
const { vendorScene } = await import("../../fixtures/bpic2019");
const { abstract, defaultTheme, toSVG, layout } = await import("../../src/index");
const { CanvasMap, ProcessMap, emptySelection, useFlowTheme } = await import("../../src/react/index");
const { prepareScene } = await import("../../src/canvas/index");
const { cssColor } = await import("../../src/react/theme");
type FlowTheme = import("../../src/react/index").FlowTheme;
type ThemeSetting = import("../../src/index").ThemeSetting;

const vendor = abstract(vendorScene, { minEdgeShare: 0.02 });
const rules = document.createElement("style");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(buildScene).mockClear();
  layouts.mockClear();
  rules.remove();
  rules.textContent = "";
  delete document.documentElement.dataset.theme;
});

/** A 2D context that records the texts and outlines of the last frame with their paints. */
function recorder() {
  let texts: { text: string; fill: string }[] = [];
  let strokes: { stroke: string; width: number }[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", lineJoin: "miter", lineCap: "butt",
    save: noop, restore: noop, translate: noop, scale: noop, setTransform: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, arc: noop, arcTo: noop, rect: noop, fill: noop, fillRect: noop, strokeText: noop, setLineDash: noop, createPattern: () => null,
    clearRect() {
      texts = [];
      strokes = [];
    },
    stroke() {
      strokes.push({ stroke: ctx.strokeStyle, width: ctx.lineWidth });
    },
    fillText(text: string) {
      texts.push({ text, fill: ctx.fillStyle });
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return { label: () => texts.filter((t) => t.text === "Record Goods Receipt").map((t) => t.fill), strokes: () => strokes };
}

/** Renders `useFlowTheme` on an element of class `host` and reports what it resolves. */
function Probe({ setting, report }: { setting?: ThemeSetting; report: (look: FlowTheme) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  report(useFlowTheme(ref, setting));
  return <div ref={ref} className="host" />;
}

function resolved(setting?: ThemeSetting): () => FlowTheme {
  let last!: FlowTheme;
  render(<Probe setting={setting} report={(look) => void (last = look)} />);
  return () => last;
}

describe("a colour written in any CSS syntax", () => {
  it("becomes the literal the browser paints, read back from one pixel", () => {
    // jsdom has no 2D context: this one knows four colours and the pixel each paints.
    const pixels: Record<string, number[]> = { "#000000": [0, 0, 0, 255], "#ffffff": [255, 255, 255, 255], "oklch(0.97 0.02 90)": [253, 246, 227, 255], "color-mix(in srgb, #0072b2 50%, transparent)": [0, 114, 178, 128] };
    let fill = "#000000";
    const ctx = { get fillStyle() { return fill; }, set fillStyle(v: string) { if (pixels[v]) fill = v; }, clearRect() {}, fillRect() {}, getImageData: () => ({ data: pixels[fill] }) };
    const made = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    expect(cssColor("#abc")).toBe("#abc");
    expect(made).not.toHaveBeenCalled();
    expect(cssColor("oklch(0.97 0.02 90)")).toBe("#fdf6e3");
    expect(cssColor("color-mix(in srgb, #0072b2 50%, transparent)")).toBe("rgba(0, 114, 178, 0.5)");
    expect(cssColor("not a colour")).toBeUndefined();

    // Palettes are interpolated from hex stops: an opaque stop in any syntax becomes `#rrggbb`, a translucent one leaves the palette out.
    const stops = (categorical: string[]) => resolved({ palette: { categorical } })().theme.palette.categorical;
    expect(stops(["rgb(0, 114, 178)", "oklch(0.97 0.02 90)", "#abc"])).toEqual(["#0072b2", "#fdf6e3", "#abc"]);
    cleanup();
    expect(stops(["#0072b2", "color-mix(in srgb, #0072b2 50%, transparent)"])).toEqual([...defaultTheme.palette.categorical]);
    cleanup();

    // Through the variables of a host: the export draws the literal.
    document.head.appendChild(rules);
    rules.textContent = ".host { --wf-paper: oklch(0.97 0.02 90); --wf-line: color-mix(in srgb, #0072b2 50%, transparent); }";
    const look = resolved();
    expect([look().theme.color.paper, look().theme.color.line]).toEqual(["#fdf6e3", "rgba(0, 114, 178, 0.5)"]);
    const svg = toSVG({ graph: vendor, positions: { nodes: {}, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, engine: "given", direction: "RIGHT" } }, { theme: look().theme });
    expect(svg).toContain('fill="#fdf6e3"');
    for (const word of ["var(", "oklch(", "color-mix("]) expect(svg).not.toContain(word);
  });
});

describe("the theme of a map", () => {
  it("puts the setting over the container's CSS variables over the preset", () => {
    document.head.appendChild(rules);
    // The preset alone: print's surface is white, the default's grey.
    expect(resolved("print")().theme.color.surface).toBe("#ffffff");
    cleanup();
    rules.textContent = ".host { --wf-surface: #eeeeee; --wf-ink: #222222; }";
    const css = resolved("print")().theme;
    expect([css.color.surface, css.color.ink]).toEqual(["#eeeeee", "#222222"]);
    cleanup();
    const set = resolved({ preset: "print", color: { surface: "#dddddd" } })().theme;
    expect([set.color.surface, set.color.ink]).toEqual(["#dddddd", "#222222"]);
  });

  it("draws the container's variables, and over them the setting, on the Canvas map", async () => {
    const { label } = recorder();
    const positions = await layout(vendor, { engine: "dagre" });
    document.head.appendChild(rules);
    const map = (theme?: ThemeSetting) => (
      <div className="host" style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={vendor} positions={positions} renderer="canvas" edgeBudget="all" controls={false} legend={false} theme={theme} />
      </div>
    );
    const view = render(map());
    await waitFor(() => expect(label()).toEqual(["#1f1f1f"]));
    view.unmount();
    // As a browser inherits: the rule sets the container and everything in it.
    rules.textContent = ".host, .host * { --wf-ink: #222222; }";
    const css = render(map());
    await waitFor(() => expect(label()).toEqual(["#222222"]));
    css.rerender(map({ color: { ink: "#333333" } }));
    await waitFor(() => expect(label()).toEqual(["#333333"]));
  });

  it("repaints when a colour variable changes, without a layout or a new scene, and builds the scene once when a size changes", async () => {
    const { label, strokes } = recorder();
    // The host changes its container's class; the rules set the container and everything in it, as a browser inherits.
    document.head.appendChild(rules);
    rules.textContent = ".inked, .inked * { --wf-ink: #123456; } .sized, .sized * { --wf-stroke-node: 3px; }";
    const view = render(
      <div className="host" style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={vendor} layout={{ engine: "dagre" }} renderer="canvas" edgeBudget="all" controls={false} legend={false} />
      </div>,
    );
    const host = view.container.firstElementChild as HTMLElement;
    await waitFor(() => expect(view.container.querySelector('[data-layout-status="ready"]')).not.toBeNull());
    await waitFor(() => expect(label()).toEqual(["#1f1f1f"]));
    const laid = layouts.mock.calls.length;
    const built = vi.mocked(buildScene).mock.calls.length;
    expect(laid).toBeGreaterThan(0);

    act(() => host.classList.add("inked"));
    await waitFor(() => expect(label()).toEqual(["#123456"]));
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built);
    expect(layouts.mock.calls.length).toBe(laid);

    // The activities of the first stage are outlined in its colour, 2 wide by default and 3 wide once the host says so.
    const outlined = (width: number) => strokes().filter((s) => s.stroke === "#0072B2" && s.width === width).length;
    expect([outlined(2) > 0, outlined(3)]).toEqual([true, 0]);
    act(() => host.classList.add("sized"));
    await waitFor(() => expect(outlined(3)).toBeGreaterThan(0));
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built + 1);
    expect(layouts.mock.calls.length).toBe(laid);
    expect([outlined(2), label()]).toEqual([0, ["#123456"]]);
  });

  it("writes a given theme's colours on the map's element, and repaints a change of them without a new scene", async () => {
    const positions = await layout(vendor, { engine: "dagre" });
    const map = (theme?: ThemeSetting) => <ProcessMap graph={vendor} positions={positions} renderer="svg" controls={false} legend={false} theme={theme} />;
    const view = render(map());
    const root = () => view.container.querySelector(".wf-process-map") as HTMLElement;
    await waitFor(() => expect(root()).not.toBeNull());
    // Without a theme the map draws the variables it inherits and writes none.
    expect(root().style.getPropertyValue("--wf-ink")).toBe("");
    view.rerender(map({ color: { ink: "#333333" }, font: { family: "Georgia, serif" } }));
    await waitFor(() => expect(root().style.getPropertyValue("--wf-ink")).toBe("#333333"));
    expect([root().style.getPropertyValue("--wf-font"), root().style.getPropertyValue("--wf-paper"), root().style.getPropertyValue("--wf-stroke-focus")]).toEqual(["Georgia, serif", "#ffffff", "2px"]);
    const built = vi.mocked(buildScene).mock.calls.length;
    view.rerender(map({ color: { ink: "#444444" }, font: { family: "Georgia, serif" } }));
    await waitFor(() => expect(root().style.getPropertyValue("--wf-ink")).toBe("#444444"));
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built);
  });

  it("draws the variables a host sets on the map's own element on the Canvas map too, and given a theme draws its variables there", async () => {
    const { label } = recorder();
    const positions = await layout(vendor, { engine: "dagre" });
    document.head.appendChild(rules);
    // As a browser inherits: the rule sets the map's element and everything in it.
    rules.textContent = ".mine, .mine * { --wf-ink: #123456; }";
    const map = (props: { className?: string; containerStyle?: React.CSSProperties; theme?: ThemeSetting }) => (
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={vendor} positions={positions} renderer="canvas" edgeBudget="all" controls={false} legend={false} {...props} />
      </div>
    );
    const view = render(map({ className: "mine" }));
    await waitFor(() => expect(label()).toEqual(["#123456"]));
    view.rerender(map({ containerStyle: { "--wf-ink": "#234567" } as React.CSSProperties }));
    await waitFor(() => expect(label()).toEqual(["#234567"]));
    // Given a theme, the map writes the theme's variables over its own: the DOM and the Canvas map draw the same ink.
    view.rerender(map({ containerStyle: { "--wf-ink": "#234567" } as React.CSSProperties, theme: { color: { paper: "#fdf6e3" } } }));
    const root = view.container.querySelector(".wf-process-map") as HTMLElement;
    await waitFor(() => expect(root.style.getPropertyValue("--wf-paper")).toBe("#fdf6e3"));
    await waitFor(() => expect(label()).toEqual(["#1f1f1f"]));
    expect(root.style.getPropertyValue("--wf-ink")).toBe("#1f1f1f");
  });

  it("draws the variables a host sets on a Canvas map of its own", async () => {
    const { label } = recorder();
    const positions = await layout(vendor, { engine: "dagre" });
    document.head.appendChild(rules);
    rules.textContent = ".mine { --wf-ink: #123456; }";
    render(
      <div style={{ width: 1200, height: 800 }}>
        <CanvasMap className="mine" scene={prepareScene(vendor, positions)} state={{ selection: emptySelection }} edgeBudget="all" />
      </div>,
    );
    await waitFor(() => expect(label()).toEqual(["#123456"]));
  });

  it("takes its colours in the dark scheme as the dark roles, so an export stays light unless told to draw dark", () => {
    document.documentElement.dataset.theme = "dark";
    document.head.appendChild(rules);
    rules.textContent = ':root[data-theme="dark"] .host { --wf-paper: #101010; --wf-ink: #ececec; }';
    const look = resolved()();
    expect(look.scheme).toBe("dark");
    // `--wf-ink: #ececec` is what tokens.css sets in the dark scheme, not the host's.
    expect(look.theme.dark).toEqual({ ...look.theme.dark, paper: "#101010", ink: "#ececec" });
    const given = { graph: vendor, positions: { nodes: {}, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, engine: "given" as const, direction: "RIGHT" as const } };
    expect(toSVG(given, { theme: look.theme })).toContain('fill="#ffffff"');
    expect(toSVG(given, { theme: look.theme, scheme: look.scheme })).toContain('fill="#101010"');
  });

  it("logs what checkTheme finds once, in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolved();
    expect(warn).not.toHaveBeenCalled();
    resolved({ color: { inkMuted: "#9a9a9a" } });
    resolved({ color: { inkMuted: "#9a9a9a" } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toContainEqual({ kind: "text", scheme: "light", subject: "inkMuted on paper", value: 2.81, minimum: 4.5 });
  });
});
