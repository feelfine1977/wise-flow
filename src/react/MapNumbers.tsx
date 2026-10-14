import { useMemo } from "react";
import { type FlowScene, type Readable, dimensionTokens, t, zTokens } from "../core/index.js";
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
      {numbers.texts.map(({ id, text: n }) => <text key={id} data-id={id} x={n.x} y={n.y} fontSize={n.size} fontWeight={n.weight} textAnchor="middle" dominantBaseline="central">{n.text}</text>)}
    </svg>
  ) : null;
}

export function ActivityKey({ numbers, locale }: { numbers: ReturnType<typeof useMapNumbers>; locale: FlowScene["locale"] }) {
  return numbers ? (
    <div className="wf-overlay-panel wf-overlay-panel--bottom-right wf-activity-key-panel">
      <Panel part="activity-key" className="wf-activity-key" role="region" aria-label={t(locale, "export.numbers")} tabIndex={0} onKeyDown={(e) => e.stopPropagation()}>
        {numbers.lines.map((line, i) => <div key={i}>{i ? line : t(locale, "export.numbers")}</div>)}
      </Panel>
    </div>
  ) : null;
}
