/**
 * What the React map drew, read from its DOM as a `Reading` (see
 * `tests/support/reading.ts`): the zoom of React Flow's viewport, the cards
 * from the node wrappers' positions and sizes, the texts with their boxes in
 * map units (path counts and overlay texts carry their coordinates; a card's
 * texts are inside it), each text in the size its mark gives it (the
 * `--wf-text-size` the element carries), which texts the level-of-detail
 * classes hide at the current zoom, the badges, the path lines with their
 * stroke, the self-loops, the note on withheld paths and the legend's printed
 * values. Without layout in jsdom, a card's texts get the card's box: the
 * overlap properties do not read them.
 *
 * jsdom applies no stylesheet, so the reading does what the stylesheet does
 * with the classes the map writes on its root for its readable state: it
 * shows the card block of the root's level (`wf-text--*`), scales it, a
 * group's title and the pills by the root's floor (the rung class
 * `wf-text-f*`, whose floor `tokens.css` gives, over the text size the
 * element names; a title and a pill where the root has `wf-text-grow`),
 * and leaves out the labels the root sheds (`wf-text-hide-*`). The browser
 * lane checks the stylesheet itself.
 */
import { fireEvent } from "@testing-library/react";
import { type Box, type Locale, type NodeKind, type XY, readableTokens } from "../../src/index";
import { type DrawnText, type Reading, type TextRole, parsePrinted, textBox } from "../support/reading";

/** The readable state the map's root says: its level, its floor (0 without a rung) and the kinds it sheds. */
function rootState(map: Element) {
  const classes = [...map.classList];
  const level = classes.find((c) => c.startsWith("wf-text--"))?.slice(9) ?? "plain";
  // The rung's floor, 2^(k/8) layout units (tokens.css writes it rounded up at the fourth decimal).
  const rung = classes.find((c) => /^wf-text-f\d+$/.test(c));
  const shed = new Set(classes.filter((c) => c.startsWith("wf-text-hide-")).map((c) => c.slice(13)));
  return { level, floor: rung ? 2 ** (Number(rung.slice(9)) / readableTokens.steps) : 0, shed, plain: level === "plain", grow: classes.includes("wf-text-grow") };
}

/** The scale the stylesheet gives an element whose smallest text is `size`: the floor over it, at least 1; a card's block except at the plain level, a group's title and a pill where the root says they grow. */
const boostOf = (state: ReturnType<typeof rootState>, size: number, scaled = !state.plain) => (!scaled || !(size > 0) ? 1 : Math.max(1, state.floor / size));
const grownBy = (state: ReturnType<typeof rootState>, size: number) => boostOf(state, size, state.grow);

/** The size in pixels of a text the map draws in the size of its mark. */
function textSize(el: Element): number {
  const size = parseFloat((el as HTMLElement).style.getPropertyValue("--wf-text-size"));
  if (!Number.isFinite(size)) throw new Error(`no text size on ${el.className}`);
  return size;
}

