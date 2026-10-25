/**
 * The theme of a component drawn in a page: the host's setting, the CSS
 * variables the host wrote, and the preset, resolved once (`resolveTheme`).
 * One hook reads the variables and the colour scheme and follows their
 * changes; the map, the Canvas map and a host's export read what it resolves.
 */
import { type RefObject, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { type ColorScheme, type Theme, type ThemeOverrides, type ThemeSetting, checkTheme, resolveTheme } from "../core/index.js";
import { colorChannels, themeFromVariables } from "../core/theme.js";

/** A theme resolved in a page, and the colour scheme it is drawn in there. */
export interface FlowTheme {
  theme: Theme;
  scheme: ColorScheme;
  /** An element around the map pins it to a scheme other than the page's (`data-theme`, 0.4): the map writes the scheme's variables itself. */
  pinned?: boolean;
}

/**
 * The scheme `tokens.css` draws in: `data-theme` on the nearest element
 * around the map that has one (0.4: a host can pin one map), on the
 * document's root, otherwise the system's preference.
 */
function liveScheme(doc: Document | undefined, element?: Element | null): ColorScheme {
  const pinned = element?.closest?.("[data-theme]")?.getAttribute("data-theme");
  if (pinned === "dark" || pinned === "light") return pinned;
  const set = doc?.documentElement.getAttribute("data-theme");
  if (set === "dark" || set === "light") return set;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * A CSS colour as a literal: a literal as it is, any other syntax (a name,
 * `hsl()`, `oklch()`, `color-mix()`, …) as the browser paints it, read back
 * from one pixel: `#rrggbb`, or `rgba()` when it is translucent. None for what
 * is not a colour, or without a canvas.
 */
export function cssColor(css: string): string | undefined {
  if (colorChannels(css)) return css;
  if (probe === undefined) {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : undefined;
    if (canvas) canvas.width = canvas.height = 1;
    probe = canvas?.getContext("2d", { willReadFrequently: true }) ?? null;
  }
  if (!probe) return undefined;
  // A value that is not a colour leaves the fill style as it was, so two different starts tell it.
  const seen = ["#000000", "#ffffff"].map((start) => {
    probe!.fillStyle = start;
    probe!.fillStyle = css;
    return probe!.fillStyle;
  });
  if (seen[0] !== seen[1]) return undefined;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return a === 255 ? hex : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
}

/** A palette stop as hex, which palettes are interpolated from: an opaque colour as `#rrggbb`; anything else as it is. */
function hexStop(css: string): string {
  const literal = cssColor(css);
  const channels = literal && !/^#([\da-f]{3}){1,2}$/i.test(literal) ? colorChannels(literal) : undefined;
  if (!channels || channels[3] !== 1) return literal ?? css;
  return `#${channels.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** The setting with its colours turned into literals and its palette stops into hex. */
function literalSetting(setting: ThemeSetting | undefined): ThemeSetting | undefined {
  if (typeof setting !== "object") return setting;
  const literal = (roles: Readonly<Record<string, string | undefined>> | undefined) => roles && Object.fromEntries(Object.entries(roles).map(([role, value]) => [role, value === undefined ? value : cssColor(value)]));
  const palette = setting.palette && Object.fromEntries(Object.entries(setting.palette).map(([name, stops]) => [name, stops?.map(hexStop)]));
  return { ...setting, color: literal(setting.color), dark: literal(setting.dark), palette };
}

// Bundlers write the mode of the build in; a page without one is not developing.
declare const process: { env: { NODE_ENV?: string } };
function developing(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

/** What was logged, so that each finding is logged once. */
const warned = new Set<string>();

interface Read {
  scheme: ColorScheme;
  pinned?: boolean;
  variables?: ThemeOverrides;
  key: string;
}

/** Variables a component writes on its own element (`names`) over the host's inline values of them (`own`). */
export interface Written {
  names: readonly string[];
  own?: Readonly<Record<string, unknown>>;
}

/**
 * The theme of a component: `setting` (a preset's name or changes over a
 * preset) over the `--wf-*` CSS variables of `host` (what its rules and its
 * ancestors' set) over the preset, in the scheme `tokens.css` draws in.
 * Variables that `tokens.css` itself sets are not the host's and are left
 * out; colours in any CSS syntax become literals. Follows changes of the
 * host's and its ancestors' `class`, `style` and `data-theme` and of the
 * system's colour scheme. In development, logs what `checkTheme` finds.
 * Pass the result to `toSVG` or `toPNG` to export what the map draws; an
 * export stays in the light scheme unless given `scheme: "dark"`.
 */
export function useFlowTheme(host: RefObject<Element | null>, setting?: ThemeSetting): FlowTheme {
  return useTheme(host, setting);
}

/**
 * `useFlowTheme` for a component that writes the theme's variables on `host`
 * itself (`written`): while the variables are read, those it wrote are set
 * aside (the host's own inline values put back), so the host's show.
 */
export function useTheme(host: RefObject<Element | null>, setting?: ThemeSetting, written?: RefObject<Written | undefined>): FlowTheme {
  const [read, setRead] = useState<Read>(() => ({ scheme: liveScheme(typeof document !== "undefined" ? document : undefined), key: "" }));
  useLayoutEffect(() => {
    const element = host.current as HTMLElement | null;
    if (!element) return;
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(() => update()) : undefined;
    const update = () => {
      const scheme = liveScheme(element.ownerDocument, element);
      const pinned = scheme !== liveScheme(element.ownerDocument);
      const aside = written?.current;
      const inline = element.style;
      const saved = inline?.cssText;
      for (const name of aside?.names ?? []) {
        const own = aside!.own?.[name];
        if (own == null) inline.removeProperty(name);
        else inline.setProperty(name, String(own));
      }
      const style = getComputedStyle(element);
      const variables = themeFromVariables((name) => style.getPropertyValue(name), scheme, cssColor);
      if (aside?.names.length) {
        inline.cssText = saved;
        observer?.takeRecords();
      }
      const json = JSON.stringify(variables);
      const key = json === "{}" ? "" : json;
      setRead((previous) => (previous.scheme === scheme && previous.key === key && !!previous.pinned === pinned ? previous : { scheme, variables: key ? variables : undefined, key, ...(pinned && { pinned }) }));
    };
    update();
    for (let el: Element | null = element; el; el = el.parentElement) observer?.observe(el, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
    media?.addEventListener?.("change", update);
    return () => {
      observer?.disconnect();
      media?.removeEventListener?.("change", update);
    };
  }, [host, written]);
  // The setting by its content: a new object with the same content is the same setting.
  const settingKey = useMemo(() => JSON.stringify(setting ?? null), [setting]);
  const theme = useMemo(() => resolveTheme(literalSetting(setting), read.variables), [settingKey, read]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const found = developing() ? checkTheme(theme) : [];
    const key = JSON.stringify(found);
    if (!found.length || warned.has(key)) return;
    warned.add(key);
    console.warn("wise-flow: the theme falls short of checkTheme", found);
  }, [theme]);
  return useMemo(() => ({ theme, scheme: read.scheme, ...(read.pinned && { pinned: true }) }), [theme, read.scheme, read.pinned]);
}
