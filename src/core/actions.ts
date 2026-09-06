/**
 * Actions menu of a map element: what the menu targets (an element, a pair
 * or a set of activities) and the default actions per target, grouped and
 * ordered as the interaction model prescribes (filter, explore, compare,
 * author). The host fills or replaces them through `onContextMenu`.
 */
import { COLLAPSED_TAG } from "./aggregate";
import { type FilterClause, clauseForTarget } from "./filters";
import { type Locale } from "./format";
import { type FlowGraph, type GroupKind, type NodeKind, hasTag, indexGraph } from "./model";
import { type ElementRef, type Selection } from "./selection";
import { type StringKey, t } from "./strings";

export type MenuGroup = "filter" | "explore" | "compare" | "author" | "export";

export const MENU_GROUP_ORDER: MenuGroup[] = ["filter", "explore", "compare", "author", "export"];

export interface MenuTarget {
  kind: "node" | "edge" | "group" | "pair" | "set";
  /** The element under the pointer or the focus (the first id of a pair or set). */
  id: string;
  ids: string[];
  label: string;
  nodeKind?: NodeKind;
  groupKind?: GroupKind;
  edgeKind?: "follows" | "constraint" | "flow";
}

export interface MenuAction {
  /** `filter-to`, `exclude`, `paths`, `lens`, `add-constraint`, `pin`, `worst-cases`, `collapse`, `expand`, `clear-focus` or a host id. */
  id: string;
  label: string;
  group: MenuGroup;
  /** Letter that activates the entry while the menu is open. */
  accelerator?: string;
  disabled?: boolean;
  /** Filter clause(s) the action adds when the host handles `onFilterChange`. */
  clause?: FilterClause | FilterClause[];
  /** Runs when the entry is chosen; may return the text to announce. */
  run?: (target: MenuTarget) => void | string;
  description?: string;
}

/**
 * The target of a menu opened on an element: the element itself, or, when
 * the element is part of a multi-node selection, that pair or set.
 */
export function menuTargetFor(graph: FlowGraph, element: ElementRef, selection: Selection): MenuTarget {
  const idx = indexGraph(graph);
  const label = (id: string) => idx.nodes.get(id)?.label ?? idx.groups.get(id)?.label ?? id;
  if (element.kind === "node" && selection.nodes.length >= 2 && selection.nodes.includes(element.id) && selection.edges.length === 0) {
    const ids = [element.id, ...selection.nodes.filter((id) => id !== element.id)];
    return { kind: ids.length === 2 ? "pair" : "set", id: element.id, ids, label: ids.map(label).join(", "), nodeKind: idx.nodes.get(element.id)?.kind };
  }
  if (element.kind === "edge") {
    const e = idx.edges.get(element.id);
    return { kind: "edge", id: element.id, ids: [element.id], label: e ? `${label(e.source)} → ${label(e.target)}` : element.id, edgeKind: e?.kind };
  }
  if (element.kind === "group") {
    return { kind: "group", id: element.id, ids: [element.id], label: label(element.id), groupKind: idx.groups.get(element.id)?.kind };
  }
  return { kind: "node", id: element.id, ids: [element.id], label: label(element.id), nodeKind: idx.nodes.get(element.id)?.kind };
}

export interface DefaultActionOptions {
  /** The group of the target is collapsed into a stage node. */
  collapsed?: boolean;
  /** A focus (paths) is shown, so "hide the paths" makes sense. */
  hasFocus?: boolean;
}

/**
 * Default actions for a target, in menu order. Filter actions carry the
 * clause they add; `paths`, `collapse` and `expand` are handled by the map
 * itself; the others reach the host through `onAction`.
 */
