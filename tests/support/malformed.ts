/**
 * Malformed input for the public entry points: what a host's backend may send
 * inside the shapes the documentation names. One case per seed: a graph with
 * planted defects (the invalid families of `graphs.ts` and the defects listed
 * below), its validation, positions that may be missing, not finite or
 * extreme, overlays that point nowhere or carry junk, and a stream of junk
 * numbers and strings for the scalar parameters (zoom levels, widths, budgets,
 * limits, metric names, colours).
 *
 * Kinds are drawn in turn (`seed` modulo their count), so a run of `n` seeds
 * meets each kind about `n / KINDS.length` times.
 */
import type { DrawContext } from "../../src/canvas/index";
import { type FlowGraph, type FlowGroup, type FlowNode, type GraphIssue, type Overlay, type Positions, MAP_TARGET, validateGraph } from "../../src/index";
import { type InvalidFamilyName, families, invalidFamilies } from "./graphs";
import { type Random, caseCount, createRandom } from "./random";
import { brokenPositionsOf, positionsOf } from "./scenes";

/** Defects beyond the invalid families. */
const EXTRA_KINDS = [
  "groupCycles",
  "emptyGraph",
  "oneActivity",
  "zeroCases",
  "veryLongLabels",
  "markupLabels",
  "junkOverlays",
  "unknownGroupKinds",
  "junkMeta",
] as const;

export type MalformedKind = InvalidFamilyName | (typeof EXTRA_KINDS)[number];

export const MALFORMED_KINDS: readonly MalformedKind[] = [...(Object.keys(invalidFamilies) as InvalidFamilyName[]), ...EXTRA_KINDS];

export type PositionKind = "grid" | "layered" | "overlapping" | "extreme" | "missing" | "nonFinite" | "none";

const POSITION_KINDS: readonly PositionKind[] = ["grid", "layered", "overlapping", "extreme", "missing", "nonFinite", "none"];

export interface MalformedCase {
  seed: number;
  kind: MalformedKind;
  positionKind: PositionKind;
  graph: FlowGraph;
  /** Positions of the graph, broken as `positionKind` says. */
  positions: Positions;
  /** What `validateGraph` reports, and whether it reports no error. */
  issues: GraphIssue[];
  accepted: boolean;
  /** The case's own stream for the scalar parameters. */
  rng: Random;
  /** For the failure message: kind, positions, sizes. */
  describe: string;
}

/** Numbers a host computes wrongly: zero, negative, fractional, huge, tiny, not finite. */
export const JUNK_NUMBERS: readonly number[] = [0, -0, -1, -250, 0.5, 2.5, 1e-320, 1e308, -1e308, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity];

/** What a backend sends where a number belongs: the junk numbers, and strings (JSON does not type its numbers). */
export const JUNK_VALUES: readonly number[] = [...JUNK_NUMBERS, "12" as unknown as number, "" as unknown as number, "abc" as unknown as number];

/**
 * Strings a backend sends as names: empty, blank, markup, right-to-left, very long, the map target, control
 * characters. Names of members of Object.prototype are left out (see the test of prototype ids), and so are
 * "NaN" and "undefined", which the checks for numbers that went wrong in a text would take for one.
 */
export const JUNK_STRINGS: readonly string[] = ["", " ", "\t\n", "<b>x</b>", '"quoted" & \'single\'', "<script>alert(1)</script>", "مراجعة الفاتورة", "x".repeat(5000), MAP_TARGET, "a->b", "0", "-1", "#zzzzzz", "#12", "rgb(1,2)", "var(--x)", "ü😀\u0000\u0007"];

/** A junk number a host passes: zoom, width, budget, limit, padding. */
export function junkNumber(rng: Random): number {
  return rng.chance(0.25) ? rng.float(-10, 10) : rng.pick(JUNK_NUMBERS);
}

/** A junk value a backend sends as a number: metrics, statistics, payload values. */
export function junkValue(rng: Random): number {
  return rng.chance(0.25) ? rng.float(-10, 10) : rng.pick(JUNK_VALUES);
}

