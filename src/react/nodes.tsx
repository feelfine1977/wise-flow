import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useContext } from "react";
import { type BoxSide, type ElementText, type GroupMark, type LayoutDirection, type MarkPaint, type NodeMark, type Overlay, type StateStyle, type SvgElement, defaultNodeSize, groupMark, hasTag, nodeMark } from "../core/index.js";
import { ElementMarks, MARK_IDS, MarkFigure, mapMark, marksAtOrigin, paintCss, svgReact } from "./marks.js";
import { part } from "./parts.js";
import { PatternSwatch, PatternTheme } from "./patterns.js";
import type { ActivityNodeData, GroupNodeData, WfGroupNode, WfNode } from "./types.js";

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
      {marksAtOrigin(badges, locale).map((m) => svgReact(mapMark(m, MARK_IDS), m.id))}
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

const px = (n: number) => `${n}px`;

/** A diamond or a dashed outline, which a border cannot draw, is an SVG shape (`Outline`). */
const drawnOutline = (m: NodeMark) => m.shape === "diamond" || !!m.stroke.dash;

/**
 * The node's fill, outline, its width, corner radius and opacity from its
 * mark, as custom properties for the stylesheet; and the outline the rules of
 * its interactive states set, which the stylesheet draws them in instead.
 */
function look(m: NodeMark, state?: StateStyle): Record<string, string> {
  const drawn = drawnOutline(m);
  const out: Record<string, string> = { "--wf-node-color": m.color, "--wf-node-fill": drawn ? "transparent" : paintCss(m, m.fill), "--wf-node-outline": paintCss(m, m.stroke.paint), "--wf-node-stroke": px(drawn ? 0 : m.stroke.width), "--wf-node-radius": px(m.radius) };
  if (m.opacity !== undefined) out["--wf-node-opacity"] = String(m.opacity);
  if (state?.stroke) out["--wf-state-outline"] = paintCss(m, state.stroke);
  return out;
}

/** A text's size, weight and paint from its mark, as custom properties for the stylesheet. */
function textLook(t: ElementText, mark: { color: string }): Record<string, string | undefined> {
  return { "--wf-text-size": px(t.size), "--wf-text-weight": t.weight === undefined ? undefined : String(t.weight), "--wf-text-paint": paintCss(mark, t.paint) };
}

/** A mark's outline as an SVG shape over its box: a diamond (corners half the width from the centre, as in the SVG export), a circle or a rounded box. */
function Outline({ className, mark, fill, shape }: { className: string; mark: NodeMark | GroupMark; fill: string; shape?: NodeMark["shape"] }) {
  const { box, stroke, radius } = mark;
  const [w, h, cx, cy] = [box.width, box.height, box.width / 2, box.height / 2];
  const attrs: [string, string][] = [["fill", fill], ["stroke", paintCss(mark, stroke.paint)], ["stroke-width", String(stroke.width)]];
  if (stroke.dash) attrs.push(["stroke-dasharray", stroke.dash.join(" ")]);
  const el: SvgElement =
    shape === "diamond"
      ? { tag: "path", attrs: [["d", `M${cx} ${cy - cx}L${w} ${cy}L${cx} ${cy + cx}L0 ${cy}Z`], ...attrs], children: [] }
      : shape === "circle"
        ? { tag: "circle", attrs: [["cx", String(cx)], ["cy", String(cy)], ["r", String(radius)], ...attrs], children: [] }
        : { tag: "rect", attrs: [["width", String(w)], ["height", String(h)], ["rx", String(radius)], ...attrs], children: [] };
  return (
    <svg className={className} width={w} height={h} overflow="visible" aria-hidden="true">
      {svgReact(el)}
    </svg>
  );
}

/** The node's outline where a border cannot draw it. */
const NodeOutline = ({ mark }: { mark: NodeMark }) => (drawnOutline(mark) ? <Outline className="wf-node__outline" mark={mark} fill={paintCss(mark, mark.fill)} shape={mark.shape} /> : null);

/** The node's classes and the data attributes of its part, kind and states. */
function attrs(mark: NodeMark, data: ActivityNodeData, selected: boolean | undefined, extra = "") {
  const c = ["wf-node", `wf-node--${mark.kind}`];
  if (selected) c.push("wf-node--selected");
  if (data.focused) c.push("wf-node--focused");
  if (data.hovered) c.push("wf-node--hovered");
  // An opacity of the dimmed state's rules replaces the dimmed look.
  if (data.dimmed && data.state?.opacity === undefined) c.push("wf-node--dimmed");
  if (data.hatched) c.push("wf-node--hatched");
  if (data.tint) c.push("wf-node--tinted");
  if (mark.reconnected) c.push("wf-node--reconnected");
  if (drawnOutline(mark)) c.push("wf-node--outlined");
  if (mark.kind === "event" && hasTag(mark.node, "end")) c.push("wf-node--event-end");
  return { className: c.join(" ") + extra, ...part("node", mark.kind, [selected && "selected", data.focused && "focused", data.hovered && "hovered", data.dimmed && "dimmed", data.hatched && "outOfScope", mark.reconnected && "reconnected"]) };
}

