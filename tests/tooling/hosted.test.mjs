import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstProcessors, verdict } from '../../scripts/test-hosted.mjs';

test('the hosted run is pinned to the first processors the machine allows', () => {
  assert.equal(firstProcessors('0-9', 2), '0,1');
  assert.equal(firstProcessors('4-9', 2), '4,5');
  assert.equal(firstProcessors('3,7-9', 3), '3,7,8');
  assert.equal(firstProcessors('5', 1), '5');
  assert.throws(() => firstProcessors('0', 2), /only 1 processors are available, 2 asked for/);
});

test('a test is tight when it passes in more than the headroom of its own time limit, and a failed one is never tight', () => {
  const tests = [
    { name: 'quick', state: 'passed', duration: 1000, timeout: 30000 },
    { name: 'half', state: 'passed', duration: 15000, timeout: 30000 },
    { name: 'long but given the time', state: 'passed', duration: 50000, timeout: 120000 },
    { name: 'close', state: 'passed', duration: 25000, timeout: 30000 },
    { name: 'closer', state: 'passed', duration: 29000, timeout: 30000 },
    { name: 'timed out', state: 'failed', duration: 30000, timeout: 30000 },
    { name: 'skipped', state: 'skipped', duration: 0, timeout: 30000 },
  ];
  const { failed, tight } = verdict(tests, 0.5);
  assert.deepEqual(failed.map(t => t.name), ['timed out']);
  assert.deepEqual(tight.map(t => t.name), ['closer', 'close']);
  assert.deepEqual(verdict(tests, 0.9).tight.map(t => t.name), ['closer']);
});
