import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, validateGateways, validateGraph } from "../../src/index";
import { playTokens } from "./token-game";

// A model from its flows: `start` and `end*` are events, `and*` parallel and
// `xor*` exclusive gateways, every other id a task.
function model(flows: string, extra: FlowEdge[] = []): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const node = (id: string): FlowNode => {
    if (id === "start") return { id, kind: "event", label: id, tags: ["start"] };
    if (id.startsWith("end")) return { id, kind: "event", label: id, tags: ["end"] };
    if (id.startsWith("and")) return { id, kind: "gateway", label: id, tags: ["and"] };
    if (id.startsWith("xor")) return { id, kind: "gateway", label: id, tags: ["xor"] };
    return { id, kind: "activity", label: id };
  };
  const edges: FlowEdge[] = flows.split(" ").map((pair) => {
    const [source, target] = pair.split(">");
    for (const id of [source, target]) if (!nodes.has(id)) nodes.set(id, node(id));
    return { id: pair, kind: "flow", source, target };
  });
  return { nodes: [...nodes.values()], edges: [...edges, ...extra] };
}

const unpairedJoin = (id: string) => ({ level: "warning", message: "parallel join that is the partner of no parallel split", id });
const unpairedSplit = (id: string) => ({ level: "warning", message: "parallel split whose branches do not all reach one parallel join", id });

describe("validateGateways", () => {
  it("reports a parallel join whose branches come from an exclusive split", () => {
    const g = model("start>xor1 xor1>a xor1>b a>and1 b>and1 and1>end");
    expect(validateGateways(g)).toEqual([unpairedJoin("and1")]);
    // The case waits at the join forever: a deadlock.
    expect(playTokens(g).stuck).toEqual([["a>and1"], ["b>and1"]]);
  });

  it("reports a parallel split whose branches an exclusive gateway merges", () => {
    const g = model("start>and1 and1>a and1>b a>xor1 b>xor1 xor1>end");
    expect(validateGateways(g)).toEqual([unpairedSplit("and1")]);
    // Both tokens pass the merge: the process completes twice.
    expect(playTokens(g).unsafe).toContainEqual(["xor1>end"]);
  });

  it("reports a split with a branch that can leave the block, and the join it leaves", () => {
    const g = model("start>and1 and1>a and1>b a>and2 b>xor1 xor1>and2 xor1>end2 and2>end");
    expect(validateGateways(g)).toEqual([unpairedSplit("and1"), unpairedJoin("and2")]);
    expect(playTokens(g).stuck).toEqual([["a>and2"]]);
  });

  it("reports a split whose branch reaches the join on two flows", () => {
    const g = model("start>and1 and1>a and1>b a>xor1 xor1>and2 xor1>c c>and2 b>and2 and2>end");
    expect(validateGateways(g)).toEqual([unpairedSplit("and1"), unpairedJoin("and2")]);
    expect(playTokens(g).stuck.length).toBeGreaterThan(0);
  });

  it("reports a split with a branch that is also entered from outside the block", () => {
    const g = model("start>xor0 xor0>and1 xor0>b and1>a and1>b a>and2 b>and2 and2>end");
    expect(validateGateways(g)).toEqual([unpairedSplit("and1"), unpairedJoin("and2")]);
    expect(playTokens(g).stuck).toEqual([["b>and2"]]);
  });

  it("reports a split with a branch that ends at an unknown node", () => {
    const g = model("start>and1 and1>a and1>b a>and2 b>and2 and2>end", [{ id: "lost", kind: "flow", source: "a", target: "nowhere" }]);
    expect(validateGateways(g)).toEqual([unpairedSplit("and1"), unpairedJoin("and2")]);
  });

  it("reports a split whose branch returns to it", () => {
    const g = model("start>xor0 xor0>and1 and1>a and1>b a>and2 b>xor1 xor1>and2 xor1>xor0 and2>end");
    expect(validateGateways(g)).toEqual([unpairedSplit("and1"), unpairedJoin("and2")]);
    expect(playTokens(g).unsafe.length).toBeGreaterThan(0);
  });

  it("follows a branch through a choice wider than a call can take arguments", () => {
    // xor1 offers 200,000 tasks that xor2 merges again: one branch, so a sound block.
    const wide: FlowEdge[] = [];
    for (let i = 0; i < 200_000; i++) wide.push({ id: `x${i}`, kind: "flow", source: "xor1", target: `t${i}` }, { id: `y${i}`, kind: "flow", source: `t${i}`, target: "xor2" });
    const g = model("start>and1 and1>a and1>b a>xor1 xor2>and2 b>and2 and2>end", wide);
    for (let i = 0; i < 200_000; i++) g.nodes.push({ id: `t${i}`, kind: "activity", label: `t${i}` });
    expect(validateGateways(g)).toEqual([]);
  });

  it("reports nothing on blocks that are nested, loop inside a branch or repeat as a whole", () => {
    const sound = [
      model("start>and1 and1>and2 and1>c and2>a and2>b a>and3 b>and3 and3>and4 c>and4 and4>end"),
      // a message between the branches and a constraint carry no tokens.
      model("start>and1 and1>a and1>b a>xor1 xor1>a xor1>and2 b>and2 and2>end", [
        { id: "m", kind: "flow", source: "a", target: "b", tags: ["message"] },
        { id: "k", kind: "constraint", source: "b", target: "a" },
      ]),
      model("start>xor0 xor0>and1 and1>a and1>b a>and2 b>and2 and2>xor1 xor1>xor0 xor1>end"),
      // A parallel gateway that neither splits nor joins.
      model("start>and1 and1>a a>end"),
    ];
    for (const g of sound) {
      expect(validateGraph(g)).toEqual([]);
      expect(validateGateways(g)).toEqual([]);
      const game = playTokens(g);
      expect(game).toMatchObject({ complete: true, completes: true, stuck: [], unsafe: [] });
    }
  });
});