/** The node's look and the fills of the marks that cover it (`tint`). */
function covered(mark: NodeMark, data: ActivityNodeData): Record<string, string> {
  return data.tint ? { ...look(mark, data.state), "--wf-tint": data.tint } : look(mark, data.state);
}

const lodClass = (t: ElementText) => (t.lod === "labels" ? " wf-lod-labels" : t.lod === "edgeLabels" ? " wf-lod-edge-labels" : "");

/** The mark's text of one role, as the scene fitted it, with its level-of-detail class. */
function Text({ mark, role, className, hidden }: { mark: NodeMark; role: ElementText["role"]; className: string; hidden?: boolean }) {
  const t = mark.texts.find((x) => x.role === role);
  return t ? <span className={`${className}${lodClass(t)}`} style={textLook(t, mark)} {...part(role === "count" ? "node-count" : "node-label")} aria-hidden={hidden || undefined}>{t.text}</span> : null;
}

function Band({ mark }: { mark: NodeMark }) {
  const { ink, look } = useContext(PatternTheme);
  return mark.band ? (
    <span className="wf-node__band" style={{ ["--wf-node-band" as string]: px(mark.band) }} {...part("node-band")} aria-hidden="true">
      <PatternSwatch pattern={mark.pattern} ink={ink} look={look} />
    </span>
  ) : null;
}

/** The frequency cue where the mark places it: its stripe and its foot, inside the border. */
function Cue({ mark }: { mark: NodeMark }) {
  const { cue, box } = mark;
  if (!cue) return null;
  const border = drawnOutline(mark) ? 0 : mark.stroke.width;
  const at = (b: { x: number; y: number; width: number; height: number }, paint: MarkPaint) => ({ left: px(b.x - box.x - border), top: px(b.y - box.y - border), width: px(b.width), height: px(b.height), background: paintCss(mark, paint) });
  return (
    <>
      {cue.stripe ? <span className="wf-node__cue" style={at(cue.stripe.box, cue.stripe.paint)} {...part("node-cue")} aria-hidden="true" /> : null}
      {cue.foot ? <span className="wf-node__cue wf-node__cue-foot" style={at(cue.foot.box, cue.foot.paint)} {...part("node-cue-foot")} aria-hidden="true" /> : null}
    </>
  );
}

/** A text of the card in its own style. */
const Run = ({ t, mark, className, children }: { t: ElementText; mark: NodeMark; className?: string; children?: string }) => (
  <span className={className} style={textLook(t, mark)}>
    {children ?? t.text}
  </span>
);

/**
 * An activity or a stage as its card: the name on up to two lines and the
 * number line (the cases, then their share), over the frequency cue, with the
 * stage once as the band. The card has the size of its box in the scene.
 */
const Card = memo(function Card({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  const names = mark.texts.filter((t) => t.role === "nameLine");
  const count = mark.texts.find((t) => t.role === "countLine");
  const share = mark.texts.find((t) => t.role === "share");
  return (
    <div
      id={`wf-node-${id}`}
      {...attrs(mark, data, selected, ` wf-node--card${data.activityLabels ? " wf-node--activity-labels" : ""}`)}
      style={{ ...covered(mark, data), width: px(mark.box.width), height: px(mark.box.height) }}
      // With activity labels the map shows its own tooltip, so the card has no native one.
      title={data.activityLabels ? undefined : (mark.title ?? data.description)}
      data-kind={mark.kind}
    >
      {handles(data.direction)}
      <NodeOutline mark={mark} />
      <Cue mark={mark} />
      <Band mark={mark} />
      <span className={`wf-activity-copy${names[0] ? lodClass(names[0]) : ""}`}>
        {names.length ? (
          <span className="wf-activity-name" style={textLook(names[0], mark)} {...part("node-label")}>
            {names.map((t, i) => (
              <span key={i}>{t.text}</span>
            ))}
          </span>
        ) : null}
        {count ? (
          <span className="wf-activity-counts" {...part("node-count")}>
            <Run t={count} mark={mark}>{data.meta ?? count.text}</Run>
            {share ? <Run t={share} mark={mark} className="wf-activity-share" /> : null}
          </span>
        ) : null}
      </span>
      {carried(data)}
    </div>
  );
});

const Gateway = memo(function Gateway({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} {...attrs(mark, data, selected)} style={covered(mark, data)} title={data.description} data-kind="gateway">
      {handles(data.direction)}
      <NodeOutline mark={mark} />
      <Text mark={mark} role="glyph" className="wf-node__label" hidden />
      {carried(data)}
    </div>
  );
});

