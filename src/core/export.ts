/**
 * Deterministic SVG export of a scene with an embedded legend and figure presets.
 */
import { type Locale, formatCompact, formatCount, formatNumber, formatShare } from "./format";
import { type Box, type Positions, straightRoute } from "./layout";
import { type FlowGraph, type Overlay, MAP_TARGET, hasTag, metric } from "./model";
import { type OverlayGeometryOptions, type OverlayShape, canonicalOverlays, overlayGeometry } from "./overlays";
import { type LegendItem, type Scales, type StyleSpec, buildScales, contrastText, defaultStyle, fixedColors, lodAt, patternDefs } from "./style";
import { RECONNECTED_TAG } from "./aggregate";
import { type StringKey, t } from "./strings";

export interface Scene {
  graph: FlowGraph;
  positions: Positions;
  overlays?: Overlay[];
  style?: StyleSpec;
  title?: string;
  subtitle?: string;
  locale?: Locale;
}

export type FigurePreset = "single-column" | "double-column" | "slide" | "none";

export interface ExportOptions {
  /** Figure preset setting the output width in pixels (the drawing scales to fit). */
  preset?: FigurePreset;
  /** Explicit output width in pixels; overrides the preset. */
  width?: number;
  legend?: boolean;
  background?: string;
  fontFamily?: string;
  padding?: number;
  /** Zoom level used for level-of-detail decisions. Default 1 (everything visible). */
  lodZoom?: number;
  overlayGeometry?: OverlayGeometryOptions;
  /** Show the scene context line (label, cases, events) under the title. */
  context?: boolean;
}

export const FIGURE_WIDTHS: Record<Exclude<FigurePreset, "none">, number> = {
  "single-column": 1000,
  "double-column": 2000,
  slide: 1600,
};

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number): string => Number(n.toFixed(2)).toString();

interface Ctx {
  scene: Scene;
  scales: Scales;
  locale: Locale;
  lod: ReturnType<typeof lodAt>;
  font: string;
}

function rect(b: Box, attrs: string): string {
  return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" ${attrs}/>`;
}

