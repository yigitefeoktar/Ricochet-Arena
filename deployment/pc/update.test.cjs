const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deployCandidate, run } = require('./update.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const manifest = { schemaVersion: 1, branch: 'main', backend: { provider: 'pc', buildScript: 'build:backend', entry: 'dist/backend/server.cjs', healthPath: '/api/health' } };
test('frontend-only repository never builds or starts a backend', async () => {
  const unexpected = async () => assert.fail('Backend operation called for frontend-only game');
  for (const value of [{}, { backend: null }]) assert.equal((await deployCandidate(value, { build: unexpected, probe: unexpected, activate: unexpected })).status, 'skipped');
});
test('a failed build keeps the existing backend running', async () => {
  await assert.rejects(deployCandidate(manifest, {
    build: async () => { throw new Error('Compilation failure'); },
    probe: async () => assert.fail('Probed failed build'), activate: async () => assert.fail('Replaced working backend'),
  }), /Compilation failure/);
});
test('a failed candidate smoke test keeps the existing backend running', async () => {
  await assert.rejects(deployCandidate(manifest, {
    build: async () => {}, probe: async () => { throw new Error('Room join failed'); }, activate: async () => assert.fail('Replaced working backend'),
  }), /Room join failed/);
});
test('only a healthy candidate is activated and activation failure is surfaced', async () => {
  const events = [];
  assert.equal((await deployCandidate(manifest, { build: async () => events.push('build'), probe: async () => events.push('probe'), activate: async () => events.push('activate') })).status, 'success');
  assert.deepEqual(events, ['build', 'probe', 'activate']);
  await assert.rejects(deployCandidate(manifest, { build: async () => {}, probe: async () => {}, activate: async () => { throw new Error('Rolled back'); } }), /Rolled back/);
});
test('unsupported backend targets fail before any operations', async () => {
  await assert.rejects(deployCandidate({ ...manifest, backend: { ...manifest.backend, provider: 'cloud-run' } }, {}), /Unsupported/);
});

async function updaterFixture(t, state, declared = manifest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ricochet-updater-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const config = {
    repository: 'https://github.com/yigitefeoktar/Ricochet-Arena.git', root,
    gitExe: process.execPath, tarExe: process.execPath, powershellExe: process.execPath,
    npmCli: process.execPath, probePort: 4105,
    pauseFile: path.join(root, 'paused'), currentFile: path.join(root, 'current.json'),
  };
  const configFile = path.join(root, 'config.json');
  await fs.mkdir(path.join(root, 'cache', '.git'), { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(config));
  await fs.writeFile(config.currentFile, JSON.stringify({ commit: sha, directory: path.join(root, 'active') }));
  await fs.writeFile(path.join(root, 'status.json'), JSON.stringify({ sha, ...state }));
  const calls = [];
  const command = async (_executable, args) => {
    calls.push(args[0]);
    if (args[0] === 'remote') return config.repository;
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'show') return JSON.stringify(declared);
    assert.fail('Unexpected build, activation or pruning command: ' + args.join(' '));
  };
  return { configFile, root, sha, calls, command };
}

test('fetch timeout recovers on the next poll without rebuilding or restarting active main', async t => {
  const fixture = await updaterFixture(t, { status: 'success' });
  let unavailable = true;
  let healthChecks = 0;
  let polls = 0;
  const stop = new Error('Finished two polls');
  await assert.rejects(run(fixture.configFile, false, {
    command: async (exe, args) => {
      if (args[0] === 'fetch' && unavailable) throw new Error('git timed out');
      return fixture.command(exe, args);
    },
    checkActiveHealth: async () => { healthChecks++; },
    delay: async () => {
      if (++polls === 1) {
        const failed = JSON.parse(await fs.readFile(path.join(fixture.root, 'status.json')));
        assert.equal(failed.status, 'failed');
        assert.equal(failed.phase, 'sync');
        unavailable = false;
      } else throw stop;
    },
  }), error => error === stop);
  const state = JSON.parse(await fs.readFile(path.join(fixture.root, 'status.json')));
  assert.equal(state.status, 'success');
  assert.equal(state.sha, fixture.sha);
  assert.equal(state.recovered, true);
  assert.equal(healthChecks, 1);
  assert.deepEqual(fixture.calls, ['remote', 'remote', 'fetch', 'rev-parse', 'show']);
});

test('legacy timeout state recovers only after active health succeeds', async t => {
  const fixture = await updaterFixture(t, { status: 'failed', error: 'git timed out' });
  const failed = await run(fixture.configFile, true, {
    command: fixture.command, checkActiveHealth: async () => { throw new Error('Backend offline'); },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.phase, 'health');
  const recovered = await run(fixture.configFile, true, {
    command: fixture.command, checkActiveHealth: async () => {},
  });
  assert.equal(recovered.status, 'success');
  assert.equal(recovered.recovered, true);
});

test('frontend-only recovery skips even active backend health checks', async t => {
  const fixture = await updaterFixture(t, { status: 'failed', phase: 'sync' }, { backend: null });
  const state = await run(fixture.configFile, true, {
    command: fixture.command, checkActiveHealth: async () => assert.fail('Backend health called'),
  });
  assert.equal(state.status, 'skipped');
});

test('failed candidate is not retried on every unchanged main poll', async t => {
  const fixture = await updaterFixture(t, { status: 'failed', phase: 'deploy' });
  const stop = new Error('Finished poll');
  await assert.rejects(run(fixture.configFile, false, {
    command: fixture.command, checkActiveHealth: async () => assert.fail('Deployment failure treated as sync recovery'),
    delay: async () => { throw stop; },
  }), error => error === stop);
  assert.deepEqual(fixture.calls, ['remote', 'fetch', 'rev-parse']);
});
