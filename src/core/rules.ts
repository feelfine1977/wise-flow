/**
 * Rules: a theme's ordered list of `{ match, set }` that restyles elements by
 * part, kind, tag and state within a closed set of properties. The mark
 * builders apply them when the scene is built, with the states `outOfScope`
 * and `reconnected`, so what they set reaches every renderer and both
 * exports; `stateStyle` gives what the rules of the interactive states set,
 * for the DOM map and the Canvas map alike.
 */
import type { EdgeKind, GroupKind, NodeKind, OverlayKind } from "./model.js";
import type { MarkPaint } from "./overlay-marks.js";
import type { ThemeDeviation } from "./style.js";
import { type FrequencyCue, type Theme, colorChannels } from "./theme.js";
import { type ColorToken, dashTokens, ruleTokens } from "./tokens.js";

/** The states the interactive maps resolve, through `stateStyle`. */
export type InteractiveState = "selected" | "focused" | "hovered" | "dimmed";

/** The states a rule may match: `outOfScope` and `reconnected` resolve when the scene is built, the others in the interactive maps. */
export type RuleState = "outOfScope" | "reconnected" | InteractiveState;

/**
 * The texts a rule may style: a card's `name` (its name lines), `count` (the
 * cases on its number line) and `share` (their share), and the `label` of
 * everything else (an event's, a note's and a group's label, a gateway's
 * glyph, a path's count, a mark's texts).
 */
export type RuleTextRole = "name" | "count" | "share" | "label";

/** How a rule styles a text: its size (from the theme's smallest text to 15), its weight and its colour. */
export interface RuleText {
  readonly size?: number;
  readonly weight?: 400 | 500 | 600;
  /** A literal colour or a colour role of the theme (`ink`, `accent`, …). */
  readonly color?: string;
}

/**
 * What a rule sets: the closed set of properties. There is no field for a
 * shape, a pattern, an arrowhead, a shadow, a gradient or any geometry.
 */
export interface RuleSet {
  /** A literal colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`) or a colour role of the theme. */
  readonly fill?: string;
  /** From 0 to 1. */
  readonly fillOpacity?: number;
  /** The outline's (a path's line's) colour, as `fill`. */
  readonly stroke?: string;
  /** The outline's width on the stroke scale: `thin` 1, `strong` 2. */
  readonly strokeWeight?: "thin" | "strong";
  /** `unobserved`: the dash of what was not directly observed. */
  readonly dash?: "solid" | "unobserved";
  /** A box's corners: `s` 4, `m` 8, `full` half its shorter side. */
  readonly radius?: "s" | "m" | "full";
  /** The whole element's, clamped to 0.2 to 1. */
  readonly opacity?: number;
  readonly text?: { readonly [R in RuleTextRole]?: RuleText };
  /** The place of a card's frequency cue (`Theme.frequencyCue`). */
  readonly cue?: FrequencyCue;
}

/**
 * Which elements a rule restyles: a part, and optionally its kind, a tag on
 * the element (nodes and paths carry tags) and a state.
 */
export type RuleMatch =
  | { readonly part: "node"; readonly kind?: NodeKind; readonly tag?: string; readonly state?: RuleState }
  | { readonly part: "edge"; readonly kind?: EdgeKind; readonly tag?: string; readonly state?: Exclude<RuleState, "outOfScope"> }
  | { readonly part: "group"; readonly kind?: GroupKind; readonly state?: "selected" }
  | { readonly part: "mark"; readonly kind?: OverlayKind; readonly state?: "hovered" };

/** One rule of a theme. */
export interface ThemeRule {
  readonly match: RuleMatch;
  readonly set: RuleSet;
}

/** The parts a rule matches. */
export type RulePart = RuleMatch["part"];

type Key = keyof RuleSet;
const INTERACTIVE: readonly string[] = ["selected", "focused", "hovered", "dimmed"];
/** What a rule of an interactive state may set: paints, widths, dashes and opacities, nothing the texts were fitted to. */
const PAINTS: readonly string[] = ["fill", "fillOpacity", "stroke", "strokeWeight", "dash", "opacity", "text"];
const BOX: readonly Key[] = ["fill", "fillOpacity", "stroke", "strokeWeight", "dash", "radius", "opacity", "text"];

