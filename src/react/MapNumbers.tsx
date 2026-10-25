import { useMemo } from "react";
import { type FlowScene, type Readable, dimensionTokens, readableTokens, t, zTokens } from "../core/index.js";
import { numbered } from "../core/figure.js";
import { Panel } from "./primitives.js";

/** The same numbered cards as a figure, with full names in a scrollable screen key. */
export function useMapNumbers(scene: FlowScene | undefined, readable: Readable | undefined) {
  const floor = readable?.level === "box" ? readable.floor : 0;
  return useMemo(() => scene && floor > 0 ? numbered({ ...scene, activityLabels: undefined }, floor, dimensionTokens.panelMaxWidth, scene.textMeasure) : undefined, [scene, floor]);
}

export function MapNumbers({ numbers }: { numbers: ReturnType<typeof useMapNumbers> }) {
  return numbers ? (
    <svg className="wf-map-numbers" style={{ zIndex: zTokens.marksAbove }} aria-hidden="true">
      {numbers.texts.filter((n) => n.text.from).map(({ id, text: n }) => <line key={id} data-id={id} x1={n.from!.x} y1={n.from!.y} x2={n.x} y2={n.y} stroke="var(--wf-ink)" strokeWidth={n.size * readableTokens.number.link} />)}
      {numbers.texts.map(({ id, text: n }) => <g key={id}>{n.box && <rect {...n.box} fill="var(--wf-paper)" stroke="none" />}<text data-id={id} x={n.x} y={n.y} fontSize={n.size} fontWeight={n.weight} textAnchor="middle" dominantBaseline="central">{n.text}</text></g>)}
    </svg>
  ) : null;
}

export function ActivityKey({ numbers, locale, side = "right" }: { numbers: ReturnType<typeof useMapNumbers>; locale: FlowScene["locale"]; /** The side of the map the key sits on: the one the legend does not take. */ side?: "left" | "right" }) {
  return numbers ? (
    <div className={`wf-overlay-panel wf-overlay-panel--bottom-${side} wf-activity-key-panel`}>
      <Panel part="activity-key" className="wf-activity-key" role="region" aria-label={t(locale, "export.numbers")} tabIndex={0} onKeyDown={(e) => e.stopPropagation()}>
        {numbers.lines.map((line, i) => <div key={i}>{i ? line : t(locale, "export.numbers")}</div>)}
      </Panel>
    </div>
  ) : null;
}
