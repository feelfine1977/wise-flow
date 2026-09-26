import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowViolations } from '../../scripts/check-workflows.mjs';
const header = 'permissions: {contents: read}\nconcurrency: ci\njobs:\n  check:\n    timeout-minutes: 10\n    steps:\n';
test('workflow validation rejects mutable actions, duplicate YAML and ignored failures', () => {
  assert.match(workflowViolations(header + '      - uses: actions/checkout@v4')[0], /full commit/);
  assert.ok(workflowViolations('name: a\nname: b').length);
  assert.match(workflowViolations(header + '      - run: npm test\n        continue-on-error: true')[0], /ignore failures/);
});
test('strict visual assertions are accepted, baseline approval is rejected', () => {
  assert.deepEqual(workflowViolations(header + '      - run: npm run test:visual -- --update-snapshots=none'), []);
  assert.match(workflowViolations(header + '      - run: npm run test:visual -- --update-snapshots=all')[0], /approve/);
});
