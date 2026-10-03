import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { type LayoutDirection, type Overlay, activityLabelLines, contrastText, formatCompact, formatShare, hasTag, metric, overlayColor, RECONNECTED_TAG } from "../core/index.js";
import { PatternSwatch } from "./patterns.js";
import type { ActivityNodeData, WfGroupNode, WfNode } from "./types.js";

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

export function Badges({ badges, locale }: { badges: Overlay[]; locale: ActivityNodeData["locale"] }) {
  if (!badges.length) return null;
  return (
    <div className="wf-badges wf-lod-badges" aria-hidden="true">
      {badges.map((b, i) => {
        const bg = overlayColor(b);
        const v = b.payload?.value;
        return (
          <span
            key={`${b.payload?.constraintId ?? "badge"}-${i}`}
            className="wf-badge"
            style={{ background: bg, color: contrastText(bg) }}
            title={[b.payload?.label, b.payload?.text].filter(Boolean).join(" — ")}
            data-constraint={b.payload?.constraintId}
          >
            <span className="wf-badge__glyph">{b.payload?.glyph ?? "●"}</span>
            {typeof v === "number" && Number.isFinite(v) ? <span className="wf-badge__share">{formatShare(v, locale)}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function classes(kind: string, data: ActivityNodeData, selected: boolean | undefined): string {
  const c = ["wf-node", `wf-node--${kind}`];
  if (selected) c.push("wf-node--selected");
  if (data.focused) c.push("wf-node--focused");
  if (data.hovered) c.push("wf-node--hovered");
  if (data.dimmed) c.push("wf-node--dimmed");
  if (data.hatched) c.push("wf-node--hatched");
  if (hasTag(data.node, RECONNECTED_TAG)) c.push("wf-node--reconnected");
  if (data.node.kind === "event" && hasTag(data.node, "end")) c.push("wf-node--event-end");
  return c.join(" ");
}

const Activity = memo(function Activity({ id, data, selected }: NodeProps<WfNode>) {
  const cases = metric(data.node, "cases", NaN);
  const lines = data.activityLabels ? activityLabelLines(data.node, data.activityLabels, data.labelWidth ?? 280, data.locale) : undefined;
  return (
    <div
      id={`wf-node-${id}`}
      className={`${classes(data.node.kind, data, selected)}${lines ? " wf-node--activity-labels" : ""}`}
      style={{ ["--wf-node-color" as string]: data.color, ...(lines ? { width: data.labelWidth, height: data.labelHeight } : {}) }}
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
      <Badges badges={data.badges} locale={data.locale} />
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
      style={{ ["--wf-node-color" as string]: data.color, width: 200, height: 56 }}
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
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const Gateway = memo(function Gateway({ id, data, selected }: NodeProps<WfNode>) {
  const glyph = hasTag(data.node, "and") ? "+" : hasTag(data.node, "or") ? "○" : "×";
  return (
    <div id={`wf-node-${id}`} className={classes("gateway", data, selected)} title={data.description} data-kind="gateway">
      {handles(data.direction)}
      <span className="wf-node__label" aria-hidden="true">
        {glyph}
      </span>
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const EventNode = memo(function EventNode({ id, data, selected }: NodeProps<WfNode>) {
  return (
    <div id={`wf-node-${id}`} className={classes("event", data, selected)} title={data.description} data-kind="event">
      {handles(data.direction)}
      <span className="wf-node__label wf-lod-labels">{data.node.label}</span>
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const Note = memo(function Note({ id, data, selected }: NodeProps<WfNode>) {
  return (
    <div id={`wf-node-${id}`} className={classes("note", data, selected)} title={data.description} data-kind="note">
      {handles(data.direction)}
      <span className="wf-node__label">{data.node.label}</span>
    </div>
  );
});

export function Chip({ chip, locale }: { chip: Overlay; locale: ActivityNodeData["locale"] }) {
  const p = chip.payload ?? {};
  const color = overlayColor(chip);
  const gauge = p.gauge;
  const span = gauge ? Math.max(gauge.threshold + (gauge.width ?? gauge.threshold), 1e-9) : 0;
  const fill = gauge ? Math.min(1, gauge.value / span) : 0;
  const mark = gauge ? Math.min(1, gauge.threshold / span) : 0;
  return (
    <span className="wf-chip" style={{ ["--wf-chip-color" as string]: color }} title={[p.label, p.text].filter(Boolean).join(" — ")} data-constraint={p.constraintId}>
      {p.glyph ? <span aria-hidden="true">{p.glyph}</span> : null}
      {gauge ? (
        <span className="wf-chip__gauge" aria-hidden="true">
          <span className="wf-chip__gauge-fill" style={{ width: `${fill * 100}%` }} />
          <span className="wf-chip__gauge-mark" style={{ left: `${mark * 100}%` }} />
        </span>
      ) : null}
      <span>
        {p.label ? <strong>{p.label}: </strong> : null}
        {p.text ?? (typeof p.value === "number" ? formatShare(p.value, locale) : "")}
      </span>
    </span>
  );
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
      {data.chips.length ? (
        <span className="wf-group__chips wf-lod-chips">
          {data.chips.map((c, i) => (
            <Chip key={`${c.payload?.constraintId ?? "chip"}-${i}`} chip={c} locale="en" />
          ))}
        </span>
      ) : null}
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