const translate = (el: Element): [number, number] => {
  const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec((el as HTMLElement).style.transform);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

const num = (el: Element, name: string) => Number(el.getAttribute(name));

/** Hidden by a level-of-detail class the map does not set at its zoom. */
function hidden(el: Element, map: Element): boolean {
  return (!!el.closest(".wf-lod-labels") && !map.classList.contains("wf-lod--labels")) || (!!el.closest(".wf-lod-edge-labels") && !map.classList.contains("wf-lod--edge-labels"));
}

/**
 * A card's texts as it draws them at `level` (its block of that level; `plain` its own texts, the richest): each line
 * of the name, the count and the share, scaled by `boost`; or the label of an event, a note or a gateway, unless shed.
 */
function cardTexts(node: Element, level: string, scale: (sizeOf: string) => number, shed: ReadonlySet<string>): { el: Element; text: string; size: number }[] {
  const out: { el: Element; text: string; size: number }[] = [];
  const block = node.querySelector(`:scope > .wf-activity-copy.wf-copy--${level}`);
  // The smallest text of the level, which the root names for the block's level.
  const k = block ? scale(level) : 1;
  const name = block?.querySelector(":scope > .wf-activity-name");
  if (name) for (const line of name.children) out.push({ el: line, text: line.textContent ?? "", size: textSize(name) * k });
  for (const run of block?.querySelectorAll(":scope > .wf-activity-counts > span") ?? []) out.push({ el: run, text: run.textContent ?? "", size: textSize(run) * k });
  const kind = node.getAttribute("data-kind");
  const label = kind === "event" ? "event" : kind === "gateway" ? "glyph" : "note";
  if (!shed.has(label)) for (const el of node.querySelectorAll(":scope > .wf-node__label")) out.push({ el, text: el.textContent ?? "", size: textSize(el) });
  return out;
}

/** A box scaled by `k` about `o`. */
const scaled = (b: Box, k: number, o: XY): Box => ({ x: o.x + (b.x - o.x) * k, y: o.y + (b.y - o.y) * k, width: b.width * k, height: b.height * k });

/** The text of an overlay mark's `<text>` with its box; a middle baseline is written 0.3 em low, so the box is the drawn one either way. Scaled by `k` about `o`. */
function svgText(el: Element, owner: string, role: TextRole, k = 1, o: XY = { x: 0, y: 0 }): DrawnText {
  const size = num(el, "font-size") * k;
  const anchor = el.getAttribute("text-anchor");
  const text = el.textContent ?? "";
  const at = { x: o.x + (num(el, "x") - o.x) * k, y: o.y + (num(el, "y") - o.y) * k };
  return { owner, role, text, size, box: textBox(text, at.x, at.y, size, anchor === "middle" ? "middle" : anchor === "end" ? "end" : "start", "alphabetic") };
}

/** The box of an SVG rectangle. */
const rectBox = (r: Element): Box => ({ x: num(r, "x"), y: num(r, "y"), width: num(r, "width"), height: num(r, "height") });

export interface DomReadings {
  /** What shows at the map's zoom: texts the level of detail hides or the readable state sheds are left out, the rest at the size the stylesheet scales them to. */
  fitted: Reading;
  /** Everything in the DOM, hidden by the level of detail or not: each card's own texts, every label and pill, at their sizes. */
  full: Reading;
}

/** Read a mounted `ProcessMap` (React Flow renderer) inside `container`. */
export function readReactMap(container: Element, locale: Locale = "en"): DomReadings {
  const map = container.querySelector(".wf-process-map")!;
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport");
  const zoom = Number(/scale\(([-\d.e]+)\)/.exec(viewport?.style.transform ?? "")?.[1] ?? 1);
  const state = rootState(map);
  const none = { level: "plain", floor: 0, shed: new Set<string>(), plain: true, grow: false };
  const sizeOf = (level: string) => parseFloat((map as HTMLElement).style.getPropertyValue(`--wf-text-s-${level}`));
  // The smallest text of the pills, which the stylesheet scales each up by.
  const pills = parseFloat((map as HTMLElement).style.getPropertyValue("--wf-pill-size"));
  const legend = readLegend(container, locale);
  const read = (look: typeof state): Reading => {
    const cards: Reading["cards"] = [];
    const texts: DrawnText[] = [];
    const badges: Reading["badges"] = [];
    // The full reading holds what the level of detail hides too.
    const shown = (el: Element, t: DrawnText) => (look === none || !hidden(el, map) ? texts.push(t) : undefined);
    for (const wrapper of container.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const node = wrapper.querySelector<HTMLElement>(":scope > .wf-node");
      const id = wrapper.getAttribute("data-id")!;
      const [x, y] = translate(wrapper);
      const box: Box = { x, y, width: parseFloat(wrapper.style.width), height: parseFloat(wrapper.style.height) };
      if (node) {
        const kind = node.getAttribute("data-kind") as NodeKind;
        cards.push({ id, kind, box });
        for (const { el, text, size } of cardTexts(node, look.level, (level) => boostOf(look, sizeOf(level)), look.shed)) shown(el, { owner: id, role: "node", text, box, size });
      } else {
        const title = wrapper.querySelector(".wf-group__label");
        if (title && look.level !== "box") {
          const size = textSize(title) * grownBy(look, textSize(title));
          shown(title, { owner: id, role: "group", text: title.textContent ?? "", box: { x: box.x + 12, y: box.y + 8, width: 0, height: size }, size });
        }
      }
      // Marks the element carries, in scene coordinates: its row of badges grows from the row's bottom-right corner, a chip from its middle.
      const row = wrapper.querySelector(".wf-marks .wf-pill-row");
      const rowBoxes = [...(row?.querySelectorAll("g.wf-badge > rect") ?? [])].map(rectBox);
      const corner = { x: Math.max(...rowBoxes.map((b) => b.x + b.width)), y: Math.max(...rowBoxes.map((b) => b.y + b.height)) };
      if (look.shed.has("pills")) continue;
      for (const g of wrapper.querySelectorAll(".wf-marks g.wf-overlay")) {
        const markId = g.getAttribute("data-overlay-id")!;
        if (g.classList.contains("wf-badge")) {
          badges.push({ id: markId, owner: id, box: scaled(rectBox(g.querySelector("rect")!), grownBy(look, pills), corner) });
        } else if (g.classList.contains("wf-chip")) {
          const b = rectBox(g.querySelector("rect")!);
          const k = grownBy(look, pills);
          for (const t of g.querySelectorAll("text")) shown(t, svgText(t, markId, "chip", k, { x: b.x + b.width / 2, y: b.y + b.height / 2 }));
        }
      }
    }
    const paths: Reading["paths"] = [];
    for (const g of container.querySelectorAll("g.wf-edge")) {
      const id = g.getAttribute("data-id")!;
      const line = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
      // The map sets a path's width and colour on its group, which the stylesheet gives the line.
      const style = (g as SVGGElement).style;
      if (line) paths.push({ id, width: parseFloat(line.style.strokeWidth || style.getPropertyValue("--wf-edge-width")), color: hex(line.style.stroke || style.getPropertyValue("--wf-edge-color")) });
      const label = g.querySelector(".wf-edge-label");
      if (label && !look.shed.has("path")) {
        const text = label.textContent ?? "";
        const size = textSize(label);
        shown(label, { owner: id, role: "path", text, size, box: textBox(text, num(label, "x"), num(label, "y"), size, "middle", "alphabetic") });
      }
    }
    const loops: string[] = [];
    for (const g of container.querySelectorAll(".wf-overlay-layer g.wf-overlay")) {
      const markId = g.getAttribute("data-overlay-id")!;
      const role: TextRole | undefined = g.classList.contains("wf-arc") ? "arc" : g.classList.contains("wf-selfloop") ? "loop" : undefined;
      if (!role) continue;
      if (role === "loop" && g.getAttribute("data-edge-id")) loops.push(g.getAttribute("data-edge-id")!);
      if (role === "loop" ? look.shed.has("loop") : look.shed.has("pills")) continue;
      // An arc's label grows with its pill from the pill's middle.
      const pill = g.querySelector(".wf-arc-pill");
      const b = pill ? rectBox(pill.querySelector("rect")!) : undefined;
      for (const t of g.querySelectorAll("text")) shown(t, b ? svgText(t, markId, role, grownBy(look, pills), { x: b.x + b.width / 2, y: b.y + b.height / 2 }) : svgText(t, markId, role));
    }
    const note = container.querySelector(".wf-edge-note")?.textContent ?? undefined;
    return { renderer: "react", zoom, cards, texts, badges, paths, loops, note, ...legend };
  };
  return { fitted: read(state), full: read(none) };
}

/**
 * The zoom at which the map fits its nodes (groups included) into a pane no
 * panel covers: the nodes' extent with 4 % of it on each side
 * (`min(pane / (size × 1.08))`), so 1,200 × 800 hold nodes of up to
 * 1,111 × 740 at zoom 1; clamped to the map's 0.05 … 3.
 */
export function fittedZoom(container: Element, pane: { width: number; height: number }): number {
  const boxes = [...container.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => {
    const [x, y] = translate(el);
    return { x, y, right: x + parseFloat(el.style.width), bottom: y + parseFloat(el.style.height) };
  });
  const width = Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.x));
  const height = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.y));
  return Math.min(3, Math.max(0.05, Math.min(pane.width / (width * 1.08), pane.height / (height * 1.08))));
}

