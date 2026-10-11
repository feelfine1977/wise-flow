/**
 * The layout lifecycle under random schedules. `useStableLayout` and the layout
 * module run as they are; the workers, and an ELK instance a caller supplies,
 * are fakes that answer only when the schedule says so, in any order, also
 * after they were terminated; the clock is fake. A schedule mounts the hook
 * (also twice, as StrictMode does), changes its graph and options, unmounts
 * it, asks layout scopes and `layout` directly, aborts, lets timeouts pass and
 * disposes scopes. After every step a small model of the schedule says what
 * must be true, and every violation names its invariant, the seed and the step.
 */
import { type ReactNode, StrictMode, useEffect } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type LayoutOptions, type LayoutScope, type Positions, createLayoutScope, layout, layoutUnion } from "../../src/index";
import * as layoutModule from "../../src/core/layout";
import { type StableLayout, useStableLayout } from "../../src/react/index";
import { families } from "../support/graphs";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { schedule } from "../support/schedules";
import { type AnswerSource, FakeLayoutWorker, HeldEngine, layoutSignature, replyOf } from "../support/workers";

const Strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

const ELK = FakeLayoutWorker.elkUrl;
const DAGRE = FakeLayoutWorker.dagreUrl;
const workers: LayoutOptions = { elkWorkerUrl: ELK, dagreWorkerUrl: DAGRE };
/** Layouts a scope keeps unless told otherwise (`createLayoutScope`). */
const DEFAULT_ENTRIES = 8;
/** `timeoutMs` of the layout module unless told otherwise. */
const DEFAULT_TIMEOUT = 20000;

/**
 * Option sets a schedule chooses from. Each has its own geometry (direction,
 * spacing or node size), so a layout's signature names its variant and its
 * timeout; the first three differ in one option only (direction, node size),
 * so a key that ignored one of them would return another variant's layout.
 * The last two pass the schedule's ELK instance, which the module cannot
 * interrupt, and hold the Dagre worker URL alone.
 */
interface Variant {
  name: string;
  options: LayoutOptions;
  timeoutMs: number;
  /** The worker URLs a scope holds once it computed a layout with these options. */
  holds: readonly string[];
}

function variantsOf(engine: HeldEngine): Variant[] {
  const both = [ELK, DAGRE];
  return [
    { name: "auto", options: { ...workers }, timeoutMs: DEFAULT_TIMEOUT, holds: both },
    { name: "auto down", options: { ...workers, direction: "DOWN" }, timeoutMs: DEFAULT_TIMEOUT, holds: both },
    { name: "auto small", options: { ...workers, nodeSize: { width: 120, height: 40 } }, timeoutMs: DEFAULT_TIMEOUT, holds: both },
    { name: "dagre wide", options: { ...workers, engine: "dagre", nodeSize: { width: 240, height: 60 } }, timeoutMs: DEFAULT_TIMEOUT, holds: both },
    { name: "auto tight 300ms", options: { ...workers, spacing: { node: 10, layer: 30 }, timeoutMs: 300 }, timeoutMs: 300, holds: both },
    { name: "elk left", options: { ...workers, engine: "elk", direction: "LEFT" }, timeoutMs: DEFAULT_TIMEOUT, holds: both },
    { name: "elk up 300ms", options: { ...workers, engine: "elk", direction: "UP", timeoutMs: 300 }, timeoutMs: 300, holds: both },
    { name: "engine elk airy", options: { ...workers, elk: engine.elk, engine: "elk", spacing: { node: 40, layer: 80 } }, timeoutMs: DEFAULT_TIMEOUT, holds: [DAGRE] },
    { name: "engine auto medium 300ms", options: { ...workers, elk: engine.elk, nodeSize: { width: 150, height: 50 }, timeoutMs: 300 }, timeoutMs: 300, holds: [DAGRE] },
  ];
}

/** What a scene choice gives the hook, and the graph the model expects it to lay out. */
interface Scenes {
  name: string;
  value: FlowGraph | FlowGraph[] | undefined;
  /**
   * The one graph the hook lays out: the union of the scenes as `unionGraph` builds
   * it (also of one scene, which gives it a `groups` array), undefined without scenes.
   */
  union: FlowGraph | undefined;
}

/** The union as the model understands it: elements by id, the first definition wins, in order. */
function modelUnion(scenes: FlowGraph[]): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const groups = new Map<string, FlowGroup>();
  for (const s of scenes) {
    for (const n of s.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    for (const e of s.edges) if (!edges.has(e.id)) edges.set(e.id, e);
    for (const g of s.groups ?? []) if (!groups.has(g.id)) groups.set(g.id, g);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], groups: [...groups.values()] };
}

