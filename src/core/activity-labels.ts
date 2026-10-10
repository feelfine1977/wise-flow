import { type Locale, formatCompact, formatCount } from "./format.js";
import { type NodeSize, defaultNodeSize } from "./layout.js";
import { type FlowGraph, type FlowNode, metric } from "./model.js";

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

/** Conservative deterministic wrapping shared by live renderers and headless exports. */
export function wrapActivityText(value: string, width: number, fontSize = 14): string[] {
  // Deliberately generous advances for the default sans-serif stack; wide scripts
  // reserve a full em. No browser font measurement or viewport-dependent wrapping.
  const advance = (char: string) => fontSize * ((char.codePointAt(0) ?? 0) <= 0x2ff ? 0.7 : 1);
  const limit = Math.max(fontSize, width);
  // Joined from characters: a line appended to char by char is kept as a chain of strings.
  const lines: string[] = [];
  let line: string[] = [];
  let used = 0;
  const end = () => {
    lines.push(line.join(""));
    line = [];
    used = 0;
  };
  for (const word of value.trim().split(/\s+/u)) {
    const chars = Array.from(word);
    const wordWidth = chars.reduce((total, char) => total + advance(char), 0);
    if (line.length && used + advance(" ") + wordWidth > limit) end();
    if (line.length) { line.push(" "); used += advance(" "); }
    for (const char of chars) {
      const size = advance(char);
      if (line.length && used + size > limit) end();
      line.push(char);
      used += size;
    }
  }
  if (line.length) end();
  return lines.length === 1 && lines[0] === value ? [value] : lines.length ? lines : [""];
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

export function activityLabelLines(node: FlowNode, options: ActivityLabelOptions, width: number, locale: Locale = "en") {
  return {
    name: wrapActivityText(activityLabel(node, options), width - 32),
    counts: wrapActivityText(activityNodeCounts(node, options, locale), width - 32, 12),
  };
}

/** Call before layout. Hover/focus/count visibility never affect these dimensions. */
export function activityNodeSize(node: FlowNode, options: ActivityLabelOptions): NodeSize {
  if (node.kind !== "activity") return defaultNodeSize(node);
  const width = options.mode === "ids" ? 140 : 280;
  // IDs get a fixed title row even when called before the reference inventory exists.
  const nameRows = options.mode === "ids" ? 1 : wrapActivityText(activityLabel(node, options), width - 32).length;
  // Reserve the chosen metric even when the checkbox is off.
  const countRowsIn = (locale: Locale) => wrapActivityText(activityNodeCounts(node, options, locale), width - 32, 12).length;
  const countRows = Math.max(1, countRowsIn("en"), countRowsIn("de"));
  return { width, height: 20 + nameRows * 18 + countRows * 16 };
}

/** Visible canonical key, independent of the optional colour/constraint legend. */
export function activityKeyLines(graph: FlowGraph, options: ActivityLabelOptions | undefined, width: number, locale: Locale = "en"): string[] {
  if (!options) return [];
  const nodes = graph.nodes.filter((n) => n.kind === "activity");
  if (!nodes.length) return [];
  return ["Activity key — exact counts", ...nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).flatMap((node) => wrapActivityText(activityDescription(node, options, locale), width, 11))];
}
