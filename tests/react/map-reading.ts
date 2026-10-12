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
 */
import { fireEvent } from "@testing-library/react";
import type { Box, Locale, NodeKind } from "../../src/index";
import { type DrawnText, type Reading, type TextRole, parsePrinted, textBox } from "../support/reading";

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

/** A card's texts as it draws them: each line of the name, the count and the share, or the label of an event, a note or a gateway. */
function cardTexts(node: Element): { el: Element; text: string; size: number }[] {
  const out: { el: Element; text: string; size: number }[] = [];
  const name = node.querySelector(":scope > .wf-activity-copy > .wf-activity-name");
  if (name) for (const line of name.children) out.push({ el: line, text: line.textContent ?? "", size: textSize(name) });
  for (const run of node.querySelectorAll(":scope > .wf-activity-copy > .wf-activity-counts > span")) out.push({ el: run, text: run.textContent ?? "", size: textSize(run) });
  for (const label of node.querySelectorAll(":scope > .wf-node__label")) out.push({ el: label, text: label.textContent ?? "", size: textSize(label) });
  return out;
}

/** The text of an overlay mark's `<text>` with its box; a middle baseline is written 0.3 em low, so the box is the drawn one either way. */
function svgText(el: Element, owner: string, role: TextRole): DrawnText {
  const size = num(el, "font-size");
  const anchor = el.getAttribute("text-anchor");
  const text = el.textContent ?? "";
  return { owner, role, text, size, box: textBox(text, num(el, "x"), num(el, "y"), size, anchor === "middle" ? "middle" : anchor === "end" ? "end" : "start", "alphabetic") };
}

export interface DomReadings {
  /** What shows at the map's zoom: texts the level of detail hides are left out. */
  fitted: Reading;
  /** Everything in the DOM, hidden by the level of detail or not. */
  full: Reading;
}

/** Read a mounted `ProcessMap` (React Flow renderer) inside `container`. */
export function readReactMap(container: Element, locale: Locale = "en"): DomReadings {
  const map = container.querySelector(".wf-process-map")!;
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport");
  const zoom = Number(/scale\(([-\d.e]+)\)/.exec(viewport?.style.transform ?? "")?.[1] ?? 1);
  const cards: Reading["cards"] = [];
  const all: (DrawnText & { el: Element })[] = [];
  const badges: Reading["badges"] = [];
  for (const wrapper of container.querySelectorAll<HTMLElement>(".react-flow__node")) {
    const node = wrapper.querySelector<HTMLElement>(":scope > .wf-node");
    const id = wrapper.getAttribute("data-id")!;
    const [x, y] = translate(wrapper);
    const box: Box = { x, y, width: parseFloat(wrapper.style.width), height: parseFloat(wrapper.style.height) };
    if (node) {
      const kind = node.getAttribute("data-kind") as NodeKind;
      cards.push({ id, kind, box });
      for (const { el, text, size } of cardTexts(node)) all.push({ el, owner: id, role: "node", text, box, size });
    } else {
      const title = wrapper.querySelector(".wf-group__label");
      if (title) all.push({ el: title, owner: id, role: "group", text: title.textContent ?? "", box: { x: box.x + 12, y: box.y + 8, width: 0, height: textSize(title) }, size: textSize(title) });
    }
    // Marks the element carries, in scene coordinates.
    for (const g of wrapper.querySelectorAll(".wf-marks g.wf-overlay")) {
      const markId = g.getAttribute("data-overlay-id")!;
      if (g.classList.contains("wf-badge")) {
        const r = g.querySelector("rect")!;
        badges.push({ id: markId, owner: id, box: { x: num(r, "x"), y: num(r, "y"), width: num(r, "width"), height: num(r, "height") } });
      } else if (g.classList.contains("wf-chip")) for (const t of g.querySelectorAll("text")) all.push({ el: t, ...svgText(t, markId, "chip") });
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
    if (label) {
      const text = label.textContent ?? "";
      const size = textSize(label);
      all.push({ el: label, owner: id, role: "path", text, size, box: textBox(text, num(label, "x"), num(label, "y"), size, "middle", "alphabetic") });
    }
  }
  const loops: string[] = [];
  for (const g of container.querySelectorAll(".wf-overlay-layer g.wf-overlay")) {
    const markId = g.getAttribute("data-overlay-id")!;
    const role: TextRole | undefined = g.classList.contains("wf-arc") ? "arc" : g.classList.contains("wf-selfloop") ? "loop" : undefined;
    if (!role) continue;
    if (role === "loop" && g.getAttribute("data-edge-id")) loops.push(g.getAttribute("data-edge-id")!);
    for (const t of g.querySelectorAll("text")) all.push({ el: t, ...svgText(t, markId, role) });
  }
  const note = container.querySelector(".wf-edge-note")?.textContent ?? undefined;
  const legend = readLegend(container, locale);
  const reading = (texts: DrawnText[]): Reading => ({ renderer: "react", zoom, cards, texts, badges, paths, loops, note, ...legend });
  const strip = ({ el: _el, ...t }: DrawnText & { el: Element }): DrawnText => t;
  return { fitted: reading(all.filter((t) => !hidden(t.el, map)).map(strip)), full: reading(all.map(strip)) };
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
