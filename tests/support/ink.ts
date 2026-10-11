/**
 * Where the ink of a Canvas draw goes. `inkContext` is a 2D context stub that
 * records every call and follows the transform, the path, the line width, the
 * font and the text alignment far enough to say which box of canvas pixels
 * each fill, stroke or text covers. `watch` wraps a prepared scene so that
 * reading an element from one of its lists begins a visit, to which the ink
 * drawn until the next read is attributed. A test can then compare what a
 * draw put on the canvas, element by element, with a naive reference; the
 * drawing code tells it nothing.
 *
 * Only translation and scaling are followed (the drawing routines use no
 * rotation). Text covers its measured width (`measure`, 0.55 em per character
 * by default, as the library's own estimate) and, from an alphabetic
 * baseline, 0.8 em above to 0.25 em below it; from a middle baseline, half an
 * em each way.
 */
import type { DrawContext, PreparedScene } from "../../src/canvas/index";
import type { Box } from "../../src/index";

export type ListName = "groups" | "marks" | "edges" | "nodes";
export const LIST_NAMES: readonly ListName[] = ["groups", "marks", "edges", "nodes"];

/** One read of an element's entry and the ink drawn until the next read. */
export interface Visit {
  list: ListName;
  index: number;
  id: string;
  /** Union of the ink in canvas pixels; absent when the visit drew nothing. */
  ink?: Box;
  /** Every call and assignment, with its arguments, for comparing how an element was drawn. */
  calls: string[];
}

export type TextMeasure = (text: string, size: number) => number;

/** The library's own estimate of a text's width: 0.55 em per character. */
export const estimate: TextMeasure = (text, size) => Array.from(text).length * 0.55 * size;

