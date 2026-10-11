import { describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay, type Theme, type ThemeRule, buildScene, checkTheme, defaultTheme, markInState, printTheme, resolveTheme, stateStyle, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";
import { markedThemeKey } from "../../src/core/theme";
import { graph as kinds, positions } from "./element-kinds";

/** The element kinds with the activity `a` tagged `manual` and the stage `s` outside the scope (hatched). */
const graph: FlowGraph = { ...kinds, nodes: kinds.nodes.map((n) => (n.id === "a" ? { ...n, tags: ["manual"] } : n)) };
const overlays: Overlay[] = [{ kind: "hatch", target: "s" }];

const withRules = (rules: readonly unknown[]): Theme => ({ ...defaultTheme, rules: rules as ThemeRule[] });
const scene = (rules: readonly unknown[], scheme: "light" | "dark" = "light") => buildScene(graph, positions, { overlays, theme: withRules(rules), scheme });
const node = (s: ReturnType<typeof scene>, id: string) => s.nodeMarks.find((m) => m.id === id)!;
const edge = (s: ReturnType<typeof scene>, id: string) => s.edgeMarks.find((m) => m.id === id)!;

/** One rule by kind, one by tag and one by state, as the API document's example writes them. */
const three: ThemeRule[] = [
  { match: { part: "node", kind: "gateway" }, set: { fill: "#fff3c4" } },
  { match: { part: "node", tag: "manual" }, set: { strokeWeight: "strong", radius: "m" } },
  { match: { part: "edge", state: "reconnected" }, set: { stroke: "#b42318", opacity: 0.5 } },
];

describe("a theme's rules", () => {
  it("restyle a node by kind, a node by tag and a path by state in the scene", () => {
    const s = scene(three);
    expect(node(s, "g").fill).toBe("#fff3c4");
    expect([node(s, "a").stroke.width, node(s, "a").radius]).toEqual([2, 8]);
    // The other activity keeps its kind's default: a 1 px outline with corners of 4.
    expect([node(s, "r").stroke.width, node(s, "r").radius, node(s, "r").fill]).toEqual([1, 4, "paper"]);
    expect([edge(s, "s->r").color, edge(s, "s->r").opacity, edge(s, "s->r").dash]).toEqual(["#b42318", 0.5, [6, 5]]);
    expect(edge(s, "start->a").opacity).toBeUndefined();
  });

  it("reach the SVG export and the Canvas drawing alike", () => {
    const svg = toSVG({ graph, positions, overlays }, { theme: withRules(three) });
    expect(svg).toMatch(/<g class="wf-node wf-node-gateway" data-id="g"><path [^>]*fill="#fff3c4"/);
    expect(svg).toMatch(/<g class="wf-node wf-node-activity" data-id="a"><rect [^>]*rx="8" fill="#ffffff" stroke="#8c94a1" stroke-width="2"/);
    expect(svg).toMatch(/<g class="wf-edge" data-id="s-&gt;r" opacity="0.5"><path [^>]*stroke="#b42318"/);

    const ops: { op: string; color: string; alpha: number; width: number }[] = [];
    const record = (op: string) =>
      function (this: DrawContext) {
        ops.push({ op, color: String(op === "fill" ? this.fillStyle : this.strokeStyle), alpha: this.globalAlpha, width: this.lineWidth });
      };
    const ctx = new Proxy({ fill: record("fill"), stroke: record("stroke"), measureText: (t: string) => ({ width: t.length * 6 }), globalAlpha: 1, lineWidth: 1 } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : () => undefined),
    }) as unknown as DrawContext;
    drawScene(ctx, prepareScene(graph, positions, { overlays, theme: withRules(three) }), { x: 0, y: 0, zoom: 1, width: 900, height: 200 }, undefined, { cull: false, background: false });
    expect(ops).toContainEqual({ op: "fill", color: "#fff3c4", alpha: 1, width: expect.any(Number) });
    expect(ops).toContainEqual({ op: "stroke", color: "#8c94a1", alpha: 1, width: 2 });
    expect(ops).toContainEqual({ op: "stroke", color: "#b42318", alpha: 0.5, width: expect.any(Number) });
  });

  it("apply in order, the later over the earlier, and a state's rules over both", () => {
    const outOfScope = { match: { part: "node", state: "outOfScope" }, set: { stroke: "#333333" } };
    const byKind = { match: { part: "node", kind: "stage" }, set: { stroke: "#111111" } };
    const byTag = { match: { part: "node", tag: "manual" }, set: { stroke: "#222222" } };
    const byActivity = { match: { part: "node", kind: "activity" }, set: { stroke: "#444444" } };
    const s = scene([outOfScope, byKind, byActivity, byTag]);
    // `a` is an activity tagged manual: the tag's rule comes later than the kind's.
    expect(node(s, "a").stroke.paint).toBe("#222222");
    // `r` is an activity without the tag.
    expect(node(s, "r").stroke.paint).toBe("#444444");
    // `s` is a stage outside the scope: the state's rule, though it comes first, overrides the kind's.
    expect(node(s, "s").stroke.paint).toBe("#333333");
    // In the other order the kind's rule comes later and wins for `a`.
    expect(node(scene([byTag, byActivity]), "a").stroke.paint).toBe("#444444");
  });

  it("of the interactive states resolve through one function, in order and over the others", () => {
    const rules = [
      { match: { part: "node", state: "hovered" }, set: { stroke: "#444444", opacity: 0.6 } },
      { match: { part: "node", state: "selected" }, set: { stroke: "#555555", fill: "#fef0e6" } },
      { match: { part: "node", kind: "activity" }, set: { stroke: "#666666" } },
      { match: { part: "edge", state: "dimmed" }, set: { opacity: 0.2 } },
    ];
    const s = scene(rules);
    const a = node(s, "a");
    // The scene holds the rule without a state; the states' rules are not in it.
    expect([a.stroke.paint, a.fill, a.opacity]).toEqual(["#666666", "paper", undefined]);
    expect(stateStyle(s, "node", a, {})).toBeUndefined();
    expect(stateStyle(s, "node", a, { focused: true })).toBeUndefined();
    expect(stateStyle(s, "node", a, { hovered: true })).toEqual({ stroke: "#444444", opacity: 0.6 });
    // Both states: the later rule's outline, the earlier's opacity.
    expect(stateStyle(s, "node", a, { hovered: true, selected: true })).toEqual({ stroke: "#555555", fill: "#fef0e6", opacity: 0.6 });
    expect(stateStyle(s, "edge", edge(s, "start->a"), { dimmed: true })).toEqual({ opacity: 0.2 });
    expect(stateStyle(s, "edge", edge(s, "start->a"), { hovered: true })).toBeUndefined();
    // The mark in a state: its outline and fill replaced, its texts kept.
    const hovered = markInState(a, stateStyle(s, "node", a, { selected: true }));
    expect([hovered.stroke.paint, hovered.fill, hovered.texts]).toEqual(["#555555", "#fef0e6", a.texts]);
  });

  it("draw the Canvas map's states as `stateStyle` gives them, over the default look of the state", () => {
    const rules = [
      { match: { part: "node", state: "selected" }, set: { stroke: "#c2410c" } },
      { match: { part: "edge", state: "dimmed" }, set: { opacity: 0.2 } },
    ];
    const ops: { op: string; color: string; alpha: number }[] = [];
    const record = (op: string) =>
      function (this: DrawContext) {
        ops.push({ op, color: String(op === "fill" ? this.fillStyle : this.strokeStyle), alpha: this.globalAlpha });
      };
    const ctx = new Proxy({ fill: record("fill"), stroke: record("stroke"), measureText: (t: string) => ({ width: t.length * 6 }), globalAlpha: 1 } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : () => undefined),
    }) as unknown as DrawContext;
    const prepared = prepareScene(graph, positions, { overlays, theme: withRules(rules) });
    const state = { selection: { nodes: ["a"], edges: [], groups: [] }, bright: { nodes: new Set(["a"]), edges: new Set<string>() } };
    drawScene(ctx, prepared, { x: 0, y: 0, zoom: 1, width: 900, height: 200 }, state, { cull: false, background: false });
    // The selected activity in the rule's outline, not the focus colour; the dimmed paths at the rule's opacity, not 0.25.
    expect(ops).toContainEqual({ op: "stroke", color: "#c2410c", alpha: 1 });
    expect(ops.filter((o) => o.op === "stroke" && o.color === "#0072b2")).toEqual([]);
    expect(ops.some((o) => o.alpha === 0.2)).toBe(true);
    expect(ops.some((o) => o.alpha === 0.25)).toBe(false);
  });

  it("ignore an entry left undefined, which the type allows, rather than refuse the rule or undo an earlier one", () => {
    const rules = [
      { match: { part: "node", kind: "activity" }, set: { fill: "#fff3c4", text: { name: { size: 15 } } } },
      { match: { part: "node", kind: undefined, tag: undefined, state: undefined }, set: { stroke: "#111111", fill: undefined, opacity: undefined, text: { name: { size: undefined, color: "#222222" }, label: undefined } } },
    ];
    expect(checkTheme(withRules(rules)).filter((d) => d.kind === "rule")).toEqual([]);
    const a = node(scene(rules), "a");
    // The second rule matches every node: its outline and name colour apply, the first rule's fill and size stay.
    expect([a.fill, a.stroke.paint, a.opacity]).toEqual(["#fff3c4", "#111111", undefined]);
    expect(a.texts.find((t) => t.role === "nameLine")).toMatchObject({ size: 15, paint: "#222222" });
  });

  it("name colours by role, drawn in the scheme's colour", () => {
    const rules = [{ match: { part: "node", kind: "activity" }, set: { text: { name: { color: "accent", weight: 600 } } } }];
    const name = (scheme: "light" | "dark") => node(scene(rules, scheme), "a").texts.find((t) => t.role === "nameLine")!;
    expect([name("light").paint, name("light").weight]).toEqual(["#b84a00", 600]);
    expect(name("dark").paint).toBe("#ff8c42");
    // With rules, a change of any colour builds the scene again.
    const theme = withRules(rules);
    expect(markedThemeKey(theme, "light")).not.toBe(markedThemeKey({ ...theme, color: { ...theme.color, ink: "#000000" } }, "light"));
  });

  it("change a card's text sizes before its name is wrapped, and the place of its cue", () => {
    const long: FlowGraph = { nodes: [{ id: "x", kind: "activity", label: "Approve the purchase requisition of a vendor", metrics: { cases: 5 } }], edges: [], meta: { cases: 10 } };
    const at = { ...positions, nodes: { x: { x: 0, y: 0, width: 180, height: 64 } }, edges: {} };
    // Half the size a character, the ellipsis too.
    const textMeasure = (text: string, font: { size: number }) => (Array.from(text).length * font.size) / 2;
    const card = (rules: unknown[]) => buildScene(long, at, { theme: withRules(rules), textMeasure }).nodeMarks[0];
    const lines = (rules: unknown[]) => card(rules).texts.filter((t) => t.role === "nameLine").map((t) => [t.text, t.size]);
    // 180 − 24 of padding − 2 of outline leaves 154: 23 characters at 13 px, 20 at 15 px.
    expect(lines([])).toEqual([["Approve the purchase", 13], ["requisition of a vendor", 13]]);
    const bigger = [{ match: { part: "node", kind: "activity" }, set: { text: { name: { size: 15 } }, cue: "bottom" } }];
    expect(lines(bigger)).toEqual([["Approve the purchase", 15], ["requisition of a ve…", 15]]);
    // The cue only as its foot, half of 180 − 8 of band − 1 of outline long.
    expect([card(bigger).cue!.stripe, card(bigger).cue!.foot?.box.width]).toEqual([undefined, 85.5]);
  });

  it("leave a hatch's pattern and a tint's corners as they are, and restyle a badge", () => {
    const badge: Overlay = { kind: "badge", target: "a", payload: { glyph: "≥1", value: 0.25 } };
    const tint: Overlay = { kind: "tint", target: "r", payload: { value: 0.5 } };
    const rules = [
      { match: { part: "mark", kind: "badge" }, set: { fill: "#fff7ed", stroke: "ink", radius: "s", opacity: 0.8 } },
      { match: { part: "mark", kind: "hatch" }, set: { fill: "#000000" } },
      { match: { part: "mark", kind: "tint" }, set: { radius: "full" } },
    ];
    const s = buildScene(graph, positions, { overlays: [...overlays, badge, tint], theme: withRules(rules) });
    const mark = (kind: string) => s.marks.find((m) => m.kind === kind)!;
    expect([mark("badge").fill, mark("badge").stroke?.paint, mark("badge").radius, mark("badge").opacity]).toEqual([{ paint: "#fff7ed", opacity: undefined }, "#1f1f1f", 4, 0.8]);
    expect(mark("hatch").fill).toEqual({ paint: "outOfScope", pattern: "outOfScope", opacity: 0.55 });
    // A tint follows the corners of the activity it covers (4).
    expect(mark("tint").radius).toBe(4);
    expect(toSVG({ graph, positions, overlays: [...overlays, badge, tint] }, { theme: withRules(rules) })).toMatch(/<g class="wf-overlay wf-badge" opacity="0.8">/);
  });
});

