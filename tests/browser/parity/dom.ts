/**
 * What the interactive DOM map drew, read in the browser from computed styles
 * and geometry, in flow coordinates. `readDomInPage` runs in the page and
 * returns plain values; `readDom` turns them into a `Drawing`.
 */
import { type Drawing, type DrawnText, bbox, cue, dash, num, paint, shadow } from "./drawn";

type Box = { x: number; y: number; width: number; height: number };

/** One element as the page read it: computed CSS values, not yet normalised. */
export interface DomElement {
  key: string;
  box?: Box;
  fill: { color: string; opacity: number };
  outline?: { color: string; width: number; style: string; opacity: number; sides: string };
  radius?: number;
  shadow?: string;
  band?: { color: string; width: number };
  /** A card's frequency cue: its stripe and its foot. */
  cue?: { color: string; width: number };
  cueFoot?: { color: string; width: number };
  rule?: { color: string; width: number };
  texts: { text: string; size: number; weight: number; color: string }[];
}

/**
 * Runs in the page (serialised by Playwright; it may use nothing from outside).
 * `tints` are the marks the map draws as a background of their target.
 */
export function readDomInPage(tints: { id: string; target: string }[]): DomElement[] {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")!;
  const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;
  const origin = viewport.getBoundingClientRect();
  const flow = (x: number, y: number): [number, number] => [(x - origin.left) / zoom, (y - origin.top) / zoom];
  const boxOf = (points: [number, number][]): Box => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  };
  const rectBox = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return boxOf([flow(r.left, r.top), flow(r.right, r.bottom)]);
  };
  // Points of path data (M, L, H, V, C, Z), control points included, in flow coordinates.
  const svgPoints = (el: SVGGraphicsElement, points: [number, number][]) => {
    const m = el.getScreenCTM()!;
    return points.map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(m);
      return flow(p.x, p.y);
    });
  };
  const pathPoints = (d: string): [number, number][] => {
    const out: [number, number][] = [];
    let x = 0;
    let y = 0;
    for (const m of d.matchAll(/([MLHVCZ])([^MLHVCZ]*)/gi)) {
      const n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
      const c = m[1].toUpperCase();
      if (c === "H") for (const v of n) out.push([(x = v), y]);
      else if (c === "V") for (const v of n) out.push([x, (y = v)]);
      else for (let i = 0; i + 1 < n.length; i += 2) out.push([(x = n[i]), (y = n[i + 1])]);
    }
    return out;
  };
  const shown = (el: Element) => {
    const cs = getComputedStyle(el);
    return cs.visibility === "visible" && cs.display !== "none" && el.getClientRects().length > 0;
  };
  const px = (v: string, of = 0) => (v.endsWith("%") ? (parseFloat(v) / 100) * of : parseFloat(v) || 0);
  // Texts of the element's own text nodes, in document order, outside the parts named by `skip`.
  const textsOf = (root: Element, skip: string) => {
    const out: DomElement["texts"] = [];
    const visit = (el: Element) => {
      if (el.matches(skip) || el.tagName === "title") return;
      const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim()).map((c) => c.textContent).join("");
      if (own && shown(el)) {
        const cs = getComputedStyle(el);
        out.push({ text: own, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), color: el instanceof SVGElement ? cs.fill : cs.color });
      }
      for (const c of el.children) visit(c);
    };
    visit(root);
    return out;
  };
  const SIDES = ["top", "right", "bottom", "left"] as const;
  const Cap = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" } as const;
  // The border as an outline: the sides drawn, and the first one's colour, width and style.
  const border = (el: HTMLElement): DomElement["outline"] => {
    const cs = getComputedStyle(el);
    const drawn = SIDES.filter((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 && cs.getPropertyValue(`border-${s}-style`) !== "none");
    if (!drawn.length) return undefined;
    const s = Cap[drawn[0]];
    return { color: cs[`border${s}Color`], width: parseFloat(cs[`border${s}Width`]), style: cs[`border${s}Style`], opacity: 1, sides: drawn.join(" ") };
  };
  // Box shadows split into the inset rule along an edge and the shadow around the box.
  const shadows = (el: HTMLElement) => {
    const value = getComputedStyle(el).boxShadow;
    if (value === "none") return { shadow: "none" };
    const list = value.split(/,(?![^(]*\))/).map((s) => s.trim());
    const inset = list.find((s) => s.endsWith("inset"));
    const outer = list.filter((s) => !s.endsWith("inset"));
    const lengths = inset ? (inset.replace(/^(rgba?|color)\([^)]*\)/, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat) : [];
    return {
      shadow: outer.length ? outer.join(", ") : "none",
      rule: inset ? { color: /^((?:rgba?|color)\([^)]*\))/.exec(inset)![1], width: Math.max(Math.abs(lengths[0] ?? 0), Math.abs(lengths[1] ?? 0)) } : undefined,
    };
  };
  // An outline drawn as an SVG shape (where a border cannot draw it): its paints, its radius and its extent.
  const drawnOutline = (shape: SVGGraphicsElement | null): Partial<DomElement> => {
    if (!shape) return {};
    const cs = getComputedStyle(shape);
    const a = (k: string) => Number(shape.getAttribute(k) ?? 0);
    const points: [number, number][] =
      shape.tagName === "rect" ? [[a("x"), a("y")], [a("x") + a("width"), a("y") + a("height")]] : shape.tagName === "circle" ? [[a("cx") - a("r"), a("cy") - a("r")], [a("cx") + a("r"), a("cy") + a("r")]] : pathPoints(shape.getAttribute("d") ?? "");
    return {
      box: boxOf(svgPoints(shape, points)),
      outline: cs.stroke === "none" ? undefined : { color: cs.stroke, width: parseFloat(cs.strokeWidth), style: cs.strokeDasharray, opacity: Number(cs.strokeOpacity), sides: "" },
      radius: shape.tagName === "rect" ? a("rx") : shape.tagName === "circle" ? a("r") : 0,
    };
  };
  const out: DomElement[] = [];
  const htmlElement = (key: string, el: HTMLElement, skip: string): DomElement => {
    const cs = getComputedStyle(el);
    return {
      key,
      box: rectBox(el),
      fill: { color: cs.backgroundColor, opacity: Number(cs.opacity) },
      outline: border(el),
      radius: px(cs.borderTopLeftRadius, el.offsetWidth),
      ...shadows(el),
      texts: textsOf(el, skip),
    };
  };

  for (const wrapper of document.querySelectorAll<HTMLElement>(".react-flow__node:not(.react-flow__node-wfGroup)")) {
    const el = wrapper.querySelector<HTMLElement>(":scope > .wf-node")!;
    const node = htmlElement(`node:${wrapper.dataset.id}`, el, ".wf-marks, .react-flow__handle, .wf-node__band, .wf-node__outline, .wf-node__cue");
    const band = el.querySelector<HTMLElement>(":scope > .wf-node__band");
    const shape = el.querySelector<SVGGraphicsElement>(":scope > .wf-node__outline > *");
    const fill = shape ? { color: getComputedStyle(shape).fill, opacity: Number(getComputedStyle(shape).fillOpacity) * node.fill.opacity } : node.fill;
    const part = (selector: string) => {
      const p = el.querySelector<HTMLElement>(`:scope > ${selector}`);
      return p ? { color: getComputedStyle(p).backgroundColor, width: rectBox(p).width } : undefined;
    };
    out.push({ ...node, ...drawnOutline(shape), fill, band: band ? { color: getComputedStyle(band).backgroundColor, width: band.offsetWidth } : undefined, cue: part(".wf-node__cue:not(.wf-node__cue-foot)"), cueFoot: part(".wf-node__cue-foot") });
  }
  for (const wrapper of document.querySelectorAll<HTMLElement>(".react-flow__node-wfGroup")) {
    const el = wrapper.querySelector<HTMLElement>(":scope > .wf-group")!;
    const group = htmlElement(`group:${wrapper.dataset.id!.replace(/^group:/, "")}`, el, ".wf-marks, .wf-group__outline");
    const { box: _, ...outline } = drawnOutline(el.querySelector<SVGGraphicsElement>(":scope > .wf-group__outline > *"));
    out.push({ ...group, ...outline });
  }
  for (const g of document.querySelectorAll<SVGGElement>("g.wf-edge[data-id]")) {
    const path = g.querySelector<SVGPathElement>(".react-flow__edge-path")!;
    const cs = getComputedStyle(path);
    out.push({
      key: `edge:${g.dataset.id}`,
      box: boxOf(svgPoints(path, pathPoints(path.getAttribute("d") ?? ""))),
      fill: { color: cs.fill === "none" ? "none" : cs.fill, opacity: 1 },
      outline: { color: cs.stroke, width: parseFloat(cs.strokeWidth), style: cs.strokeDasharray, opacity: Number(cs.opacity) * Number(cs.strokeOpacity), sides: "" },
      texts: textsOf(g, "title"),
    });
  }
  for (const g of document.querySelectorAll<SVGGElement>("[data-overlay-id]")) {
    const shape = [...g.children].find((c): c is SVGGraphicsElement => c.tagName === "path" || c.tagName === "rect")!;
    const cs = getComputedStyle(shape);
    const a = (k: string) => Number(shape.getAttribute(k) ?? 0);
    const points: [number, number][] = shape.tagName === "rect" ? [[a("x"), a("y")], [a("x") + a("width"), a("y") + a("height")]] : pathPoints(shape.getAttribute("d") ?? "");
    const texts: DomElement["texts"] = [];
    for (const t of g.querySelectorAll("text")) {
      const ts = getComputedStyle(t);
      for (const c of t.childNodes) {
        const style = c instanceof Element ? getComputedStyle(c) : ts;
        if (c.textContent) texts.push({ text: c.textContent, size: parseFloat(style.fontSize), weight: Number(style.fontWeight), color: style.fill });
      }
    }
    out.push({
      key: `mark:${g.dataset.overlayId}`,
      box: boxOf(svgPoints(shape, points)),
      fill: { color: cs.fill, opacity: Number(cs.fillOpacity) },
      outline: cs.stroke === "none" ? undefined : { color: cs.stroke, width: parseFloat(cs.strokeWidth), style: cs.strokeDasharray, opacity: Number(cs.strokeOpacity), sides: "" },
      radius: shape.tagName === "rect" ? px(cs.getPropertyValue("rx")) || a("rx") : undefined,
      texts,
    });
  }
  // Tints are the background of the element they cover.
  for (const { id, target } of tints) {
    const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(target)}"] > .wf-node, .react-flow__node[data-id="${CSS.escape(`group:${target}`)}"] > .wf-group`);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const color = /((?:rgba?|color)\([^)]*\))/.exec(cs.backgroundImage)?.[1];
    if (!color) continue;
    out.push({ key: `mark:${id}`, box: rectBox(el), fill: { color, opacity: 1 }, radius: px(cs.borderTopLeftRadius, el.offsetWidth), texts: [] });
  }
  return out;
}

