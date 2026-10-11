import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { type ElementText, type LayoutDirection, type NodeMark, type Overlay, colorTokens, defaultNodeSize, fitText, hasTag, nodeMark } from "../core/index.js";
import { ElementMarks, MARK_IDS, MarkFigure, domMark, marksAtOrigin, svgReact } from "./marks.js";
import { part } from "./parts.js";
import { PatternSwatch } from "./patterns.js";
import type { ActivityNodeData, WfGroupNode, WfNode } from "./types.js";

/** The marks the element carries, from the scene. */
function carried(data: { marks?: ActivityNodeData["marks"]; origin?: ActivityNodeData["origin"] }) {
  return data.marks?.length && data.origin ? <ElementMarks marks={data.marks} origin={data.origin} /> : null;
}

function handles(direction: LayoutDirection) {
  const [target, source] =
    direction === "DOWN"
      ? [Position.Top, Position.Bottom]
      : direction === "UP"
        ? [Position.Bottom, Position.Top]
        : direction === "LEFT"
          ? [Position.Right, Position.Left]
          : [Position.Left, Position.Right];
  return (
    <>
      <Handle type="target" position={target} isConnectable={false} />
      <Handle type="source" position={source} isConnectable={false} />
    </>
  );
}

/** Badges drawn from their marks, extending left from the top-right corner of the element they are placed in. */
export function Badges({ badges, locale }: { badges: Overlay[]; locale: ActivityNodeData["locale"] }) {
  if (!badges.length) return null;
  return (
    <svg className="wf-badges" width={0} height={0} overflow="visible" aria-hidden="true">
      {marksAtOrigin(badges, locale).map((m) => svgReact(domMark(m, MARK_IDS), m.id))}
    </svg>
  );
}

/** The node's mark; resolved from the node data when the map did not pass one. */
function markOf(data: ActivityNodeData): NodeMark {
  if (data.mark) return data.mark;
  const size = defaultNodeSize(data.node);
  const box = { x: 0, y: 0, width: data.labelWidth ?? size.width, height: data.labelHeight ?? size.height };
  return nodeMark(data.node, box, { color: data.color, pattern: data.pattern, locale: data.locale, activityLabels: data.activityLabels });
}

/** The node's classes and the data attributes of its part, kind and states. */
function attrs(mark: NodeMark, data: ActivityNodeData, selected: boolean | undefined, extra = "") {
  const c = ["wf-node", `wf-node--${mark.kind}`];
  if (selected) c.push("wf-node--selected");
  if (data.focused) c.push("wf-node--focused");
  if (data.hovered) c.push("wf-node--hovered");
  if (data.dimmed) c.push("wf-node--dimmed");
  if (data.hatched) c.push("wf-node--hatched");
  if (data.tint) c.push("wf-node--tinted");
  if (mark.reconnected) c.push("wf-node--reconnected");
  if (mark.kind === "event" && hasTag(mark.node, "end")) c.push("wf-node--event-end");
  return { className: c.join(" ") + extra, ...part("node", mark.kind, [selected && "selected", data.focused && "focused", data.hovered && "hovered", data.dimmed && "dimmed", data.hatched && "outOfScope", mark.reconnected && "reconnected"]) };
}

/** The fills of the marks that cover the node (`tint`). */
function covered(data: ActivityNodeData): Record<string, string> | undefined {
  return data.tint ? { "--wf-tint": data.tint } : undefined;
}

const lodClass = (t: ElementText) => (t.lod === "labels" ? " wf-lod-labels" : t.lod === "edgeLabels" ? " wf-lod-edge-labels" : "");

/** The mark's text of one role, shortened by the core rule, with its level-of-detail class. */
function Text({ mark, role, className, hidden }: { mark: NodeMark; role: ElementText["role"]; className: string; hidden?: boolean }) {
  const t = mark.texts.find((x) => x.role === role);
  return t ? <span className={`${className}${lodClass(t)}`} {...part(role === "count" ? "node-count" : "node-label")} aria-hidden={hidden || undefined}>{fitText(t)}</span> : null;
}

function Band({ mark }: { mark: NodeMark }) {
  return mark.band ? (
    <span className="wf-node__band" {...part("node-band")} aria-hidden="true">
      <PatternSwatch pattern={mark.pattern} ink={colorTokens.ink} />
    </span>
  ) : null;
}

