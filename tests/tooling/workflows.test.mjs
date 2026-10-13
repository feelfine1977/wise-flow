import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontArrangementViolations, workflowViolations } from '../../scripts/check-workflows.mjs';
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
