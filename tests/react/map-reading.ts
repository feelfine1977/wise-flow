/**
 * What the React map drew, read from its DOM as a `Reading` (see
 * `tests/support/reading.ts`): the zoom of React Flow's viewport, the cards
 * from the node wrappers' positions and sizes, the texts with their boxes in
 * map units (path counts and overlay texts carry their coordinates; a card's
 * texts are inside it), the font sizes the stylesheet gives the map's classes,
 * which texts the level-of-detail classes hide at the current zoom, the badges,
 * the path lines with their stroke, the self-loops, the note on withheld
 * paths and the legend's printed values. Without layout in jsdom, a card's
 * texts get the card's box: the overlap properties do not read them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Box, NodeKind } from "../../src/index";
import { type DrawnText, type Reading, type TextRole, textBox } from "../support/reading";

const css = readFileSync(resolve(process.cwd(), "src/react/style.css"), "utf8").replace(/\/\*[^]*?\*\//g, "");

/** The font size the stylesheet's last rule for exactly this selector sets, in pixels. */
export function cssFontSize(selector: string): number {
  let size: number | undefined;
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim());
    const value = /(?:^|;)\s*font-size:\s*([\d.]+)px/.exec(m[2])?.[1];
    if (value && selectors.includes(selector)) size = Number(value);
  }
  if (size === undefined) throw new Error(`no font size for ${selector} in style.css`);
  return size;
}

const SIZES = {
  node: cssFontSize(".wf-node"),
  meta: cssFontSize(".wf-node__meta"),
  event: cssFontSize(".wf-node--event"),
  note: cssFontSize(".wf-node--note"),
  edge: cssFontSize(".wf-edge-label"),
  group: cssFontSize(".wf-group__label"),
};

const translate = (el: Element): [number, number] => {
  const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec((el as HTMLElement).style.transform);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

const num = (el: Element, name: string) => Number(el.getAttribute(name));

/** Hidden by a level-of-detail class the map does not set at its zoom. */
function hidden(el: Element, map: Element): boolean {
  return (el.classList.contains("wf-lod-labels") && !map.classList.contains("wf-lod--labels")) || (el.classList.contains("wf-lod-edge-labels") && !map.classList.contains("wf-lod--edge-labels"));
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
export function readReactMap(container: Element): DomReadings {
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
      const base = kind === "event" ? SIZES.event : kind === "note" ? SIZES.note : SIZES.node;
      for (const el of node.querySelectorAll(":scope > .wf-node__label, :scope > .wf-node__meta")) {
        all.push({ el, owner: id, role: "node", text: el.textContent ?? "", box, size: el.classList.contains("wf-node__meta") ? SIZES.meta : base });
      }
    } else {
      const title = wrapper.querySelector(".wf-group__label");
      if (title) all.push({ el: title, owner: id, role: "group", text: title.textContent ?? "", box: { x: box.x + 12, y: box.y + 8, width: 0, height: SIZES.group }, size: SIZES.group });
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
    if (line) paths.push({ id, width: parseFloat(line.style.strokeWidth), color: hex(line.style.stroke) });
    const label = g.querySelector(".wf-edge-label");
    if (label) {
      const text = label.textContent ?? "";
      all.push({ el: label, owner: id, role: "path", text, size: SIZES.edge, box: textBox(text, num(label, "x"), num(label, "y"), SIZES.edge, "middle", "alphabetic") });
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
  const legend = readLegend(container);
  const reading = (texts: DrawnText[]): Reading => ({ renderer: "react", zoom, cards, texts, badges, paths, loops, note, ...legend });
  const strip = ({ el: _el, ...t }: DrawnText & { el: Element }): DrawnText => t;
  return { fitted: reading(all.filter((t) => !hidden(t.el, map)).map(strip)), full: reading(all.map(strip)) };
}

/**
 * The zoom at which React Flow fits the map's nodes (groups included) into a
 * pane with a padding of 8 %: on each side `floor((size − size / 1.08) / 2)`
 * pixels, so in 1,200 × 800 the nodes get 1,112 × 742; clamped to the map's
 * 0.05 … 3.
 */
export function fittedZoom(container: Element, pane: { width: number; height: number }): number {
  const boxes = [...container.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => {
    const [x, y] = translate(el);
    return { x, y, right: x + parseFloat(el.style.width), bottom: y + parseFloat(el.style.height) };
  });
  const width = Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.x));
  const height = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.y));
  const pad = (size: number) => 2 * Math.floor((size - size / 1.08) / 2);
  return Math.min(3, Math.max(0.05, Math.min((pane.width - pad(pane.width)) / width, (pane.height - pad(pane.height)) / height)));
}

/** The legend's printed path-width ends and its colour scale, as `<Legend/>` writes them. */
export function readLegend(container: Element): Pick<Reading, "widthEnds" | "colorScale"> {
  const width = container.querySelector(".wf-legend__width");
  const ends = width ? [...width.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? "").trim()).filter(Boolean) : [];
  const gradient = container.querySelector<HTMLElement>(".wf-legend__gradient");
  const stops = gradient ? [...gradient.style.background.matchAll(/#[0-9a-f]{6}|rgb\([^)]*\)/gi)].map((m) => hex(m[0])) : [];
  const range = gradient ? [...(gradient.parentElement?.querySelectorAll(".wf-legend__range > span") ?? [])].map((s) => s.textContent ?? "") : [];
  const domain = range.map((r) => Number(r.replace(/[^\d.,-]/g, "").replace(",", ".")) / (r.includes("%") ? 100 : 1));
  return {
    ...(ends.length === 2 ? { widthEnds: [ends[0], ends[1]] as [string, string] } : {}),
    ...(stops.length >= 2 && domain.length >= 2 ? { colorScale: { domain, stops } } : {}),
  };
}

/** `#rrggbb` of a CSS colour jsdom may have normalised to `rgb(r, g, b)`. */
export function hex(color: string): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  return m ? `#${m.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, "0")).join("")}` : color.toLowerCase();
}