/** The graph with every id prefixed, so that a union of two scenes has nodes of both. */
function prefixed(graph: FlowGraph, prefix: string): FlowGraph {
  const id = (x: string) => `${prefix}${x}`;
  return {
    nodes: graph.nodes.map((n) => ({ ...n, id: id(n.id), ...(n.group !== undefined ? { group: id(n.group) } : {}) })),
    edges: graph.edges.map((e) => ({ ...e, id: id(e.id), source: id(e.source), target: id(e.target) })),
    ...(graph.groups ? { groups: graph.groups.map((g) => ({ ...g, id: id(g.id), ...(g.parent !== undefined ? { parent: id(g.parent) } : {}) })) } : {}),
  };
}

/** Every entry has its own inputs: the second scene of a pair is prefixed, so the union is a graph of its own. */
function scenesPool(seed: number): Scenes[] {
  const chain = families.chain(3, seed);
  const layered = families.layered(6, seed);
  const stages = families.stages(8, seed);
  const cyclic = families.cyclic(5, seed);
  const empty: FlowGraph = { nodes: [], edges: [] };
  const second = { cyclic: prefixed(cyclic, "b"), stages: prefixed(stages, "b") };
  return [
    { name: "no scenes", value: undefined, union: undefined },
    { name: "chain 3", value: chain, union: modelUnion([chain]) },
    { name: "layered 6", value: layered, union: modelUnion([layered]) },
    { name: "stages 8", value: stages, union: modelUnion([stages]) },
    { name: "cyclic 5", value: cyclic, union: modelUnion([cyclic]) },
    { name: "empty", value: empty, union: modelUnion([empty]) },
    { name: "chain 3 + cyclic 5", value: [chain, second.cyclic], union: modelUnion([chain, second.cyclic]) },
    { name: "layered 6 + stages 8", value: [layered, second.stages], union: modelUnion([layered, second.stages]) },
  ];
}

const ids = (graph: FlowGraph) => graph.nodes.map((n) => n.id).sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// The model

interface Reply {
  signature: string;
  /** Index of the worker, or -1 for the engine. */
  source: number;
  /** The worker had been terminated when it answered: a real worker could not have. */
  terminatedBefore: boolean;
  step: number;
}

interface HookResult {
  result: StableLayout;
  signature: string | undefined;
  /** Counts the hook's requests: every mount, change of scenes or options, and clone. */
  request: number;
  mount: number;
}

interface HookProps {
  scenes: FlowGraph | FlowGraph[] | undefined;
  options: LayoutOptions;
}

interface DirectScope {
  name: string;
  scope: LayoutScope;
  maxEntries: number;
  /** The worker URLs of the layouts the scope computed since it was created or last disposed: it holds them. */
  holds: Set<string>;
  /** Disposed since its last request: the next request starts a new job even for the same inputs, replacing what is pending. */
  disposedSince: boolean;
}

interface DirectRequest {
  id: number;
  /** Index of the scope, or -1 for `layout` and `layoutUnion` outside a scope. */
  scope: number;
  scenes: Scenes;
  variant: Variant;
  signature: string;
  controller?: AbortController;
  /** Aborted while pending and before any answer for its inputs was delivered: it must end rejected. */
  mustReject: boolean;
  aborted: boolean;
  /** A newer request with other inputs to the same scope: it must settle. */
  replaced: boolean;
  state: "pending" | "resolved" | "rejected";
  positions?: Positions;
  error?: unknown;
}

/** A pair of a graph and options a scope was asked for, as `knownLayout` is asked about it. */
interface Asked {
  graph: FlowGraph;
  options: LayoutOptions;
  signature: string;
}

interface Model {
  seed: number;
  rng: Random;
  pool: Scenes[];
  variants: Variant[];
  /** The ELK instance the engine variants pass; it answers when the schedule says so. */
  engine: HeldEngine;
  step: number;
  hook: {
    mounted: boolean;
    strict: boolean;
    /** How many scopes the spy had recorded before this mount: the rest are this mount's. */
    scopesBefore: number;
    scenes: Scenes;
    variant: Variant;
    signature: string | undefined;
    request: number;
    mount: number;
    /** The worker URLs the hook's scope holds. */
    holds: Set<string>;
    handle?: ReturnType<typeof renderHook<StableLayout, HookProps>>;
  };
  log: HookResult[];
  /** Answers by serial number; index 0 is unused. */
  replies: (Reply | undefined)[];
  /** Inputs an engine error was delivered for. */
  fails: Set<string>;
  scopes: DirectScope[];
  requests: DirectRequest[];
  /** Scopes the hook created, through the spy. */
  hookScopes: LayoutScope[];
  /** What each scope was asked for, so that `knownLayout` is checked for every entry a scope can hold. */
  asked: Map<LayoutScope, Asked[]>;
  /** The timeout of every input asked for; each variant has its own geometry, so a signature names one timeout. */
  timeouts: Map<string, number>;
  /** What the schedule exercised, for the record. */
  stats: Record<string, number>;
}

function count(stats: Record<string, number>, what: string, by = 1): void {
  stats[what] = (stats[what] ?? 0) + by;
}

