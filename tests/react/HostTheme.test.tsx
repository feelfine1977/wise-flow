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
const { abstract, defaultTheme, toSVG, layout, resolveViews } = await import("../../src/index");
const { CanvasMap, ProcessMap, ViewSwitcher, emptySelection, useFlowTheme } = await import("../../src/react/index");
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
    // 6 per character, 12 in a font named Wide.
    measureText: (text: string) => ({ width: text.length * (ctx.font.includes("Wide") ? 12 : 6) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  // The label is shortened to the room before its count by the scene's measure, the estimate's or the stub's.
  return { label: () => texts.filter((t) => t.text.startsWith("Record Goods Rec")).map((t) => t.fill), texts: () => texts.map((t) => t.text), strokes: () => strokes };
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

    // The activities of the invoice stage are outlined in its colour (the third categorical colour, #CC79A7, by its key's
    // hash), 2 wide by default and 3 wide once the host says so.
    const outlined = (width: number) => strokes().filter((s) => s.stroke === "#CC79A7" && s.width === width).length;
    expect([outlined(2) > 0, outlined(3)]).toEqual([true, 0]);
    act(() => host.classList.add("sized"));
    await waitFor(() => expect(outlined(3)).toBeGreaterThan(0));
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built + 1);
    expect(layouts.mock.calls.length).toBe(laid);
    expect([outlined(2), label()]).toEqual([0, ["#123456"]]);
  });

  it("measures the texts in the font of the host's variables, and measures them again when it changes, without a layout", async () => {
    const { texts } = recorder();
    const positions = await layout(vendor, { engine: "dagre" });
    document.head.appendChild(rules);
    rules.textContent = ".wide, .wide * { --wf-font: Wide; }";
    const view = render(
      <div className="host" style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={vendor} positions={positions} renderer="canvas" edgeBudget="all" controls={false} legend={false} />
      </div>,
    );
    const host = view.container.firstElementChild as HTMLElement;
    // At 6 per character "Record Invoice Recei…" (126) fits before its count "318" (18) and "Record Invoice Receip…" (132) does not,
    // so the label has 126 to 131 and "Record Goods Receipt" (120) is written in full.
    await waitFor(() => expect(texts()).toContain("Record Goods Receipt"));
    const built = vi.mocked(buildScene).mock.calls.length;
    const laid = layouts.mock.calls.length;
    // At 12 per character the count "323" takes 36, 18 more, leaving 108 to 113: "Record G…" (108), not "Record Go…" (120).
    act(() => host.classList.add("wide"));
    await waitFor(() => expect(texts()).toContain("Record G…"));
    expect(texts()).not.toContain("Record Goods Receipt");
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built + 1);
    expect(layouts.mock.calls.length).toBe(laid);
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

  it("draws the variables a host sets on the map's own element on the Canvas map too, and given a theme puts it over them", async () => {
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
    // Given a theme, the setting goes over the map's own variables, which go over the preset; the map writes the
    // result on its element, so the DOM and the Canvas map draw the same.
    const root = view.container.querySelector(".wf-process-map") as HTMLElement;
    const drawn = async (props: Parameters<typeof map>[0], ink: string) => {
      view.rerender(map(props));
      await waitFor(() => expect([label(), root.style.getPropertyValue("--wf-ink")]).toEqual([[ink], ink]));
    };
    const paper = { color: { paper: "#fdf6e3" } };
    await drawn({ containerStyle: { "--wf-ink": "#234567" } as React.CSSProperties, theme: paper }, "#234567");
    expect(root.style.getPropertyValue("--wf-paper")).toBe("#fdf6e3");
    await drawn({ className: "mine", theme: paper }, "#123456");
    await drawn({ className: "mine", containerStyle: { "--wf-ink": "#234567" } as React.CSSProperties, theme: { color: { ink: "#345678" } } }, "#345678");
    // A setting that no longer names the ink gives the map's own variable back.
    await drawn({ className: "mine", theme: paper }, "#123456");
    await drawn({ theme: paper }, "#1f1f1f");
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

  it("gives every view's map the switcher's theme, in the page's scheme, without a new layout", async () => {
    const positions = await layout(vendor, { engine: "dagre" });
    const views = resolveViews(vendor, [{ id: "a", label: "A" }, { id: "b", label: "B" }], positions);
    const switcher = (mode: "single" | "grid") => <ViewSwitcher views={views} mode={mode} theme={{ color: { paper: "#fdf6e3" } }} edgeBudget="all" legend={false} />;
    const view = render(switcher("grid"));
    const papers = () => [...view.container.querySelectorAll<HTMLElement>(".wf-process-map")].map((map) => map.style.getPropertyValue("--wf-paper"));
    await waitFor(() => expect(papers()).toEqual(["#fdf6e3", "#fdf6e3"]));
    view.rerender(switcher("single"));
    await waitFor(() => expect(papers()).toEqual(["#fdf6e3"]));
    // The setting's paper is the light scheme's; in the dark scheme the default theme's dark paper is drawn.
    const laid = layouts.mock.calls.length;
    act(() => void (document.documentElement.dataset.theme = "dark"));
    await waitFor(() => expect(papers()).toEqual(["#16181d"]));
    act(() => void delete document.documentElement.dataset.theme);
    await waitFor(() => expect(papers()).toEqual(["#fdf6e3"]));
    expect(layouts.mock.calls.length).toBe(laid);
  });

  it("repaints the DOM map, its pattern twins and the switcher's legends when a colour variable changes, without a new scene", async () => {
    const positions = await layout(vendor, { engine: "dagre" });
    document.head.appendChild(rules);
    rules.textContent = ".inked, .inked * { --wf-ink: #123456; } .sized, .sized * { --wf-stroke-node: 3px; }";
    const views = resolveViews(vendor, [{ id: "a", label: "A" }, { id: "b", label: "B" }], positions);
    const view = render(
      <div className="host">
        <ProcessMap graph={vendor} positions={positions} renderer="svg" controls={false} />
        <ViewSwitcher views={views} mode="grid" edgeBudget="all" />
      </div>,
    );
    const host = view.container.firstElementChild as HTMLElement;
    const inks = () => new Set([...view.container.querySelectorAll(".wf-node__band pattern > path, .wf-legend__swatch pattern > path")].map((p) => p.getAttribute("stroke")));
    await waitFor(() => expect(inks()).toEqual(new Set(["#1f1f1f"])));
    const built = vi.mocked(buildScene).mock.calls.length;
    act(() => host.classList.add("inked"));
    await waitFor(() => expect(inks()).toEqual(new Set(["#123456"])));
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built);
    expect(layouts).not.toHaveBeenCalled();
    // A size builds the scene of each of the three maps once, and the switcher's two legends, one per view of the one style.
    act(() => host.classList.add("sized"));
    await waitFor(() => expect(vi.mocked(buildScene).mock.calls.length).toBe(built + 3 + 2));
    expect(layouts).not.toHaveBeenCalled();
  });

  it("draws the pattern twins of the DOM map and of the switcher's legends in the theme's ink, as the theme says", async () => {
    const positions = await layout(vendor, { engine: "dagre" });
    document.head.appendChild(rules);
    rules.textContent = ".host, .host * { --wf-ink: #123456; }";
    const patterns = (root: Element) => [...root.querySelectorAll(".wf-node__band pattern > path, .wf-legend__swatch pattern > path")].map((p) => [p.getAttribute("stroke"), p.getAttribute("stroke-opacity")]);
    const map = (theme?: ThemeSetting) => (
      <div className="host">
        <ProcessMap graph={vendor} positions={positions} renderer="svg" controls={false} theme={theme} />
      </div>
    );
    const view = render(map());
    await waitFor(() => expect(patterns(view.container).length).toBeGreaterThan(1));
    expect(new Set(patterns(view.container).map(String))).toEqual(new Set(["#123456,0.6"]));
    // Print draws them opaque, and the setting's ink goes over the host's.
    view.rerender(map({ preset: "print", color: { ink: "#000000" } }));
    await waitFor(() => expect(new Set(patterns(view.container).map(String))).toEqual(new Set(["#000000,1"])));
    cleanup();

    // The legends of the grid are drawn in the theme too: print's stage colours, each with an opaque pattern.
    const views = resolveViews(vendor, [{ id: "a", label: "A" }, { id: "b", label: "B", style: { edgeColor: { metric: "count", palette: "performance" } } }], positions);
    const grid = render(<div className="host"><ViewSwitcher views={views} mode="grid" theme="print" edgeBudget="all" /></div>);
    const legends = grid.container.querySelector(".wf-views__legends")!;
    const swatches = [...legends.querySelectorAll<HTMLElement>(".wf-legend__swatch")];
    expect(swatches.length).toBeGreaterThan(1);
    // The print palette, in the form jsdom writes a background: #0072B2, #E69F00, #009E73, #CC79A7, #56B4E9, #D55E00, #F0E442.
    const print = ["rgb(0, 114, 178)", "rgb(230, 159, 0)", "rgb(0, 158, 115)", "rgb(204, 121, 167)", "rgb(86, 180, 233)", "rgb(213, 94, 0)", "rgb(240, 228, 66)"];
    for (const s of swatches) expect(print).toContain(s.style.background);
    expect(swatches.map((s) => s.querySelector("pattern > path, pattern > circle")?.getAttribute("stroke-opacity") ?? s.querySelector("pattern > circle")?.getAttribute("fill-opacity"))).toEqual(swatches.map(() => "1"));
    // Print's performance ramp, light to dark: #3a7bbf to #08306b.
    expect([...legends.querySelectorAll<HTMLElement>(".wf-legend__gradient")].map((g) => g.style.background)).toContain("linear-gradient(to right, #3a7bbf, #08519c, #08306b)");
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

  it("logs nothing in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      // A finding not logged before: in development it would be.
      resolved({ color: { inkMuted: "#a0a0a0" } });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
