// Runs the unit and component suites as the hosted runners do: `vitest run --coverage` with `CI` set, on as many
// cores as they have (two by default, pinned with `taskset`), and reports every test that failed or used more than
// a share of its time limit (`--headroom`, half by default), so that a test too slow for the runners is seen here.
//
//   npm run test:hosted                          # two cores, one run
//   npm run test:hosted -- --runs 3 --cores 4    # three runs on four cores
//   npm run test:hosted -- tests/react           # arguments after the options go to Vitest
//
// The Node that runs this script runs Vitest: put another Node first on the PATH to use it.
// The module is also the Vitest reporter that records each test's duration and time limit.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const self = fileURLToPath(import.meta.url);

/** The first `count` processors of an affinity list such as `0-3,8`, as a list for `taskset -c`. */
export function firstProcessors(allowed, count) {
  const ids = allowed.trim().split(',').flatMap(part => {
    const [from, to = from] = part.split('-').map(Number);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
  if (ids.length < count) throw new Error(`only ${ids.length} processors are available, ${count} asked for`);
  return ids.slice(0, count).join(',');
}

/** The tests that failed, and those that passed in more than `headroom` of their time limit, slowest share first. */
export function verdict(tests, headroom) {
  const share = test => test.duration / test.timeout;
  return {
    failed: tests.filter(test => test.state === 'failed'),
    tight: tests.filter(test => test.state === 'passed' && share(test) > headroom).sort((a, b) => share(b) - share(a)),
  };
}

/** Records every test's file, name, state, duration and time limit, and writes them to `FLOW_HOSTED_REPORT`. */
export default class HostedReporter {
  tests = [];
  onTestCaseResult(test) {
    const result = test.result();
    this.tests.push({
      file: relative(root, test.module.moduleId),
      name: test.fullName,
      state: result.state,
      duration: Math.round(test.diagnostic()?.duration ?? 0),
      timeout: test.options.timeout ?? test.project.config.testTimeout,
      error: result.errors?.[0]?.message?.split('\n')[0].slice(0, 300),
    });
  }
  onTestRunEnd() {
    if (process.env.FLOW_HOSTED_REPORT) writeFileSync(process.env.FLOW_HOSTED_REPORT, JSON.stringify(this.tests, null, 2) + '\n');
  }
}

function option(args, name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  if (!(Number(value) > 0)) throw new Error(`${name} needs a positive number, got ${value}`);
  return Number(value);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function main(args) {
  const cores = option(args, '--cores', 2);
  const runs = option(args, '--runs', 1);
  const headroom = option(args, '--headroom', 0.5);
  const pinned = spawnSync('taskset', ['--version']).status === 0;
  if (!pinned && availableParallelism() > cores) {
    console.error(`taskset (util-linux) is not available and this machine has ${availableParallelism()} processors. Run this script on Linux, or in a container limited to ${cores}, for example:\n  docker run --rm --cpuset-cpus=0-${cores - 1} -v "$PWD":/work -v /work/node_modules -w /work node:24 sh -c "npm ci && npm run test:hosted"`);
    return 2;
  }
  const allowed = pinned ? /^Cpus_allowed_list:\s*(.+)$/m.exec(readFileSync('/proc/self/status', 'utf8'))?.[1] : undefined;
  const processors = allowed ? firstProcessors(allowed, cores) : undefined;
  const out = resolve(root, 'reports/hosted');
  mkdirSync(out, { recursive: true });
  const vitest = [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--coverage', '--reporter=default', `--reporter=${self}`, ...args];
  console.log(`Node ${process.version}, ${processors ? `processors ${processors}` : `${availableParallelism()} processors`}, ${runs} run(s); a test that passes in more than ${headroom * 100} % of its time limit is reported as tight.`);
  let failures = 0;
  for (let run = 1; run <= runs; run++) {
    const report = resolve(out, `node-${process.versions.node.split('.')[0]}-run-${run}.json`);
    const started = Date.now();
    const command = processors ? ['taskset', ['-c', processors, process.execPath, ...vitest]] : [process.execPath, vitest];
    const { status } = spawnSync(...command, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true', FLOW_HOSTED_REPORT: report } });
    const tests = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : [];
    const { failed, tight } = verdict(tests, headroom);
    console.log(`\nRun ${run} of ${runs}: Vitest exited with ${status} after ${seconds(Date.now() - started)}; ${tests.length} tests, ${failed.length} failed, ${tight.length} tight.`);
    for (const test of failed) console.log(`  failed  ${seconds(test.duration)} of ${seconds(test.timeout)}  ${test.file} › ${test.name}\n          ${test.error ?? ''}`);
    for (const test of tight) console.log(`  tight   ${seconds(test.duration)} of ${seconds(test.timeout)}  ${test.file} › ${test.name}`);
    if (status !== 0 || failed.length || tight.length || !tests.length) failures++;
  }
  console.log(`\n${runs - failures} of ${runs} run(s) passed with headroom; reports in ${relative(root, out)}/.`);
  return failures ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main(process.argv.slice(2));
