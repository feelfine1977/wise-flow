// The cases of the benchmark (run.mjs) and its trial counts.

/** Mode, trials and warm-up runs per measurement: five trials in full mode, two in quick mode, one warm-up. */
export function settings({ quick = false, trials, warmup } = {}) {
  const count = (given, fallback, least, option) => {
    const value = Number(given ?? fallback);
    if (!Number.isInteger(value) || value < least) throw new Error(`${option} takes a whole number from ${least}, not "${given}"`);
    return value;
  };
  return { mode: quick ? 'quick' : 'full', trials: count(trials, quick ? 2 : 5, 1, '--trials'), warmup: count(warmup, 1, 0, '--warmup') };
}

const thousands = new Intl.NumberFormat('en-US');
const n = (value) => thousands.format(value);
const short = (value) => (value >= 1e6 ? `${value / 1e6}m` : `${value / 1e3}k`);

/**
 * Every case: where it runs, what it is given, and the rows it reports
 * (`sample` names the samples a row reads; `on` describes the input from the
 * case's detail).
 */
export function catalogue({ quick = false, only } = {}) {
  const prepare = [100_000, 500_000, 1_000_000].flatMap((flows) => [false, true].map((selfLoops) => ({
    where: 'node',
    spec: { kind: 'prepare', flows, selfLoops },
    rows: [{
      id: `prepare.${short(flows)}${selfLoops ? '.self-loops' : ''}`,
      group: 'Scene preparation (prepareScene)',
      label: `${n(flows)} flows, ${selfLoops ? 'a self-loop on every activity' : 'no self-loops'}`,
      on: (d) => `${n(d.activities)} activities, ${n(d.flows)} flows, ${n(d.selfLoops)} self-loops drawn`,
    }],
  })));
  const options = [
    ['default', 'default options', {}],
    ['unconnected', 'keepConnected: false', { keepConnected: false }],
    ['thresholds', 'minEdgeShare 0.3, minNodeShare 0.2', { minEdgeShare: 0.3, minNodeShare: 0.2 }],
  ];
  const simplify = [50_000, 100_000].flatMap((activities) => options.map(([key, text, given]) => ({
    where: 'node',
    spec: { kind: 'simplify', activities, options: given },
    rows: [{
      id: `simplify.${short(activities)}.${key}`,
      group: 'Simplification of the cyclic family (abstract)',
      label: `${n(activities)} activities, ${text}`,
      on: (d) => `${n(d.activities)} activities, ${n(d.flows)} flows → ${n(d.shownActivities)}, ${n(d.shownFlows)}`,
    }],
  })));
  const drawOn = (d) => `${n(d.activities)} activities, ${n(d.flows)} flows; in view ${n(d.nodesInView)} activities, ${n(d.flowsInView)} flows, ${n(d.flowsDrawn)} drawn`;
  const draw = [
    ['draw.sparse-100k', 'Sparse 100,000-activity scene at zoom 1, default budget', { scene: 'sparse', size: 100_000, budget: 'adaptive' }],
    ['draw.hub-50k.adaptive', 'Hub with 50,000 flows in view, default budget', { scene: 'hub', size: 50_000, budget: 'adaptive' }],
    ['draw.hub-50k.all', 'Hub with 50,000 flows in view, budget "all"', { scene: 'hub', size: 50_000, budget: 'all' }],
    ['draw.fit-all-50k', 'Fit-all view of 50,000 activities, default budget', { scene: 'fitAll', size: 50_000, budget: 'adaptive' }],
  ].map(([id, label, spec]) => ({
    where: 'browser',
    spec: { kind: 'draw', ...spec },
    rows: [{ id, group: 'Canvas draw per frame in motion', label, sample: 'frame', on: drawOn }],
  }));
  const ready = [1_000, 5_000, 10_000, 20_000].map((activities) => ({
    where: 'browser',
    spec: { kind: 'ready', activities },
    rows: [{
      id: `map-ready.${activities}`,
      group: 'React map with supplied positions: ready',
      label: `${n(activities)} activities`,
      sample: 'ready',
      on: (d) => `${n(d.activities)} activities, ${n(d.flows)} flows, ${d.renderer} renderer`,
    }],
  }));
  const first = ['sparse', 'dense'].flatMap((shape) => [100, 500].map((activities) => ({
    where: 'browser',
    spec: { kind: 'firstScene', shape, activities },
    rows: [
      { id: `first-scene.${shape}-${activities}`, group: 'Map without positions: first scene', label: `${shape[0].toUpperCase()}${shape.slice(1)}, ${activities} activities`, sample: 'first', on: (d) => `${n(d.activities)} activities, ${n(d.flows)} flows, ${d.renderer} renderer` },
      { id: `refined-layout.${shape}-${activities}`, group: 'Map without positions: until the refined layout replaces the first scene, or fails', label: `${shape[0].toUpperCase()}${shape.slice(1)}, ${activities} activities`, sample: 'refined', on: (d) => d.outcomes },
    ],
  })));
  const abort = [{
    where: 'browser',
    spec: { kind: 'abort' },
    rows: [
      { id: 'abort.terminated', group: 'Abort of a layout in a worker', label: 'From abort to the terminated worker', sample: 'terminated', on: (d) => `${n(d.activities)} activities, ${n(d.flows)} flows, aborted after ${d.ranFor} ms` },
      { id: 'abort.rejected', group: 'Abort of a layout in a worker', label: 'From abort to the rejected layout', sample: 'rejected', on: (d) => `${n(d.activities)} activities, ${n(d.flows)} flows, aborted after ${d.ranFor} ms` },
    ],
  }];
  const [small, large] = quick ? [50_000, 100_000] : [100_000, 500_000];
  const memory = [{
    where: 'memory',
    spec: { small, large },
    rows: [
      { id: 'memory.per-activity', group: 'Retained scene memory', label: 'Per activity', sample: 'perActivity', unit: 'B', on: () => `slope from ${n(small)} to ${n(large)} activities` },
      { id: 'memory.per-flow', group: 'Retained scene memory', label: 'Per flow', sample: 'perFlow', unit: 'B', on: () => `slope from ${n(small)} to ${n(large)} flows` },
      { id: `memory.scene-${short(large)}`, group: 'Retained scene memory', label: `Scene of ${n(large)} activities and flows`, sample: 'scene', unit: 'MB', on: () => `${n(large + 1)} activities, ${n(large)} flows` },
    ],
  }];
  return [...prepare, ...simplify, ...draw, ...ready, ...first, ...abort, ...memory]
    .filter((c) => !only || c.rows.some((r) => only.some((text) => r.id.includes(text))));
}
