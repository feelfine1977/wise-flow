/**
 * The overlay projection of the BPMN view: where the scene's overlay marks go
 * on a diagram, from the marks and the boxes of the rendered elements. Marks
 * with a path run between elements and go into an SVG layer; boxes become
 * overlays on the element they name, at the offset of their box.
 */
import type { OverlayMark } from "../core/index.js";
import type { RegistryElement } from "./scene.js";

/** A mark drawn as an overlay that follows its element. */
interface BoxPlacement {
  mark: OverlayMark;
  /** Registry id of the element the overlay is attached to. */
  element: string;
  /** Offset of the mark's box from the element's top-left corner. */
  position: { top: number; left: number };
  /** Zoom from which the overlay is shown; absent when it is shown at every zoom. */
  show?: { minZoom: number };
  /** Covers scale with the diagram; marks with text stay legible. */
  scale: true | { min: number; max: number };
  /** Class of the overlay's element: the kind, and whether it lies below the diagram's shapes. */
  className: string;
  /** Marker the element carries while the overlay is shown. */
  marker: string;
}

/** A mark drawn in the SVG layer of the diagram. */
interface PathPlacement {
  mark: OverlayMark;
  /** Zoom from which the path is shown. */
  minZoom: number;
  /** Registry ids of the elements a click on the path selects: the arc's source and target, and the overlay's target. */
  selects: string[];
}

interface Projection {
  boxes: BoxPlacement[];
  paths: PathPlacement[];
}

/**
 * Place the marks drawn on the map; `elements` holds the rendered element of
 * every node and group id of the scene (`registryPositions`). Box marks whose
 * target has no rendered box are left out.
 */
export function projectMarks(marks: readonly OverlayMark[], elements: ReadonlyMap<string, RegistryElement>): Projection {
  const boxes: BoxPlacement[] = [];
  const paths: PathPlacement[] = [];
  for (const mark of marks) {
    if (!mark.inMap) continue;
    const { kind, overlay, box } = mark;
    if (mark.path !== undefined) {
      const ends = [overlay.payload?.source, overlay.payload?.target, overlay.target];
      const selects = ends.flatMap((id) => (typeof id === "string" && elements.get(id)?.id) || []);
      paths.push({ mark, minZoom: mark.minZoom, selects });
      continue;
    }
    const target = elements.get(overlay.target);
    if (typeof target?.x !== "number" || typeof target.y !== "number") continue;
    const name = kind.toLowerCase();
    boxes.push({
      mark,
      element: target.id,
      position: { top: box.y - target.y, left: box.x - target.x },
      show: mark.minZoom > 0 ? { minZoom: mark.minZoom } : undefined,
      scale: mark.texts.length ? { min: 0.8, max: 1.2 } : true,
      className: `wf-${name}${mark.layer === "below" ? " wf-mark--below" : ""}`,
      marker: `wf-bpmn--${name}`,
    });
  }
  return { boxes, paths };
}

