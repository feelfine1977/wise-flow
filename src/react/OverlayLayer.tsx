import { EdgeLabelRenderer, ViewportPortal } from "@xyflow/react";
import { type Locale, type OverlayMark, type OverlayShape, overlayMarks } from "../core/index.js";
import { type MarkIds, domMark, markDefs, svgReact } from "./marks.js";

export interface OverlayLayerProps {
  /** The scene's overlay marks (`FlowScene.marks`). Without them, the marks of `shapes`. */
  marks?: OverlayMark[];
  /** The placed shapes; `onSelect` receives the shape of the mark that was clicked. */
  shapes?: OverlayShape[];
  locale: Locale;
  /** Zoom of the map: each mark is drawn from its `minZoom`. */
  zoom?: number;
  /** @deprecated Without `zoom`, draws arcs only when set. Pass `zoom` instead. */
  showArcs?: boolean;
  /** @deprecated Without `zoom`, draws self-loops (observed ones always) only when set. Pass `zoom` instead. */
  showSelfLoops?: boolean;
  hoveredId: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (shape: OverlayShape) => void;
}

const IDS: MarkIds = { arrow: "wf-arc-arrow", pattern: "wf-overlay-outofscope" };

/**
 * Overlay marks in flow coordinates. The map hands it the marks that run between
 * elements: arcs (`layer: "between"`) above the edges and below the nodes, in the
 * container React Flow keeps between them, and self-loops above the nodes. The
 * marks an element carries are drawn by its node or group, and map-level chips by
 * the legend.
 */
export function OverlayLayer({ marks, shapes = [], locale, zoom, showArcs = false, showSelfLoops = false, hoveredId, onHover, onSelect }: OverlayLayerProps) {
  const all = marks ?? overlayMarks(shapes, locale);
  // Without a zoom the layer keeps its former contract: arcs and self-loops by flag.
  const shown = (m: OverlayMark) =>
    zoom !== undefined ? zoom >= m.minZoom : m.path !== undefined && (m.kind === "arc" ? showArcs : showSelfLoops || !!m.overlay.payload?.observed);
  const visible = all.filter((m) => m.inMap && m.layer !== "below" && shown(m));
  if (!visible.length) return null;
  const shapeOf = (m: OverlayMark): OverlayShape => shapes.find((s) => s.id === m.id) ?? { id: m.id, overlay: m.overlay, kind: m.kind, ...m.box, path: m.path, minZoom: m.minZoom };
  const between = visible.filter((m) => m.layer === "between");
  // React Flow stacks edges and nodes from 0, each above the elements before it.
  const layer = (Portal: typeof ViewportPortal, list: OverlayMark[], zIndex: number, defs: boolean) =>
    list.length ? (
      <Portal>
        <svg className="wf-overlay-layer" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", zIndex }} aria-hidden="true">
          {defs ? svgReact(markDefs(IDS)) : null}
          {list.map((m) =>
            svgReact(domMark(m, IDS, hoveredId === m.id), m.id, {
              onMouseEnter: () => onHover?.(m.id),
              onMouseLeave: () => onHover?.(null),
              onClick: () => onSelect?.(shapeOf(m)),
            }),
          )}
        </svg>
      </Portal>
    ) : null;
  return (
    <>
      {layer(EdgeLabelRenderer, between, 0, true)}
      {layer(ViewportPortal, visible.filter((m) => m.layer === "above"), 1001, !between.length)}
    </>
  );
}
