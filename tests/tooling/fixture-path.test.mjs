import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const localPath = /\/(?:Users|home)\/[^\s/"'<>]+|[A-Za-z]:[\\/]+Users[\\/]+/i;

test('tracked files contain no personal absolute paths', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const violations = files.filter(file => localPath.test(file) || localPath.test(readFileSync(file).toString()));
  assert.deepEqual(violations, []);
});

test('personal path detection covers Unix and Windows forms', () => {
  for (const path of ['/' + 'Users/alice/data.csv', '/' + 'home/alice/data.csv', 'C:' + '\\Users\\alice\\data.csv', 'C:/' + 'Users/alice/data.csv']) {
    assert.ok(localPath.test(path));
  }
  assert.equal(localPath.test('path/to/data.csv'), false);
});

test('personal path detection covers escaped Windows literals in source files', () => {
  const slash = '\\'.repeat(2);
  assert.ok(localPath.test(`const csv = "C:${slash}Users${slash}alice${slash}data.csv";`));
});

test('fixture input is required, with download instructions before optional imports', () => {
  const result = spawnSync('python3', ['-S', 'fixtures/build_bpic2019_fixture.py'], {
    encoding: 'utf8', env: { ...process.env, BPIC2019_CSV: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BPIC2019_CSV/);
  assert.match(result.stderr, /https:\/\/doi.org\/10.4121\/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1/);
  assert.doesNotMatch(result.stderr, /Traceback/);
});

test('fixture reads the argument before the environment, and accepts the environment alone', () => {
  // Stop at the CSV reader so the gate needs neither pandas nor the public log.
  const probe = `
import runpy, sys, types
sys.modules['numpy'] = types.ModuleType('numpy')
pandas = types.ModuleType('pandas')
def read_csv(path, **kwargs):
    print(path)
    raise SystemExit(0)
pandas.read_csv = read_csv
sys.modules['pandas'] = pandas
sys.argv = ['fixtures/build_bpic2019_fixture.py'] + sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
`;
  for (const [args, expected] of [[[], 'environment.csv'], [['argument with spaces.csv'], 'argument with spaces.csv']]) {
    const result = spawnSync('python3', ['-S', '-c', probe, ...args], {
      encoding: 'utf8', env: { ...process.env, BPIC2019_CSV: 'environment.csv' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
});