function newModel(seed: number, hookScopes: LayoutScope[]): Model {
  const pool = scenesPool(seed);
  const engine = new HeldEngine();
  const variants = variantsOf(engine);
  return {
    seed,
    rng: createRandom(seed),
    pool,
    variants,
    engine,
    step: 0,
    hook: { mounted: false, strict: false, scopesBefore: 0, scenes: pool[0], variant: variants[0], signature: undefined, request: 0, mount: 0, holds: new Set() },
    log: [],
    replies: [undefined],
    fails: new Set(),
    scopes: [
      { name: "scope A (2 entries)", scope: createLayoutScope({ maxEntries: 2 }), maxEntries: 2, holds: new Set(), disposedSince: false },
      { name: "scope B (1 entry)", scope: createLayoutScope({ maxEntries: 1 }), maxEntries: 1, holds: new Set(), disposedSince: false },
    ],
    requests: [],
    hookScopes,
    asked: new Map(),
    timeouts: new Map(),
    stats: {},
  };
}

function remember(m: Model, scope: LayoutScope, graph: FlowGraph, options: LayoutOptions): void {
  const list = m.asked.get(scope) ?? m.asked.set(scope, []).get(scope)!;
  if (!list.some((a) => a.graph === graph && a.options === options)) list.push({ graph, options, signature: layoutSignature(graph, options) });
}

/** Everything a schedule can answer: the workers in the order they were started, then the engine. */
const sources = (m: Model): AnswerSource[] => [...FakeLayoutWorker.created, m.engine];
const sourceOf = (m: Model, index: number): AnswerSource | undefined => (index < 0 ? m.engine : FakeLayoutWorker.created[index]);
const sourceName = (index: number) => (index < 0 ? "the engine" : `worker ${index}`);

// ---------------------------------------------------------------------------
// Operations

type Op =
  | { kind: "mount"; strict: boolean; scenes: number; variant: number }
  | { kind: "change"; scenes?: number; variant?: number; clone?: boolean }
  | { kind: "unmount" }
  /** `source` is a worker's index, or -1 for the engine. */
  | { kind: "reply"; source: number; layout: number }
  | { kind: "fail"; source: number; layout: number }
  | { kind: "advance"; ms: number }
  | { kind: "direct"; scope: number; scenes: number; variant: number; signal: boolean }
  | { kind: "abort"; request: number }
  | { kind: "dispose"; scope: number }
  /** Several operations without settling between them: in one task, or a few microtasks apart (an answer being read while a component re-renders). */
  | { kind: "burst"; atomic: boolean; ops: Op[] };

type OpKind = Op["kind"] | "late";

const ALPHABET: readonly (readonly [OpKind, number])[] = [
  ["mount", 2], ["change", 5], ["unmount", 1.5], ["reply", 6], ["late", 1], ["fail", 1], ["advance", 2], ["direct", 2.5], ["abort", 1.5], ["dispose", 0.7], ["burst", 2],
];

const ADVANCES: readonly (readonly [number, number])[] = [[0, 1], [10, 3], [100, 3], [299, 1], [300, 2], [301, 1], [1000, 1]];

/** A concrete operation for a drawn kind; a kind that does not apply to the state becomes one that does. */
function drawOp(m: Model, kind: OpKind, inBurst = false): Op {
  const rng = m.rng;
  const alive = sources(m).filter((w) => !w.terminated && w.pending.length);
  const gone = sources(m).filter((w) => w.terminated && w.pending.length);
  const pendingWithSignal = m.requests.filter((q) => q.state === "pending" && q.controller && !q.aborted);
  switch (kind) {
    case "mount":
      if (m.hook.mounted) return drawOp(m, "change", inBurst);
      return { kind, strict: rng.chance(0.3), scenes: rng.int(0, m.pool.length - 1), variant: rng.int(0, m.variants.length - 1) };
    case "change": {
      if (!m.hook.mounted) return drawOp(m, "mount", inBurst);
      const what = rng.weighted([["scenes", 6], ["variant", 3], ["clone", 1]] as const);
      if (what === "clone") return { kind, clone: true };
      if (what === "variant") return { kind, variant: rng.int(0, m.variants.length - 1) };
      return { kind, scenes: rng.int(0, m.pool.length - 1) };
    }
    case "unmount":
      if (!m.hook.mounted) return drawOp(m, "mount", inBurst);
      return { kind };
    case "reply":
    case "fail": {
      if (!alive.length) return gone.length ? drawOp(m, "late", inBurst) : { kind: "advance", ms: 10 };
      const w = rng.pick(alive);
      return { kind, source: w.index, layout: rng.pick(w.pending) };
    }
    case "late": {
      if (!gone.length) return alive.length ? drawOp(m, "reply", inBurst) : { kind: "advance", ms: 10 };
      const w = rng.pick(gone);
      return { kind: "reply", source: w.index, layout: rng.pick(w.pending) };
    }
    case "advance":
      return { kind, ms: rng.weighted(ADVANCES) };
    case "direct":
      return { kind, scope: rng.int(-1, m.scopes.length - 1), scenes: rng.int(1, m.pool.length - 1), variant: rng.int(0, m.variants.length - 1), signal: rng.chance(0.8) };
    case "abort":
      if (!pendingWithSignal.length) return drawOp(m, "direct", inBurst);
      return { kind, request: rng.pick(pendingWithSignal).id };
    case "dispose":
      return { kind, scope: rng.int(0, m.scopes.length - 1) };
    case "burst": {
      if (inBurst) return drawOp(m, "advance", inBurst);
      const kinds = ALPHABET.filter(([k]) => k !== "burst");
      const atomic = rng.chance(0.5);
      // Half of the spaced bursts are an answer arriving while a component re-renders or a caller leaves.
      if (!atomic && rng.chance(0.5)) return { kind, atomic, ops: [drawOp(m, "reply", true), drawOp(m, rng.pick(["change", "unmount", "direct", "abort"] as const), true)] };
      return { kind, atomic, ops: Array.from({ length: rng.int(2, 3) }, () => drawOp(m, rng.weighted(kinds), true)) };
    }
  }
}