function text(x: number, y: number, s: string, attrs = ""): string {
  return `<text x="${num(x)}" y="${num(y)}" ${attrs}>${esc(s)}</text>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

function drawGroups(ctx: Ctx): string {
  const { graph, positions } = ctx.scene;
  const out: string[] = [];
  for (const g of [...(graph.groups ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const b = positions.groups[g.id];
    if (!b) continue;
    const c = ctx.scales.categorical(g.id);
    out.push(`<g class="wf-group" data-id="${esc(g.id)}">`);
    out.push(rect(b, `rx="10" fill="${c.color}" fill-opacity="0.06" stroke="${c.color}" stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray="6 4"`));
    out.push(text(b.x + 12, b.y + 22, g.label, `font-size="14" font-weight="600" fill="${fixedColors.ink}"`));
    out.push(`</g>`);
  }
  return out.join("");
}

function routeOf(ctx: Ctx, edgeId: string, source: string, target: string) {
  const { positions } = ctx.scene;
  const r = positions.edges[edgeId];
  if (r && r.points.length >= 2) return r;
  const a = positions.nodes[source];
  const b = positions.nodes[target];
  if (!a || !b) return undefined;
  return straightRoute(a, b);
}

function drawEdges(ctx: Ctx): string {
  const { graph } = ctx.scene;
  const out: string[] = [];
  const edges = [...graph.edges].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const e of edges) {
    if (e.source === e.target) continue;
    const route = routeOf(ctx, e.id, e.source, e.target);
    if (!route) continue;
    const w = ctx.scales.edgeWidth(e);
    const color = e.kind === "constraint" ? fixedColors.mechanism : ctx.scales.edgeColor(e);
    const dash = hasTag(e, RECONNECTED_TAG) ? ` stroke-dasharray="6 5"` : e.kind === "constraint" ? ` stroke-dasharray="2 4"` : "";
    const d = route.points.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join("");
    out.push(`<g class="wf-edge" data-id="${esc(e.id)}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${num(w)}" stroke-linejoin="round"${dash} marker-end="url(#wf-arrow)"/>`);
    if (ctx.lod.edgeLabels && e.kind === "follows") {
      const count = metric(e, "count", NaN);
      if (Number.isFinite(count)) {
        const mid = route.points[Math.floor((route.points.length - 1) / 2)];
        const next = route.points[Math.min(route.points.length - 1, Math.floor((route.points.length - 1) / 2) + 1)];
        const lx = route.labelX ?? (mid.x + next.x) / 2;
        const ly = route.labelY ?? (mid.y + next.y) / 2 - 4;
        out.push(text(lx, ly, formatCompact(count, ctx.locale), `font-size="10" text-anchor="middle" fill="${fixedColors.ink}" paint-order="stroke" stroke="${fixedColors.paper}" stroke-width="3"`));
      }
    }
    out.push(`</g>`);
  }
  return out.join("");
}

function drawNodes(ctx: Ctx): string {
  const { graph, positions } = ctx.scene;
  const out: string[] = [];
  const nodes = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const n of nodes) {
    const b = positions.nodes[n.id];
    if (!b) continue;
    const color = ctx.scales.nodeColor(n);
    const pattern = ctx.scales.nodePattern(n);
    const reconnected = hasTag(n, RECONNECTED_TAG);
    out.push(`<g class="wf-node wf-node-${n.kind}" data-id="${esc(n.id)}">`);
    if (n.kind === "event") {
      const r = Math.min(b.width, b.height) / 2;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const end = hasTag(n, "end");
      out.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fixedColors.paper}" stroke="${fixedColors.ink}" stroke-width="${end ? 3 : 1.5}"/>`);
      if (ctx.lod.labels) out.push(text(cx, cy + r + 12, n.label, `font-size="10" text-anchor="middle" fill="${fixedColors.ink}"`));
    } else if (n.kind === "gateway") {
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const h = b.width / 2;
      out.push(`<path d="M${num(cx)} ${num(cy - h)}L${num(cx + h)} ${num(cy)}L${num(cx)} ${num(cy + h)}L${num(cx - h)} ${num(cy)}Z" fill="${fixedColors.paper}" stroke="${fixedColors.ink}" stroke-width="1.5"/>`);
      if (ctx.lod.labels) out.push(text(cx, cy + 4, n.label, `font-size="11" text-anchor="middle" fill="${fixedColors.ink}"`));
    } else {
      out.push(rect(b, `rx="6" fill="${fixedColors.paper}" stroke="${color}" stroke-width="${n.kind === "stage" ? 3 : 2}"${reconnected ? ` stroke-dasharray="4 3"` : ""}`));
      const band: Box = { x: b.x, y: b.y, width: 8, height: b.height };
      out.push(rect(band, `rx="3" fill="${color}"`));
      if (pattern !== "solid") out.push(rect(band, `rx="3" fill="url(#wf-pattern-${pattern})"`));
      if (ctx.lod.labels) {
        const label = truncate(n.label, Math.max(4, Math.floor((b.width - 20) / 6.4)));
        out.push(text(b.x + 14, b.y + b.height / 2 + 4, label, `font-size="12" fill="${fixedColors.ink}"`));
        const cases = metric(n, "cases", NaN);
        if (Number.isFinite(cases)) {
          out.push(text(b.x + b.width - 6, b.y + b.height - 5, formatCompact(cases, ctx.locale), `font-size="9" text-anchor="end" fill="${fixedColors.neutral}"`));
        }
      }
    }
    out.push(`</g>`);
  }
  return out.join("");
}

