/**
 * Malformed input at the asynchronous functions of the BPMN bridge:
 * `layoutBpmn`, `exportBpmn`, `importBpmn`, `validateBpmn`, `positionsFromDi`
 * and the moddle helpers over what a parse of a broken file gives. Each runs
 * once per malformed case (see `malformed-input.test.ts`), the import on the
 * case's own export and on a mutated file (`mutate`). A call settles within
 * the time bound and fails with nothing but a plain error named below; an
 * export holds no number that is not finite and no id twice, and an import
 * lists every problem `validateGraph` finds in its graph.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type IdMap, type ModdleElement, createIdMap, createModdle, exportBpmn, flowIdOf, importBpmn, isAnyType, isType, layoutBpmn, positionsFromDi, validateBpmn, wiseAttr } from "../../src/bpmn/headless";
import { validateGraph } from "../../src/index";
import { mutate } from "../support/bpmn-files";
import { Calls, type MalformedCase, failure, junkCoordinate, junkString, malformedCase } from "../support/malformed";
import { caseCount, seeds } from "../support/random";

const fixture = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
const CASES = seeds(caseCount(300)).map((seed) => malformedCase(seed, { maxSize: 8 }));

const fail = (message: string): never => expect.fail(message);
function must(ok: boolean, c: MalformedCase, what: () => string): void {
  if (!ok) expect.fail(failure(c, what()));
}

/** Documented: the parser's error for text that is not BPMN definitions. */
const PARSER = /^Error: (unparsable content|failed to parse document)/;
/** Documented: routing raises a descriptive error for unroutable supplied geometry. */
const ROUTING = /^Error: Cannot route .*Increase the layout spacing\.$/;
/** Not documented: the engines' own errors on a graph validation rejects (see the layout search). */
const ELK = /^Error: org\.eclipse\.elk\.graph\.json\.JsonImportException: /;
const DAGRE_CYCLE = /^Error: Setting .* as parent of .* would create a cycle$/;

const KNOWN: Record<string, readonly RegExp[]> = {
  layoutBpmn: [ROUTING, ELK, DAGRE_CYCLE],
  exportBpmn: [ROUTING, ELK, DAGRE_CYCLE],
  importBpmn: [PARSER],
  // Not documented: validateBpmn rejects text that is not BPMN with the parser's error, as importBpmn does.
  validateBpmn: [PARSER],
  positionsFromDi: [],
};

/** Every element of a parse, depth first, without recursion (a file may nest deeply). */
function elementsOf(root: ModdleElement): ModdleElement[] {
  const out: ModdleElement[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) stack.push(...v);
    else if ("$type" in (v as object)) {
      out.push(v as ModdleElement);
      for (const [k, x] of Object.entries(v as object)) if (k !== "$parent" && k !== "$descriptor" && k !== "$model" && k !== "$attrs") stack.push(x);
    }
  }
  return out;
}

describe("malformed input at the BPMN bridge", () => {
  it("lays out, exports, imports and validates in time, with every problem reported and no number that is not finite", async () => {
    const calls = new Calls(fail, 20_000);
    for (const c of CASES) {
      const layoutOptions = c.rng.chance(0.2) ? { rowGap: junkCoordinate(c.rng, 56), lanePadding: junkCoordinate(c.rng, 48), labelWidth: junkCoordinate(c.rng, 30), poolPadding: junkCoordinate(c.rng, 20) } : {};
      await calls.callAsync("layoutBpmn", c, () => layoutBpmn(c.graph, { ...layoutOptions, lanes: c.rng.pick(["bands", "compound", "ignore"] as const) }));
      const exported = await calls.callAsync("exportBpmn", c, () => exportBpmn(c.graph, { positions: c.rng.chance() ? c.positions : undefined, extension: c.rng.chance(0.8), participant: c.rng.chance(0.8), format: c.rng.chance(), name: c.rng.chance() ? junkString(c.rng) : undefined }));
      if (exported) {
        must(!/NaN|Infinity/.test(exported.xml), c, () => `NaN or Infinity in the export: …${exported.xml.slice(Math.max(0, exported.xml.search(/NaN|Infinity/) - 100), exported.xml.search(/NaN|Infinity/) + 40)}…`);
        const written = [...exported.xml.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
        must(new Set(written).size === written.length, c, () => `an id twice in the export: ${written.filter((id, i) => written.indexOf(id) !== i)}`);
      }
      const text = exported && c.rng.chance(0.6) ? exported.xml : mutate(c.rng.chance() ? fixture : (exported?.xml ?? fixture), c.rng).xml;
      const imported = await calls.callAsync("importBpmn", c, () => importBpmn(text, { keepIds: c.rng.chance(0.8), positions: c.rng.chance(0.8), subProcesses: c.rng.pick(["stage", "activity"] as const), activities: c.rng.chance() ? [{ id: junkString(c.rng), label: junkString(c.rng) }] : undefined }));
      if (imported) {
        // Documented: every issue validateGraph reports on the imported graph is in the warnings, as "<message>: <id>".
        for (const issue of validateGraph(imported.graph)) must(imported.warnings.includes(`${issue.message}: ${issue.id}`), c, () => `"${issue.message}: ${issue.id}" is not among the warnings`);
        if (imported.positions) must(Object.values(imported.positions.nodes).every((b) => [b.x, b.y, b.width, b.height].every(Number.isFinite)), c, () => "an imported box that is not finite");
      }
      await calls.callAsync("validateBpmn", c, () => validateBpmn(text));
      const parsed = await createModdle()
        .fromXML(text)
        .catch(() => undefined);
      await calls.callAsync("positionsFromDi", c, async () => {
        const warnings: string[] = [];
        const ids: IdMap = imported?.ids ?? createIdMap();
        const p = parsed && positionsFromDi(parsed.rootElement, ids, warnings);
        if (p) must(Object.values(p.nodes).every((b) => [b.x, b.y, b.width, b.height].every(Number.isFinite)) && [p.bounds.x, p.bounds.y, p.bounds.width, p.bounds.height].every(Number.isFinite), c, () => "positionsFromDi gave a box that is not finite");
      });
      const elements = parsed ? elementsOf(parsed.rootElement) : [];
      calls.call("flowIdOf", c, () => elements.forEach((el) => flowIdOf(el)));
      calls.call("wiseAttr", c, () => elements.forEach((el) => [wiseAttr(el, "flowId"), wiseAttr(el, "kind"), wiseAttr(el, "tags")]));
      calls.call("isType", c, () => elements.forEach((el) => isType(el, c.rng.pick(["bpmn:Task", "bpmn:FlowNode", junkString(c.rng)]))));
      calls.call("isAnyType", c, () => elements.forEach((el) => isAnyType(el, ["bpmn:Gateway", junkString(c.rng)])));
    }
    expect(calls.ranAtLeast(["layoutBpmn", "exportBpmn", "importBpmn", "validateBpmn", "positionsFromDi", "flowIdOf", "wiseAttr", "isType", "isAnyType"], CASES.length)).toEqual([]);
    expect(calls.unknown(KNOWN), "plain errors that are not documented").toEqual([]);
    if (process.env.WISE_DEEP) console.info(`plain errors over ${CASES.length} cases:\n${calls.report()}`);
  });
});
