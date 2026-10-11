import { type Locale, formatCount } from "./format.js";
import { type NodeSize, defaultNodeSize } from "./layout.js";
import { type FlowGraph, type FlowNode, metric } from "./model.js";
import { type TextMeasure, estimateTextWidth, wrapText } from "./text.js";
import { textTokens } from "./tokens.js";

const { activityName: nameText, activityNumber: numberText } = textTokens;

/** Presentation only. Map keys are canonical activity node IDs. */
export interface ActivityLabelOptions {
  mode: "names" | "ids";
  references: Record<string, string>;
  names?: Record<string, string>;
  /** Default true; hiding counts does not change the reserved node size. */
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

/** One chosen node metric: distinct cases/items, never event frequency, grouped in full. */
export function activityNodeCounts(node: FlowNode, options: ActivityLabelOptions, locale: Locale = "en"): string {
  const cases = metric(node, "cases", NaN);
  return `${Number.isFinite(cases) && cases >= 0 ? formatCount(cases, locale) : "–"} ${options.caseLabel?.trim() || "cases"}`;
}

/** Both measures for detail surfaces, grouped in full; `exact` is kept for callers and changes nothing. */
export function activityCounts(node: FlowNode, options: ActivityLabelOptions, locale: Locale = "en", exact = false): string {
  void exact;
  const count = (name: string, unit: string) => {
    const value = metric(node, name, NaN);
    return Number.isFinite(value) && value >= 0 ? `${formatCount(value, locale)} ${unit}` : `${unit} unavailable`;
  };
  return `${count("cases", options.caseLabel?.trim() || "cases")} · ${count("events", "events")}`;
}

export function activityDescription(node: FlowNode, options: ActivityLabelOptions, locale: Locale = "en"): string {
  const reference = ownValue(options.references, node.id);
  return [reference ? `${reference} — ` : "", node.label, ". ", activityCounts(node, options, locale, true), "."].join("");
}

export function activityLabelLines(node: FlowNode, options: ActivityLabelOptions, width: number, locale: Locale = "en", measure: TextMeasure = estimateTextWidth) {
  return {
    name: wrapActivityText(activityLabel(node, options), width - 32, nameText.size, measure),
    counts: wrapActivityText(activityNodeCounts(node, options, locale), width - 32, numberText.size, measure),
  };
}

/** Call before layout, with the text measure of the scene. Hover/focus/count visibility never affect these dimensions. */
export function activityNodeSize(node: FlowNode, options: ActivityLabelOptions, measure: TextMeasure = estimateTextWidth): NodeSize {
  if (node.kind !== "activity") return defaultNodeSize(node);
  const width = options.mode === "ids" ? 140 : 280;
  // IDs get a fixed title row even when called before the reference inventory exists.
  const nameRows = options.mode === "ids" ? 1 : wrapActivityText(activityLabel(node, options), width - 32, nameText.size, measure).length;
  // Reserve the chosen metric even when the checkbox is off.
  const countRowsIn = (locale: Locale) => wrapActivityText(activityNodeCounts(node, options, locale), width - 32, numberText.size, measure).length;
  const countRows = Math.max(1, countRowsIn("en"), countRowsIn("de"));
  return { width, height: 20 + nameRows * nameText.lineHeight + countRows * numberText.lineHeight };
}

/** Visible canonical key, independent of the optional colour/constraint legend. */
export function activityKeyLines(graph: FlowGraph, options: ActivityLabelOptions | undefined, width: number, locale: Locale = "en", measure: TextMeasure = estimateTextWidth): string[] {
  if (!options) return [];
  const nodes = graph.nodes.filter((n) => n.kind === "activity");
  if (!nodes.length) return [];
  return ["Activity key — exact counts", ...nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).flatMap((node) => wrapActivityText(activityDescription(node, options, locale), width, textTokens.figureText.size, measure))];
}
