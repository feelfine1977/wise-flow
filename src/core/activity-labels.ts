import { type Locale, formatCompact, formatCount } from "./format.js";
import { type NodeSize, defaultNodeSize } from "./layout.js";
import { type FlowGraph, type FlowNode, metric } from "./model.js";
import { type TextMeasure, estimateTextWidth, wrapLines, wrapText } from "./text.js";
import { spaceTokens, strokeTokens, textTokens } from "./tokens.js";

const { activityName: nameText, activityNumber: numberText } = textTokens;

/** Presentation only. Map keys are canonical activity node IDs. */
export interface ActivityLabelOptions {
  mode: "names" | "ids";
  references: Record<string, string>;
  names?: Record<string, string>;
  /** Default true; hiding the number line does not change the reserved node size. */
  showCounts?: boolean;
  /** Plural unit for the cases metric. Default "cases". */
  caseLabel?: string;
}

/** Retains absent activities too. Persist the result for an inventory/run across filters. */
export function activityReferences(graph: FlowGraph, previous: Record<string, string> = {}): Record<string, string> {
  const result = { ...previous };
  const used = new Set(Object.values(previous));
  let next = 1n;
  for (const value of used) {
    const match = /^A(\d+)$/.exec(value);
    if (match && BigInt(match[1]) >= next) next = BigInt(match[1]) + 1n;
  }
  for (const node of graph.nodes.filter((n) => n.kind === "activity").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (Object.hasOwn(result, node.id)) continue;
    let reference: string;
    do { reference = `A${String(next++).padStart(2, "0")}`; } while (used.has(reference));
    Object.defineProperty(result, node.id, { value: reference, enumerable: true, writable: true, configurable: true });
    used.add(reference);
  }
  return result;
}

function ownValue(values: Record<string, string> | undefined, id: string): string | undefined {
  return values && Object.hasOwn(values, id) ? values[id] : undefined;
}

export function activityLabel(node: FlowNode, options: ActivityLabelOptions): string {
  return (options.mode === "ids" ? ownValue(options.references, node.id) : ownValue(options.names, node.id)) || node.label;
}

/** Lines of an activity's name or counts, wrapped by the text measure (`wrapText`). */
export function wrapActivityText(value: string, width: number, fontSize: number = nameText.size, measure: TextMeasure = estimateTextWidth): string[] {
  return wrapText(value, width, { size: fontSize }, measure);
}

/** One chosen node metric: distinct cases/items, never event frequency. */
export function activityNodeCounts(node: FlowNode, options: ActivityLabelOptions, locale: Locale = "en"): string {
  const cases = metric(node, "cases", NaN);
  return `${Number.isFinite(cases) && cases >= 0 ? formatCompact(cases, locale) : "–"} ${options.caseLabel?.trim() || "cases"}`;
}

/** Both measures for detail surfaces; pass exact=true for tooltips and keys. */
export function activityCounts(node: FlowNode, options: ActivityLabelOptions, locale: Locale = "en", exact = false): string {
  const format = exact ? formatCount : formatCompact;
  const count = (name: string, unit: string) => {
    const value = metric(node, name, NaN);
    return Number.isFinite(value) && value >= 0 ? `${format(value, locale)} ${unit}` : `${unit} unavailable`;
  };
  return `${count("cases", options.caseLabel?.trim() || "cases")} · ${count("events", "events")}`;
}

export function activityDescription(node: FlowNode, options: ActivityLabelOptions, locale: Locale = "en"): string {
  const reference = ownValue(options.references, node.id);
  return [reference ? `${reference} — ` : "", node.label, ". ", activityCounts(node, options, locale, true), "."].join("");
}

/** The room a card of `width` gives its texts in the default theme: inside its padding and outline. */
const cardRoom = (width: number) => width - 12 * spaceTokens.unit - 2 * strokeTokens.node;

/** The lines of an activity's card in the default theme: its name on up to two lines (`wrapLines`), and its cases in `options.caseLabel`. */
export function activityLabelLines(node: FlowNode, options: ActivityLabelOptions, width: number, locale: Locale = "en", measure: TextMeasure = estimateTextWidth) {
  return {
    name: wrapLines(activityLabel(node, options), cardRoom(width), nameText, 2, measure),
    counts: wrapActivityText(activityNodeCounts(node, options, locale), cardRoom(width), numberText.size, measure),
  };
}

/**
 * Call before layout. An activity's card reserves its two name lines and its
 * number line whatever its name, so its size is fixed once: 140 wide for
 * references, 280 for names, as high as the default activity. Hover, focus and
 * whether the number line is shown never change it.
 */
export function activityNodeSize(node: FlowNode, options: ActivityLabelOptions, _measure: TextMeasure = estimateTextWidth): NodeSize {
  if (node.kind !== "activity") return defaultNodeSize(node);
  return { width: options.mode === "ids" ? 140 : 280, height: defaultNodeSize(node).height };
}

/** Visible canonical key, independent of the optional colour/constraint legend. */
export function activityKeyLines(graph: FlowGraph, options: ActivityLabelOptions | undefined, width: number, locale: Locale = "en", measure: TextMeasure = estimateTextWidth): string[] {
  if (!options) return [];
  const nodes = graph.nodes.filter((n) => n.kind === "activity");
  if (!nodes.length) return [];
  return ["Activity key — exact counts", ...nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).flatMap((node) => wrapActivityText(activityDescription(node, options, locale), width, textTokens.figureText.size, measure))];
}
