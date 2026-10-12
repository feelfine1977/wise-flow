/**
 * The maps of the stories, with a fixed edge budget: every story draws the
 * same edges on every machine, so the browser and visual lanes stay
 * deterministic. Stories take `ProcessMap` and `ViewSwitcher` from here, and
 * the architecture check refuses a story that takes a map from the library or
 * asks for an adaptive budget. A story may still pass a number of its own.
 */
import type { ComponentProps } from "react";
import { ProcessMap as LibraryMap, ViewSwitcher as LibraryViews } from "../src/react/index";

/**
 * Where the detail sliders of the stories on the whole log open: the 16 of 42
 * activities and the 31 of 677 paths by frequency that the thresholds the
 * stories opened at before (activities 1 %, paths 3 %) showed. The paths
 * that keep an activity on a way from start to end are drawn solid with
 * their counts, where the thresholds re-added dashed ones.
 */
export const WHOLE_LOG_DETAIL = { activityDetail: 16 / 42, pathDetail: 31 / 677 };

export function ProcessMap(props: ComponentProps<typeof LibraryMap>) {
  return <LibraryMap {...props} edgeBudget={props.edgeBudget ?? "all"} />;
}

export function ViewSwitcher(props: ComponentProps<typeof LibraryViews>) {
  return <LibraryViews {...props} edgeBudget={props.edgeBudget ?? "all"} />;
}
