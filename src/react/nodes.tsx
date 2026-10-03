import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { type ElementText, type LayoutDirection, type NodeMark, type Overlay, contrastText, defaultNodeSize, fitText, formatShare, hasTag, nodeMark, overlayColor } from "../core/index.js";
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

/** The node's mark; resolved from the node data when the map did not pass one. */
function markOf(data: ActivityNodeData): NodeMark {
  if (data.mark) return data.mark;
  const size = defaultNodeSize(data.node);
  const box = { x: 0, y: 0, width: data.labelWidth ?? size.width, height: data.labelHeight ?? size.height };
  return nodeMark(data.node, box, { color: data.color, pattern: data.pattern, locale: data.locale, activityLabels: data.activityLabels });
}

function classes(mark: NodeMark, data: ActivityNodeData, selected: boolean | undefined): string {
  const c = ["wf-node", `wf-node--${mark.kind}`];
  if (selected) c.push("wf-node--selected");
  if (data.focused) c.push("wf-node--focused");
  if (data.hovered) c.push("wf-node--hovered");
  if (data.dimmed) c.push("wf-node--dimmed");
  if (data.hatched) c.push("wf-node--hatched");
  if (mark.reconnected) c.push("wf-node--reconnected");
  if (mark.kind === "event" && hasTag(mark.node, "end")) c.push("wf-node--event-end");
  return c.join(" ");
}

const lodClass = (t: ElementText) => (t.lod === "labels" ? " wf-lod-labels" : t.lod === "edgeLabels" ? " wf-lod-edge-labels" : "");

/** The mark's text of one role, shortened by the core rule, with its level-of-detail class. */
function Text({ mark, role, className, hidden }: { mark: NodeMark; role: ElementText["role"]; className: string; hidden?: boolean }) {
  const t = mark.texts.find((x) => x.role === role);
  return t ? <span className={`${className}${lodClass(t)}`} aria-hidden={hidden || undefined}>{fitText(t)}</span> : null;
}

function Band({ mark }: { mark: NodeMark }) {
  return mark.band ? (
    <span className="wf-node__band" aria-hidden="true">
      <PatternSwatch pattern={mark.pattern} ink="#1f1f1f" />
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
      className={`${classes(mark, data, selected)}${lines ? " wf-node--activity-labels" : ""}`}
      style={{ ["--wf-node-color" as string]: mark.color, ...(lines ? { width: data.labelWidth, height: data.labelHeight } : {}) }}
      title={lines ? undefined : data.description}
      data-kind={mark.kind}
    >
      {handles(data.direction)}
      <Band mark={mark} />
      {lines ? (
        <span className="wf-activity-copy">
          <span className="wf-activity-name">{mark.texts.filter((t) => t.role === "nameLine").map((t, i) => <span key={i}>{t.text}</span>)}</span>
          {mark.texts.some((t) => t.role === "countLine") ? <span className="wf-activity-counts">{mark.texts.filter((t) => t.role === "countLine").map((t, i) => <span key={i}>{t.text}</span>)}</span> : null}
        </span>
      ) : (
        <>
          <Text mark={mark} role="label" className="wf-node__label" />
          {count ? <span className={`wf-node__meta${lodClass(count)}`}>{data.meta ?? count.text}</span> : null}
        </>
      )}
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const Stage = memo(function Stage({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div
      id={`wf-node-${id}`}
      className={classes(mark, data, selected)}
      style={{ ["--wf-node-color" as string]: mark.color, width: 200, height: 56 }}
      title={data.description}
      data-kind="stage"
    >
      {handles(data.direction)}
      <Band mark={mark} />
      <Text mark={mark} role="label" className="wf-node__label" />
      <Text mark={mark} role="count" className="wf-node__meta" />
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const Gateway = memo(function Gateway({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} className={classes(mark, data, selected)} title={data.description} data-kind="gateway">
      {handles(data.direction)}
      <Text mark={mark} role="glyph" className="wf-node__label" hidden />
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const EventNode = memo(function EventNode({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} className={classes(mark, data, selected)} title={data.description} data-kind="event">
      {handles(data.direction)}
      <Text mark={mark} role="label" className="wf-node__label" />
      <Badges badges={data.badges} locale={data.locale} />
    </div>
  );
});

const Note = memo(function Note({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} className={classes(mark, data, selected)} title={data.description} data-kind="note">
      {handles(data.direction)}
      <Text mark={mark} role="label" className="wf-node__label" />
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
