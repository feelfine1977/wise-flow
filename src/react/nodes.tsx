import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { type LayoutDirection, type Overlay, activityLabelLines, formatCompact, hasTag, metric, RECONNECTED_TAG } from "../core/index.js";
import { type MarkIds, ElementMarks, MarkFigure, domMark, marksAtOrigin, svgReact } from "./marks.js";
import { PatternSwatch } from "./patterns.js";
import type { ActivityNodeData, WfGroupNode, WfNode } from "./types.js";

const IDS: MarkIds = { arrow: "wf-mark-arrow", pattern: "wf-mark-outofscope" };

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
    <svg className="wf-badges" width={0} height={0} overflow="visible" style={{ position: "absolute", right: 0, top: 0 }} aria-hidden="true">
      {marksAtOrigin(badges, locale).map((m) => svgReact(domMark(m, IDS), m.id))}
    </svg>
  );
}

function classes(kind: string, data: ActivityNodeData, selected: boolean | undefined): string {
  const c = ["wf-node", `wf-node--${kind}`];
  if (selected) c.push("wf-node--selected");
  if (data.focused) c.push("wf-node--focused");
  if (data.hovered) c.push("wf-node--hovered");
  if (data.dimmed) c.push("wf-node--dimmed");
  if (data.hatched) c.push("wf-node--hatched");
  if (data.tint) c.push("wf-node--tinted");
  if (hasTag(data.node, RECONNECTED_TAG)) c.push("wf-node--reconnected");
  if (data.node.kind === "event" && hasTag(data.node, "end")) c.push("wf-node--event-end");
  return c.join(" ");
}

/** The fills of the marks that cover the node (`tint`). */
function covered(data: ActivityNodeData): Record<string, string> | undefined {
  return data.tint ? { "--wf-tint": data.tint } : undefined;
}

const Activity = memo(function Activity({ id, data, selected }: NodeProps<WfNode>) {
  const cases = metric(data.node, "cases", NaN);
  const lines = data.activityLabels ? activityLabelLines(data.node, data.activityLabels, data.labelWidth ?? 280, data.locale) : undefined;
  return (
    <div
      id={`wf-node-${id}`}
      className={`${classes(data.node.kind, data, selected)}${lines ? " wf-node--activity-labels" : ""}`}
      style={{ ["--wf-node-color" as string]: data.color, ...covered(data), ...(lines ? { width: data.labelWidth, height: data.labelHeight } : {}) }}
      title={lines ? undefined : data.description}
      data-kind={data.node.kind}
    >
      {handles(data.direction)}
      <span className="wf-node__band" aria-hidden="true">
        <PatternSwatch pattern={data.pattern} ink="#1f1f1f" />
      </span>
      {lines ? (
        <span className="wf-activity-copy">
          <span className="wf-activity-name">{lines.name.map((line, i) => <span key={i}>{line}</span>)}</span>
          {data.activityLabels?.showCounts !== false ? <span className="wf-activity-counts">{lines.counts.map((line, i) => <span key={i}>{line}</span>)}</span> : null}
        </span>
      ) : (
        <>
          <span className="wf-node__label wf-lod-labels">{data.node.label}</span>
          {Number.isFinite(cases) ? <span className="wf-node__meta wf-lod-labels">{data.meta ?? formatCompact(cases, data.locale)}</span> : null}
        </>
      )}
      {carried(data)}
    </div>
  );
});

const Stage = memo(function Stage({ id, data, selected }: NodeProps<WfNode>) {
  const members = metric(data.node, "members", NaN);
  const cases = metric(data.node, "cases", NaN);
  return (
    <div
      id={`wf-node-${id}`}
      className={classes("stage", data, selected)}
      style={{ ["--wf-node-color" as string]: data.color, ...covered(data), width: 200, height: 56 }}
      title={data.description}
      data-kind="stage"
    >
      {handles(data.direction)}
      <span className="wf-node__band" aria-hidden="true">
        <PatternSwatch pattern={data.pattern} ink="#1f1f1f" />
      </span>
      <span className="wf-node__label wf-lod-labels">{data.node.label}</span>
      <span className="wf-node__meta wf-lod-labels">
        {Number.isFinite(members) ? `${members} · ` : ""}
        {Number.isFinite(cases) ? formatCompact(cases, data.locale) : ""}
      </span>
      {carried(data)}
    </div>
  );
});

const Gateway = memo(function Gateway({ id, data, selected }: NodeProps<WfNode>) {
  const glyph = hasTag(data.node, "and") ? "+" : hasTag(data.node, "or") ? "○" : "×";
  return (
    <div id={`wf-node-${id}`} className={classes("gateway", data, selected)} style={covered(data)} title={data.description} data-kind="gateway">
      {handles(data.direction)}
      <span className="wf-node__label" aria-hidden="true">
        {glyph}
      </span>
      {carried(data)}
    </div>
  );
});

const EventNode = memo(function EventNode({ id, data, selected }: NodeProps<WfNode>) {
  return (
    <div id={`wf-node-${id}`} className={classes("event", data, selected)} style={covered(data)} title={data.description} data-kind="event">
      {handles(data.direction)}
      <span className="wf-node__label wf-lod-labels">{data.node.label}</span>
      {carried(data)}
    </div>
  );
});

const Note = memo(function Note({ id, data, selected }: NodeProps<WfNode>) {
  return (
    <div id={`wf-node-${id}`} className={classes("note", data, selected)} style={covered(data)} title={data.description} data-kind="note">
      {handles(data.direction)}
      <span className="wf-node__label">{data.node.label}</span>
      {carried(data)}
    </div>
  );
});

/** A chip drawn from its mark, at the size the core gives it. */
export function Chip({ chip, locale }: { chip: Overlay; locale: ActivityNodeData["locale"] }) {
  const [mark] = marksAtOrigin([chip], locale);
  return mark ? <MarkFigure mark={mark} /> : null;
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
    >
      <span className="wf-group__label">{data.group.label}</span>
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
