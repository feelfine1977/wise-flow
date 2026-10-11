/**
 * The map under random schedules. `ProcessMap` lays out through the real hook
 * and layout module with fake workers whose answers the schedule delivers in
 * any order, on a fake clock; the schedule selects by click and keyboard,
 * moves the keyboard position, opens and closes the actions menu, changes the
 * graph and the layout options, lets the clock and the arrival's frames pass,
 * mounts the map twice as StrictMode does and unmounts it. After every step:
 * the nodes on the map are the graph's; a finished layout on the map is the
 * answer for the map's current inputs and does not change again for the same
 * request; selection, keyboard position, input focus and the focus of paths
 * are the same after every step that is not an interaction; and no worker is
 * alive without a user.
 */
import { type RenderResult, act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowGraph, LayoutOptions, Positions } from "../../src/index";
import { ProcessMap, groupNodeId } from "../../src/react/index";
import { families } from "../support/graphs";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { schedule } from "../support/schedules";
import { FakeLayoutWorker, layoutSignature, replyOf } from "../support/workers";

const workers: LayoutOptions = { elkWorkerUrl: FakeLayoutWorker.elkUrl, dagreWorkerUrl: FakeLayoutWorker.dagreUrl };

interface Variant {
  name: string;
  options: LayoutOptions;
}

/** Option sets with their own geometry each; the first two differ in the direction alone. */
const VARIANTS: Variant[] = [
  { name: "auto", options: { ...workers } },
  { name: "auto down", options: { ...workers, direction: "DOWN" } },
  { name: "elk left", options: { ...workers, engine: "elk", direction: "LEFT" } },
  { name: "auto tight 300 ms", options: { ...workers, spacing: { node: 10, layer: 30 }, timeoutMs: 300 } },
];

/** Graphs with overlapping ids, so that a selection can outlive a change of graph. */
function graphPool(seed: number): { name: string; graph: FlowGraph }[] {
  return [
    { name: "layered 6", graph: families.layered(6, seed) },
    { name: "chain 4", graph: families.chain(4, seed) },
    { name: "stages 6", graph: families.stages(6, seed) },
  ];
}