const EventNode = memo(function EventNode({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} {...attrs(mark, data, selected)} style={covered(mark, data)} title={data.description} data-kind="event">
      {handles(data.direction)}
      <NodeOutline mark={mark} />
      <Text mark={mark} role="label" className="wf-node__label" />
      {carried(data)}
    </div>
  );
});

const Note = memo(function Note({ id, data, selected }: NodeProps<WfNode>) {
  const mark = markOf(data);
  return (
    <div id={`wf-node-${id}`} {...attrs(mark, data, selected)} style={covered(mark, data)} title={data.description} data-kind="note">
      {handles(data.direction)}
      <NodeOutline mark={mark} />
      <Text mark={mark} role="label" className="wf-node__label" />
    </div>
  );
});

/** A chip drawn from its mark, at the size the core gives it. */
export function Chip({ chip, locale }: { chip: Overlay; locale: ActivityNodeData["locale"] }) {
  // Placed as a map-level chip, every chip has a mark; an arc without its ends or an unknown kind has none.
  const mark = marksAtOrigin([chip], locale)[0];
  return mark ? <MarkFigure mark={mark} /> : null;
}

/** The group's mark; resolved from the group data and its size when the map did not pass one. */
function groupMarkOf(data: GroupNodeData, width = 0, height = 0): GroupMark {
  return data.mark ?? groupMark(data.group, { x: 0, y: 0, width, height }, { color: data.color, pattern: "solid", band: data.band });
}

/** The group's fill, tint, radius, opacity, a band's outline on its sides and its rule from its mark, as custom properties for the stylesheet. */
function groupLook(m: GroupMark, tint: string | undefined, state?: StateStyle): Record<string, string | undefined> {
  const { stroke, rule } = m;
  const out: Record<string, string | undefined> = { "--wf-group-color": paintCss(m, m.fill.paint), "--wf-group-fill": String(m.fill.opacity ?? 1), "--wf-group-radius": px(m.radius), "--wf-tint": tint };
  if (m.opacity !== undefined) out["--wf-group-opacity"] = String(m.opacity);
  if (state?.stroke) out["--wf-state-outline"] = paintCss(m, state.stroke);
  if (stroke.sides) {
    const sides = stroke.sides;
    const side = (s: BoxSide) => px(sides.includes(s) ? stroke.width : 0);
    Object.assign(out, { "--wf-group-outline": paintCss(m, stroke.paint), "--wf-group-top": side("top"), "--wf-group-right": side("right"), "--wf-group-bottom": side("bottom"), "--wf-group-left": side("left") });
  }
  if (rule) out["--wf-group-rule"] = `inset ${rule.side === "left" ? px(rule.width) : 0} ${rule.side === "top" ? px(rule.width) : 0} 0 ${paintCss(m, rule.paint)}`;
  return out;
}

const Group = memo(function Group({ id, data, selected, width, height }: NodeProps<WfGroupNode>) {
  const mark = groupMarkOf(data, width, height);
  const band = mark.band;
  const title = mark.texts[0];
  return (
    <div
      id={`wf-group-${id}`}
      className={`wf-group${data.tint ? " wf-group--tinted" : ""}${selected ? " wf-group--selected" : ""}${band ? ` wf-group--band wf-group--band-${band.axis}${band.index % 2 ? " wf-group--band-odd" : ""}` : ""}`}
      style={groupLook(mark, data.tint, data.state)}
      title={data.description}
      data-kind="group"
      data-band={band ? band.axis : undefined}
      {...part("group", data.group.kind, [selected && "selected"])}
    >
      {mark.stroke.sides ? null : <Outline className="wf-group__outline" mark={mark} fill="none" />}
      {title ? (
        <span className="wf-group__label" style={textLook(title, mark)} {...part("group-label")}>
          {title.text}
        </span>
      ) : null}
      {carried(data)}
    </div>
  );
});

export const nodeTypes = {
  activity: Card,
  stage: Card,
  gateway: Gateway,
  event: EventNode,
  note: Note,
  wfGroup: Group,
};
