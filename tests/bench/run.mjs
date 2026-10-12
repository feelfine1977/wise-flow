// The benchmark: times of the library on large and dense inputs, against the
// numbers measured before the repairs and the targets set for them.
//
//   npm run bench                 full mode: 5 trials after 1 warm-up
//   npm run bench -- --quick      reduced mode: 2 trials after 1 warm-up, smaller memory sizes
//   options: --trials N --warmup N --only <text in the id> --out <dir> --loaded "<why>"
//
// `npm run bench` builds the library first; this script measures `dist/`. It
// bundles node.ts and page/ with Vite against `dist/`, runs every Node case in
// its own process with `--expose-gc`, every browser case on a fresh page in
// headless Chromium through Playwright, and the memory cases with
// scripts/scene-memory.mjs. It writes bench.json and bench.md to
// artifacts/bench/ (or --out). It reports time and fails only when a case
// cannot run; the counted-work tests of the test suite are the gate.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { libraryJavaScriptGzipBytes } from '../../scripts/check-budgets.mjs';
import { catalogue, settings } from './cases.mjs';
import { markdown, summarise } from './report.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const dist = join(root, 'dist');
const src = join(root, 'src');

const { values: args } = parseArgs({
  options: {
    quick: { type: 'boolean', default: false },
    trials: { type: 'string' },
    warmup: { type: 'string' },
    only: { type: 'string', multiple: true },
    out: { type: 'string' },
    loaded: { type: 'string' },
  },
});
const { mode, trials, warmup } = settings(args);
const out = resolve(root, args.out ?? 'artifacts/bench');
const build = join(out, 'build');

/** Vite builds of node.ts (for Node) and page/ (for the browser) whose imports of `src/` load the built `dist/` instead. */
async function bundle() {
  const { build: viteBuild } = await import('vite');
  const toDist = (external) => ({
    name: 'bench-dist',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      const path = resolve(dirname(importer.split('?')[0]), source);
      if (!path.startsWith(src + sep)) return null;
      const id = join(dist, `${relative(src, path).replace(/\.(js|ts|tsx)$/, '')}.js`);
      return external ? { id, external: true } : id;
    },
  });
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    root,
    plugins: [toDist(true)],
    build: { ssr: join(here, 'node.ts'), outDir: join(build, 'node'), emptyOutDir: true, target: 'node22', rollupOptions: { makeAbsoluteExternalsRelative: false, output: { entryFileNames: 'node.mjs' } } },
  });
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    root: join(here, 'page'),
    base: './',
    plugins: [toDist(false)],
    build: {
      outDir: join(build, 'page'),
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1e5,
      // React Flow's "use client" means nothing in a bundle.
      rollupOptions: { onwarn: (warning, warn) => warning.code === 'MODULE_LEVEL_DIRECTIVE' || warn(warning) },
    },
  });
}

function runNode(spec) {
  const output = execFileSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', join(build, 'node', 'node.mjs'), JSON.stringify({ ...spec, trials, warmup })], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const { samples, detail } = JSON.parse(output);
  return { samples: { value: samples }, detail };
}

/** Scene bytes of a sparse chain of `size` (with or without its flows) in a fresh process, by scripts/scene-memory.mjs. */
function sceneBytes(size, flows) {
  const output = execFileSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', join(root, 'scripts/scene-memory.mjs'), '--child', String(size), flows ? '1' : '0', '0', '0'], { encoding: 'utf8', maxBuffer: 1 << 20 });
  return JSON.parse(output).scene;
}

function runMemory({ small, large }) {
  const samples = { perActivity: [], perFlow: [], scene: [] };
  for (let i = 0; i < warmup + trials; i++) {
    const nodes = [sceneBytes(small, false), sceneBytes(large, false)];
    const both = [sceneBytes(small, true), sceneBytes(large, true)];
    if (i < warmup) continue;
    const perActivity = (nodes[1] - nodes[0]) / (large - small);
    samples.perActivity.push(perActivity);
    samples.perFlow.push((both[1] - both[0]) / (large - small) - perActivity);
    samples.scene.push(both[1] / 2 ** 20);
  }
  return { samples, detail: {} };
}

