import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { type EdgeMark, type XY, edgeMark, lineEnd, routeMidpoint, strokeTokens } from "../core/index.js";
import { part } from "./parts.js";
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
    <g
      id={`wf-edge-${id}`}
      className={`wf-edge wf-edge--${mark.kind}${data.hovered ? " wf-edge--hovered" : ""}${data.dimmed ? " wf-edge--dimmed" : ""}${data.focused ? " wf-edge--focused" : ""}`}
      data-id={id}
      {...part("edge", mark.kind, [selected && "selected", data.focused && "focused", data.hovered && "hovered", data.dimmed && "dimmed", mark.reconnected && "reconnected"])}
      // The scene's paints as variables (a focused path at least 3 wide): the stylesheet draws the path with them, a host rule on the path overrides them.
      style={{ ["--wf-edge-color" as string]: mark.color, ["--wf-edge-width" as string]: data.focused ? Math.max(mark.width, strokeTokens.pathFocus) : mark.width, ["--wf-edge-dash" as string]: mark.dash?.join(" ") }}
    >
      <title>{data.description}</title>
      {/* The line ends inside its head, whose tip lies on the route's end. */}
      <BaseEdge id={id} path={polyline([...mark.points.slice(0, -1), lineEnd(mark.points, mark.arrow)])} markerEnd={markerEnd} interactionWidth={strokeTokens.pathHit} {...part("edge-path")} />
      {label ? (
        <text className="wf-edge-label wf-lod-edge-labels" {...part("edge-label")} x={label.x} y={label.y} textAnchor="middle">
          {label.text}
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