const Activity = memo(function Activity({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  const lines = mark.texts.some((t) => t.role === "nameLine");
  const count = mark.texts.find((t) => t.role === "count");
  return (
    <div
      id={`wf-node-${id}`}
      {...attrs(mark, data, selected, lines ? " wf-node--activity-labels" : "")}
      style={{ ["--wf-node-color" as string]: mark.color, ...covered(data), ...(lines ? { width: data.labelWidth, height: data.labelHeight } : {}) }}
      title={lines ? undefined : data.description}
      data-kind={mark.kind}
    >
      {handles(data.direction)}
      <Band mark={mark} />
      {lines ? (
        <span className="wf-activity-copy">
          <span className="wf-activity-name" {...part("node-label")}>{mark.texts.filter((t) => t.role === "nameLine").map((t, i) => <span key={i}>{t.text}</span>)}</span>
          {mark.texts.some((t) => t.role === "countLine") ? <span className="wf-activity-counts" {...part("node-count")}>{mark.texts.filter((t) => t.role === "countLine").map((t, i) => <span key={i}>{t.text}</span>)}</span> : null}
        </span>
      ) : (
        <>
          <Text mark={mark} role="label" className="wf-node__label" />
          {count ? <span className={`wf-node__meta${lodClass(count)}`} {...part("node-count")}>{data.meta ?? count.text}</span> : null}
        </>
      )}
      {carried(data)}
    </div>
  );
});

const Stage = memo(function Stage({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div
      id={`wf-node-${id}`}
      {...attrs(mark, data, selected)}
      style={{ ["--wf-node-color" as string]: mark.color, ...covered(data) }}
      title={data.description}
      data-kind="stage"
    >
      {handles(data.direction)}
      <Band mark={mark} />
      <Text mark={mark} role="label" className="wf-node__label" />
      <Text mark={mark} role="count" className="wf-node__meta" />
      {carried(data)}
    </div>
  );
});

const Gateway = memo(function Gateway({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} {...attrs(mark, data, selected)} style={covered(data)} title={data.description} data-kind="gateway">
      {handles(data.direction)}
      <Text mark={mark} role="glyph" className="wf-node__label" hidden />
      {carried(data)}
    </div>
  );
});

const EventNode = memo(function EventNode({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} {...attrs(mark, data, selected)} style={covered(data)} title={data.description} data-kind="event">
      {handles(data.direction)}
      <Text mark={mark} role="label" className="wf-node__label" />
      {carried(data)}
    </div>
  );
});

const Note = memo(function Note({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} {...attrs(mark, data, selected)} style={covered(data)} title={data.description} data-kind="note">
      {handles(data.direction)}
      <Text mark={mark} role="label" className="wf-node__label" />
    </div>
  );
});

/** A chip drawn from its mark, at the size the core gives it. */
export function Chip({ chip, locale }: { chip: Overlay; locale: ActivityNodeData["locale"] }) {
  // Placed as a map-level chip, every chip has a mark.
  return <MarkFigure mark={marksAtOrigin([chip], locale)[0]} />;
}

const Group = memo(function Group({ id, data, selected }: NodeProps<WfGroupNode>) {
  const style: React.CSSProperties & Record<string, string | undefined> = { "--wf-group-color": data.color };
  if (data.tint) style["--wf-tint"] = data.tint;
  const band = data.band;
  return (
    <div
      id={`wf-group-${id}`}
      className={`wf-group${data.tint ? " wf-group--tinted" : ""}${selected ? " wf-group--selected" : ""}${band ? ` wf-group--band wf-group--band-${band.axis}${band.index % 2 ? " wf-group--band-odd" : ""}` : ""}`}
      style={style}
      title={data.description}
      data-kind="group"
      data-band={band ? band.axis : undefined}
      {...part("group", data.group.kind, [selected && "selected"])}
    >
      <span className="wf-group__label" {...part("group-label")}>{data.group.label}</span>
      {carried(data)}
    </div>
  );
});

export const nodeTypes = {
  activity: Activity,
  stage: Stage,
  gateway: Gateway,
  event: EventNode,
  note: Note,
  wfGroup: Group,
};