/** For each part: its kinds, its states, whether it has tags, what a rule may set on it and which texts it has. */
const PARTS: Record<RulePart, { kinds: readonly string[]; states: readonly string[]; tags: boolean; set: readonly Key[]; texts: readonly RuleTextRole[] }> = {
  node: { kinds: ["activity", "stage", "gateway", "event", "note"], states: ["outOfScope", "reconnected", ...INTERACTIVE], tags: true, set: [...BOX, "cue"], texts: ["name", "count", "share", "label"] },
  edge: { kinds: ["follows", "flow", "constraint"], states: ["reconnected", ...INTERACTIVE], tags: true, set: ["stroke", "dash", "opacity", "text"], texts: ["label"] },
  group: { kinds: ["stage", "lane", "pool"], states: ["selected"], tags: false, set: BOX, texts: ["label"] },
  mark: { kinds: ["badge", "chip", "arc", "selfLoop", "tint", "hatch"], states: ["hovered"], tags: false, set: BOX, texts: ["label"] },
};

const NAMED: Partial<Record<Key, readonly string[]>> = {
  strokeWeight: ["thin", "strong"],
  dash: ["solid", "unobserved"],
  radius: ["s", "m", "full"],
  cue: ["both", "behind", "bottom", "none"],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: object, key: unknown) => typeof key === "string" && Object.prototype.hasOwnProperty.call(o, key);
const shown = (v: unknown): number | string => (typeof v === "number" || typeof v === "string" ? v : String(JSON.stringify(v)));

/** A literal colour or a colour role of the theme. */
const isColor = (v: unknown, theme: Theme) => typeof v === "string" && (own(theme.color, v) || !!colorChannels(v));

interface Problem {
  subject: string;
  value: number | string;
  minimum?: number;
  /** An opacity outside 0.2 to 1, which is clamped; every other problem leaves the rule out. */
  clamped?: true;
}

/** What is wrong with the rule at `at` (`rules[2]`). */
function problems(theme: Theme, rule: unknown, at: string): Problem[] {
  const out: Problem[] = [];
  const bad = (path: string, value: unknown, extra: Partial<Problem> = {}) => out.push({ subject: at + path, value: shown(value), ...extra });
  if (!isObject(rule) || !isObject(rule.match) || !isObject(rule.set)) return bad("", rule), out;
  const { match, set } = rule;
  if (!own(PARTS, match.part)) return bad(".match.part", match.part), out;
  const part = PARTS[match.part as RulePart];
  for (const [key, value] of Object.entries(match)) {
    const ok = key === "part" || (key === "kind" ? part.kinds.includes(value as string) : key === "state" ? part.states.includes(value as string) : key === "tag" && part.tags && typeof value === "string");
    if (!ok) bad(`.match.${key}`, value);
  }
  const interactive = INTERACTIVE.includes(match.state as string);
  for (const [key, value] of Object.entries(set)) {
    const path = `.set.${key}`;
    if (!part.set.includes(key as Key) || (interactive && !PAINTS.includes(key))) bad(path, value);
    else if (key === "fill" || key === "stroke") {
      if (!isColor(value, theme)) bad(path, value);
    } else if (key === "fillOpacity") {
      if (!(typeof value === "number" && value >= 0 && value <= 1)) bad(path, value);
    } else if (key === "opacity") {
      const { min, max } = ruleTokens.opacity;
      if (typeof value !== "number" || !Number.isFinite(value)) bad(path, value);
      else if (value < min || value > max) bad(path, value, { minimum: min, clamped: true });
    } else if (key === "text") {
      if (!isObject(value)) bad(path, value);
      else for (const [role, style] of Object.entries(value)) {
        if (!part.texts.includes(role as RuleTextRole) || !isObject(style)) bad(`${path}.${role}`, style);
        else for (const [name, v] of Object.entries(style)) textProblem(theme, `${path}.${role}.${name}`, name, v, match.part === "mark" || interactive, bad);
      }
    } else if (!NAMED[key as Key]!.includes(value as string)) bad(path, value);
  }
  return out;
}

/** What is wrong with one property of a rule's text; a mark's texts and those of an interactive state take only a colour. */
function textProblem(theme: Theme, path: string, name: string, v: unknown, colorOnly: boolean, bad: (path: string, value: unknown, extra?: Partial<Problem>) => void) {
  // The theme's smallest text in layout units (one is 0.75 pt).
  const min = (theme.minimum.text * 4) / 3;
  if (name === "color" ? !isColor(v, theme) : colorOnly || (name === "size" ? !(typeof v === "number" && v >= min - 1e-9 && v <= ruleTokens.textMax) : name !== "weight" || !(ruleTokens.weights as readonly unknown[]).includes(v)))
    bad(path, v, name === "size" && typeof v === "number" && v < min ? { minimum: min } : {});
}

/**
 * What of a theme's rules is unknown or out of range, as `checkTheme`
 * reports it: a rule that is not `{ match, set }`, an unknown part, kind,
 * state or property, a tag on a part without tags, a property the part or an
 * interactive state does not draw, a value outside its range. Such a rule
 * changes nothing; an opacity outside 0.2 to 1 is clamped to it instead.
 */
