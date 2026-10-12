import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { type EdgeMark, type XY, edgeMark, fitText, routeMidpoint } from "../core/index.js";
import type { FollowsEdgeData, WfEdge } from "./types.js";

function polyline(points: XY[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join("");
}

/** Point at half of the polyline's length (`routeMidpoint`). */
export function midpoint(points: XY[]): XY {
  return routeMidpoint(points);
}

/** The edge's mark; resolved from the edge data and its handles when the map did not pass one. */
function markOf(data: FollowsEdgeData, source: XY, target: XY): EdgeMark {
  if (data.mark) return data.mark;
  const points = data.route && data.route.points.length >= 2 ? data.route.points : [source, target];
  return edgeMark(data.edge, points, { color: data.color, width: data.width });
}

const Follows = memo(function Follows(props: EdgeProps<WfEdge>) {
  const { id, data, sourceX, sourceY, targetX, targetY, markerEnd, selected } = props;
  if (!data) return null;
  const mark = markOf(data, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const label = mark.texts[0];
  return (
    <g id={`wf-edge-${id}`} className={`wf-edge wf-edge--${mark.kind}${data.hovered ? " wf-edge--hovered" : ""}${data.dimmed ? " wf-edge--dimmed" : ""}${data.focused ? " wf-edge--focused" : ""}`} data-id={id}>
      <title>{data.description}</title>
      <BaseEdge
        id={id}
        path={polyline(mark.points)}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{
          stroke: selected || data.hovered || data.focused ? "var(--wf-focus)" : mark.color,
          strokeWidth: data.focused ? Math.max(mark.width, 3) : mark.width,
          strokeDasharray: mark.dash?.join(" "),
          opacity: data.dimmed ? 0.25 : 1,
        }}
      />
      {label ? (
        <text className="wf-edge-label wf-lod-edge-labels" x={label.x} y={label.y} textAnchor="middle">
          {fitText(label)}
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
