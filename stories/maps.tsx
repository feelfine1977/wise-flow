/**
 * The maps of the stories, with a fixed edge budget: every story draws the
 * same edges on every machine, so the browser and visual lanes stay
 * deterministic. Stories take `ProcessMap` and `ViewSwitcher` from here, and
 * the architecture check refuses a story that takes a map from the library or
 * asks for an adaptive budget. A story may still pass a number of its own.
 */
import type { ComponentProps } from "react";
import { ProcessMap as LibraryMap, ViewSwitcher as LibraryViews } from "../src/react/index";

export function ProcessMap(props: ComponentProps<typeof LibraryMap>) {
  return <LibraryMap {...props} edgeBudget={props.edgeBudget ?? "all"} />;
}

export function ViewSwitcher(props: ComponentProps<typeof LibraryViews>) {
  return <LibraryViews {...props} edgeBudget={props.edgeBudget ?? "all"} />;
}