function drawOverlays(ctx: Ctx, shapes: OverlayShape[]): string {
  const out: string[] = [];
  const order: Record<string, number> = { tint: 0, hatch: 1, arc: 2, selfLoop: 3, badge: 4, chip: 5 };
  const sorted = [...shapes].sort((a, b) => order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : 1));
  for (const s of sorted) {
    const key = lodKey(s.kind);
    if (key && !ctx.lod[key]) continue;
    const p = s.overlay.payload ?? {};
    const value = typeof p.value === "number" ? p.value : NaN;
    const color = Number.isFinite(value) ? ctx.scales.color(value, "sequential", [0, 1]) : fixedColors.neutral;
    const title = `<title>${esc([p.label, p.text].filter(Boolean).join(" — "))}</title>`;
    switch (s.kind) {
      case "tint":
        out.push(`<g class="wf-overlay wf-tint">${title}${rect(s, `rx="10" fill="${color}" fill-opacity="0.18" stroke="none"`)}</g>`);
        break;
      case "hatch":
        out.push(`<g class="wf-overlay wf-hatch">${title}${rect(s, `rx="6" fill="url(#wf-pattern-outofscope)" fill-opacity="0.9" stroke="${fixedColors.outOfScope}" stroke-width="1"`)}</g>`);
        break;
      case "arc": {
        const width = 2 + 8 * Math.max(0, Math.min(1, typeof p.coverage === "number" ? p.coverage : 1));
        const dash = p.reverse ? ` stroke-dasharray="6 4"` : "";
        out.push(`<g class="wf-overlay wf-arc">${title}<path d="${s.path}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-opacity="0.9"${dash} marker-end="url(#wf-arrow-arc)"/>`);
        if (s.labelX !== undefined && s.labelY !== undefined) {
          const label = `${p.glyph ?? ""} ${Number.isFinite(value) ? formatShare(value, ctx.locale) : ""}`.trim();
          out.push(text(s.labelX, s.labelY, label, `font-size="11" text-anchor="middle" fill="${fixedColors.ink}" paint-order="stroke" stroke="${fixedColors.paper}" stroke-width="3"`));
        }
        out.push(`</g>`);
        break;
      }
      case "selfLoop": {
        out.push(`<g class="wf-overlay wf-selfloop">${title}<path d="${s.path}" fill="none" stroke="${color}" stroke-width="2.5" marker-end="url(#wf-arrow)"/>`);
        if (s.labelX !== undefined && s.labelY !== undefined && Number.isFinite(value)) {
          out.push(text(s.labelX, s.labelY, `↻ ${formatShare(value, ctx.locale)}`, `font-size="10" fill="${fixedColors.ink}" paint-order="stroke" stroke="${fixedColors.paper}" stroke-width="3"`));
        }
        out.push(`</g>`);
        break;
      }
      case "badge": {
        const ink = contrastText(color);
        out.push(`<g class="wf-overlay wf-badge">${title}${rect(s, `rx="${num(s.height / 2)}" fill="${color}" stroke="${fixedColors.paper}" stroke-width="1.5"`)}`);
        const label = Number.isFinite(value) ? formatShare(value, ctx.locale) : (p.glyph ?? "");
        out.push(text(s.x + s.width / 2, s.y + s.height / 2 + 3.5, p.glyph && Number.isFinite(value) ? `${p.glyph}` : label, `font-size="10" font-weight="700" text-anchor="middle" fill="${ink}"`));
        if (Number.isFinite(value)) {
          out.push(text(s.x + s.width + 4, s.y + s.height / 2 + 3.5, formatShare(value, ctx.locale), `font-size="10" fill="${fixedColors.ink}" paint-order="stroke" stroke="${fixedColors.paper}" stroke-width="3"`));
        }
        out.push(`</g>`);
        break;
      }
      case "chip": {
        if (s.overlay.target === MAP_TARGET) break; // drawn in the legend
        out.push(`<g class="wf-overlay wf-chip">${title}${rect(s, `rx="12" fill="${fixedColors.paper}" stroke="${color}" stroke-width="2"`)}`);
        out.push(text(s.x + 8, s.y + s.height / 2 + 4, truncate(`${p.glyph ?? ""} ${p.text ?? p.label ?? ""}`.trim(), Math.floor((s.width - 12) / 6.2)), `font-size="10" fill="${fixedColors.ink}"`));
        out.push(`</g>`);
        break;
      }
    }
  }
  return out.join("");
}

function lodKey(kind: OverlayShape["kind"]): keyof ReturnType<typeof lodAt> | null {
  switch (kind) {
    case "badge":
      return "badges";
    case "arc":
      return "arcs";
    case "chip":
      return "chips";
    case "hatch":
      return "hatch";
    case "selfLoop":
      return "selfLoops";
    default:
      return null;
  }
}

