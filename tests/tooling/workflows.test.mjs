import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontArrangementViolations, visualLaneViolations, workflowViolations } from '../../scripts/check-workflows.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const header = 'permissions: {contents: read}\nconcurrency: ci\njobs:\n  check:\n    timeout-minutes: 10\n    steps:\n';
test('workflow validation rejects mutable or unlabelled actions, duplicate YAML and ignored failures', () => {
  assert.match(workflowViolations(header + '      - uses: actions/checkout@v4')[0], /full commit/);
  assert.match(workflowViolations(header + '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')[0], /version comment/);
  assert.match(workflowViolations(header + '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # latest')[0], /version comment/);
  assert.deepEqual(workflowViolations(header + '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'), []);
  assert.ok(workflowViolations('name: a\nname: b').length);
  assert.match(workflowViolations(header + '      - run: npm test\n        continue-on-error: true')[0], /ignore failures/);
});
test('strict visual assertions are accepted, baseline approval is rejected', () => {
  assert.deepEqual(workflowViolations(header + '      - run: npm run test:visual -- --update-snapshots=none'), []);
  assert.match(workflowViolations(header + '      - run: npm run test:visual -- --update-snapshots=all')[0], /approve/);
});
const digest = 'mcr.microsoft.com/playwright@sha256:' + 'ab'.repeat(32);
const record = { linux: { image: digest } };
const visualJob = (lines) => 'permissions: {contents: read}\nconcurrency: ci\njobs:\n  visual:\n    timeout-minutes: 20\n' + lines + '    steps:\n      - run: npm ci\n      - run: npm run test:visual -- --update-snapshots=none\n';
test('a job container is accepted only when its image is pinned by digest', () => {
  assert.deepEqual(workflowViolations(header.replace('    steps:\n', `    container:\n      image: ${digest}\n    steps:\n`) + '      - run: npm test'), []);
  assert.deepEqual(workflowViolations(header.replace('    steps:\n', `    container: ${digest}\n    steps:\n`) + '      - run: npm test'), []);
  for (const image of ['mcr.microsoft.com/playwright:v1.61.1-noble', 'mcr.microsoft.com/playwright', 'mcr.microsoft.com/playwright@sha256:abc']) {
    assert.match(workflowViolations(header.replace('    steps:\n', `    container:\n      image: ${image}\n    steps:\n`) + '      - run: npm test')[0], /pinned by digest/);
  }
});
test('the strict visual job runs in the image the provenance record names and installs nothing over it', () => {
  assert.deepEqual(visualLaneViolations(visualJob(`    container:\n      image: ${digest}\n`), record), []);
  assert.deepEqual(visualLaneViolations(visualJob(`    container: ${digest}\n`), record), []);
  assert.match(visualLaneViolations(visualJob(''), record)[0], /image the provenance record names/);
  assert.match(visualLaneViolations(visualJob(`    container:\n      image: ${digest.replace('ab', 'cd')}\n`), record)[0], /image the provenance record names/);
  assert.match(visualLaneViolations(visualJob(`    container: ${digest}\n`).replace('      - run: npm ci\n', '      - run: npm ci\n      - run: npx --no-install playwright install --with-deps chromium\n'), record)[0], /installs nothing/);
  assert.match(visualLaneViolations(header + '      - run: npm test', record)[0], /no job visual/);
  assert.match(visualLaneViolations(visualJob(`    container: ${digest}\n`), {})[0], /image the provenance record names/);
});
test('the repository\'s visual job runs in the image of its provenance record, with the Playwright version recorded there', () => {
  const provenance = JSON.parse(readFileSync(resolve(root, 'tests/visual/baseline-provenance.json'), 'utf8'));
  assert.deepEqual(visualLaneViolations(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'), provenance), []);
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/@playwright/test'].version, provenance.playwright);
});
const fontconfig = resolve(root, 'tests/visual/fonts.conf');
const rule = (family) => `  <match target="pattern">\n    <test name="family"><string>${family}</string></test>\n    <edit name="family" mode="assign" binding="strong"><string>Liberation Sans</string></edit>\n  </match>\n`;
const include = '  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n';
const conf = (body) => `<?xml version="1.0"?>\n<fontconfig>\n${body}</fontconfig>\n`;
test('the visual lane\'s fonts map system-ui and the generic sans to Liberation Sans ahead of the system configuration', () => {
  assert.deepEqual(fontArrangementViolations(fontconfig, conf(rule('system-ui') + rule('sans-serif') + include)), []);
  assert.match(fontArrangementViolations(undefined, conf(rule('system-ui') + rule('sans-serif') + include))[0], /FONTCONFIG_FILE/);
  assert.match(fontArrangementViolations('/etc/fonts/fonts.conf', conf(rule('system-ui') + rule('sans-serif') + include))[0], /FONTCONFIG_FILE/);
  assert.match(fontArrangementViolations(fontconfig, conf(rule('sans-serif') + include))[0], /system-ui/);
  assert.match(fontArrangementViolations(fontconfig, conf(rule('system-ui') + include))[0], /sans-serif/);
  assert.match(fontArrangementViolations(fontconfig, conf(include + rule('system-ui') + rule('sans-serif')))[0], /system-ui.*before/);
  assert.match(fontArrangementViolations(fontconfig, conf(rule('system-ui') + rule('sans-serif')))[0], /system configuration/);
  assert.match(fontArrangementViolations(fontconfig, conf(rule('system-ui').replace('binding="strong"', 'binding="weak"') + rule('sans-serif') + include))[0], /system-ui/);
  assert.match(fontArrangementViolations(fontconfig, conf(`<!--\n${rule('system-ui')}-->\n` + rule('sans-serif') + include))[0], /system-ui/);
});
test('the strict visual configuration and its approval hand the repository\'s fonts to the browser', async () => {
  const { default: strict } = await import('../visual/playwright.config.ts');
  const file = strict.use?.launchOptions?.env?.FONTCONFIG_FILE;
  assert.deepEqual(fontArrangementViolations(file, readFileSync(file, 'utf8')), []);
  // The browser keeps the rest of the lane's environment.
  assert.equal(strict.use.launchOptions.env.PATH, process.env.PATH);
  // Approval is the strict configuration with recording switched on, nothing else.
  assert.match(readFileSync(resolve(root, 'tests/visual/playwright.approve.config.ts'), 'utf8'), /export default defineConfig\(strict, \{ updateSnapshots: "all" \}\);/);
});