async function browserRunner() {
  const { chromium } = await import('playwright');
  const { preview } = await import('vite');
  const server = await preview({ configFile: false, logLevel: 'warn', root: join(here, 'page'), build: { outDir: join(build, 'page') }, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
  return {
    version: browser.version(),
    async run(spec) {
      // A fresh context per case: its own page and heap.
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => document.documentElement.dataset.bench === 'ready');
        // A page whose process died never answers: fail the case on the crash, or after a generous time.
        const limit = (warmup + trials) * 180 + 60;
        let timer;
        const silent = new Promise((_, reject) => {
          page.once('crash', () => reject(new Error('the page crashed')));
          timer = setTimeout(() => reject(new Error(`no answer within ${limit} s`)), limit * 1000);
        });
        const result = await Promise.race([page.evaluate((given) => window.bench(given), { ...spec, trials, warmup }), silent]).finally(() => clearTimeout(timer));
        if (errors.length) throw new Error(errors.join('; '));
        return result;
      } finally {
        await context.close();
      }
    },
    async close() {
      await browser.close();
      await new Promise((done) => server.httpServer.close(done));
    },
  };
}

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const load = () => loadavg().map((v) => Number(v.toFixed(2)));

async function main() {
  const cases = catalogue(args);
  const loadBefore = load();
  console.log(`Benchmark, ${mode} mode: ${cases.length} cases, ${trials} trials after ${warmup} warm-up${warmup === 1 ? '' : 's'}.`);
  await bundle();
  const browser = cases.some((c) => c.where === 'browser') ? await browserRunner() : undefined;
  const results = [];
  try {
    for (const c of cases) {
      const started = performance.now();
      let outcome;
      try {
        outcome = c.where === 'node' ? runNode(c.spec) : c.where === 'memory' ? runMemory(c.spec) : await browser.run(c.spec);
      } catch (error) {
        outcome = { error: String(error?.message ?? error).split('\n')[0] };
      }
      for (const row of c.rows) {
        const samples = outcome.samples?.[row.sample ?? 'value'] ?? [];
        const result = { id: row.id, group: row.group, label: row.label, unit: row.unit ?? 'ms', where: c.where, spec: c.spec };
        if (outcome.error) Object.assign(result, { error: outcome.error, samples: [] });
        else Object.assign(result, { on: row.on(outcome.detail), ...summarise(samples), samples, detail: outcome.detail });
        results.push(result);
        console.log(`${row.id.padEnd(32)} ${result.error ? `failed: ${result.error}` : `median ${result.median.toFixed(2)} ${result.unit} (min ${result.min.toFixed(2)}, max ${result.max.toFixed(2)}, ${samples.length} samples)`}`);
      }
      console.log(`${''.padEnd(32)} ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally {
    await browser?.close();
  }
  const loadAfter = load();
  const cores = cpus().length;
  const busy = Math.max(...loadBefore, ...loadAfter) >= cores / 2;
  const loaded = args.loaded ?? (busy ? `load average reached ${Math.max(...loadBefore, ...loadAfter)} on ${cores} cores` : undefined);
  const meta = {
    commit: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    date: new Date().toISOString(),
    mode,
    trials,
    warmup,
    framesPerGesture: results.find((r) => r.detail?.framesPerTrial)?.detail.framesPerTrial,
    machine: { cpu: cpus()[0]?.model ?? 'unknown', cores, memoryGB: Number((totalmem() / 2 ** 30).toFixed(1)), freeMemoryGB: Number((freemem() / 2 ** 30).toFixed(1)), platform: platform(), release: release(), arch: arch(), loadBefore, loadAfter, loaded },
    runtime: { node: process.version, v8: process.versions.v8 },
    browser: { name: 'Chromium', version: browser?.version ?? 'not run', playwright: JSON.parse(readFileSync(join(root, 'node_modules/playwright/package.json'), 'utf8')).version },
    library: { javaScriptGzipBytes: libraryJavaScriptGzipBytes(dist) },
  };
  const run = { meta, results };
  const reference = JSON.parse(readFileSync(join(here, 'reference.json'), 'utf8'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'bench.json'), `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(join(out, 'bench.md'), markdown(run, reference));
  console.log(`Wrote ${relative(root, join(out, 'bench.json'))} and ${relative(root, join(out, 'bench.md'))}.`);
  if (results.some((r) => r.error)) process.exitCode = 1;
}

await main();