function drawLegend(ctx: Ctx, x: number, y: number, width: number, mapChips: Overlay[]): { svg: string; height: number } {
  const out: string[] = [];
  const L = ctx.locale;
  let cy = y;
  out.push(text(x, cy + 14, t(L, "legend.title"), `font-size="13" font-weight="700" fill="${fixedColors.ink}"`));
  cy += 26;
  const item = (item: LegendItem) => {
    out.push(text(x, cy + 11, t(L, item.title as StringKey), `font-size="11" font-weight="600" fill="${fixedColors.ink}"`));
    cy += 16;
    if (item.kind === "width") {
      const [lo, hi] = item.range;
      out.push(`<path d="M${num(x)} ${num(cy + 6)}H${num(x + 40)}" stroke="${fixedColors.neutral}" stroke-width="${num(lo)}"/>`);
      out.push(text(x + 46, cy + 10, formatCompact(item.domain[0], L), `font-size="10" fill="${fixedColors.ink}"`));
      out.push(`<path d="M${num(x + width / 2)} ${num(cy + 6)}H${num(x + width / 2 + 40)}" stroke="${fixedColors.neutral}" stroke-width="${num(hi)}"/>`);
      out.push(text(x + width / 2 + 46, cy + 10, formatCompact(item.domain[1], L), `font-size="10" fill="${fixedColors.ink}"`));
      cy += 20;
    } else if (item.kind === "sequential" || item.kind === "diverging") {
      const gid = `wf-grad-${item.title.replace(/\W/g, "")}-${item.metric.replace(/\W/g, "")}`;
      const stops = item.stops.map((c, i) => `<stop offset="${num((i / (item.stops.length - 1)) * 100)}%" stop-color="${c}"/>`).join("");
      out.push(`<defs><linearGradient id="${gid}">${stops}</linearGradient></defs>`);
      out.push(rect({ x, y: cy, width: width - 10, height: 10 }, `fill="url(#${gid})" stroke="${fixedColors.neutral}" stroke-width="0.5"`));
      const share = /share/i.test(item.metric);
      const f = (v: number) => (share ? formatShare(v, L) : formatNumber(v, 1, L));
      out.push(text(x, cy + 22, f(item.domain[0]), `font-size="10" fill="${fixedColors.ink}"`));
      if (item.domain.length === 3) out.push(text(x + (width - 10) / 2, cy + 22, f(item.domain[1]), `font-size="10" text-anchor="middle" fill="${fixedColors.ink}"`));
      out.push(text(x + width - 10, cy + 22, f(item.domain[item.domain.length - 1]), `font-size="10" text-anchor="end" fill="${fixedColors.ink}"`));
      cy += 30;
    } else if (item.kind === "categorical") {
      for (const e of item.entries) {
        const sw: Box = { x, y: cy, width: 14, height: 12 };
        out.push(rect(sw, `rx="2" fill="${e.color}"`));
        if (e.pattern !== "solid") out.push(rect(sw, `rx="2" fill="url(#wf-pattern-${e.pattern})"`));
        out.push(text(x + 20, cy + 10, truncate(e.key, Math.floor((width - 24) / 6)), `font-size="10" fill="${fixedColors.ink}"`));
        cy += 16;
      }
      cy += 4;
    }
  };
  for (const it of ctx.scales.legend) item(it);
  const keys: [string, StringKey][] = [
    ["●", "legend.badge"],
    ["⌒", "legend.arc"],
    ["⌒ ┄", "legend.reverse"],
    ["↻", "legend.selfLoop"],
    ["▨", "legend.outOfScope"],
    ["┄", "legend.reconnected"],
  ];
  for (const [glyph, key] of keys) {
    out.push(text(x, cy + 10, glyph, `font-size="10" fill="${fixedColors.ink}"`));
    out.push(text(x + 22, cy + 10, truncate(t(L, key), Math.floor((width - 24) / 5.6)), `font-size="9.5" fill="${fixedColors.ink}"`));
    cy += 14;
  }
  if (mapChips.length) {
    cy += 6;
    for (const c of mapChips) {
      const p = c.payload ?? {};
      const label = truncate(`${p.glyph ?? ""} ${p.label ?? ""}`.trim(), Math.floor((width - 4) / 5.8));
      out.push(text(x, cy + 10, label, `font-size="10" font-weight="600" fill="${fixedColors.ink}"`));
      cy += 13;
      out.push(text(x, cy + 10, truncate(String(p.text ?? ""), Math.floor((width - 4) / 5.4)), `font-size="9.5" fill="${fixedColors.ink}"`));
      cy += 15;
    }
  }
  return { svg: out.join(""), height: cy - y };
}

/**
 * Render a scene to an SVG string. Output is deterministic for the same input:
 * elements are drawn in id order, numbers are formatted with fixed precision and
 * no time-dependent data is embedded.
 */