const KEYS = ["Home", "End", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", " ", "Escape", "Enter"];

// ---------------------------------------------------------------------------
// The model

interface Reply {
  signature: string;
  worker: number;
  terminatedBefore: boolean;
}

/** What a step that is not an interaction must leave alone. */
interface Snapshot {
  selected: string;
  active: string;
  hasFocus: boolean;
  paths: boolean;
  selects: number;
  focusChanges: number;
  /** The map shows an error and no elements: what the elements would show cannot be read. */
  blank: boolean;
}

interface Model {
  rng: Random;
  pool: { name: string; graph: FlowGraph }[];
  mounted: boolean;
  strict: boolean;
  graph: number;
  variant: number;
  reduced: boolean;
  fit: boolean;
  focus: string | undefined;
  /** Counts the map's requests: a mount and every change of graph or options. */
  request: number;
  /** Where the nodes were drawn when a request first reached `ready`. */
  readyBoxes: Map<number, string>;
  replies: (Reply | undefined)[];
  fails: Set<string>;
  timeouts: Map<string, number>;
  selects: number;
  focusChanges: number;
  handle?: Pick<RenderResult, "container" | "rerender" | "unmount">;
  stats: Record<string, number>;
}

function count(stats: Record<string, number>, what: string, by = 1): void {
  stats[what] = (stats[what] ?? 0) + by;
}

function newModel(seed: number): Model {
  return {
    // `schedule` draws the kinds and times from a stream of the same seed; a fork keeps the operations' choices independent of them.
    rng: createRandom(seed).fork(),
    pool: graphPool(seed),
    mounted: false,
    strict: false,
    graph: 0,
    variant: 0,
    reduced: true,
    fit: true,
    focus: undefined,
    request: 0,
    readyBoxes: new Map(),
    replies: [undefined],
    fails: new Set(),
    timeouts: new Map(),
    selects: 0,
    focusChanges: 0,
    stats: {},
  };
}

const signatureOf = (m: Model) => layoutSignature(m.pool[m.graph].graph, VARIANTS[m.variant].options);

function reducedMotion(reduce: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

function element(m: Model) {
  return (
    <div style={{ width: 800, height: 600 }}>
      <ProcessMap
        graph={m.pool[m.graph].graph}
        layout={VARIANTS[m.variant].options}
        fitView={m.fit}
        defaultFocus={m.focus}
        controls={false}
        legend={false}
        onSelect={() => m.selects++}
        onFocusChange={() => m.focusChanges++}
      />
    </div>
  );
}

const mapOf = (m: Model) => m.handle?.container.querySelector<HTMLElement>(".wf-process-map") ?? null;

function snapshot(m: Model): Snapshot {
  const container = m.handle?.container;
  const map = mapOf(m);
  return {
    selected: container ? [...container.querySelectorAll(".react-flow__node.selected, .react-flow__edge.selected")].map((e) => e.getAttribute("data-id") ?? "").sort().join(",") : "",
    active: map?.getAttribute("aria-activedescendant") ?? "",
    hasFocus: !!map && document.activeElement === map,
    paths: !!container?.querySelector(".wf-process-map__side"),
    selects: m.selects,
    focusChanges: m.focusChanges,
    blank: map?.getAttribute("data-layout-status") === "error",
  };
}

// ---------------------------------------------------------------------------
// Operations

type Op =
  | { kind: "mount"; strict: boolean; graph: number; variant: number; focus: string | undefined; reduced: boolean; fit: boolean }
  | { kind: "click"; node: string; multi: boolean }
  | { kind: "key"; key: string; shift: boolean }
  | { kind: "reply"; worker: number; layout: number }
  | { kind: "fail"; worker: number; layout: number }
  | { kind: "advance"; ms: number }
  | { kind: "change"; graph?: number; variant?: number }
  | { kind: "unmount" };

type OpKind = Op["kind"] | "late";

const ALPHABET: readonly (readonly [OpKind, number])[] = [
  ["mount", 2], ["click", 4], ["key", 4], ["reply", 6], ["late", 1], ["fail", 1], ["advance", 3], ["change", 2.5], ["unmount", 1.5],
];

const ADVANCES: readonly (readonly [number, number])[] = [[16, 4], [50, 2], [100, 2], [320, 2], [400, 1], [1000, 1]];

function drawOp(m: Model, kind: OpKind): Op {
  const rng = m.rng;
  const alive = FakeLayoutWorker.created.filter((w) => !w.terminated && w.pending.length);
  const gone = FakeLayoutWorker.created.filter((w) => w.terminated && w.pending.length);
  switch (kind) {
    case "mount": {
      if (m.mounted) return drawOp(m, "change");
      const graph = rng.int(0, m.pool.length - 1);
      const focus = rng.chance(0.4) ? rng.pick(m.pool[graph].graph.nodes).id : undefined;
      return { kind, strict: rng.chance(0.3), graph, variant: rng.int(0, VARIANTS.length - 1), focus, reduced: rng.chance(0.6), fit: rng.chance(0.7) };
    }
    case "click":
    case "key":
      if (!m.mounted) return drawOp(m, "mount");
      if (kind === "click") return { kind, node: rng.pick(m.pool[m.graph].graph.nodes).id, multi: rng.chance(0.25) };
      return { kind, key: rng.pick(KEYS), shift: rng.chance(0.2) };
    case "reply":
    case "fail": {
      if (!alive.length) return gone.length ? drawOp(m, "late") : { kind: "advance", ms: 16 };
      const w = rng.pick(alive);
      return { kind, worker: w.index, layout: rng.pick(w.pending) };
    }
    case "late": {
      if (!gone.length) return alive.length ? drawOp(m, "reply") : { kind: "advance", ms: 16 };
      const w = rng.pick(gone);
      return { kind: "reply", worker: w.index, layout: rng.pick(w.pending) };
    }
    case "advance":
      return { kind, ms: rng.weighted(ADVANCES) };
    case "change":
      if (!m.mounted) return drawOp(m, "mount");
      return rng.chance(0.7) ? { kind, graph: rng.int(0, m.pool.length - 1) } : { kind, variant: rng.int(0, VARIANTS.length - 1) };
    case "unmount":
      if (!m.mounted) return drawOp(m, "mount");
      return { kind };
  }
}

function describeOp(op: Op): string {
  switch (op.kind) {
    case "mount": return `mount${op.strict ? " in StrictMode" : ""} graph #${op.graph} options #${op.variant}${op.focus ? ` focus ${op.focus}` : ""}${op.reduced ? " reduced motion" : ""}${op.fit ? "" : " no fit"}`;
    case "click": return `${op.multi ? "shift-click" : "click"} ${op.node}`;
    case "key": return `key ${op.shift ? "Shift+" : ""}${op.key === " " ? "Space" : op.key}`;
    case "reply": return `answer worker ${op.worker} layout ${op.layout}`;
    case "fail": return `fail worker ${op.worker} layout ${op.layout}`;
    case "advance": return `advance ${op.ms} ms`;
    case "change": return op.graph !== undefined ? `change graph to #${op.graph}` : `change options to #${op.variant}`;
    case "unmount": return "unmount";
  }
}

/** Whether the operation is the user's or the host's doing; everything else must leave the map's state alone. */
const interaction = (op: Op) => op.kind === "mount" || op.kind === "click" || op.kind === "key" || op.kind === "change" || op.kind === "unmount";

function perform(m: Model, op: Op): boolean {
  switch (op.kind) {
    case "mount": {
      if (m.mounted) return false;
      Object.assign(m, { mounted: true, strict: op.strict, graph: op.graph, variant: op.variant, focus: op.focus, reduced: op.reduced, fit: op.fit });
      m.request++;
      m.timeouts.set(signatureOf(m), VARIANTS[m.variant].options.timeoutMs ?? 20000);
      reducedMotion(op.reduced);
      m.handle = render(element(m), { reactStrictMode: op.strict });
      if (op.strict) count(m.stats, "mount in StrictMode");
      return true;
    }
    case "click": {
      const node = m.handle?.container.querySelector(`.react-flow__node[data-id="${op.node}"]`);
      if (!node) return false;
      fireEvent.click(node, op.multi ? { shiftKey: true } : {});
      return true;
    }
    case "key": {
      const map = mapOf(m);
      if (!map) return false;
      if (document.activeElement !== map) map.focus();
      fireEvent.keyDown(map, { key: op.key, shiftKey: op.shift });
      return true;
    }
    case "reply": {
      const w = FakeLayoutWorker.created[op.worker];
      if (!w || w.layouts[op.layout]?.answered !== false) return false;
      const serial = m.replies.length;
      m.replies.push({ signature: w.layouts[op.layout].signature, worker: w.index, terminatedBefore: w.terminated });
      if (w.terminated) count(m.stats, "answer after termination");
      w.answer(op.layout, serial);
      return true;
    }
    case "fail": {
      const w = FakeLayoutWorker.created[op.worker];
      if (!w || w.layouts[op.layout]?.answered !== false) return false;
      m.fails.add(w.layouts[op.layout].signature);
      w.fail(op.layout);
      return true;
    }
    case "advance":
      return true;
    case "change": {
      if (!m.mounted) return false;
      if (op.graph !== undefined ? op.graph === m.graph : op.variant === m.variant) return false;
      if (op.graph !== undefined) m.graph = op.graph;
      else m.variant = op.variant!;
      m.request++;
      m.timeouts.set(signatureOf(m), VARIANTS[m.variant].options.timeoutMs ?? 20000);
      m.handle!.rerender(element(m));
      return true;
    }
    case "unmount":
      if (!m.mounted) return false;
      m.handle!.unmount();
      m.handle = undefined;
      m.mounted = false;
      return true;
  }
}

// ---------------------------------------------------------------------------
// The invariants

function translateY(node: Element): number {
  const match = (node as HTMLElement).style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/);
  return match ? Number(match[2]) : NaN;
}

function check(m: Model, before: Snapshot, op: Op): string[] {
  const bad: string[] = [];
  const now = Date.now();
  const timeoutOf = (signature: string) => m.timeouts.get(signature) ?? 20000;
  const timedOut = (signature: string) => FakeLayoutWorker.created.some((w) => w.layouts.some((l) => l.signature === signature && (l.answeredAt ?? now) - l.postedAt >= timeoutOf(signature)));

  if (m.mounted) {
    const container = m.handle!.container;
    const map = mapOf(m);
    const { graph } = m.pool[m.graph];
    const signature = signatureOf(m);
    if (!map) bad.push("the map is mounted but not in the document");
    else {
      const status = map.getAttribute("data-layout-status");
      const engine = map.getAttribute("data-engine");
      const drawn = [...container.querySelectorAll(".react-flow__node")];
      const drawnIds = drawn.map((e) => e.getAttribute("data-id") ?? "").sort();
      const wantIds = [...graph.nodes.map((n) => n.id), ...(graph.groups ?? []).map((g) => groupNodeId(g.id))].sort();
      if (status === "error") {
        const error = container.querySelector("[role='alert']")?.textContent ?? "";
        if (!error) bad.push("error: the map reports an error but shows no alert");
        else if (/timed out/.test(error) ? !timedOut(signature) : !(error.includes("engine down") && m.fails.has(signature))) bad.push(`error: the map shows "${error}" but no layout of its inputs failed that way`);
        if (drawn.length) bad.push(`error: the map still draws ${drawn.length} nodes beside an error that is not a LayoutUnavailableError`);
      } else {
        if (status !== "pending" && status !== "ready") bad.push(`status: the map reports ${status}`);
        if (drawnIds.join(",") !== wantIds.join(",")) bad.push(`latest request: the map draws ${drawnIds.join(",") || "nothing"} but the graph has ${wantIds.join(",")}`);
        if (status === "ready") {
          if (engine !== "elk" && engine !== "dagre") bad.push(`ready: the map is ready with engine ${engine}`);
          // Every box's y is the answer's serial number times 1000; a node inside a group is drawn at 0 within it.
          const ys = drawn.map(translateY);
          const boxes = Object.fromEntries(ys.map((y, i) => [String(i), { x: 0, y, width: 0, height: 0 }]));
          const k = ys.length ? replyOf({ nodes: boxes, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, engine: "elk", direction: "RIGHT" } satisfies Positions) : undefined;
          const top = new Set(ys.filter((y) => y >= 1000));
          const nested = ys.filter((y) => y < 1000);
          const reply = top.size === 1 ? m.replies[[...top][0] / 1000] : undefined;
          if (top.size !== 1 || nested.some((y) => y !== 0)) bad.push(`latest request: the drawn boxes come from no single answer (y ${ys.join(",")}; ${String(k)})`);
          else if (!reply) bad.push(`latest request: the drawn layout comes from no answer (y ${[...top][0]})`);
          else if (reply.signature !== signature) bad.push(`latest request: the map shows a layout computed for ${reply.signature} but its inputs are ${signature}`);
          else if (reply.terminatedBefore) bad.push(`after termination: the map shows an answer worker ${reply.worker} sent after it was terminated`);
          const where = ys.join(",");
          const first = m.readyBoxes.get(m.request);
          if (first === undefined) {
            m.readyBoxes.set(m.request, where);
            if (!interaction(op) && (before.selected || before.active)) count(m.stats, "arrivals with a selection or keyboard position to keep");
          } else if (first !== where) bad.push(`replaced once: request ${m.request} was drawn at ${first} when it became ready and now at ${where}`);
        } else if (m.readyBoxes.has(m.request)) bad.push(`replaced once: request ${m.request} went back to ${status} after it was ready`);
      }
    }
  }

  // Selection, keyboard position, input focus and the focus of paths survive everything that is not an interaction.
  // A map that shows a layout error draws no elements, so their state is read only while they are drawn.
  if (!interaction(op)) {
    const after = snapshot(m);
    const drawnBoth = !before.blank && !after.blank;
    for (const key of Object.keys(after) as (keyof Snapshot)[]) {
      if (key === "blank" || (!drawnBoth && (key === "selected" || key === "active" || key === "paths"))) continue;
      if (after[key] !== before[key]) bad.push(`survives: ${key} changed from ${JSON.stringify(before[key])} to ${JSON.stringify(after[key])} through "${describeOp(op)}"`);
    }
  }

  // No worker is alive without a user: at most one layout runs for the map, one idle worker per URL while it is mounted.
  const busy: FakeLayoutWorker[] = [];
  const idle = new Map<string, number>();
  for (const w of FakeLayoutWorker.created) {
    if (w.postedAfterTermination) bad.push(`after termination: ${w.kind} worker ${w.index} was given ${w.postedAfterTermination} messages after it was terminated`);
    for (const k of w.pending) {
      const l = w.layouts[k];
      if (!w.terminated && now - l.postedAt >= timeoutOf(l.signature)) bad.push(`timeout: ${w.kind} worker ${w.index} still runs ${l.signature} ${now - l.postedAt} ms after it was asked, timeout ${timeoutOf(l.signature)} ms`);
    }
    if (w.terminated) continue;
    if (w.pending.length) busy.push(w);
    else idle.set(w.url, (idle.get(w.url) ?? 0) + 1);
  }
  if (!m.mounted && (busy.length || idle.size)) bad.push(`no worker without a user: ${busy.length} running and ${[...idle.values()].reduce((a, b) => a + b, 0)} idle workers are alive after the map unmounted`);
  if (busy.length > 1) bad.push(`no worker without a user: ${busy.length} workers run layouts for one map`);
  if (m.mounted && busy.length === 1 && busy[0].layouts[busy[0].pending[0]].signature !== signatureOf(m)) bad.push(`no worker without a user: a worker runs ${busy[0].layouts[busy[0].pending[0]].signature} but the map asks for ${signatureOf(m)}`);
  for (const [url, n] of idle) if (n > 1) bad.push(`no worker without a user: ${n} idle workers for ${url}`);
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

async function runSchedule(seed: number, length: number): Promise<{ steps: number; stats: Record<string, number> }> {
  vi.useFakeTimers({ now: 0 });
  FakeLayoutWorker.created = [];
  const m = newModel(seed);
  const plan = schedule(ALPHABET, seed, { length, minGap: 0, maxGap: 100 });
  const trace: string[] = [];
  try {
    for (const { step, at, event } of plan) {
      if (at > Date.now()) await advance(at - Date.now());
      const op = drawOp(m, event);
      const before = snapshot(m);
      let did: string;
      if (op.kind === "advance") {
        await advance(op.ms);
        did = describeOp(op);
      } else did = perform(m, op) ? describeOp(op) : `${describeOp(op)} (skipped: no longer applies)`;
      count(m.stats, did.endsWith("applies)") ? "op skipped" : `op ${op.kind}`);
      trace.push(`${step} @${at}ms: ${did}`);
      await settle();
      const bad = check(m, before, op);
      expect(bad, `${caseLabel(seed, `step ${step}: ${did}`)}\n${trace.join("\n")}`).toEqual([]);
    }
    count(m.stats, "requests", m.request);
    count(m.stats, "requests whose layout arrived", m.readyBoxes.size);
    count(m.stats, "selections reported to the host", m.selects);
    count(m.stats, "focus changes reported to the host", m.focusChanges);
    for (const w of FakeLayoutWorker.created) count(m.stats, `${w.kind} workers`);
    if (m.mounted) perform(m, { kind: "unmount" });
    await settle();
    const bad = check(m, snapshot(m), { kind: "unmount" });
    expect(bad, `${caseLabel(seed, "after the schedule ended")}\n${trace.join("\n")}`).toEqual([]);
    return { steps: plan.length, stats: m.stats };
  } finally {
    m.handle?.unmount();
    // Testing Library keeps every root until it cleans up, and a root keeps the model through the map's callbacks.
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}

beforeAll(async () => {
  await import("elkjs/lib/elk-api.js");
});

beforeEach(() => {
  vi.stubGlobal("Worker", FakeLayoutWorker);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the map under random schedules", () => {
  it("keeps its selection and focus through every arrival and shows only the latest request's layout", async () => {
    let steps = 0;
    const total: Record<string, number> = {};
    const all = seeds(caseCount(12));
    for (const seed of all) {
      const outcome = await runSchedule(seed, 30 + (seed % 11));
      steps += outcome.steps;
      for (const [what, n] of Object.entries(outcome.stats)) count(total, what, n);
    }
    expect(steps).toBeGreaterThanOrEqual(all.length * 30);
    console.log(`${all.length} map schedules (seeds ${all[0]}–${all[all.length - 1]}), ${steps} steps:\n` + Object.entries(total).sort().map(([what, n]) => `  ${what}: ${n}`).join("\n"));
  }, 600000);
});
