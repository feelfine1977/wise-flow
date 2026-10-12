/** Colours and fonts the canvas renderer draws with: the core's tokens, or the live CSS variables of an element. */
import { type FlowScene, colorTokens, cssVariable, fontTokens } from "../core/index.js";

export interface CanvasTokens {
  font: string;
  paper: string;
  surface: string;
  ink: string;
  inkMuted: string;
  line: string;
  lineStrong: string;
  /** The frequency cue's stripe and foot; the scene's, in its scheme, when not given. */
  cueStripe?: string;
  cueFoot?: string;
  /** The ink of the pattern twins on the stage colours; the scene's, in its scheme, when not given. */
  patternInk?: string;
  focus: string;
  selection: string;
  neutral: string;
  outOfScope: string;
}

export const defaultTokens: CanvasTokens = {
  font: fontTokens.family,
  paper: colorTokens.paper,
  surface: colorTokens.surface,
  ink: colorTokens.ink,
  inkMuted: colorTokens.inkMuted,
  line: colorTokens.line,
  lineStrong: colorTokens.lineStrong,
  cueStripe: colorTokens.cueStripe,
  cueFoot: colorTokens.cueFoot,
  patternInk: colorTokens.patternInk,
  focus: colorTokens.focus,
  selection: colorTokens.selection,
  neutral: colorTokens.neutral,
  outOfScope: colorTokens.outOfScope,
};

const KEYS = Object.keys(defaultTokens) as (keyof CanvasTokens)[];

/** The tokens a scene is drawn with: its theme's font and its colours in its scheme. */
export function sceneTokens(scene: Pick<FlowScene, "theme" | "colors">): CanvasTokens {
  const out = { font: scene.theme.font.family } as CanvasTokens;
  for (const key of KEYS) if (key !== "font") out[key] = scene.colors[key];
  return out;
}

/** Tokens from the computed style of an element; missing variables keep their defaults. */
export function readTokens(element: Element | null | undefined, overrides: Partial<CanvasTokens> = {}): CanvasTokens {
  const out: CanvasTokens = { ...defaultTokens };
  if (element && typeof getComputedStyle === "function") {
    const cs = getComputedStyle(element);
    for (const key of KEYS) {
      const v = cs.getPropertyValue(cssVariable(key)).trim();
      if (v) out[key] = v;
    }
  }
  return { ...out, ...overrides };
}
