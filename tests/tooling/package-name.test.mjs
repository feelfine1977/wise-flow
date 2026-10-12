import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
// Written in two parts so that this file does not hold the former name itself.
const formerName = ['@wise', 'flow'].join('/');

test('the package, its lockfile and every changeset name the package wise-flow', () => {
  assert.equal(JSON.parse(read('package.json')).name, 'wise-flow');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.name, 'wise-flow');
  assert.equal(lock.packages[''].name, 'wise-flow');
  const changesets = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '.changeset/*.md'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((path) => path && !path.endsWith('README.md'));
  assert.ok(changesets.length > 0);
  for (const path of changesets) {
    const front = read(path).split('---')[1];
    assert.deepEqual(front.trim().split('\n').map((line) => line.split(':')[0].trim()), ['"wise-flow"'], path);
  }
});

test('Changesets publishes the unscoped package as public, the only access npm allows it', () => {
  assert.equal(JSON.parse(read('.changeset/config.json')).access, 'public');
});

test('the former name is written only in the changeset and the migration note that name it on purpose', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter((path) => path && existsSync(join(root, path)));
  const found = files.filter((path) => readFileSync(join(root, path)).includes(formerName));
  assert.deepEqual(found.sort(), ['.changeset/package-name-wise-flow.md', 'docs/API.md']);
  // In the API document, only its section "Package name" names the former name.
  const sections = read('docs/API.md').split(/^(?=## )/m);
  assert.deepEqual(sections.filter((section) => section.includes(formerName)).map((section) => section.split('\n')[0]), ['## Package name']);
});
