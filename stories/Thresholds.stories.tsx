import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useEffect, useMemo, useState } from "react";
import { prepareScene } from "../src/canvas/index";
import { type Positions, abstract, formatCompact, layout } from "../src/index";
import { type LadderScene, type Rung, MAGNITUDES, STEPS, collapsedGraph, committedScenes, generatedScene, optionsOf, rungOf, shownGraph } from "../tests/support/ladder";
import { type Failure, arcLabelPlaces, checkReading, findingOf, fitView, readCanvas } from "../tests/support/reading";
import { ProcessMap } from "./maps";

/**
 * The ladder of the abstraction controls on one scene, as the searching tests
 * read it: a map per threshold step (activities and paths at 0 %, the default
 * 1 % and 3 %, 5 %, 10 %, 25 % and 50 %), with keep connected and the stage
 * view as chosen, each in the 1,200 × 800 the test fits it into and with
 * what the test measures on it. The maps get the layout the measurement was
 * taken on and a budget of 24 paths.
 */
const meta: Meta = {
  title: "Thresholds and sizes",
  parameters: { layout: "fullscreen" },
};
export default meta;

const SCENES = ["global", "vendor", ...MAGNITUDES.map((m) => `generated ${m.toExponential(0).replace("+", "")}`)] as const;

interface Args {
  scene: (typeof SCENES)[number];
  seed: number;
  keepConnected: boolean;
  stages: "shown" | "collapsed";
  renderer: "svg" | "canvas";
}

function sceneOf(args: Args): LadderScene {
  const committed = committedScenes().find((s) => s.name === args.scene);
  return committed ?? generatedScene(args.seed, MAGNITUDES[SCENES.indexOf(args.scene) - 2]);
}

const BUDGET = 24;

/** What the Canvas drawing of a rung shows and fails, measured as the tests measure it (1,200 × 800). */
function measure(scene: LadderScene, rung: Rung, positions: Positions) {
  const shown = shownGraph(scene.graph, optionsOf(rung));
  const prepared = prepareScene(shown, positions, { overlays: [...(shown.overlays ?? []), ...scene.overlays], lodBySize: true });
  const whole = { x: -prepared.bounds.x, y: -prepared.bounds.y, zoom: 1, width: prepared.bounds.width, height: prepared.bounds.height };
  const fitted = readCanvas(prepared, fitView(prepared.bounds, 1200, 800));
  const failures = checkReading({ fitted, full: readCanvas(prepared, whole, { lodZoom: 100 }), expect: { graph: scene.graph, abstraction: abstract(scene.graph, optionsOf(rung)), rung, locale: "en", positions } });
  const width = prepared.legend.items.find((i) => i.kind === "width");
  return {
    activities: shown.nodes.filter((n) => n.kind === "activity" || n.kind === "stage").length,
    paths: shown.edges.filter((e) => e.source !== e.target).length,
    ends: width?.kind === "width" ? `${formatCompact(width.domain[0])} … ${formatCompact(width.domain[1])}` : "–",
    zoom: fitted.zoom,
    failures: failures.map((f) => ({ ...f, finding: findingOf(f, shown, collapsedGraph(scene.graph, rung), arcLabelPlaces(prepared)) })),
  };
}

/** Failures counted by property, the open findings named. */
function tally(failures: (Failure & { finding?: string })[]): string[] {
  const by = new Map<string, number>();
  for (const f of failures) by.set(`${f.property}${f.finding ? ` (open: ${f.finding})` : ""}`, (by.get(`${f.property}${f.finding ? ` (open: ${f.finding})` : ""}`) ?? 0) + 1);
  return [...by].map(([k, n]) => `${k} × ${n}`);
}

function RungMap({ scene, rung, renderer }: { scene: LadderScene; rung: Rung; renderer: Args["renderer"] }) {
  const shown = useMemo(() => shownGraph(scene.graph, optionsOf(rung)), [scene, rung]);
  const [positions, setPositions] = useState<Positions>();
  useEffect(() => {
    let live = true;
    setPositions(undefined);
    void layout(shown, { elkWorkerUrl }).then((p) => live && setPositions(p));
    return () => void (live = false);
  }, [shown]);
  const measured = useMemo(() => (positions ? measure(scene, rung, positions) : undefined), [scene, rung, positions]);
  return (
    <figure style={{ margin: 0, width: 1200, border: "1px solid var(--wf-line)" }} data-testid="rung">
      <figcaption style={{ padding: "4px 8px", font: "600 12px var(--wf-font)" }}>
        {rung.name}
        {measured ? <span style={{ fontWeight: 400 }}> · {measured.activities} activities, {measured.paths} paths · widths {measured.ends} · fitted at {measured.zoom.toFixed(2)}</span> : " · laying out…"}
      </figcaption>
      <div style={{ width: 1200, height: 800 }}>
        {positions ? <ProcessMap graph={scene.graph} overlays={scene.overlays} positions={positions} abstraction={optionsOf(rung)} renderer={renderer} edgeBudget={BUDGET} controls={false} contextMenu={false} pathList={false} /> : null}
      </div>
      <details style={{ padding: "4px 8px", font: "11px var(--wf-font)" }}>
        <summary>{measured ? (measured.failures.length ? `${measured.failures.length} failing: ${tally(measured.failures).join(", ")}` : "every property holds") : "…"}</summary>
        <ol>{measured?.failures.slice(0, 40).map((f, i) => <li key={i}>{f.property}: {f.detail}</li>)}</ol>
      </details>
    </figure>
  );
}

export const Ladder: StoryObj<Args> = {
  args: { scene: "global", seed: 1, keepConnected: true, stages: "shown", renderer: "svg" },
  argTypes: {
    scene: { control: "select", options: SCENES },
    seed: { control: { type: "number", min: 1, step: 1 }, description: "seed of a generated scene" },
    stages: { control: "inline-radio", options: ["shown", "collapsed"] },
    renderer: { control: "inline-radio", options: ["svg", "canvas"] },
  },
  render: (args) => {
    const { scene: name, seed, keepConnected, stages } = args;
    const scene = useMemo(() => sceneOf({ ...args, scene: name, seed }), [name, seed]);
    const rungs = useMemo(() => STEPS.map((_, step) => rungOf(step, keepConnected, stages === "collapsed" ? "all" : false)), [keepConnected, stages]);
    return (
      <div>
        <p style={{ margin: 0, padding: "6px 12px", font: "12px var(--wf-font)", borderBottom: "1px solid var(--wf-line)" }}>
          {scene.name}: {formatCompact(scene.events)} events, {scene.graph.nodes.length} nodes, {scene.graph.edges.length} paths. One map per threshold step in the 1,200 × 800 the test fits it into; under each, what the searching test measures on its Canvas drawing.
        </p>
        <div style={{ display: "grid", gap: 12, padding: 8 }}>
          {rungs.map((rung) => <RungMap key={rung.name} scene={scene} rung={rung} renderer={args.renderer} />)}
        </div>
      </div>
    );
  },
};