export function ruleDeviations(theme: Theme): ThemeDeviation[] {
  const rules: readonly unknown[] = Array.isArray(theme.rules) ? theme.rules : theme.rules === undefined ? [] : [theme.rules];
  return rules.flatMap((rule, i) => problems(theme, rule, `rules[${i}]`).map(({ clamped: _, ...p }) => ({ kind: "rule" as const, ...p })));
}

const valid = new WeakMap<object, { min: number; rules: readonly ThemeRule[] }>();

/** The rules of a theme that apply: those without a problem, their opacity clamped to 0.2 to 1. */
function validRules(theme: Theme): readonly ThemeRule[] {
  const given = theme.rules;
  if (!Array.isArray(given) || !given.length) return [];
  let known = valid.get(given);
  if (known?.min !== theme.minimum.text) {
    const { min, max } = ruleTokens.opacity;
    const rules = (given as readonly ThemeRule[]).flatMap((rule) => {
      const found = problems(theme, rule, "");
      if (found.some((p) => !p.clamped)) return [];
      return [found.length ? { match: rule.match, set: { ...rule.set, opacity: Math.min(max, Math.max(min, rule.set.opacity!)) } } : rule];
    });
    valid.set(given, (known = { min: theme.minimum.text, rules }));
  }
  return known.rules;
}

type Mutable<T> = { -readonly [K in keyof T]?: T[K] };

/**
 * What the rules of a theme set on an element, in their order: first those
 * without a state, then those whose state is one of `states`, so a state's
 * rule overrides the others. With `onlyStates`, only the second. None when no
 * rule matches.
 */
export function ruleSet(theme: Theme, part: RulePart, kind: string, tags: readonly string[] | undefined, states: readonly RuleState[], onlyStates = false): RuleSet | undefined {
  const rules = validRules(theme);
  if (!rules.length) return undefined;
  let out: Mutable<RuleSet> | undefined;
  for (const stated of onlyStates ? [true] : [false, true]) {
    for (const { match, set } of rules) {
      if (match.part !== part || (match.kind && match.kind !== kind) || ("tag" in match && match.tag !== undefined && !tags?.includes(match.tag))) continue;
      if (stated ? !(match.state && states.includes(match.state)) : match.state) continue;
      let text = out?.text;
      if (set.text) {
        const merged: Record<string, RuleText> = { ...text };
        for (const [role, r] of Object.entries(set.text)) merged[role] = { ...merged[role], ...r };
        text = merged;
      }
      out = { ...out, ...set, text };
    }
  }
  return out;
}

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/**
 * A rule's colour as a paint at an opacity: a colour role or a literal in
 * `colors`' scheme as `#rrggbb` (with the alpha after it below full). Without
 * a colour or an opacity, `current`; with only an opacity, `current` at it
 * (`value` being `value`).
 */