const STYLES: Record<string, string> = { solid: "none", none: "none" };

/** The page's values as a `Drawing`: paints normalised, dash keywords of borders kept as they are. */
export function readDom(elements: DomElement[], kinds: Map<string, string>): Drawing {
  const out: Drawing = new Map();
  for (const e of elements) {
    const kind = kinds.get(e.key) ?? e.key;
    const props: Record<string, string> = { fill: paint(e.fill.color, e.fill.opacity) };
    const o = e.outline;
    const stroke = o ? paint(o.color, o.opacity) : "none";
    props.outline = stroke;
    if (o && stroke !== "none") {
      props.outlineWidth = num(o.width);
      props.dash = STYLES[o.style] ?? (/^[a-z]+$/.test(o.style) ? o.style : dash(o.style));
    }
    if (e.radius !== undefined) props.radius = num(e.radius);
    if (!kind.startsWith("mark:") && !kind.startsWith("edge:")) props.shadow = shadow(e.shadow);
    if (kind.startsWith("node:")) {
      props.band = e.band ? `${paint(e.band.color)} ${num(e.band.width)}` : "none";
      props.cue = cue(e.cue && paint(e.cue.color), e.cue?.width);
      props.cueFoot = cue(e.cueFoot && paint(e.cueFoot.color), e.cueFoot?.width);
    }
    if (kind.endsWith(":band")) {
      props.outlineSides = o?.sides ?? "none";
      props.rule = e.rule ? `${paint(e.rule.color)} ${num(e.rule.width)}` : "none";
    }
    const texts: DrawnText[] = e.texts.map((t) => ({ text: t.text, size: t.size, weight: t.weight, paint: paint(t.color) }));
    out.set(e.key, { box: e.box && bbox([[e.box.x, e.box.y], [e.box.x + e.box.width, e.box.y + e.box.height]]), props, texts });
  }
  return out;
}
