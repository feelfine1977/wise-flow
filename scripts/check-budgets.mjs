import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
/** The layout workers in `dist`: assets a Web Worker loads, not library modules. */
export const workers = ['elk-worker.min.js', 'dagre-worker.min.js'];
function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesAt(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
}
export function assertBudgets(measured, limits) {
  for (const [name, limit] of Object.entries(limits)) {
    if (!Number.isFinite(measured[name]) || measured[name] < 0 || measured[name] > limit) throw new Error(`${name}: ${measured[name]} exceeds budget ${limit} or is missing/invalid`);
  }
}
export function checkBudgets() {
  const artifactDir = resolve(process.env.FLOW_ARTIFACT_DIR || resolve(root, 'artifacts'));
  const limits = JSON.parse(readFileSync(resolve(root, 'scripts/budgets.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const assets = JSON.parse(readFileSync(resolve(artifactDir, 'consumer-assets.json'), 'utf8'));
  const workerPaths = workers.map(name => resolve(root, 'dist', name));
  const measured = {
    libraryJavaScriptGzipBytes: filesAt(resolve(root, 'dist')).filter(path => path.endsWith('.js') && !workerPaths.includes(path)).reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0),
    workerBytes: workerPaths.reduce((sum, path) => sum + statSync(path).size, 0),
    consumerAllJavaScriptGzipBytes: assets.allJavaScriptGzipBytes,
    tarballBytes: statSync(resolve(artifactDir, `wise-flow-${pkg.version}.tgz`)).size,
  };
  writeFileSync(resolve(artifactDir, 'size-budgets.json'), JSON.stringify({ measured, limits }, null, 2) + '\n');
  assertBudgets(measured, limits);
  console.log(JSON.stringify(measured, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkBudgets();
