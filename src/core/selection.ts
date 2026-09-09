/**
 * Selection state of a map: which nodes, edges and groups are selected, how a
 * click or a key changes that, what the selection looks like (one activity,
 * a pair, a set, a path, a stage) and how it is announced. Framework-free so
 * that every renderer and the table alternative share one model.
 */
import { type Locale } from "./format.js";
import { type FlowGraph, indexGraph } from "./model.js";
import { t } from "./strings.js";

/** Selected element ids of a map. */
export interface Selection {
  nodes: string[];
  edges: string[];
  groups: string[];
}

export const emptySelection: Selection = { nodes: [], edges: [], groups: [] };

export type ElementKind = "node" | "edge" | "group";

export interface ElementRef {
  kind: ElementKind;
  id: string;
}

/**
 * How a click changes the selection: `replace` selects the element alone
 * (clicking the only selected element again clears), `toggle` adds or removes
 * it (Shift, Ctrl or Cmd click), `add` and `remove` are the explicit forms.
 */
export type SelectMode = "replace" | "toggle" | "add" | "remove";

const KEY: Record<ElementKind, keyof Selection> = { node: "nodes", edge: "edges", group: "groups" };

export function isSelected(selection: Selection, ref: ElementRef): boolean {
  return selection[KEY[ref.kind]].includes(ref.id);
}

export function selectionSize(selection: Selection): number {
  return selection.nodes.length + selection.edges.length + selection.groups.length;
}

export function selectionEquals(a: Selection, b: Selection): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return same(a.nodes, b.nodes) && same(a.edges, b.edges) && same(a.groups, b.groups);
}

/** The selected elements as references, nodes first. */
export function selectionElements(selection: Selection): ElementRef[] {
  return [
    ...selection.nodes.map((id) => ({ kind: "node" as const, id })),
    ...selection.edges.map((id) => ({ kind: "edge" as const, id })),
    ...selection.groups.map((id) => ({ kind: "group" as const, id })),
  ];
}

/**
 * Apply a click or a key to the selection. Groups are single-select and clear
 * the rest; nodes and edges may be combined with `toggle` and `add`.
 */
export function selectElement(selection: Selection, ref: ElementRef, mode: SelectMode = "replace"): Selection {
  const key = KEY[ref.kind];
  const already = selection[key].includes(ref.id);
  if (ref.kind === "group") {
    if (mode === "remove" || ((mode === "toggle" || mode === "replace") && already)) return { nodes: [], edges: [], groups: [] };
    return { nodes: [], edges: [], groups: [ref.id] };
  }
  if (mode === "replace") {
    const alone = already && selectionSize(selection) === 1;
    return alone ? { nodes: [], edges: [], groups: [] } : { nodes: ref.kind === "node" ? [ref.id] : [], edges: ref.kind === "edge" ? [ref.id] : [], groups: [] };
  }
  const list = selection[key];
  const next = mode === "remove" || (mode === "toggle" && already) ? list.filter((id) => id !== ref.id) : already ? list : [...list, ref.id];
  return { nodes: ref.kind === "node" ? next : selection.nodes, edges: ref.kind === "edge" ? next : selection.edges, groups: [] };
}

/** Select several elements at once (`replace` starts from an empty selection). */
export function selectMany(selection: Selection, refs: ElementRef[], mode: SelectMode = "replace"): Selection {
  let out: Selection = mode === "replace" ? { nodes: [], edges: [], groups: [] } : selection;
  for (const ref of refs) out = selectElement(out, ref, mode === "replace" ? "add" : mode);
  return out;
}

export function clearSelection(): Selection {
  return { nodes: [], edges: [], groups: [] };
}

/**
 * Shape of a selection, which decides the actions a menu offers: one activity
 * (`node`), two activities (`pair`), more (`set`), one path (`edge`), several
 * paths (`edges`), one stage or lane (`group`), anything else (`mixed`).
 */
export type SelectionShape = "none" | "node" | "pair" | "set" | "edge" | "edges" | "group" | "mixed";

export function selectionShape(selection: Selection): SelectionShape {
  const n = selection.nodes.length;
  const e = selection.edges.length;
  const g = selection.groups.length;
  if (n + e + g === 0) return "none";
  if (g === 1 && n + e === 0) return "group";
  if (g > 0) return "mixed";
  if (n > 0 && e > 0) return "mixed";
  if (e === 1) return "edge";
  if (e > 1) return "edges";
  if (n === 1) return "node";
  if (n === 2) return "pair";
  return "set";
}

/**
 * Elements that stay bright while a selection exists: the selected nodes and
 * the paths touching them, the selected paths with their endpoints, the
 * members of a selected group. Everything else is dimmed by the renderers.
 */
export function relatedToSelection(graph: FlowGraph, selection: Selection): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>(selection.nodes);
  const edges = new Set<string>(selection.edges);
  const idx = indexGraph(graph);
  for (const id of selection.nodes) {
    for (const e of idx.outgoing.get(id) ?? []) edges.add(e.id);
    for (const e of idx.incoming.get(id) ?? []) edges.add(e.id);
  }
  for (const id of selection.edges) {
    const e = idx.edges.get(id);
    if (e) {
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  for (const g of selection.groups) for (const n of idx.members.get(g) ?? []) nodes.add(n.id);
  return { nodes, edges };
}

/** Sentence for the live region after the selection changed. */
export function describeSelection(graph: FlowGraph, selection: Selection, locale: Locale = "en"): string {
  const idx = indexGraph(graph);
  const label = (id: string) => idx.nodes.get(id)?.label ?? idx.groups.get(id)?.label ?? id;
  switch (selectionShape(selection)) {
    case "none":
      return t(locale, "selection.none");
    case "node":
      return t(locale, "selection.one", { label: label(selection.nodes[0]) });
    case "pair":
      return t(locale, "selection.pair", { a: label(selection.nodes[0]), b: label(selection.nodes[1]) });
    case "set":
      return t(locale, "selection.set", { count: selection.nodes.length, labels: selection.nodes.map(label).join(", ") });
    case "edge": {
      const e = idx.edges.get(selection.edges[0]);
      return e ? t(locale, "selection.edge", { a: label(e.source), b: label(e.target) }) : t(locale, "selection.one", { label: selection.edges[0] });
    }
    case "edges":
      return t(locale, "selection.edges", { count: selection.edges.length });
    case "group": {
      const g = idx.groups.get(selection.groups[0]);
      return t(locale, "selection.group", { label: g?.label ?? selection.groups[0], kind: t(locale, g?.kind === "lane" ? "group.lane" : g?.kind === "pool" ? "group.pool" : "group.stage") });
    }
    default:
      return t(locale, "selection.mixed", { count: selectionSize(selection) });
  }
}