export function defaultActions(graph: FlowGraph, target: MenuTarget, locale: Locale = "en", options: DefaultActionOptions = {}): MenuAction[] {
  const idx = indexGraph(graph);
  const label = (id: string) => idx.nodes.get(id)?.label ?? idx.groups.get(id)?.label ?? id;
  const out: MenuAction[] = [];
  const add = (id: string, group: MenuGroup, key: StringKey, accelerator?: string, vars: Record<string, string | number> = {}, extra: Partial<MenuAction> = {}) =>
    out.push({ id, label: t(locale, key, vars), group, accelerator, ...extra });
  const clause = (action: "keep" | "exclude") => clauseForTarget({ kind: target.kind, ids: target.ids }, action, graph);
  const withClause = (action: "keep" | "exclude"): Partial<MenuAction> => {
    const c = clause(action);
    return c ? { clause: c } : { disabled: true };
  };
  switch (target.kind) {
    case "node": {
      const node = idx.nodes.get(target.id);
      if (!node) break;
      if (node.kind === "event") {
        if (hasTag(node, "end")) {
          add("filter-to", "filter", "menu.filterToEnd", "f", {}, withClause("keep"));
          add("exclude", "filter", "menu.excludeEnd", "x", {}, withClause("exclude"));
        }
        add("pin", "compare", "menu.pin", "p");
        break;
      }
      if (node.kind === "gateway" || node.kind === "note") {
        add("pin", "compare", "menu.pin", "p");
        break;
      }
      add("filter-to", "filter", "menu.filterTo", "f", {}, withClause("keep"));
      add("exclude", "filter", "menu.exclude", "x", {}, withClause("exclude"));
      add("paths", "explore", "menu.paths", "i");
      add("lens", "explore", "menu.lens", "d");
      add("worst-cases", "explore", "menu.worstCases", "w");
      add("pin", "compare", "menu.pin", "p");
      add("add-constraint", "author", "menu.addConstraint", "c");
      if (node.kind === "stage" && hasTag(node, COLLAPSED_TAG)) add("expand", "explore", "menu.expand", "z");
      break;
    }
    case "edge": {
      const e = idx.edges.get(target.id);
      if (!e) break;
      if (e.kind === "constraint") {
        add("lens", "explore", "menu.lens", "d");
        add("pin", "compare", "menu.pin", "p");
        break;
      }
      add("filter-to", "filter", "menu.filterToEdge", "f", {}, withClause("keep"));
      add("exclude", "filter", "menu.excludeEdge", "x", {}, withClause("exclude"));
      add("paths", "explore", "menu.pathsEdge", "i", { a: label(e.source), b: label(e.target) });
      add("worst-cases", "explore", "menu.worstCasesEdge", "w");
      add("pin", "compare", "menu.pin", "p");
      add("add-constraint", "author", "menu.addConstraintEdge", "c");
      break;
    }
    case "group": {
      add(options.collapsed ? "expand" : "collapse", "explore", options.collapsed ? "menu.expand" : "menu.collapse", "z");
      add("filter-to", "filter", "menu.filterToGroup", "f", {}, withClause("keep"));
      add("exclude", "filter", "menu.excludeGroup", "x", {}, withClause("exclude"));
      add("paths", "explore", "menu.pathsGroup", "i");
      add("worst-cases", "explore", "menu.worstCasesGroup", "w");
      add("pin", "compare", "menu.pin", "p");
      break;
    }
    case "pair": {
      const [a, b] = target.ids;
      const vars = { a: label(a), b: label(b) };
      add("filter-to", "filter", "menu.filterToPair", "f", vars, withClause("keep"));
      add("exclude", "filter", "menu.excludePair", "x", vars, withClause("exclude"));
      add("paths", "explore", "menu.pathsPair", "i", vars);
      add("lens", "explore", "menu.lensPair", "d", vars);
      add("pin", "compare", "menu.pin", "p");
      add("add-constraint", "author", "menu.addConstraintPair", "c", vars);
      break;
    }
    case "set": {
      add("filter-to", "filter", "menu.filterToSet", "f", {}, withClause("keep"));
      add("exclude", "filter", "menu.excludeSet", "x", {}, withClause("exclude"));
      add("pin", "compare", "menu.pin", "p");
      break;
    }
  }
  if (options.hasFocus) add("clear-focus", "explore", "menu.clearFocus", "h");
  return sortActions(out);
}

/** Actions in menu order: by group (filter, explore, compare, author, export), stable inside a group. */
export function sortActions(actions: MenuAction[]): MenuAction[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => MENU_GROUP_ORDER.indexOf(x.a.group) - MENU_GROUP_ORDER.indexOf(y.a.group) || x.i - y.i)
    .map((x) => x.a);
}

/** Title of a menu for a target. */
export function menuTitle(target: MenuTarget, graph: FlowGraph, locale: Locale = "en"): string {
  const idx = indexGraph(graph);
  const label = (id: string) => idx.nodes.get(id)?.label ?? idx.groups.get(id)?.label ?? id;
  if (target.kind === "pair") return t(locale, "menu.titlePair", { a: label(target.ids[0]), b: label(target.ids[1]) });
  if (target.kind === "set") return t(locale, "menu.titleSet", { count: target.ids.length });
  return t(locale, "menu.title", { label: target.label });
}