export function rulePaint(color: string | undefined, opacity: number | undefined, current: MarkPaint, colors: Readonly<Record<ColorToken, string>>, value: string): MarkPaint {
  if (color === undefined && opacity === undefined) return current;
  const css = color ?? (current === "value" || current === "onValue" ? value : current);
  const c = colorChannels(colors[css as ColorToken] ?? css);
  if (!c) return css as MarkPaint;
  const alpha = c[3] * (opacity ?? 1);
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}${alpha < 1 ? hex(alpha * 255) : ""}`;
}

/** The width of a rule's stroke weight; `current` without one. */
export const ruleWidth = (set: RuleSet | undefined, current: number): number => (set?.strokeWeight ? ruleTokens.strokeWeight[set.strokeWeight] : current);

/** The dash a rule sets (`unobserved`: the dash given, `solid`: none); `current` without one. */
export const ruleDash = (set: RuleSet | undefined, current: readonly number[] | undefined, unobserved: readonly number[]): number[] | undefined =>
  (set?.dash ? (set.dash === "unobserved" ? unobserved : undefined) : current) as number[] | undefined;

/** The corner radius of a rule on a box of that size; `current` without one. */
export const ruleRadius = (set: RuleSet | undefined, current: number, box: { width: number; height: number }): number =>
  !set?.radius ? current : set.radius === "full" ? Math.min(box.width, box.height) / 2 : ruleTokens.radius[set.radius];

const ROLES: Record<string, RuleTextRole> = { nameLine: "name", countLine: "count", share: "share" };

/** The rule role of a text of a mark: a card's name lines `name`, its cases `count`, their share `share`, any other `label`. */
export const ruleTextRole = (role?: string): RuleTextRole => ROLES[role ?? ""] ?? "label";

/** A text of a mark with what a rule sets on its role: its size and weight, and its paint. */
export function ruleText<T extends { size: number; weight?: number; paint: MarkPaint }>(t: T, set: RuleSet | undefined, role: RuleTextRole, colors: Readonly<Record<ColorToken, string>>, value: string): T {
  const r = set?.text?.[role];
  return r ? { ...t, size: r.size ?? t.size, weight: r.weight ?? t.weight, paint: rulePaint(r.color, undefined, t.paint, colors, value) } : t;
}

/** What the rules of an element's interactive states set; `stateStyle` gives it. */
export interface StateStyle {
  fill?: MarkPaint;
  stroke?: MarkPaint;
  width?: number;
  /** Empty for a solid outline. */
  dash?: number[];
  /** The whole element's; it replaces the opacity of the mark and of the dimmed state. */
  opacity?: number;
  /** The paint of the mark's texts by their rule role (`ruleTextRole`). */
  texts?: Partial<Record<RuleTextRole, MarkPaint>>;
}

/** The marks `stateStyle` reads: their kind, colour, fill and outline, and the element they stand for with its tags. */
interface StatedMark {
  kind: string;
  color: string;
  fill?: MarkPaint | { paint: MarkPaint };
  stroke?: { paint: MarkPaint };
  node?: { tags?: string[] };
  edge?: { tags?: string[] };
}

/**
 * What the rules of a scene's theme set on a mark in its interactive states
 * (`selected`, `focused`, `hovered`, `dimmed`), over what the scene resolved:
 * the one function the DOM map and the Canvas map both draw a state with.
 * None when no rule of these states matches; the renderers then draw the
 * state as they do by default (hover, selection and focus in the outline,
 * dimmed at the theme's opacity).
 */
export function stateStyle(scene: { theme: Theme; colors: Readonly<Record<ColorToken, string>> }, part: RulePart, mark: StatedMark, states: { readonly [S in InteractiveState]?: boolean }): StateStyle | undefined {
  if (!validRules(scene.theme).length) return undefined;
  const active = (Object.keys(states) as InteractiveState[]).filter((s) => states[s]);
  const set = active.length ? ruleSet(scene.theme, part, mark.kind, (mark.node ?? mark.edge)?.tags, active, true) : undefined;
  if (!set) return undefined;
  const { colors } = scene;
  const fill = typeof mark.fill === "object" ? mark.fill.paint : (mark.fill ?? "paper");
  const out: StateStyle = {};
  if (set.fill !== undefined || set.fillOpacity !== undefined) out.fill = rulePaint(set.fill, set.fillOpacity, fill, colors, mark.color);
  if (set.stroke !== undefined) out.stroke = rulePaint(set.stroke, undefined, mark.stroke?.paint ?? "value", colors, mark.color);
  if (set.strokeWeight) out.width = ruleTokens.strokeWeight[set.strokeWeight];
  if (set.dash) out.dash = set.dash === "solid" ? [] : [...(part === "edge" ? dashTokens.reconnectedPath : dashTokens.reconnectedNode)];
  if (set.opacity !== undefined) out.opacity = set.opacity;
  if (set.text) out.texts = Object.fromEntries(Object.entries(set.text).flatMap(([role, r]) => (r?.color ? [[role, rulePaint(r.color, undefined, "ink", colors, mark.color)]] : [])));
  return out;
}

/** A node's, a group's or an overlay mark's look: what `markInState` changes. */
interface Look {
  fill?: MarkPaint | { paint: MarkPaint; pattern?: string; opacity?: number };
  stroke?: { paint: MarkPaint; width: number; dash?: number[] };
  texts: readonly { paint: MarkPaint; role?: string }[];
  opacity?: number;
}

/**
 * A node's, a group's or an overlay mark as a state style (`stateStyle`)
 * draws it: its fill (a pattern stays), outline, opacity and the paint of its
 * texts. The mark itself without one.
 */
export function markInState<M extends Look>(m: M, s: StateStyle | undefined): M {
  if (!s) return m;
  const { fill, stroke, texts } = m;
  return {
    ...m,
    fill: s.fill === undefined || fill === undefined ? fill : typeof fill === "string" ? s.fill : fill.pattern ? fill : { paint: s.fill },
    stroke: stroke && { ...stroke, paint: s.stroke ?? stroke.paint, width: s.width ?? stroke.width, dash: s.dash ? (s.dash.length ? s.dash : undefined) : stroke.dash },
    opacity: s.opacity ?? m.opacity,
    texts: s.texts ? texts.map((t) => ({ ...t, paint: s.texts![ruleTextRole(t.role)] ?? t.paint })) : texts,
  };
}
