/** Colours and fonts the canvas renderer draws with: the core's tokens, or the live CSS variables of an element. */
import { colorTokens, cssVariable, fontTokens } from "../core/index.js";

export interface CanvasTokens {
  font: string;
  paper: string;
  surface: string;
  ink: string;
  inkMuted: string;
  line: string;
  lineStrong: string;
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
  focus: colorTokens.focus,
  selection: colorTokens.selection,
  neutral: colorTokens.neutral,
  outOfScope: colorTokens.outOfScope,
};

const KEYS = Object.keys(defaultTokens) as (keyof CanvasTokens)[];

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