export function toSVG(scene: Scene, options: ExportOptions = {}): string {
  const locale = scene.locale ?? "en";
  const scales = buildScales(scene.graph, scene.style ?? defaultStyle);
  const lod = lodAt(options.lodZoom ?? 1, scene.style?.lod);
  const font = options.fontFamily ?? "Inter, 'Segoe UI', Helvetica, Arial, sans-serif";
  const ctx: Ctx = { scene, scales, locale, lod, font };
  const overlays = canonicalOverlays(scene.overlays ?? scene.graph.overlays ?? []);
  const geometry = overlayGeometry(overlays, scene.positions, { ...(options.overlayGeometry ?? {}), lod: scene.style?.lod });
  const pad = options.padding ?? 24;
  const legend = options.legend ?? true;
  const legendWidth = legend ? 220 : 0;

  const content = unionBox([scene.positions.bounds, ...(geometry.shapes.length ? [geometry.bounds] : [])]);
  const headerHeight = scene.title ? 40 + (options.context !== false ? 18 : 0) : 0;
  const mapChips = overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET);
  const legendDraw = legend ? drawLegend(ctx, 0, 0, legendWidth - 16, mapChips) : { svg: "", height: 0 };

  const mapW = content.width + 2 * pad;
  const mapH = content.height + 2 * pad;
  const totalW = mapW + legendWidth;
  const totalH = Math.max(mapH, legendDraw.height + 2 * pad) + headerHeight;
  const outW = options.width ?? (options.preset && options.preset !== "none" ? FIGURE_WIDTHS[options.preset] : totalW);
  const outH = (totalH / totalW) * outW;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(outW)}" height="${num(outH)}" viewBox="0 0 ${num(totalW)} ${num(totalH)}" font-family="${esc(font)}" role="img" aria-label="${esc(scene.title ?? t(locale, "map.description", { nodes: scene.graph.nodes.length, edges: scene.graph.edges.length, groups: scene.graph.groups?.length ?? 0 }))}">`,
  );
  parts.push(`<defs>${patternDefs()}`);
  parts.push(`<marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>`);
  parts.push(`<marker id="wf-arrow-arc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>`);
  parts.push(`</defs>`);
  parts.push(rect({ x: 0, y: 0, width: totalW, height: totalH }, `fill="${options.background ?? fixedColors.paper}"`));
  if (scene.title) {
    parts.push(text(pad, 26, scene.title, `font-size="18" font-weight="700" fill="${fixedColors.ink}"`));
    if (options.context !== false) {
      const meta = scene.graph.meta ?? {};
      const label = scene.subtitle ?? String(meta.label ?? meta.scene ?? "");
      const cases = typeof meta.cases === "number" ? formatCount(meta.cases, locale) : "–";
      const events = typeof meta.events === "number" ? formatCount(meta.events, locale) : "–";
      parts.push(text(pad, 44, t(locale, "export.context", { label, cases, events }), `font-size="11" fill="${fixedColors.neutral}"`));
    }
  }
  parts.push(`<g class="wf-map" transform="translate(${num(pad - content.x)} ${num(headerHeight + pad - content.y)})">`);
  parts.push(drawGroups(ctx));
  parts.push(drawOverlays(ctx, geometry.shapes.filter((s) => s.kind === "tint")));
  parts.push(drawEdges(ctx));
  parts.push(drawNodes(ctx));
  parts.push(drawOverlays(ctx, geometry.shapes.filter((s) => s.kind !== "tint")));
  parts.push(`</g>`);
  if (legend) {
    parts.push(`<g class="wf-legend" transform="translate(${num(mapW)} ${num(headerHeight + pad)})">`);
    parts.push(`<path d="M0 0V${num(totalH - headerHeight - 2 * pad)}" stroke="${fixedColors.neutral}" stroke-opacity="0.4"/>`);
    parts.push(`<g transform="translate(16 0)">${legendDraw.svg}</g>`);
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}

function unionBox(boxes: Box[]): Box {
  const valid = boxes.filter((b) => b.width >= 0 && b.height >= 0);
  if (!valid.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(...valid.map((b) => b.x));
  const y0 = Math.min(...valid.map((b) => b.y));
  const x1 = Math.max(...valid.map((b) => b.x + b.width));
  const y1 = Math.max(...valid.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
