/**
 * What the map's default menu actions do: filter actions change the host's
 * filter, `paths` and `clear-focus` set the focus of paths, `collapse` and
 * `expand` change the abstraction. The host may then replace the actions or
 * suppress the menu (`onContextMenu`).
 */
import { useCallback } from "react";
import { type FlowGraph, type Focus, type MenuAction, type MenuTarget, addClause, asFilter, describeClause, t } from "../core/index.js";
import type { MapEvent } from "../core/map-controller.js";
import type { DispatchedStep } from "./controller.js";
import type { ProcessMapProps } from "./types.js";

type Props = Pick<ProcessMapProps, "filters" | "onFilterChange" | "onContextMenu" | "locale">;

/** The controller's `actions` for the map: the defaults with their runs, as the host leaves them. */
export function useMenuActions(props: Props, graph: FlowGraph, labelOf: (id: string) => string, dispatch: (event: MapEvent) => DispatchedStep) {
  const { filters, onFilterChange, onContextMenu, locale = "en" } = props;
  return useCallback(
    (target: MenuTarget, defaults: MenuAction[]): MenuAction[] | false => {
      const setFocus = (focus: Focus | undefined) => dispatch({ type: "setFocus", focus });
      // The action announces the sentence for the new focus; while a controlling host has not taken
      // it, the action's own sentence, and the focus sentence follows when the host takes it.
      const said = (step: DispatchedStep) => (step.waiting ? undefined : step.announcement);
      const actions = defaults.map((a): MenuAction => {
        if (a.run) return a;
        switch (a.id) {
          case "filter-to":
          case "exclude": {
            if (!onFilterChange || !a.clause) return a;
            const clauses = Array.isArray(a.clause) ? a.clause : [a.clause];
            return {
              ...a,
              run: () => {
                let f = asFilter(filters);
                for (const c of clauses) f = addClause(f, c);
                onFilterChange(f);
                return t(locale, "filters.added", { clause: clauses.map((c) => describeClause(c, locale, labelOf)).join("; ") });
              },
            };
          }
          case "paths":
            return {
              ...a,
              run: () => {
                if (target.kind === "pair") return said(setFocus([target.ids[0], target.ids[1]]));
                if (target.kind !== "edge") return said(setFocus(target.id));
                const e = graph.edges.find((x) => x.id === target.id);
                return e ? said(setFocus([e.source, e.target])) : undefined;
              },
            };
          case "collapse":
          case "expand":
            return { ...a, run: () => void dispatch({ type: "collapse", group: target.id, collapsed: a.id === "collapse" }) };
          case "clear-focus":
            return { ...a, run: () => void setFocus(undefined) };
          default:
            return a;
        }
      });
      const custom = onContextMenu?.(target, actions);
      return custom === false ? false : Array.isArray(custom) ? custom : actions;
    },
    [filters, onFilterChange, onContextMenu, locale, graph, labelOf, dispatch],
  );
}
