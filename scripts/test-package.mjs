// Run the exact npm tarball in a real, separately installed consumer; no source aliases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const artifactDir = resolve(process.env.FLOW_ARTIFACT_DIR || join(root, 'artifacts'));
const consumer = realpathSync(mkdtempSync(join(tmpdir(), 'wise-flow-consumer-')));
assert.ok(!consumer.startsWith(realpathSync(root) + '/'));
const env = { ...process.env, npm_config_cache: process.env.npm_config_cache || join(tmpdir(), 'wise-flow-npm-cache') };
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
const output = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8' });
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
mkdirSync(artifactDir, { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
run('npm', ['pack', '--pack-destination', artifactDir]);
const tarball = join(artifactDir, `wise-flow-${pkg.version}.tgz`);
const sha = sha256(readFileSync(tarball));
writeFileSync(tarball + '.sha256', `${sha}  wise-flow-${pkg.version}.tgz\n`);
// Record the actual dirty source identity, including new files, without changing the index.
const baseCommit = output('git', ['rev-parse', 'HEAD']).trim();
const files = output('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
const sourceFiles = files.filter(p => existsSync(join(root, p))).map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
let patch = execFileSync('git', ['diff', '--binary', 'HEAD', '--'], { cwd: root });
for (const path of output('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
  try { execFileSync('git', ['diff', '--no-index', '--binary', '--', '/dev/null', path], { cwd: root }); }
  catch (error) { if (error.status !== 1) throw error; patch = Buffer.concat([patch, error.stdout]); }
}
const patchName = `wise-flow-${pkg.version}.patch`;
writeFileSync(join(artifactDir, patchName), patch);
const metadata = { name: pkg.name, version: pkg.version, sourceRepository: 'https://github.com/feelfine1977/wise-flow', baseCommit, dirty: patch.length > 0, patchFile: patchName, patchSha256: sha256(patch), sourceTreeSha256: sha256(JSON.stringify(sourceFiles)), sourceFiles, tarball: `wise-flow-${pkg.version}.tgz`, sha256: sha, published: false, node: process.version, platform: process.platform, consumer, checks: 'pending' };
const metadataPath = join(artifactDir, `wise-flow-${pkg.version}.provenance.json`);
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
cpSync(join(root, 'tests/package'), consumer, { recursive: true });
const require = createRequire(import.meta.url);
const version = name => require(`${name}/package.json`).version;
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@wise/flow': `file:${tarball}`, react: version('react'), 'react-dom': version('react-dom') }, devDependencies: { typescript: version('typescript'), vite: version('vite'), '@types/react': version('@types/react'), '@types/react-dom': version('@types/react-dom') } }, null, 2));
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
assert.equal(lstatSync(join(consumer, 'node_modules/@wise/flow')).isSymbolicLink(), false);
run(process.execPath, ['--experimental-loader', './deny-react.mjs', 'core.mjs'], consumer);
run(process.execPath, ['bpmn.mjs'], consumer);
writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, lib: ['ES2022', 'DOM'] }, files: ['types.ts'] }));
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'], consumer);
const installedRequire = createRequire(join(consumer, 'package.json'));
for (const path of ['tokens.css', 'style.css', 'react-flow.css', 'bpmn.css', 'bpmn/assets/bpmn-font/css/bpmn.css', 'bpmn/assets/bpmn-font/font/bpmn.woff2', 'elk-worker.min.js']) {
  assert.ok(readFileSync(installedRequire.resolve(`@wise/flow/${path}`)).length > 0);
}
for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/licenses/bpmn-js.txt', 'dist/licenses/elkjs.txt', 'dist/licenses/@xyflow-react.txt']) assert.ok(existsSync(join(consumer, 'node_modules/@wise/flow', path)));
// Load tooling from the consumer too, so its bundling cannot see checkout dependencies.
const { build, preview } = await import(pathToFileURL(join(consumer, 'node_modules/vite/dist/node/index.js')).href);
await build({ root: consumer, configFile: false, build: { target: 'es2022', assetsInlineLimit: 0 } });
const server = await preview({ root: consumer, configFile: false, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
const { chromium } = await import('playwright');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => errors.push(r.url() + ': ' + r.failure()?.errorText));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); if (r.ok()) requests.push(r.url()); });
  const { expect: baseExpect } = await import('@playwright/test');
  const expect = baseExpect.configure({ timeout: 30_000 });
  await page.goto(server.resolvedUrls.local[0]);
  page.setDefaultTimeout(30_000);
  await expect(page.locator('html')).toHaveAttribute('data-worker-layout', 'passed', { timeout: 30_000 });
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('[data-bpmn-status="ready"]')).toBeVisible();
  await expect(page.locator('.djs-element[data-element-id="receive"]')).toBeVisible();
  await expect(page.locator('.bjs-powered-by')).toBeVisible();
  assert.equal(await page.locator('.wf-bpmn').evaluate(root => {
    const watermark = root.querySelector('.bjs-powered-by').getBoundingClientRect();
    const panel = root.querySelector('.wf-bpmn__panel--bottom-right').getBoundingClientRect();
    return panel.left < watermark.right && panel.right > watermark.left && panel.top < watermark.bottom && panel.bottom > watermark.top;
  }), false, 'BPMN legend must not overlap the required watermark');
  // Import/teardown must not masquerade as a user clearing the host selection.
  const selectedTask = page.locator('.djs-element[data-element-id="receive"]');
  const assertSelection = async (events) => {
    await expect(page.locator('[data-bpmn-status="ready"]')).toBeVisible();
    await expect(selectedTask).toHaveClass(/\bselected\b/);
    await expect(page.getByTestId('bpmn-selection')).toHaveText('receive');
    await expect(page.getByTestId('bpmn-selection-events')).toHaveText(String(events));
  };
  await assertSelection(0);
  await page.getByRole('button', { name: 'Reload diagram' }).click();
  await assertSelection(0);
  await page.getByRole('button', { name: 'Hide diagram' }).click();
  await expect(page.locator('.wf-bpmn')).toHaveCount(0);
  await expect(page.getByTestId('bpmn-selection')).toHaveText('receive');
  await expect(page.getByTestId('bpmn-selection-events')).toHaveText('0');
  await page.getByRole('button', { name: 'Show diagram' }).click();
  await assertSelection(0);
  await page.getByRole('button', { name: 'Open modeler' }).click();
  await expect(page.locator('.djs-palette')).toBeVisible();
  await expect(page.locator('.bjs-powered-by')).toBeVisible();
  assert.equal(await page.locator('.wf-bpmn').evaluate(root => {
    const watermark = root.querySelector('.bjs-powered-by').getBoundingClientRect();
    const panel = root.querySelector('.wf-bpmn__panel--bottom-right').getBoundingClientRect();
    return panel.left < watermark.right && panel.right > watermark.left && panel.top < watermark.bottom && panel.bottom > watermark.top;
  }), false, 'BPMN legend must not overlap the required watermark');
  await assertSelection(0);
  // A real click on the blank canvas must still clear selection, and a task click select it again.
  await page.locator('.wf-bpmn .djs-container > svg').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('bpmn-selection')).toHaveText('none');
  await expect(page.getByTestId('bpmn-selection-events')).toHaveText('1');
  await selectedTask.click();
  await assertSelection(2);
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.fonts.check('16px bpmn')));
  assert.ok(requests.some(u => /elk-worker.*\.js/.test(u)), 'ELK worker must load as an asset');
  assert.ok(requests.some(u => /bpmn.*\.woff2/.test(u)), 'BPMN font must load as an asset');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(artifactDir, 'packed-consumer.png'), fullPage: true });
  metadata.checks = 'passed: isolated npm ci, Node ESM/headless, ELK/Dagre, BPMN round trip, NodeNext declarations, Vite production build, Chromium map/viewer/modeler/selection lifecycle and user deselection/CSS/fonts/worker';
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  console.log(metadata.checks + `\nArtifact: ${tarball}\nSHA256: ${sha}\nConsumer: ${consumer}`);
} catch (error) {
  metadata.checks = 'failed: ' + error.message;
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