function describeOp(op: Op): string {
  switch (op.kind) {
    case "mount": return `mount${op.strict ? " in StrictMode" : ""} with scenes #${op.scenes} options #${op.variant}`;
    case "change": return op.clone ? "change: clone of the same scenes" : op.scenes !== undefined ? `change scenes to #${op.scenes}` : `change options to #${op.variant}`;
    case "unmount": return "unmount";
    case "reply": return `answer ${sourceName(op.source)} layout ${op.layout}`;
    case "fail": return `fail ${sourceName(op.source)} layout ${op.layout}`;
    case "advance": return `advance ${op.ms} ms`;
    case "direct": return `direct request to ${op.scope < 0 ? "layout()" : `scope ${op.scope}`} for scenes #${op.scenes} options #${op.variant}${op.signal ? " with signal" : ""}`;
    case "abort": return `abort request ${op.request}`;
    case "dispose": return `dispose scope ${op.scope}`;
    case "burst": return `${op.atomic ? "in one task" : "microtasks apart"}: ${op.ops.map(describeOp).join("; ")}`;
  }
}

function mountHook(m: Model): void {
  const model = m;
  const log = m.log;
  m.hook.handle = renderHook(
    ({ scenes, options }: HookProps) => {
      const result = useStableLayout(scenes, options);
      useEffect(() => {
        if (log[log.length - 1]?.result !== result) log.push({ result, signature: model.hook.signature, request: model.hook.request, mount: model.hook.mount });
      });
      return result;
    },
    { initialProps: { scenes: m.hook.scenes.value, options: m.hook.variant.options }, wrapper: m.hook.strict ? Strict : undefined },
  );
}

/** The hook is asked for its current scenes and options; a non-empty graph makes its scope hold the variant's worker URLs. */
function hookAsks(m: Model, clone = false): void {
  const { hook } = m;
  hook.request++;
  hook.signature = hook.scenes.union && layoutSignature(hook.scenes.union, hook.variant.options);
  if (hook.scenes.union?.nodes.length) for (const url of hook.variant.holds) hook.holds.add(url);
  const scenes = clone ? structuredClone(hook.scenes.value) : hook.scenes.value;
  if (hook.handle) hook.handle.rerender({ scenes, options: hook.variant.options });
  else mountHook(m);
  if (hook.signature !== undefined) m.timeouts.set(hook.signature, hook.variant.timeoutMs);
  for (const scope of m.hookScopes.slice(hook.scopesBefore)) if (hook.scenes.union) remember(m, scope, hook.scenes.union, hook.variant.options);
}

/**
 * Applies an operation. One drawn for an earlier state that no longer applies
 * (a burst changes the state between its operations) is skipped: `false`.
 */
function perform(m: Model, op: Op): boolean {
  const done = apply(m, op);
  count(m.stats, done ? `op ${op.kind}` : "op skipped");
  if (done && op.kind === "mount" && op.strict) count(m.stats, "mount in StrictMode");
  if (done && op.kind === "change" && op.clone) count(m.stats, "change to a clone");
  if (done && (op.kind === "reply" || op.kind === "fail") && op.source < 0) count(m.stats, "answer of the engine");
  if (done && op.kind === "reply" && sourceOf(m, op.source)!.terminated) count(m.stats, "answer after termination");
  return done;
}