export function junkString(rng: Random): string {
  return rng.pick(JUNK_STRINGS);
}

/** A sound number now and then, so that a function also meets junk beside sound values. */
export function someNumber(rng: Random, sound: number): number {
  return rng.chance(0.5) ? sound : junkNumber(rng);
}

/**
 * A coordinate or a size gone wrong: not finite, zero, negative, fractional, or far out (10¹², beyond the
 * extreme positions of the generators). Coordinates near the end of the number range (10³⁰⁸) are left out:
 * any sum of two of them overflows, whatever the code does with them.
 */
export function junkCoordinate(rng: Random, sound: number): number {
  return rng.chance(0.5) ? sound : rng.pick([NaN, Infinity, -Infinity, 0, -0, -250, 0.5, 1e12, -1e12, sound * 1e6]);
}

function longLabel(rng: Random, i: number): string {
  // One unbroken word of thousands of characters, or many words: wrapping and truncation meet both.
  return rng.chance(0.5) ? `${"Verification".repeat(rng.int(200, 800))}${i}` : `${"of the supplier invoice ".repeat(rng.int(100, 400))}${i}`;
}

function extra(kind: (typeof EXTRA_KINDS)[number], size: number, seed: number, rng: Random): FlowGraph {
  switch (kind) {
    case "groupCycles": {
      const g = families.stages(Math.max(4, size), seed);
      const groups: FlowGroup[] = g.groups ?? [];
      const shape = rng.int(0, 3);
      // Two groups inside each other, a group that is its own parent, a cycle of three, a lane whose chain enters a cycle.
      if (shape === 0) groups.push({ id: "c1", kind: "stage", label: "C1", parent: "c2" }, { id: "c2", kind: "stage", label: "C2", parent: "c1" });
      else if (shape === 1) groups.push({ id: "c1", kind: "lane", label: "C1", parent: "c1" });
      else if (shape === 2) groups.push({ id: "c1", kind: "lane", label: "C1", parent: "c3" }, { id: "c2", kind: "lane", label: "C2", parent: "c1" }, { id: "c3", kind: "pool", label: "C3", parent: "c2" });
      else groups.push({ id: "c1", kind: "stage", label: "C1", parent: "c2" }, { id: "c2", kind: "stage", label: "C2", parent: "c1" }, { id: "c4", kind: "lane", label: "C4", parent: "c1" });
      const cyclic = groups.filter((x) => x.id.startsWith("c")).map((x) => x.id);
      for (const n of rng.sample(g.nodes, Math.max(1, Math.floor(g.nodes.length / 2)))) n.group = rng.pick(cyclic);
      if (rng.chance()) g.groups = rng.shuffle(groups);
      return g;
    }
    case "emptyGraph": {
      const g: FlowGraph = { nodes: [], edges: [] };
      if (rng.chance()) g.groups = [{ id: "g0", kind: "stage", label: "Empty stage" }];
      if (rng.chance()) g.overlays = [{ kind: "chip", target: MAP_TARGET, payload: { label: "Scope", text: "none" } }];
      return g;
    }
    case "oneActivity": {
      const node: FlowNode = { id: "n0", kind: "activity", label: "Only" };
      if (rng.chance()) node.metrics = { cases: rng.pick([0, 1, 7]) };
      if (rng.chance()) node.group = "g0";
      const g: FlowGraph = { nodes: [node], edges: rng.chance() ? [{ id: "n0->n0", kind: "follows", source: "n0", target: "n0", metrics: { count: 3 } }] : [] };
      if (node.group) g.groups = [{ id: "g0", kind: "stage", label: "Stage" }];
      if (rng.chance()) g.overlays = [{ kind: "badge", target: "n0", payload: { value: 0.5, glyph: "≥1" } }];
      return g;
    }
    case "zeroCases": {
      const g = families.stages(Math.max(2, size), seed);
      for (const n of g.nodes) n.metrics = { cases: 0, events: 0, share: 0 };
      for (const e of g.edges) e.metrics = { count: 0, cases: 0, share: 0 };
      return g;
    }
    case "veryLongLabels": {
      const g = families.overlaid(Math.max(3, size), seed);
      g.nodes.forEach((n, i) => (n.label = longLabel(rng, i)));
      g.groups?.forEach((x, i) => (x.label = longLabel(rng, i)));
      for (const o of g.overlays ?? []) o.payload = { ...o.payload, text: longLabel(rng, 0), label: longLabel(rng, 1), displayLabel: rng.chance() ? longLabel(rng, 2) : undefined };
      return g;
    }
    case "markupLabels":
      return families.markupLabels(Math.max(2, size), seed);
    case "junkOverlays": {
      const g = families.overlaid(Math.max(3, size), seed);
      const ids = g.nodes.map((n) => n.id);
      const junk = () => (rng.chance(0.3) ? undefined : junkValue(rng));
      for (const o of g.overlays ?? []) {
        o.payload = { ...o.payload, value: junk(), coverage: junk(), threshold: junk(), width: junk() };
        if (o.payload.gauge) o.payload.gauge = { value: junkValue(rng), threshold: junkValue(rng), width: junk() };
        if (rng.chance(0.2)) o.payload.glyph = junkString(rng);
      }
      const overlays = g.overlays ?? [];
      overlays.push(
        { kind: "arc", target: "nowhere", payload: { source: rng.pick(ids), target: "gone", value: 0.5 } },
        { kind: "arc", target: rng.pick(g.edges).id },
        { kind: rng.pick(["sparkle", "", "Badge"]) as Overlay["kind"], target: rng.pick(ids), payload: { value: 0.3, text: "Unknown kind" } },
        { kind: "chip", target: g.groups?.length ? rng.pick(g.groups).id : MAP_TARGET, payload: { gauge: { value: NaN, threshold: 0 } } },
        { kind: "selfLoop", target: rng.pick(ids), payload: { displayLabel: "", value: -3, observed: rng.chance() } },
      );
      // The same overlay twice.
      overlays.push({ ...overlays[0] });
      g.overlays = rng.shuffle(overlays);
      return g;
    }
    case "unknownGroupKinds": {
      const g = families.nested(Math.max(4, size), seed);
      for (const x of rng.sample(g.groups ?? [], 2)) x.kind = rng.pick(["region", "", "Lane"]) as FlowGroup["kind"];
      return g;
    }
    case "junkMeta": {
      const g = families.stages(Math.max(2, size), seed);
      g.meta = { abstraction: rng.pick([NaN, -1, "half", { minNodeShare: "a", collapse: 3 }] as unknown[]) as number, label: rng.pick([42, null, "<b>Scene</b>"]), cases: rng.pick(["many", NaN, -5]), events: Infinity };
      g.focus = rng.pick(["gone", "", g.nodes[0]?.id ?? "n0"]);
      g.paths = { focus: rng.pick(["gone", g.nodes[0]?.id ?? "n0"]), incoming: [{ from: "gone", count: NaN }, { from: g.nodes[1]?.id, count: "7" as unknown as number, median_lag: -2 }, {}], outgoing: [{ to: undefined, share: Infinity, violation_share: 3 }] };
      return g;
    }
  }
}