export function union(a: Box | undefined, b: Box): Box {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Whether two boxes share at least a point (closed intervals). */
export function meets(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function grow(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by };
}

/** The box of the points where a cubic Bézier from `p0` with handles `p1`, `p2` to `p3` is extreme (its tight bounds). */
export function cubicBox(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): Box {
  const xs: number[] = [p0[0], p3[0]];
  const ys: number[] = [p0[1], p3[1]];
  for (const axis of [0, 1] as const) {
    const [a, b, c, d] = [p0[axis], p1[axis], p2[axis], p3[axis]];
    // B'(t) = 3[(−a + 3b − 3c + d)t² + 2(a − 2b + c)t + (−a + b)]
    const qa = -a + 3 * b - 3 * c + d;
    const qb = 2 * (a - 2 * b + c);
    const qc = -a + b;
    const roots: number[] = [];
    if (Math.abs(qa) < 1e-12) {
      if (Math.abs(qb) > 1e-12) roots.push(-qc / qb);
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) roots.push((-qb + Math.sqrt(disc)) / (2 * qa), (-qb - Math.sqrt(disc)) / (2 * qa));
    }
    for (const t of roots) {
      if (!(t > 0 && t < 1)) continue;
      const u = 1 - t;
      (axis === 0 ? xs : ys).push(u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The box of a circular arc from angle `start` to `end` (clockwise in canvas terms). */
export function arcBox(cx: number, cy: number, r: number, start: number, end: number): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  const at = (angle: number) => {
    xs.push(cx + r * Math.cos(angle));
    ys.push(cy + r * Math.sin(angle));
  };
  at(start);
  at(end);
  const span = Math.min(2 * Math.PI, end - start);
  // Every quarter turn inside the sweep is an extreme of the circle.
  for (let k = Math.ceil(start / (Math.PI / 2)); k * (Math.PI / 2) <= start + span; k++) at(k * (Math.PI / 2));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export interface InkContext {
  ctx: DrawContext;
  /** Every visit in the order the elements were read. */
  visits: Visit[];
  /** Begin a visit: the ink that follows belongs to it. */
  begin(list: ListName, index: number, id: string): void;
  /** The calls made outside any visit: before the first element, and after the draw restored the context. */
  outside: string[];
  /** Union of all the ink, visits or not. */
  ink?: Box;
}

interface Transform {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export function inkContext(measure: TextMeasure = estimate): InkContext {
  const visits: Visit[] = [];
  const outside: string[] = [];
  let current: Visit | undefined;
  const stack: Transform[] = [];
  let t: Transform = { sx: 1, sy: 1, tx: 0, ty: 0 };
  let path: Box | undefined;
  let pen: [number, number] = [0, 0];
  const log = (s: string) => (current ? current.calls : outside).push(s);
  const mark = (b: Box) => {
    out.ink = union(out.ink, b);
    if (current) current.ink = union(current.ink, b);
  };
  const device = (b: Box): Box => {
    const x0 = b.x * t.sx + t.tx;
    const x1 = (b.x + b.width) * t.sx + t.tx;
    const y0 = b.y * t.sy + t.ty;
    const y1 = (b.y + b.height) * t.sy + t.ty;
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  };
  const add = (b: Box) => (path = union(path, device(b)));
  const point = (x: number, y: number) => {
    add({ x, y, width: 0, height: 0 });
    pen = [x, y];
  };
  const own = {
    fillStyle: "" as DrawContext["fillStyle"],
    strokeStyle: "" as DrawContext["strokeStyle"],
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1,
    lineJoin: "miter" as CanvasLineJoin,
    lineCap: "butt" as CanvasLineCap,
  };
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(own.font)?.[1] ?? 10);
  const textBox = (text: string, x: number, y: number): Box => {
    const em = size();
    const w = measure(text, em);
    const x0 = own.textAlign === "right" || own.textAlign === "end" ? x - w : own.textAlign === "center" ? x - w / 2 : x;
    const [up, down] = own.textBaseline === "middle" ? [0.5 * em, 0.5 * em] : own.textBaseline === "top" ? [0, em] : [0.8 * em, 0.25 * em];
    return { x: x0, y: y - up, width: w, height: up + down };
  };
  const strokeBox = (b: Box): Box => ({ x: b.x - (own.lineWidth / 2) * t.sx, y: b.y - (own.lineWidth / 2) * t.sy, width: b.width + own.lineWidth * t.sx, height: b.height + own.lineWidth * t.sy });
  const methods = {
    save: () => void stack.push({ ...t }),
    // A restore ends the visit: the draw restores once after its last element.
    restore: () => {
      current = undefined;
      t = stack.pop() ?? t;
    },
    translate: (x: number, y: number) => void (t = { ...t, tx: t.tx + x * t.sx, ty: t.ty + y * t.sy }),
    scale: (x: number, y: number) => void (t = { ...t, sx: t.sx * x, sy: t.sy * y }),
    beginPath: () => void (path = undefined),
    closePath: () => {},
    moveTo: point,
    lineTo: point,
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      add(cubicBox(pen, [x1, y1], [x2, y2], [x, y]));
      pen = [x, y];
    },
    arc: (cx: number, cy: number, r: number, start: number, end: number) => {
      add(arcBox(cx, cy, r, start, end));
      pen = [cx + r * Math.cos(end), cy + r * Math.sin(end)];
    },
    rect: (x: number, y: number, w: number, h: number) => {
      add({ x, y, width: w, height: h });
      pen = [x, y];
    },
    fill: () => {
      if (path) mark(path);
    },
    stroke: () => {
      if (path) mark(strokeBox(path));
    },
    fillRect: (x: number, y: number, w: number, h: number) => mark(device({ x, y, width: w, height: h })),
    clearRect: () => {},
    fillText: (text: string, x: number, y: number) => mark(device(textBox(text, x, y))),
    strokeText: (text: string, x: number, y: number) => mark(strokeBox(device(textBox(text, x, y)))),
    measureText: (text: string) => ({ width: measure(text, size()) }),
    setLineDash: () => {},
  };
  const ctx = new Proxy(own as unknown as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key in methods) {
        const fn = methods[key as keyof typeof methods] as (...a: never[]) => unknown;
        return (...a: unknown[]) => {
          const out = fn(...(a as never[]));
          if (key !== "measureText") log(`${key}(${JSON.stringify(a)})`);
          return out;
        };
      }
      return target[key];
    },
    set: (target, key: string, value) => {
      log(`${key}=${JSON.stringify(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as DrawContext;
  const out: InkContext = {
    ctx,
    visits,
    outside,
    begin: (list, index, id) => {
      current = { list, index, id, calls: [] };
      visits.push(current);
    },
  };
  return out;
}

const idOf: Record<ListName, (item: never) => string> = {
  groups: (g: PreparedScene["groups"][number]) => g.group.id,
  marks: (m: PreparedScene["marks"][number]) => m.id,
  edges: (e: PreparedScene["edges"][number]) => e.edge.id,
  nodes: (n: PreparedScene["nodes"][number]) => n.node.id,
};

/** The scene with its four element lists reporting every entry read to `begin`. */
export function watch(scene: PreparedScene, begin: InkContext["begin"]): PreparedScene {
  const list = <T>(name: ListName, items: T[]): T[] =>
    new Proxy(items, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof key === "string" && /^\d+$/.test(key) && value !== undefined) begin(name, Number(key), idOf[name](value as never));
        return value;
      },
    });
  return { ...scene, groups: list("groups", scene.groups), marks: list("marks", scene.marks), edges: list("edges", scene.edges), nodes: list("nodes", scene.nodes) };
}

/** The visits that drew something, in order. */
export const drawn = (visits: readonly Visit[]): Visit[] => visits.filter((v) => v.ink !== undefined);

/** `list:index` of a visit. */
export const keyOf = (v: Pick<Visit, "list" | "index">): string => `${v.list}:${v.index}`;