function apply(m: Model, op: Op): boolean {
  const { hook } = m;
  switch (op.kind) {
    case "mount":
      if (hook.mounted) return false;
      hook.mounted = true;
      hook.strict = op.strict;
      hook.mount++;
      hook.scenes = m.pool[op.scenes];
      hook.variant = m.variants[op.variant];
      hook.holds = new Set();
      hook.handle = undefined;
      hook.scopesBefore = m.hookScopes.length;
      hookAsks(m);
      return true;
    case "change":
      if (!hook.mounted) return false;
      if (op.scenes !== undefined) hook.scenes = m.pool[op.scenes];
      if (op.variant !== undefined) hook.variant = m.variants[op.variant];
      hookAsks(m, op.clone);
      return true;
    case "unmount":
      if (!hook.mounted) return false;
      hook.handle!.unmount();
      hook.handle = undefined;
      hook.mounted = false;
      hook.holds = new Set();
      return true;
    case "reply": {
      const w = sourceOf(m, op.source);
      if (!w || w.layouts[op.layout]?.answered !== false) return false;
      const serial = m.replies.length;
      m.replies.push({ signature: w.layouts[op.layout].signature, source: w.index, terminatedBefore: w.terminated, step: m.step });
      w.answer(op.layout, serial);
      return true;
    }
    case "fail": {
      const w = sourceOf(m, op.source);
      if (!w || w.layouts[op.layout]?.answered !== false) return false;
      m.fails.add(w.layouts[op.layout].signature);
      w.fail(op.layout);
      return true;
    }
    case "advance":
      // Performed by the schedule runner, which awaits the clock.
      return true;
    case "direct": {
      const scenes = m.pool[op.scenes];
      const variant = m.variants[op.variant];
      const graph = scenes.union!;
      const controller = op.signal ? new AbortController() : undefined;
      const options: LayoutOptions = controller ? { ...variant.options, signal: controller.signal } : variant.options;
      const request: DirectRequest = { id: m.requests.length, scope: op.scope, scenes, variant, signature: layoutSignature(graph, variant.options), controller, mustReject: false, aborted: false, replaced: false, state: "pending" };
      m.requests.push(request);
      m.timeouts.set(request.signature, variant.timeoutMs);
      const single = !Array.isArray(scenes.value) && scenes.value !== undefined ? scenes.value : undefined;
      let promise: Promise<Positions>;
      if (op.scope < 0) promise = single ? layout(single, options) : layoutUnion(scenes.value as FlowGraph[], options);
      else {
        const s = m.scopes[op.scope];
        // A request for other inputs, or any request after a dispose, starts another job and replaces the pending ones.
        for (const other of m.requests) if (other !== request && other.scope === op.scope && other.state === "pending" && (s.disposedSince || other.signature !== request.signature)) other.replaced = true;
        s.disposedSince = false;
        if (graph.nodes.length) for (const url of variant.holds) s.holds.add(url);
        promise = single ? s.scope.layout(single, options) : s.scope.layoutUnion(scenes.value as FlowGraph[], options);
        remember(m, s.scope, single ?? graph, variant.options);
      }
      promise.then(
        (positions) => {
          request.state = "resolved";
          request.positions = positions;
        },
        (error: unknown) => {
          request.state = "rejected";
          request.error = error;
        },
      );
      return true;
    }
    case "abort": {
      const q = m.requests[op.request];
      if (!q?.controller || q.aborted || q.state !== "pending") return false;
      q.aborted = true;
      q.mustReject = !m.replies.some((r) => r?.signature === q.signature);
      q.controller.abort(new Error(`stopped request ${q.id}`));
      return true;
    }
    case "dispose":
      m.scopes[op.scope].scope.dispose();
      m.scopes[op.scope].holds.clear();
      m.scopes[op.scope].disposedSince = true;
      return true;
    case "burst":
      throw new Error("a burst is run operation by operation");
  }
}

// ---------------------------------------------------------------------------
// The invariants

