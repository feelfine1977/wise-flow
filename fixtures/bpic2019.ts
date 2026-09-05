/**
 * Typed access to `bpic2019_p2p.json` (built by `build_bpic2019_fixture.py`):
 * two FlowGraph scenes (whole log, one vendor) and constraint descriptions with
 * per-scene statistics.
 */
import type { ConstraintDescription, ConstraintStats, FlowGraph } from "../src/core/index";
import raw from "./bpic2019_p2p.json";

export interface FixtureConstraint {
  description: ConstraintDescription;
  stats: Record<string, ConstraintStats>;
}

export interface Bpic2019Fixture {
  meta: {
    source: string;
    doi: string;
    caseNotion: string;
    built: string;
    events: number;
    cases: number;
    activities: number;
    vendorScene: string;
    notes: string[];
  };
  stages: { id: string; label: string; order: number }[];
  scenes: Record<string, FlowGraph>;
  constraints: FixtureConstraint[];
}

export const fixture = raw as unknown as Bpic2019Fixture;

/** The whole log as a FlowGraph. */
export const globalScene: FlowGraph = fixture.scenes.global;

/** Key of the vendor slice scene (`vendor_0128`). */
export const vendorSceneKey = fixture.meta.vendorScene;

/** One vendor as a FlowGraph on the same ids. */
export const vendorScene: FlowGraph = fixture.scenes[vendorSceneKey];

/** Constraint descriptions paired with the statistics of one scene. */
export function constraintItems(scene: string = "global"): { description: ConstraintDescription; stats: ConstraintStats }[] {
  return fixture.constraints.map((c) => ({ description: c.description, stats: c.stats[scene] ?? {} }));
}
