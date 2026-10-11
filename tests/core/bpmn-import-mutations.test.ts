import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../../fixtures/p2p_stages";
import { type BpmnImport, exportBpmn, importBpmn, liteFromStages } from "../../src/bpmn/headless";
import { type Box, validateGraph } from "../../src/index";
import { MUTATION_KINDS, type MutationKind, mutate } from "../support/bpmn-files";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";

// Every import settles within this time or the case fails; a large file takes about
// 150 ms here, so the bound only catches a hang, also under coverage. The race catches
// an import that never settles; most of the work runs without yielding, so a slow one
// is caught by its measured time (an endless loop only by the run's own timeout).
const BOUND_MS = 10_000;

type Outcome = { imported: BpmnImport; ms: number } | { rejected: unknown; ms: number } | { hung: true; ms: number };

async function settle(xml: string): Promise<Outcome> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hang = new Promise<"hung">((resolve) => (timer = setTimeout(() => resolve("hung"), BOUND_MS)));
  try {
    const result = await Promise.race([importBpmn(xml), hang]);
    const ms = performance.now() - started;
    return result === "hung" ? { hung: true, ms } : { imported: result, ms };
  } catch (rejected) {
    return { rejected, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** The documented rejection: the parser's `Error`, with the parser's warnings, when the text is not BPMN definitions. */
function isDocumentedRejection(e: unknown): boolean {
  return e instanceof Error && e.constructor === Error && Array.isArray((e as { warnings?: unknown }).warnings) && /^(unparsable content|failed to parse document)/.test(e.message);
}

const finiteBox = (b: Box) => [b.x, b.y, b.width, b.height, b.x + b.width, b.y + b.height].every(Number.isFinite);

/** What an import must not do: return a graph the validation rejects without saying so, or positions that are not numbers. */
function unreported(result: BpmnImport): string[] {
  const problems = validateGraph(result.graph)
    .map((i) => `${i.message}: ${i.id}`)
    .filter((w) => !result.warnings.includes(w));
  const p = result.positions;
  if (p) {
    for (const [id, b] of [...Object.entries(p.nodes), ...Object.entries(p.groups)]) if (!finiteBox(b)) problems.push(`box of ${id} not finite`);
    for (const [id, r] of Object.entries(p.edges)) if (!r.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) problems.push(`route of ${id} not finite`);
    if (!finiteBox(p.bounds)) problems.push("bounds not finite");
  }
  return problems;
}

describe("importBpmn on mutated files", () => {
  const fixtures: { name: string; xml: string }[] = [{ name: "p2p_small.bpmn", xml: readFileSync(new URL("../../fixtures/p2p_small.bpmn", import.meta.url), "utf8") }];
  beforeAll(async () => {
    // The stage model of the fixtures as the exporter writes it: lanes, a pool, the wise extension.
    fixtures.push({ name: "p2p stages exported", xml: (await exportBpmn(liteFromStages(withSceneMetrics(p2pStages, globalScene)), { layout: { engine: "dagre" } })).xml });
  });

  it("imports each with reported problems or rejects it with the parser's error, in time, without an unreported invalid graph", async () => {
    const tally = new Map<MutationKind, { imported: number; warned: number; rejected: number; unchanged: number; ms: number }>(MUTATION_KINDS.map((k) => [k, { imported: 0, warned: 0, rejected: 0, unchanged: 0, ms: 0 }]));
    let slowest = 0;
    const count = caseCount(1000);
    for (const seed of seeds(count)) {
      // The committed file twice as often as the larger exported one.
      const fixture = fixtures[seed % 3 === 0 ? 1 : 0];
      // Every kind comes first in turn; up to two more may follow it.
      const first = MUTATION_KINDS[seed % MUTATION_KINDS.length];
      const { xml, kinds } = mutate(fixture.xml, createRandom(seed), first);
      const label = caseLabel(seed, `${fixture.name}: ${kinds.join(" + ")}`);
      const outcome = await settle(xml);
      slowest = Math.max(slowest, outcome.ms);
      const row = tally.get(first)!;
      if (xml === fixture.xml) row.unchanged++;
      row.ms += outcome.ms;
      expect("hung" in outcome, label).toBe(false);
      expect(outcome.ms, label).toBeLessThan(BOUND_MS);
      if ("rejected" in outcome) {
        expect(isDocumentedRejection(outcome.rejected), `${label}: ${String(outcome.rejected)}`).toBe(true);
        row.rejected++;
      } else if ("imported" in outcome) {
        expect(unreported(outcome.imported), label).toEqual([]);
        row.imported++;
        if (outcome.imported.warnings.length) row.warned++;
      }
    }
    // A kind that never changes a fixture says nothing.
    for (const [kind, row] of tally) expect(row.unchanged, kind).toBeLessThan((count / MUTATION_KINDS.length) * 0.2);
    console.log(
      `importer: ${count} mutated files, slowest ${Math.round(slowest)} ms\n` +
        [...tally].map(([kind, r]) => `  ${kind}: ${r.imported} imported (${r.warned} with warnings), ${r.rejected} rejected, ${r.unchanged} unchanged, ${Math.round(r.ms)} ms`).join("\n"),
    );
  });

  it("rejects text that is not BPMN with the parser's error and its warnings", async () => {
    for (const xml of ["", "not xml at all", "<", '{"nodes": []}', "<definitions/>", '<?xml version="1.0"?><bpmn:task xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>']) {
      const outcome = await settle(xml);
      expect("rejected" in outcome && isDocumentedRejection(outcome.rejected), JSON.stringify(xml)).toBe(true);
    }
  });

  it("imports a file of 10,000 tasks and flows in time", async () => {
    const small = fixtures[0].xml;
    const count = 10_000;
    const copies = Array.from({ length: count }, (_, i) => `<bpmn:task id="copy${i}" name="Copy ${i}"/><bpmn:sequenceFlow id="cf${i}" sourceRef="copy${i}" targetRef="${i + 1 < count ? `copy${i + 1}` : "Task_CreatePO"}"/>`).join("");
    const outcome = await settle(small.replace('<bpmn:task id="Task_CreatePO"', `${copies}<bpmn:task id="Task_CreatePO"`));
    expect("imported" in outcome).toBe(true);
    expect(outcome.ms).toBeLessThan(BOUND_MS);
    if (!("imported" in outcome)) return;
    expect(outcome.imported.warnings).toEqual([]);
    expect(outcome.imported.graph.nodes.length).toBe(12 + count);
    expect(outcome.imported.graph.edges.length).toBe(13 + count);
    expect(unreported(outcome.imported)).toEqual([]);
  });
});