/**
 * The legend's path widths and its colour scale, as an expanded `<Legend/>` writes them: the width row's last sample is
 * the high end of a scale that runs from 0; the colour ramp's stops and its printed ends, of the metric the map's style
 * colours paths by (by default their cases, placed by the square root). A legend shown as its strip writes neither, so
 * it is expanded for the reading by its toggle and collapsed again, as the map showed it.
 */
export function readLegend(container: Element, locale: Locale = "en", color: { metric: string; sqrt: boolean } = { metric: "cases", sqrt: true }): Pick<Reading, "widthEnds" | "colorScale"> {
  const toggle = () => container.querySelector<HTMLButtonElement>(".wf-legend .wf-legend__head button[aria-expanded]");
  if (!container.querySelector(".wf-legend--strip") || !toggle()) return readKey(container, locale, color);
  fireEvent.click(toggle()!);
  try {
    return readKey(container, locale, color);
  } finally {
    fireEvent.click(toggle()!);
  }
}

function readKey(container: Element, locale: Locale, color: { metric: string; sqrt: boolean }): Pick<Reading, "widthEnds" | "colorScale"> {
  const samples = [...container.querySelectorAll(".wf-legend__key .wf-legend__width .wf-legend__sample")].map((n) => (n.textContent ?? "").trim());
  const gradient = container.querySelector<HTMLElement>(".wf-legend__gradient");
  const stops = gradient ? [...gradient.style.background.matchAll(/#[0-9a-f]{6}|rgb\([^)]*\)/gi)].map((m) => hex(m[0])) : [];
  const range = gradient ? [...(gradient.parentElement?.querySelectorAll(".wf-legend__range > span") ?? [])].map((s) => s.textContent ?? "") : [];
  const domain = range.map((r) => (parsePrinted(r.replace(/[^\d.,kM-]/g, ""), locale)?.value ?? NaN) / (r.includes("%") ? 100 : 1));
  return {
    // One sample where every path has one count; otherwise the scale from 0, whose low end the samples do not write.
    ...(samples.length ? { widthEnds: [samples.length === 1 ? samples[0] : "0", samples.at(-1)!] as [string, string] } : {}),
    ...(stops.length >= 2 && domain.length >= 2 && domain.every(Number.isFinite) ? { colorScale: { ...color, domain, stops } } : {}),
  };
}

/** `#rrggbb` of a CSS colour jsdom may have normalised to `rgb(r, g, b)`. */
export function hex(color: string): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  return m ? `#${m.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, "0")).join("")}` : color.toLowerCase();
}
