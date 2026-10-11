import { createContext } from "react";
import { type PatternId, type PatternLook, colorTokens, patternTokens, patternTwinSvg } from "../core/index.js";
import { svgReact } from "./marks.js";

/** The ink and the look of the pattern twins a map draws: its theme's pattern ink in its scheme and `pattern`. */
export const PatternTheme = createContext<{ ink: string; look: PatternLook }>({ ink: colorTokens.patternInk, look: patternTokens });

/** Small SVG that fills its parent with the pattern twin of a categorical colour (`patternTwin`), drawn as `look` says. */
export function PatternSwatch({ pattern, ink = "currentColor", look = patternTokens }: { pattern: PatternId; ink?: string; look?: PatternLook }) {
  if (pattern === "solid") return null;
  // Swatches of another ink or look have their own tiles: a page refers to the first tile of an id.
  const id = `wf-pat-${pattern}${ink === colorTokens.patternInk && look === patternTokens ? "" : `-${ink}${Object.values(look)}`.replace(/\W/g, "")}`;
  return (
    <svg aria-hidden="true" focusable="false">
      <defs>{svgReact(patternTwinSvg(id, pattern, ink, look))}</defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
