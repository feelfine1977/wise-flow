import { describe, expect, it } from "vitest";
import { liteFromGraph } from "../../src/bpmn/headless";
import { type FlowGraph, type FlowNode, hasTag, validateGateways, validateGraph } from "../../src/index";
import { generatedModel } from "../support/models";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { type TokenGame, isWrong, playTokens } from "./token-game";

// Every generated model is explored to completion; a model with more reachable
// states than this would fail the test rather than pass unexplored.
const LIMIT = 200_000;
const sound = { complete: true, completes: true, stuck: [], unsafe: [], trapped: [], dead: [] };
const verdict = (game: TokenGame) => ({ complete: game.complete, completes: game.completes, stuck: game.stuck, unsafe: game.unsafe, trapped: game.trapped, dead: game.dead });

/** The model with one gateway's kind turned over: exclusive to parallel or back. */
function turned(model: FlowGraph, id: string): FlowGraph {
  const flip = (n: FlowNode): FlowNode => ({ ...n, tags: (n.tags ?? []).map((t) => (t === "xor" ? "and" : t === "and" ? "xor" : t)) });
  return { ...model, nodes: model.nodes.map((n) => (n.id === id ? flip(n) : n)) };
}

describe("generated BPMN models in the token game", () => {
  it("are sound for random logs and graph families, with and without parallel gateways", () => {
    let models = 0;
    let states = 0;
    let largest = 0;
    let parallel = 0;
    const count = caseCount(500);
    for (const seed of seeds(count)) {
      const source = createRandom(seed).chance(0.75) ? "log" : "family";
      const built = [false, true].map((andGateways) => generatedModel(seed, { parallel: andGateways, source }));
      // One graph, built with and without parallel gateways.
      expect(built[0].input, caseLabel(seed, built[0].describe)).toEqual(built[1].input);
      for (const { model, describe: what } of built) {
        const label = caseLabel(seed, what);
        const game = playTokens(model, { limit: LIMIT });
        expect(verdict(game), label).toEqual(sound);
        expect(validateGraph(model), label).toEqual([]);
        expect(validateGateways(model), label).toEqual([]);
        models++;
        states += game.states;
        largest = Math.max(largest, game.states);
        if (model.nodes.some((n) => n.kind === "gateway" && hasTag(n, "and"))) parallel++;
      }
    }
    // Parallel blocks must actually occur, or the search says nothing about them.
    expect(parallel).toBeGreaterThan(count / 10);
    console.log(`token game: ${count} graphs, ${models} models (${parallel} with parallel gateways), ${states} states explored, at most ${largest} in one model`);
  });

  it("are sound for random stage models", () => {
    let states = 0;
    for (const seed of seeds(caseCount(100))) {
      const { model, describe: what } = generatedModel(seed, { source: "stages" });
      const game = playTokens(model, { limit: LIMIT });
      expect(verdict(game), caseLabel(seed, what)).toEqual(sound);
      expect(validateGraph(model), caseLabel(seed, what)).toEqual([]);
      expect(validateGateways(model), caseLabel(seed, what)).toEqual([]);
      states += game.states;
    }
    console.log(`token game: ${caseCount(100)} stage models, ${states} states explored`);
  });
});

describe("the structural check and the token game", () => {
  it("agree on every generated model and on each with one gateway turned over", () => {
    let turnedModels = 0;
    let caught = 0;
    let bounded = 0;
    let unexplored = 0;
    for (const seed of seeds(caseCount(150))) {
      const rng = createRandom(seed);
      const { model, describe: what } = generatedModel(seed, { parallel: rng.chance(0.5) });
      const gateways = model.nodes.filter((n) => n.kind === "gateway");
      // A generated model is sound, and the check reports nothing on it.
      expect(validateGateways(model), caseLabel(seed, what)).toEqual([]);
      if (!gateways.length) continue;
      const id = rng.pick(gateways).id;
      const planted = turned(model, id);
      const label = caseLabel(seed, `${what}, ${id} turned`);
      const game = playTokens(planted, { limit: 5_000 });
      const reported = validateGateways(planted);
      turnedModels++;
      if (!game.complete) bounded++;
      if (!isWrong(game) && !game.complete) {
        // Neither a problem nor all states seen: the game cannot judge this one.
        unexplored++;
        continue;
      }
      // Whatever the check reports is a real problem in the game, and every model the
      // game finds stuck or unsafe is reported by the check.
      expect({ reported: reported.length > 0, wrong: isWrong(game) }, label).toEqual({ reported: isWrong(game), wrong: isWrong(game) });
      if (game.stuck.length || game.unsafe.length) expect(reported.length, label).toBeGreaterThan(0);
      if (reported.length) caught++;
    }
    expect(unexplored).toBeLessThan(turnedModels / 10);
    console.log(`check and game: ${turnedModels} models with a turned gateway, ${caught} wrong and reported by both, ${bounded} stopped at the bound, ${unexplored} of them undecided`);
  });

  it("both catch a planted parallel join that no parallel split pairs", () => {
    // A choice between b and c after a, merged before d. Turning the merge into a
    // parallel join makes the case wait at d for the branch the choice did not take.
    const follows = (pairs: string) => pairs.split(" ").map((p) => ({ id: p.replace(">", "->"), kind: "follows" as const, source: p.split(">")[0], target: p.split(">")[1], metrics: { count: 1 } }));
    const dfg: FlowGraph = { nodes: ["a", "b", "c", "d"].map((id) => ({ id, kind: "activity", label: id.toUpperCase(), metrics: { cases: 2 } })), edges: follows("a>b a>c b>d c>d") };
    const model = liteFromGraph(dfg, { andGateways: true });
    expect(model.nodes.find((n) => n.id === "gw_join_d")?.tags).toEqual(["xor", "join", "generated"]);
    expect(playTokens(model)).toMatchObject(sound);
    expect(validateGateways(model)).toEqual([]);

    const planted = turned(model, "gw_join_d");
    expect(validateGateways(planted)).toEqual([{ level: "warning", message: "parallel join that is the partner of no parallel split", id: "gw_join_d" }]);
    const game = playTokens(planted);
    // One token reaches the join from b or from c and waits there for ever.
    expect(game.stuck).toEqual([["b->gw_join_d"], ["c->gw_join_d"]]);
    expect(game.completes).toBe(false);
    expect(game.dead).toEqual(["gw_join_d", "d", "__end"]);
  });
});
