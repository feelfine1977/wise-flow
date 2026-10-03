import { type PatternId, patternTwinSvg } from "../core/index.js";
import { svgReact } from "./marks.js";

/** Small SVG that fills its parent with the pattern twin of a categorical colour (`patternTwin`). */
export function PatternSwatch({ pattern, ink = "currentColor" }: { pattern: PatternId; ink?: string }) {
  if (pattern === "solid") return null;
  const id = `wf-pat-${pattern}`;
  return (
    <svg aria-hidden="true" focusable="false">
      <defs>{svgReact(patternTwinSvg(id, pattern, ink))}</defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
