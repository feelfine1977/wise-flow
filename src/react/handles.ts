import { type NodeHandle, Position } from "@xyflow/react";
import { type LayoutDirection, dimensionTokens } from "../core/index.js";

/** The sides a card's paths enter (target) and leave (source) for the layout's direction. */
export function handleSides(direction: LayoutDirection): { target: Position; source: Position } {
  return direction === "DOWN"
    ? { target: Position.Top, source: Position.Bottom }
    : direction === "UP"
      ? { target: Position.Bottom, source: Position.Top }
      : direction === "LEFT"
        ? { target: Position.Right, source: Position.Left }
        : { target: Position.Left, source: Position.Right };
}

/** A handle `size` across, centred on the middle of a side of a card `width` × `height`, relative to the card. */
function handleAt(position: Position, width: number, height: number, size: number): { x: number; y: number } {
  const half = size / 2;
  switch (position) {
    case Position.Left: return { x: -half, y: height / 2 - half };
    case Position.Right: return { x: width - half, y: height / 2 - half };
    case Position.Top: return { x: width / 2 - half, y: -half };
    default: return { x: width / 2 - half, y: height - half };
  }
}

/**
 * The card's two handles as data, where the stylesheet draws them (0.6): React
 * Flow then draws a card's paths from its size and these, without waiting for
 * a measurement of the DOM, which a card object replaced on every render could
 * lose for good (Workbench #39). A later measurement replaces them with the
 * same bounds.
 */
export function cardHandles(direction: LayoutDirection, width: number, height: number): NodeHandle[] {
  const size = dimensionTokens.handle;
  const { target, source } = handleSides(direction);
  return [
    { type: "target", position: target, width: size, height: size, ...handleAt(target, width, height, size) },
    { type: "source", position: source, width: size, height: size, ...handleAt(source, width, height, size) },
  ];
}
