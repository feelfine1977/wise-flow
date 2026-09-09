import { ViewportPortal } from "@xyflow/react";
import { type Locale, type OverlayShape, colorOn, formatShare } from "../core/index.js";

export interface OverlayLayerProps {
  shapes: OverlayShape[];
  locale: Locale;
  showArcs: boolean;
  showSelfLoops: boolean;
  hoveredId: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (shape: OverlayShape) => void;
}

function colorOf(shape: OverlayShape): string {
  const v = shape.overlay.payload?.value;
  return typeof v === "number" && Number.isFinite(v) ? colorOn(v, "sequential", [0, 1]) : "#8c8c8c";
}

/** Arcs and self-loops drawn in flow coordinates above the nodes. */
export function OverlayLayer({ shapes, locale, showArcs, showSelfLoops, hoveredId, onHover, onSelect }: OverlayLayerProps) {
  const visible = shapes.filter((s) => (s.kind === "arc" && showArcs) || (s.kind === "selfLoop" && showSelfLoops));
  if (!visible.length) return null;
  return (
    <ViewportPortal>
      <svg className="wf-overlay-layer" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", zIndex: 1001 }} aria-hidden="true">
        <defs>
          <marker id="wf-arc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="context-stroke" />
          </marker>
        </defs>
        {visible.map((s) => {
          const p = s.overlay.payload ?? {};
          const color = colorOf(s);
          const hovered = hoveredId === s.id;
          const value = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "";
          if (s.kind === "arc") {
            const coverage = typeof p.coverage === "number" ? Math.max(0, Math.min(1, p.coverage)) : 1;
            const width = 2 + 8 * coverage;
            return (
              <g key={s.id} className={`wf-arc${p.reverse ? " wf-arc--reverse" : ""}`} data-constraint={p.constraintId}>
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
                    {`${p.glyph ?? ""} ${value}`.trim()}
                  </text>
                ) : null}
              </g>
            );
          }
          return (
            <g key={s.id} className="wf-selfloop" data-constraint={p.constraintId}>
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
              {s.labelX !== undefined && s.labelY !== undefined && value ? (
                <text x={s.labelX} y={s.labelY}>{`↻ ${value}`}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
