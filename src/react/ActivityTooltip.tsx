import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FlowNode } from "../core/index.js";

interface Props {
  id: string;
  node?: FlowNode;
  description: string;
  anchor: (id: string) => { x: number; y: number; above?: number };
}

/** An overlay: neither visibility nor content participates in graph layout. */
export function ActivityTooltip({ id, node, description, anchor }: Props) {
  const [shown, setShown] = useState<{ id: string; text: string; x: number; y: number; above?: number } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const overTooltip = useRef(false);
  const dismissed = useRef<string | null>(null);
  const candidate = useRef(node?.id);
  candidate.current = node?.id;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(closeTimer.current);
    if (node) {
      if (dismissed.current !== node.id) {
        dismissed.current = null;
        setShown({ id: node.id, text: description, ...anchor(node.id) });
      }
    } else {
      dismissed.current = null;
      closeTimer.current = setTimeout(() => {
        if (!overTooltip.current) setShown(null);
      }, 180);
    }
    return () => clearTimeout(closeTimer.current);
  }, [node, description, anchor]);
  useLayoutEffect(() => {
    const element = elementRef.current;
    const body = element?.parentElement;
    if (!shown || !element || !body) return;
    const place = () => {
      const bounds = body.getBoundingClientRect();
      const tooltip = element.getBoundingClientRect();
      const height = Math.min(tooltip.height, Math.max(0, bounds.height - 16));
      const below = shown.y;
      const top = below + height <= bounds.height - 8 ? below : (shown.above ?? below - 36) - height;
      const next = {
        left: Math.max(8, Math.min(shown.x, bounds.width - tooltip.width - 8)),
        top: Math.max(8, Math.min(top, bounds.height - height - 8)),
      };
      setPosition((previous) => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(body);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissed.current = shown.id;
      setShown(null);
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [shown]);
  if (!shown) return null;
  return (
    <div
      id={id}
      ref={elementRef}
      role="tooltip"
      className="wf-activity-tooltip"
      style={position}
      onMouseEnter={() => { overTooltip.current = true; clearTimeout(closeTimer.current); }}
      onMouseLeave={() => { overTooltip.current = false; if (!candidate.current) setShown(null); }}
    >
      {shown.text}
    </div>
  );
}