function check(m: Model): string[] {
  const bad: string[] = [];
  const now = Date.now();
  const { hook } = m;
  const current = hook.mounted ? m.log[m.log.length - 1] : undefined;
  const timeoutOf = (signature: string) => m.timeouts.get(signature) ?? DEFAULT_TIMEOUT;
  /** A layout of these inputs reached its timeout before it was answered (or still unanswered). */
  const timedOut = (signature: string) => sources(m).some((w) => w.layouts.some((l) => l.signature === signature && (l.answeredAt ?? now) - l.postedAt >= timeoutOf(signature)));

  // The applied positions belong to the latest request and to no other; nothing from a terminated worker is shown.
  if (hook.mounted && !current) bad.push("latest request: the mounted hook has reported no result");
  if (current) {
    const r = current.result;
    const union = hook.scenes.union;
    if (!union) {
      if (r.status !== "idle" || r.positions !== undefined || r.provisional) bad.push(`latest request: without scenes the hook reports ${r.status} with${r.positions ? "" : "out"} positions`);
    } else {
      const want = ids(union);
      if (r.positions) {
        const have = Object.keys(r.positions.nodes).sort();
        if (!same(want, have)) bad.push(`latest request: the shown positions cover ${have.join(",") || "nothing"} but the request has ${want.join(",") || "nothing"}`);
      }
      if (r.status === "ready") {
        if (!r.positions || r.provisional || r.positions.engine === "provisional") bad.push("latest request: ready without a finished layout");
        else if (want.length) {
          const k = replyOf(r.positions);
          const reply = k ? m.replies[k] : undefined;
          if (!reply) bad.push(`latest request: the shown layout comes from no answer (${String(k)})`);
          else if (reply.signature !== hook.signature) bad.push(`latest request: the shown layout (answer ${k}) was computed for ${reply.signature} but the request is ${hook.signature}`);
          else if (reply.terminatedBefore) bad.push(`after termination: the shown layout is answer ${k}, which worker ${reply.source} sent after it was terminated`);
        }
      } else if (r.status === "pending") {
        if (!r.provisional || r.positions?.engine !== "provisional") bad.push(`pending: the hook reports pending with provisional ${r.provisional} and engine ${r.positions?.engine}`);
      } else if (r.status === "error") {
        const error = r.error as Error | undefined;
        if (r.positions !== undefined || r.provisional) bad.push("error: positions stay with an error that is not a LayoutUnavailableError");
        if (!error) bad.push("error: no error given");
        else if (error.name === "AbortError") bad.push(`after abort: the hook shows the abort of its own earlier request (${error.message})`);
        else if (/timed out/.test(error.message)) {
          if (!timedOut(hook.signature!)) bad.push(`timeout: the hook reports "${error.message}" but no layout of its inputs reached its timeout`);
        } else if (error.message === "engine down") {
          if (!m.fails.has(hook.signature!)) bad.push("error: the hook reports an engine error no worker sent for its inputs");
        } else bad.push(`error: unexpected error ${error.name}: ${error.message}`);
      } else bad.push(`latest request: with scenes the hook reports ${r.status}`);
    }
  }

  // Each request replaces the provisional scene at most once, and never goes back.
  const runs = new Map<string, HookResult[]>();
  for (const entry of m.log) {
    const key = `${entry.mount}/${entry.request}`;
    (runs.get(key) ?? runs.set(key, []).get(key)!).push(entry);
  }
  for (const [key, entries] of runs) {
    let settled = false;
    const finished = new Set<Positions>();
    for (const { result } of entries) {
      if (result.status === "pending") {
        if (settled) bad.push(`replaced once: request ${key} went back to pending after it was ${entries.find((e) => e.result.status !== "pending")?.result.status}`);
      } else {
        settled = true;
        if (result.status === "ready" && result.positions) finished.add(result.positions);
      }
    }
    if (finished.size > 1) bad.push(`replaced once: request ${key} showed ${finished.size} different finished layouts`);
  }

  // Nothing is applied after abort; a replaced or aborted request settles; what settles is right.
  for (const q of m.requests) {
    const where = `request ${q.id} (${q.scenes.name}, ${q.variant.name})`;
    if (q.state === "pending") {
      if (q.aborted) bad.push(`after abort: ${where} is still pending after its abort`);
      if (q.replaced) bad.push(`replaced: ${where} is still pending after a newer request replaced it`);
      if (q.scenes.union!.nodes.length === 0) bad.push(`liveness: ${where} for an empty graph is still pending`);
    } else if (q.state === "resolved") {
      if (q.mustReject) bad.push(`after abort: ${where} resolved although it was aborted before any answer for its inputs`);
      const p = q.positions!;
      if (!same(ids(q.scenes.union!), Object.keys(p.nodes).sort())) bad.push(`wrong inputs: ${where} resolved with positions of other nodes`);
      else if (q.scenes.union!.nodes.length) {
        const k = replyOf(p);
        const reply = k ? m.replies[k] : undefined;
        if (!reply) bad.push(`wrong inputs: ${where} resolved with positions from no answer (${String(k)})`);
        else if (reply.signature !== q.signature) bad.push(`wrong inputs: ${where} resolved with answer ${k}, computed for ${reply.signature}`);
        else if (reply.terminatedBefore) bad.push(`after termination: ${where} resolved with answer ${k}, which worker ${reply.source} sent after it was terminated`);
      }
    } else {
      const error = q.error as Error;
      const reason = q.controller?.signal.reason as Error | undefined;
      if (error === reason) continue;
      if (error?.name === "AbortError") {
        if (!q.replaced && !q.aborted) bad.push(`replaced: ${where} was rejected as replaced, but no newer request replaced it`);
      } else if (/timed out/.test(error?.message ?? "")) {
        if (!timedOut(q.signature)) bad.push(`timeout: ${where} reports "${error.message}" but no layout of its inputs reached its timeout`);
      } else if (error?.message === "engine down") {
        if (!m.fails.has(q.signature)) bad.push(`error: ${where} reports an engine error no worker sent for its inputs`);
      } else bad.push(`error: ${where} rejected with ${String(error)}`);
    }
  }

  // No worker is alive without a user: one worker per layout somebody waits for, one idle worker per URL a scope holds.
  // The engine cannot be interrupted: a layout it still runs for nobody is allowed, and it may run several at once.
  const waited = new Map<string, number>();
  const wait = (signature: string) => waited.set(signature, (waited.get(signature) ?? 0) + 1);
  if (current?.result.status === "pending" && hook.signature) wait(hook.signature);
  m.scopes.forEach((s, i) => {
    const signatures = new Set(m.requests.filter((q) => q.scope === i && q.state === "pending").map((q) => q.signature));
    if (signatures.size > 1) bad.push(`replaced: ${s.name} has pending requests for ${signatures.size} different inputs`);
    for (const signature of signatures) wait(signature);
  });
  for (const q of m.requests) if (q.scope < 0 && q.state === "pending") wait(q.signature);
  const holders = new Set<string>();
  if (hook.mounted) for (const url of hook.holds) holders.add(url);
  for (const s of m.scopes) for (const url of s.holds) holders.add(url);
  const running = new Map<string, number>();
  const engineRuns = new Map<string, number>();
  for (const k of m.engine.pending) {
    const { signature } = m.engine.layouts[k];
    engineRuns.set(signature, (engineRuns.get(signature) ?? 0) + 1);
  }
  const idle = new Map<string, number>();
  for (const w of FakeLayoutWorker.created) {
    if (w.postedAfterTermination) bad.push(`after termination: ${w.kind} worker ${w.index} was given ${w.postedAfterTermination} messages after it was terminated`);
    for (const k of w.pending) {
      const l = w.layouts[k];
      if (!w.terminated && now - l.postedAt >= timeoutOf(l.signature)) bad.push(`timeout: ${w.kind} worker ${w.index} still runs ${l.signature} ${now - l.postedAt} ms after it was asked, timeout ${timeoutOf(l.signature)} ms`);
    }
    if (w.terminated) continue;
    const pending = w.pending;
    if (pending.length > 1) bad.push(`no worker without a user: ${w.kind} worker ${w.index} runs ${pending.length} layouts at once`);
    if (pending.length) {
      const signature = w.layouts[pending[0]].signature;
      running.set(signature, (running.get(signature) ?? 0) + 1);
    } else {
      if (!holders.has(w.url)) bad.push(`no worker without a user: idle ${w.kind} worker ${w.index} is alive but no scope holds its URL`);
      idle.set(w.url, (idle.get(w.url) ?? 0) + 1);
    }
  }
  for (const [signature, n] of running) if (n > (waited.get(signature) ?? 0)) bad.push(`no worker without a user: ${n} workers run ${signature} but ${waited.get(signature) ?? 0} requests wait for it`);
  for (const [signature, n] of waited) {
    const runs = (running.get(signature) ?? 0) + (engineRuns.get(signature) ?? 0);
    if (n > runs) bad.push(`liveness: ${n} requests wait for ${signature} but ${runs} workers or engine runs compute it`);
  }
  for (const [url, n] of idle) if (n > 1) bad.push(`no worker without a user: ${n} idle workers for ${url}`);

  // The scope's cache never exceeds its bound and never returns a layout for different inputs.
  const scopes: { name: string; scope: LayoutScope; maxEntries: number }[] = [
    ...m.scopes,
    ...m.hookScopes.map((scope, i) => ({ name: `hook scope ${i}`, scope, maxEntries: DEFAULT_ENTRIES })),
  ];
  for (const { name, scope, maxEntries } of scopes) {
    if (scope.size > maxEntries) bad.push(`cache bound: ${name} keeps ${scope.size} layouts, bound ${maxEntries}`);
    for (const { graph, options, signature } of m.asked.get(scope) ?? []) {
      const known = layoutModule.knownLayout(scope, graph, options);
      if (!known) continue;
      if (!same(ids(graph), Object.keys(known.nodes).sort())) bad.push(`wrong inputs: ${name} knows positions of other nodes for ${signature}`);
      if (!graph.nodes.length) continue;
      const k = replyOf(known);
      const reply = k ? m.replies[k] : undefined;
      if (!reply) bad.push(`wrong inputs: ${name} knows a layout for ${signature} from no answer (${String(k)})`);
      else if (reply.signature !== signature) bad.push(`wrong inputs: ${name} returns answer ${k}, computed for ${reply.signature}, for ${signature}`);
      else if (reply.terminatedBefore) bad.push(`after termination: ${name} keeps answer ${k}, which worker ${reply.source} sent after it was terminated`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Running a schedule

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Runs an operation and says what it did. */
async function run(m: Model, op: Op): Promise<string> {
  if (op.kind === "advance") {
    await advance(op.ms);
    return describeOp(op);
  }
  if (op.kind === "burst") {
    const done: string[] = [];
    for (const inner of op.ops) {
      if (!op.atomic) done.push(await run(m, inner));
      else if (inner.kind === "advance") {
        vi.advanceTimersByTime(inner.ms);
        done.push(describeOp(inner));
      } else done.push(perform(m, inner) ? describeOp(inner) : `${describeOp(inner)} (skipped: no longer applies)`);
    }
    return `${op.atomic ? "in one task" : "microtasks apart"}: ${done.join("; ")}`;
  }
  return perform(m, op) ? describeOp(op) : `${describeOp(op)} (skipped: no longer applies)`;
}

/** Ends everything a schedule left running, so that the next one starts from nothing. */
async function windDown(m: Model): Promise<void> {
  if (m.hook.mounted) perform(m, { kind: "unmount" });
  for (const q of m.requests) if (q.state === "pending" && q.controller && !q.aborted) perform(m, { kind: "abort", request: q.id });
  await settle();
  for (const w of sources(m)) for (const k of w.pending) perform(m, { kind: "reply", source: w.index, layout: k });
  await settle();
  for (const s of m.scopes) s.scope.dispose();
  for (const s of m.scopes) s.holds.clear();
  await settle();
}

interface Outcome {
  steps: number;
  trace: string[];
  stats: Record<string, number>;
}

/** What the schedule's requests, answers and workers went through. */
function summarise(m: Model): Record<string, number> {
  const stats = { ...m.stats };
  const runs = new Map<string, HookResult[]>();
  for (const entry of m.log) {
    const key = `${entry.mount}/${entry.request}`;
    (runs.get(key) ?? runs.set(key, []).get(key)!).push(entry);
  }
  for (const entries of runs.values()) {
    const first = entries[0].result;
    const last = entries[entries.length - 1].result;
    if (first.status === "idle") count(stats, "hook idle");
    else if (first.status === "ready") count(stats, "hook ready at once from a known layout");
    else if (last.status === "ready") count(stats, "hook provisional, then the layout");
    else if (last.status === "error") count(stats, /timed out/.test(last.error?.message ?? "") ? "hook error: timeout" : "hook error: engine");
    else count(stats, "hook provisional until the end");
  }
  for (const q of m.requests) {
    if (q.state === "resolved") count(stats, "direct request resolved");
    else if (q.state === "pending") count(stats, "direct request pending at the end");
    else {
      const error = q.error as Error;
      count(stats, error === q.controller?.signal.reason ? "direct request aborted" : error?.name === "AbortError" ? "direct request replaced" : /timed out/.test(error?.message ?? "") ? "direct request timed out" : "direct request engine error");
    }
  }
  const end = Date.now();
  for (const w of FakeLayoutWorker.created) {
    count(stats, `${w.kind} workers`);
    if (w.layouts.length > 1) count(stats, "workers reused for another layout");
  }
  count(stats, "layouts given to the engine", m.engine.layouts.length);
  for (const w of sources(m)) for (const l of w.layouts) if ((l.answeredAt ?? end) - l.postedAt >= (m.timeouts.get(l.signature) ?? DEFAULT_TIMEOUT)) count(stats, "layouts that timed out");
  return stats;
}

async function runSchedule(seed: number, length: number, hookScopes: LayoutScope[]): Promise<Outcome> {
  vi.useFakeTimers({ now: 0 });
  FakeLayoutWorker.created = [];
  hookScopes.length = 0;
  const m = newModel(seed, hookScopes);
  const plan = schedule(ALPHABET, seed, { length, minGap: 0, maxGap: 100 });
  const trace: string[] = [];
  try {
    for (const { step, at, event } of plan) {
      m.step = step;
      if (at > Date.now()) await advance(at - Date.now());
      const op = drawOp(m, event);
      const did = await run(m, op);
      trace.push(`${step} @${at}ms: ${did}`);
      await settle();
      const bad = check(m);
      expect(bad, `${caseLabel(seed, `step ${step}: ${did}`)}\n${trace.join("\n")}`).toEqual([]);
    }
    const stats = summarise(m);
    await windDown(m);
    const bad = check(m);
    expect(bad, `${caseLabel(seed, "after the schedule ended")}\n${trace.join("\n")}`).toEqual([]);
    expect(FakeLayoutWorker.created.filter((w) => !w.terminated), caseLabel(seed, "workers alive after everything ended")).toEqual([]);
    return { steps: plan.length, trace, stats };
  } finally {
    if (m.hook.handle) m.hook.handle.unmount();
    for (const s of m.scopes) s.scope.dispose();
    // Testing Library keeps every root until it cleans up, and a root keeps the model through the hook's closure.
    cleanup();
    vi.mocked(layoutModule.createLayoutScope).mockClear();
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}

const hookScopes: LayoutScope[] = [];

beforeAll(async () => {
  // Loaded once here, so that the layout module's import of it resolves in microtasks under fake timers.
  await import("elkjs/lib/elk-api.js");
});

beforeEach(() => {
  vi.stubGlobal("Worker", FakeLayoutWorker);
  const real = layoutModule.createLayoutScope;
  vi.spyOn(layoutModule, "createLayoutScope").mockImplementation((options) => {
    const scope = real(options);
    hookScopes.push(scope);
    return scope;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the layout lifecycle under random schedules", () => {
  it("keeps every invariant over the hook and the layout module", async () => {
    let steps = 0;
    const total: Record<string, number> = {};
    const all = seeds(caseCount(500));
    for (const seed of all) {
      const outcome = await runSchedule(seed, 30 + (seed % 16), hookScopes);
      steps += outcome.steps;
      for (const [what, n] of Object.entries(outcome.stats)) count(total, what, n);
    }
    expect(steps).toBeGreaterThanOrEqual(all.length * 30);
    console.log(`${all.length} schedules (seeds ${all[0]}–${all[all.length - 1]}), ${steps} steps:\n` + Object.entries(total).sort().map(([what, n]) => `  ${what}: ${n}`).join("\n"));
  }, 600000);
});
