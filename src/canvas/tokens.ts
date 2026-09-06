/**
 * Colours and fonts the canvas renderer draws with. They mirror the CSS
 * tokens of `tokens.css`; `readTokens` picks the live values up from an
 * element so that the canvas follows the application's theme.
 */
import { fixedColors } from "../core/index";

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
  font: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif",
  paper: fixedColors.paper,
  surface: "#f6f7f9",
  ink: fixedColors.ink,
  inkMuted: "#5b6270",
  line: "#cfd4dc",
  lineStrong: "#8c94a1",
  focus: "#0072b2",
  selection: "rgba(0, 114, 178, 0.14)",
  neutral: fixedColors.neutral,
  outOfScope: fixedColors.outOfScope,
};

const VARS: Record<keyof CanvasTokens, string> = {
  font: "--wf-font",
  paper: "--wf-paper",
  surface: "--wf-surface",
  ink: "--wf-ink",
  inkMuted: "--wf-ink-muted",
  line: "--wf-line",
  lineStrong: "--wf-line-strong",
  focus: "--wf-focus",
  selection: "--wf-selection",
  neutral: "--wf-neutral",
  outOfScope: "--wf-out-of-scope",
};

/** Tokens from the computed style of an element; missing variables keep their defaults. */
export function readTokens(element: Element | null | undefined, overrides: Partial<CanvasTokens> = {}): CanvasTokens {
  const out: CanvasTokens = { ...defaultTokens };
  if (element && typeof getComputedStyle === "function") {
    const cs = getComputedStyle(element);
    for (const key of Object.keys(VARS) as (keyof CanvasTokens)[]) {
      const v = cs.getPropertyValue(VARS[key]).trim();
      if (v) out[key] = v;
    }
  }
  return { ...out, ...overrides };
}
