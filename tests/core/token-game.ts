import { type FlowEdge, type FlowGraph, hasTag } from "../../src/index";

/**
 * A token game over the sequence flows of a FlowGraph with gateways, written
 * for the tests from the BPMN execution rules, independently of the code that
 * builds or checks the models:
 *
 * - the case starts with one token on each outgoing flow of the start node;
 * - a task or an event takes one token from one incoming flow and puts one on
 *   every outgoing flow (several outgoing flows without a gateway are all
 *   taken, as BPMN reads flows without a condition); without outgoing flows
 *   the token leaves the process;
 * - an exclusive gateway (xor, or untagged) takes one token from one incoming
 *   flow and puts it on one outgoing flow of its choice;
 * - a parallel gateway (and) waits for a token on every incoming flow, takes
 *   one from each and puts one on every outgoing flow.
 *
 * Flows tagged `message` or `association` carry no tokens; constraint edges
 * are not flows. Inclusive and other gateways are not modelled.
 *
 * A state is the number of tokens per flow. The exploration visits every
 * reachable state up to `limit` and does not continue from a state with more
 * than one token on a flow, so it stays bounded.
 */
export interface TokenGame {
  /** Reachable states visited, including the start and the empty state. */
  states: number;
  /** Every reachable state was visited within the limit. */
  complete: boolean;
  /** The empty state (every token has left through an end) is reachable. */
  completes: boolean;
  /** Reachable states in which no step is possible while tokens are left, as lists of the marked flows. */
  stuck: string[][];
  /** Reachable states with more than one token on a flow, as lists of the overfull flows. */
  unsafe: string[][];
  /**
   * Reachable states, neither stuck nor unsafe, from which no sequence of
   * steps leads to the empty state, as lists of the marked flows: the case
   * can run on but never end. A state that can reach an unexplored state
   * (unsafe, or beyond the limit) is not counted.
   */
  trapped: string[][];
  /** Nodes that take a token in no reachable state, in graph order. */
  dead: string[];
}

const carriesTokens = (e: FlowEdge) => e.kind !== "constraint" && !hasTag(e, "message") && !hasTag(e, "association");

export function playTokens(graph: FlowGraph, options: { limit?: number } = {}): TokenGame {
  const limit = options.limit ?? 100_000;
  const flows = graph.edges.filter(carriesTokens);
  const index = new Map(flows.map((e, i) => [e.id, i]));
  const ins = new Map<string, number[]>();
  const outs = new Map<string, number[]>();
  for (const n of graph.nodes) {
    ins.set(n.id, []);
    outs.set(n.id, []);
  }
  for (const e of flows) {
    outs.get(e.source)!.push(index.get(e.id)!);
    ins.get(e.target)!.push(index.get(e.id)!);
  }
  const starts = graph.nodes.filter((n) => n.kind === "event" && hasTag(n, "start"));
  if (starts.length !== 1) throw new Error(`token game: expected one start event, found ${starts.length}`);
  for (const n of graph.nodes) {
    if (n.kind === "gateway" && ["or", "complex", "eventBased"].some((t) => hasTag(n, t))) {
      throw new Error(`token game: gateway ${n.id} is neither exclusive nor parallel`);
    }
  }

  const key = (m: number[]) => m.join(",");
  const first = new Array<number>(flows.length).fill(0);
  for (const f of outs.get(starts[0].id)!) first[f]++;
  const fired = new Set<string>([starts[0].id]);
  // Every visited state, its successors, and whether it was explored (not unsafe, not beyond the limit).
  const states: number[][] = [first];
  const numberOf = new Map([[key(first), 0]]);
  const successors: number[][] = [];
  const explored: boolean[] = [];
  const result: TokenGame = { states: 0, complete: true, completes: false, stuck: [], unsafe: [], trapped: [], dead: [] };
  const named = (m: number[], test: (count: number) => boolean) => m.flatMap((c, i) => (test(c) ? [flows[i].id] : []));
  let empty = -1;

  for (let at = 0; at < states.length; at++) {
    const m = states[at];
    successors[at] = [];
    explored[at] = false;
    result.states++;
    if (m.some((c) => c > 1)) {
      result.unsafe.push(named(m, (c) => c > 1));
      continue;
    }
    explored[at] = true;
    if (m.every((c) => c === 0)) {
      result.completes = true;
      empty = at;
      continue;
    }
    const next: number[][] = [];
    const step = (node: string, take: number[], put: number[]) => {
      const n = [...m];
      for (const f of take) n[f]--;
      for (const f of put) n[f]++;
      next.push(n);
      fired.add(node);
    };
    for (const node of graph.nodes) {
      const inFlows = ins.get(node.id)!;
      const outFlows = outs.get(node.id)!;
      if (node.kind === "gateway" && hasTag(node, "and")) {
        if (inFlows.length && inFlows.every((f) => m[f] > 0)) step(node.id, inFlows, outFlows);
      } else if (node.kind === "gateway") {
        for (const f of inFlows) {
          if (m[f] === 0) continue;
          if (outFlows.length === 0) step(node.id, [f], []);
          for (const o of outFlows) step(node.id, [f], [o]);
        }
      } else {
        for (const f of inFlows) {
          if (m[f] > 0) step(node.id, [f], outFlows);
        }
      }
    }
    if (next.length === 0) result.stuck.push(named(m, (c) => c > 0));
    for (const n of next) {
      const k = key(n);
      let number = numberOf.get(k);
      if (number === undefined) {
        if (states.length >= limit) {
          result.complete = false;
          continue;
        }
        number = states.length;
        numberOf.set(k, number);
        states.push(n);
      }
      successors[at].push(number);
    }
  }

  // States that can end: the empty state, every unexplored state (unknown), and their predecessors.
  const predecessors: number[][] = states.map(() => []);
  successors.forEach((list, from) => list.forEach((to) => predecessors[to].push(from)));
  const canEnd = states.map((_, i) => i === empty || !explored[i]);
  const queue = canEnd.flatMap((ok, i) => (ok ? [i] : []));
  for (let at = 0; at < queue.length; at++) {
    for (const from of predecessors[queue[at]]) {
      if (canEnd[from]) continue;
      canEnd[from] = true;
      queue.push(from);
    }
  }
  states.forEach((m, i) => {
    if (!canEnd[i] && successors[i].length) result.trapped.push(named(m, (c) => c > 0));
  });
  result.dead = graph.nodes.filter((n) => !fired.has(n.id)).map((n) => n.id);
  return result;
}
