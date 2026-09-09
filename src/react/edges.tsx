import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import type { XY } from "../core/index.js";
import type { WfEdge } from "./types.js";

function polyline(points: XY[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join("");
}

/** Point at half of the polyline's length. */
export function midpoint(points: XY[]): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const l = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(l);
    total += l;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const tt = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * tt, y: points[i].y + (points[i + 1].y - points[i].y) * tt };
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}

const Follows = memo(function Follows(props: EdgeProps<WfEdge>) {
  const { id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected } = props;
  if (!data) return null;
  const route = data.route && data.route.points.length >= 2 ? data.route.points : undefined;
  const path = route ? polyline(route) : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0];
  const mid = route ? midpoint(route) : { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  const dash = data.reconnected ? "6 5" : data.edge.kind === "constraint" ? "2 4" : undefined;
  return (
    <g id={`wf-edge-${id}`} className={`wf-edge wf-edge--${data.edge.kind}${data.hovered ? " wf-edge--hovered" : ""}${data.dimmed ? " wf-edge--dimmed" : ""}${data.focused ? " wf-edge--focused" : ""}`} data-id={id}>
      <title>{data.description}</title>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{
          stroke: selected || data.hovered || data.focused ? "var(--wf-focus)" : data.color,
          strokeWidth: data.focused ? Math.max(data.width, 3) : data.width,
          strokeDasharray: dash,
          opacity: data.dimmed ? 0.25 : 1,
        }}
      />
      {data.label ? (
        <text className="wf-edge-label wf-lod-edge-labels" x={mid.x} y={mid.y - 4} textAnchor="middle">
          {data.label}
        </text>
      ) : null}
    </g>
  );
});

export const edgeTypes = {
  follows: Follows,
  constraint: Follows,
  flow: Follows,
};
