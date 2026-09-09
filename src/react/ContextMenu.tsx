import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type Locale, type MenuAction, type MenuGroup, type StringKey, MENU_GROUP_ORDER, t } from "../core/index.js";

export interface ContextMenuProps {
  /** Position inside the positioned container (CSS pixels). */
  x: number;
  y: number;
  /** Identity line: the element's label. */
  title: string;
  /** Kind and group of the element. */
  subtitle?: string;
  /** Plain-language sentence of the worst expectation touching the element. */
  note?: string;
  actions: MenuAction[];
  locale?: Locale;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
  /** Element that receives focus again when the menu closes. */
  returnFocusTo?: HTMLElement | null;
  /** Element the menu is clamped into; defaults to the offset parent. */
  boundsRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

const GROUP_KEY: Record<MenuGroup, StringKey> = {
  filter: "menu.group.filter",
  explore: "menu.group.explore",
  compare: "menu.group.compare",
  author: "menu.group.author",
  export: "menu.group.compare",
};

/**
 * Accessible actions menu: `role="menu"` with `menuitem`s, arrow keys, Home
 * and End, accelerator letters, Enter and Space to activate, Escape to close
 * (focus returns to the map). Entries are grouped with separators in the
 * order filter, explore, compare, author.
 */
export function ContextMenu({ x, y, title, subtitle, note, actions, locale = "en", onAction, onClose, returnFocusTo, boundsRef, className }: ContextMenuProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const enabled = actions.map((a, i) => (a.disabled ? -1 : i)).filter((i) => i >= 0);
  const [active, setActive] = useState(enabled[0] ?? 0);

  // Clamp into the container and focus the first entry.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bounds = boundsRef?.current ?? (el.offsetParent as HTMLElement | null);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxX = bounds ? bounds.clientWidth - w - 4 : Infinity;
    const maxY = bounds ? bounds.clientHeight - h - 4 : Infinity;
    setPosition({ left: Math.max(4, Math.min(x, maxX)), top: Math.max(4, Math.min(y, maxY)) });
  }, [x, y, boundsRef, actions.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, []);

  useEffect(() => {
    const el = ref.current;
    const items = el?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[active]?.focus();
  }, [active]);

  // Close on a click outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    onClose();
    returnFocusTo?.focus();
  };
  const activate = (index: number) => {
    const a = actions[index];
    if (!a || a.disabled) return;
    onAction(a);
    returnFocusTo?.focus();
  };
  const move = (delta: number) => {
    if (!enabled.length) return;
    const pos = enabled.indexOf(active);
    const next = enabled[(pos + delta + enabled.length) % enabled.length];
    setActive(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        return;
      case "Home":
        e.preventDefault();
        if (enabled.length) setActive(enabled[0]);
        return;
      case "End":
        e.preventDefault();
        if (enabled.length) setActive(enabled[enabled.length - 1]);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        activate(active);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case "Tab":
        close();
        return;
      default: {
        if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
          const letter = e.key.toLowerCase();
          const hit = actions.findIndex((a) => !a.disabled && a.accelerator?.toLowerCase() === letter);
          if (hit >= 0) {
            e.preventDefault();
            activate(hit);
          }
        }
      }
    }
  };

  const groups = MENU_GROUP_ORDER.map((g) => ({ group: g, items: actions.map((a, i) => ({ a, i })).filter(({ a }) => a.group === g) })).filter((g) => g.items.length > 0);

  return (
    <div
      ref={ref}
      className={`wf-menu${className ? ` ${className}` : ""}`}
      role="menu"
      aria-labelledby={`${id}-title`}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="wf-menu"
    >
      <div className="wf-menu__header" role="presentation">
        <strong id={`${id}-title`}>{title}</strong>
        {subtitle ? <span className="wf-menu__subtitle">{subtitle}</span> : null}
        {note ? <span className="wf-menu__note">{note}</span> : null}
      </div>
      {groups.map((g, gi) => (
        <div key={g.group} role="group" aria-label={t(locale, GROUP_KEY[g.group])} className="wf-menu__group">
          {gi > 0 ? <div role="separator" className="wf-menu__separator" /> : null}
          <div className="wf-menu__group-label" aria-hidden="true">
            {t(locale, GROUP_KEY[g.group])}
          </div>
          {g.items.map(({ a, i }) => (
            <button
              key={`${a.id}-${i}`}
              type="button"
              role="menuitem"
              className={`wf-menu__item${i === active ? " wf-menu__item--active" : ""}`}
              tabIndex={i === active ? 0 : -1}
              aria-disabled={a.disabled || undefined}
              aria-keyshortcuts={a.accelerator}
              title={a.description}
              data-action={a.id}
              onMouseEnter={() => !a.disabled && setActive(i)}
              onClick={() => activate(i)}
            >
              <span className="wf-menu__label">{a.label}</span>
              {a.accelerator ? <kbd className="wf-menu__key">{a.accelerator}</kbd> : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