function positionsFor(graph: FlowGraph, kind: PositionKind, seed: number): Positions {
  switch (kind) {
    case "missing":
    case "nonFinite":
      return graph.nodes.length ? brokenPositionsOf(graph, kind, seed).positions : positionsOf(graph, "grid", seed);
    case "none":
      return { nodes: {}, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, engine: "given", direction: "RIGHT" };
    default:
      return positionsOf(graph, kind, seed, { routes: kind === "grid" ? "bent" : kind === "extreme" ? true : undefined });
  }
}

/** The malformed case of a seed: the kind in turn, a size of 0 to 12, positions of every kind. */
export function malformedCase(seed: number, options: { maxSize?: number } = {}): MalformedCase {
  const rng = createRandom(seed + 31_000_003);
  const kind = MALFORMED_KINDS[(((seed - 1) % MALFORMED_KINDS.length) + MALFORMED_KINDS.length) % MALFORMED_KINDS.length];
  const size = rng.int(0, options.maxSize ?? 12);
  const graph = kind in invalidFamilies ? invalidFamilies[kind as InvalidFamilyName](size, seed).graph : extra(kind as (typeof EXTRA_KINDS)[number], size, seed, rng);
  const positionKind = rng.pick(POSITION_KINDS);
  const positions = positionsFor(graph, positionKind, seed);
  const issues = validateGraph(graph);
  return {
    seed,
    kind,
    positionKind,
    graph,
    positions,
    issues,
    accepted: !issues.some((i) => i.level === "error"),
    rng: rng.fork(),
    describe: `${kind}, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.groups?.length ?? 0} groups, ${graph.overlays?.length ?? 0} overlays, ${positionKind} positions${issues.length ? `; validation: ${issues.map((i) => i.message).join(", ")}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Calling the entry points

/** Errors that are not a documented failure but a fault: thrown by the engine on a programming error, or not an `Error` at all. */
export function isUntyped(e: unknown): boolean {
  return !(e instanceof Error) || e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError || e instanceof ReferenceError;
}

/** The message of a searching test's failure: seed, case and what went wrong. */
export function failure(c: Pick<MalformedCase, "seed" | "describe">, what: string): string {
  return `seed ${c.seed} (${c.describe}); replay with WISE_SEED=${c.seed}: ${what}`;
}

/**
 * Calls of the public functions over malformed cases: how often each ran, the
 * plain errors each threw (allowed when `allowed` says so, and listed), and a
 * bound on the time of every call. An untyped error, a disallowed error or a
 * slow call fails at once with the seed and the case.
 */
export class Calls {
  readonly runs = new Map<string, number>();
  /** Function → error name and the start of its message → count. */
  readonly errors = new Map<string, Map<string, number>>();

  constructor(
    private readonly fail: (message: string) => never,
    readonly limitMs = 10_000,
  ) {}

  private count(name: string): void {
    this.runs.set(name, (this.runs.get(name) ?? 0) + 1);
  }

  private caught(name: string, c: Pick<MalformedCase, "seed" | "describe">, e: unknown, allowed?: (e: Error) => boolean): void {
    const err = e as Error;
    if (err?.name === "AssertionError") throw err;
    if (isUntyped(e)) this.fail(failure(c, `${name} threw ${err?.name ?? typeof e}: ${err?.message ?? String(e)}\n${err?.stack?.split("\n").slice(1, 5).join("\n") ?? ""}`));
    if (allowed && !allowed(err)) this.fail(failure(c, `${name} threw ${err.name}: ${err.message}, which is not documented for it`));
    const key = `${err.name}: ${err.message.split("\n")[0].slice(0, 160)}`;
    const tally = this.errors.get(name) ?? this.errors.set(name, new Map()).get(name)!;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    this.lastCase.set(`${name} ${key}`, c.seed);
  }

  private readonly lastCase = new Map<string, number>();

  private timed(name: string, c: Pick<MalformedCase, "seed" | "describe">, start: number): void {
    const ms = performance.now() - start;
    if (ms > this.limitMs) this.fail(failure(c, `${name} took ${Math.round(ms)} ms, more than ${this.limitMs} ms`));
  }

  /** Calls `f`; returns its result, or undefined when it threw an allowed error. */
  call<T>(name: string, c: Pick<MalformedCase, "seed" | "describe">, f: () => T, allowed?: (e: Error) => boolean): T | undefined {
    this.count(name);
    const start = performance.now();
    try {
      return f();
    } catch (e) {
      this.caught(name, c, e, allowed);
      return undefined;
    } finally {
      this.timed(name, c, start);
    }
  }

  /** Awaits `f` within the time bound. */
  async callAsync<T>(name: string, c: Pick<MalformedCase, "seed" | "describe">, f: () => Promise<T>, allowed?: (e: Error) => boolean): Promise<T | undefined> {
    this.count(name);
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`still running after ${this.limitMs} ms`)), this.limitMs)));
    try {
      return await Promise.race([f(), late]);
    } catch (e) {
      if ((e as Error)?.message?.startsWith("still running after")) this.fail(failure(c, `${name} is ${(e as Error).message}`));
      this.caught(name, c, e, allowed);
      return undefined;
    } finally {
      clearTimeout(timer);
      this.timed(name, c, start);
    }
  }

  /** Every name ran at least `least` times. */
  ranAtLeast(names: readonly string[], least: number): string[] {
    return names.filter((n) => (this.runs.get(n) ?? 0) < least).map((n) => `${n} ran ${this.runs.get(n) ?? 0} times, fewer than ${least}`);
  }

  /** The plain errors thrown, one line per function and message. */
  report(): string {
    return [...this.errors].flatMap(([name, tally]) => [...tally].map(([msg, n]) => `${name}: ${msg} (${n}×)`)).join("\n");
  }

  /** The plain errors no pattern of `known[name]` describes, with a seed that threw each. */
  unknown(known: Readonly<Record<string, readonly RegExp[]>>): string[] {
    return [...this.errors].flatMap(([name, tally]) =>
      [...tally.keys()].filter((msg) => !(known[name] ?? []).some((re) => re.test(msg))).map((msg) => `${name} threw ${msg} (seed ${this.lastCase.get(`${name} ${msg}`)})`),
    );
  }
}

