import { ViewportPortal } from "@xyflow/react";
import { type Locale, type OverlayShape, arcWidth, formatShare, overlayArrow, overlayColor } from "../core/index.js";

export interface OverlayLayerProps {
  shapes: OverlayShape[];
  locale: Locale;
  showArcs: boolean;
  showSelfLoops: boolean;
  hoveredId: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (shape: OverlayShape) => void;
}

/** Arcs and self-loops drawn in flow coordinates above the nodes. */
export function OverlayLayer({ shapes, locale, showArcs, showSelfLoops, hoveredId, onHover, onSelect }: OverlayLayerProps) {
  const visible = shapes.filter((s) => (s.kind === "arc" && showArcs) || (s.kind === "selfLoop" && (showSelfLoops || s.overlay.payload?.observed)));
  if (!visible.length) return null;
  return (
    <ViewportPortal>
      <svg className="wf-overlay-layer" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", zIndex: 1001 }} aria-hidden="true">
        <defs>
          <marker id="wf-arc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={overlayArrow.size} markerHeight={overlayArrow.size} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="context-stroke" />
          </marker>
        </defs>
        {visible.map((s) => {
          const p = s.overlay.payload ?? {};
          const color = overlayColor(s.overlay);
          const hovered = hoveredId === s.id;
          const value = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "";
          if (s.kind === "arc") {
            const width = arcWidth(s.overlay);
            return (
              <g key={s.id} className={`wf-arc${p.reverse ? " wf-arc--reverse" : ""}`} data-overlay-id={s.id} data-constraint={p.constraintId}>
                <title>{[p.label, p.text].filter(Boolean).join(" — ")}</title>
                <path
                  d={s.path}
                  fill="none"
                  stroke={hovered ? "var(--wf-focus)" : color}
                  strokeWidth={width}
                  strokeOpacity={0.9}
                  strokeDasharray={p.reverse ? "6 4" : undefined}
                  markerEnd="url(#wf-arc-arrow)"
                  onMouseEnter={() => onHover?.(s.id)}
                  onMouseLeave={() => onHover?.(null)}
                  onClick={() => onSelect?.(s)}
                />
                {s.labelX !== undefined && s.labelY !== undefined ? (
                  <text x={s.labelX} y={s.labelY} textAnchor="middle">
                    {typeof p.displayLabel === "string" ? p.displayLabel : `${p.glyph ?? ""} ${value}`.trim()}
                  </text>
                ) : null}
              </g>
            );
          }
          return (
            <g key={s.id} className="wf-selfloop" data-overlay-id={s.id} data-constraint={p.constraintId} data-edge-id={typeof p.edgeId === "string" ? p.edgeId : undefined}>
              <title>{[p.label, p.text].filter(Boolean).join(" — ")}</title>
              <path
                d={s.path}
                fill="none"
                stroke={hovered ? "var(--wf-focus)" : color}
                strokeWidth={2.5}
                markerEnd="url(#wf-arc-arrow)"
                onMouseEnter={() => onHover?.(s.id)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onSelect?.(s)}
              />
              {s.labelX !== undefined && s.labelY !== undefined && (p.displayLabel || value) ? (
                <text x={s.labelX} y={s.labelY}>{typeof p.displayLabel === "string" ? p.displayLabel : `↻ ${value}`}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