describe("rules that are unknown or out of range", () => {
  const invalid = [
    { match: { part: "node", kind: "activity" }, set: { shadow: "0 1px 2px #000" } },
    { match: { part: "node", kind: "activity" }, set: { strokeWeight: "heavy" } },
    { match: { part: "node" }, set: { fillOpacity: 2, fill: "#ff0000" } },
    { match: { part: "node" }, set: { text: { name: { size: 40 } } } },
    { match: { part: "node" }, set: { text: { name: { size: 8 } } } },
    { match: { part: "edge", kind: "activity" }, set: { stroke: "#ff0000" } },
    { match: { part: "group", tag: "manual" }, set: { stroke: "#ff0000" } },
    { match: { part: "node", state: "hovered" }, set: { radius: "full" } },
    { match: { part: "node", kind: "gateway" }, set: { fill: "not a colour" } },
    { match: { part: "edge" }, set: { fill: "#ff0000" } },
    { match: { part: "mark", kind: "badge" }, set: { text: { label: { size: 13 } } } },
    { match: { part: "lane" }, set: { stroke: "#ff0000" } },
    "a rule",
  ];

  it("change nothing", () => {
    const plain = toSVG({ graph, positions, overlays });
    expect(toSVG({ graph, positions, overlays }, { theme: withRules(invalid) })).toBe(plain);
    expect(scene(invalid).nodeMarks).toEqual(scene([]).nodeMarks);
  });

  it("are listed among checkTheme's deviations", () => {
    const found = checkTheme(withRules(invalid)).filter((d) => d.kind === "rule");
    expect(found).toEqual([
      { kind: "rule", subject: "rules[0].set.shadow", value: "0 1px 2px #000" },
      { kind: "rule", subject: "rules[1].set.strokeWeight", value: "heavy" },
      { kind: "rule", subject: "rules[2].set.fillOpacity", value: 2 },
      { kind: "rule", subject: "rules[3].set.text.name.size", value: 40 },
      // The default theme's smallest text: 8.25 pt, 11 px.
      { kind: "rule", subject: "rules[4].set.text.name.size", value: 8, minimum: 11 },
      { kind: "rule", subject: "rules[5].match.kind", value: "activity" },
      { kind: "rule", subject: "rules[6].match.tag", value: "manual" },
      { kind: "rule", subject: "rules[7].set.radius", value: "full" },
      { kind: "rule", subject: "rules[8].set.fill", value: "not a colour" },
      { kind: "rule", subject: "rules[9].set.fill", value: "#ff0000" },
      { kind: "rule", subject: "rules[10].set.text.label.size", value: 13 },
      { kind: "rule", subject: "rules[11].match.part", value: "lane" },
      { kind: "rule", subject: "rules[12]", value: "a rule" },
    ]);
  });

  it("clamp an opacity outside 0.2 to 1, and list it", () => {
    const faint = [{ match: { part: "node", kind: "note" }, set: { opacity: 0.05 } }];
    expect(node(scene(faint), "n").opacity).toBe(0.2);
    expect(node(scene([{ match: { part: "node", kind: "note" }, set: { opacity: 3 } }]), "n").opacity).toBe(1);
    expect(checkTheme(withRules(faint)).filter((d) => d.kind === "rule")).toEqual([{ kind: "rule", subject: "rules[0].set.opacity", value: 0.05, minimum: 0.2 }]);
    // Above the range there is no minimum to report.
    expect(checkTheme(withRules([{ match: { part: "node", kind: "note" }, set: { opacity: 3 } }])).filter((d) => d.kind === "rule")).toEqual([{ kind: "rule", subject: "rules[0].set.opacity", value: 3 }]);
  });
});

describe("the default look", () => {
  it("is written without rules, in both presets", () => {
    expect([defaultTheme.rules, printTheme.rules]).toEqual([[], []]);
    expect(checkTheme(defaultTheme).filter((d) => d.kind === "rule")).toEqual([]);
  });

  it("is the same with an empty list of rules as without", () => {
    expect(toSVG({ graph, positions, overlays }, { theme: { rules: [] } })).toBe(toSVG({ graph, positions, overlays }));
    expect(resolveTheme({ rules: [] }).rules).toEqual([]);
  });

  it("takes a setting's rules over the preset's", () => {
    expect(resolveTheme({ preset: "print", rules: three }).rules).toBe(three);
  });
});