/**
 * The time limit of a search that renders, lays out or exports every malformed case: 300 cases take 25 to 66
 * seconds on two cores with coverage, as the hosted runners have, which is more than Vitest's 30. Searches run
 * fifty times as many cases in deep mode; so may their time limit.
 */
export const SEARCH_TIMEOUT = 180_000 * caseCount(1);

let inFlight: Promise<unknown> = Promise.resolve();

/**
 * Runs `body` for each case in turn, and stops at the next case once `signal`
 * is aborted, as Vitest aborts a test's signal when the test times out. No one
 * awaits a test that timed out: without the stop its loop would go on
 * rendering, calling `act()` and restoring mocks while the next test runs, and
 * that test would fail on the overlapping `act()` calls or miss what is logged.
 * Await `caseSettled()` after each test, before cleaning up.
 */
export async function eachCase<C>(cases: readonly C[], signal: AbortSignal, body: (c: C) => Promise<void>): Promise<void> {
  for (const c of cases) {
    signal.throwIfAborted();
    const step = body(c);
    inFlight = step.catch(() => undefined);
    await step;
  }
}

/** Resolves when the case `eachCase` ran last has ended. */
export function caseSettled(): Promise<unknown> {
  return inFlight;
}

/** Paths to the numbers in a value that are not finite (`NaN`, an infinity), at most `limit` of them. */
export function nonFinite(value: unknown, limit = 5): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: string) => {
    if (out.length >= limit) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) out.push(`${path} = ${v}`);
    } else if (v && typeof v === "object" && !seen.has(v)) {
      seen.add(v);
      if (v instanceof Map) for (const [k, x] of v) walk(x, `${path}.get(${String(k)})`);
      else if (v instanceof Set) for (const x of v) walk(x, `${path}[]`);
      else for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
    }
  };
  walk(value, "");
  return out;
}

/** A 2D context that records the arguments of every call and every number it is given, and draws nothing. */
export function argumentsRecorder(): { ctx: DrawContext; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const ctx: DrawContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    lineJoin: "miter",
    lineCap: "butt",
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    bezierCurveTo: record("bezierCurveTo"),
    arc: record("arc"),
    rect: record("rect"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillRect: record("fillRect"),
    clearRect: record("clearRect"),
    fillText: record("fillText"),
    strokeText: record("strokeText"),
    setLineDash: record("setLineDash"),
    measureText: (text: string) => ({ width: String(text).length * 6 }),
  };
  // The numbers set as properties count as arguments too.
  for (const key of ["lineWidth", "globalAlpha"] as const) {
    let value = ctx[key];
    Object.defineProperty(ctx, key, { get: () => value, set: (v: number) => (calls.push({ name: key, args: [v] }), (value = v)) });
  }
  return { ctx, calls };
}
