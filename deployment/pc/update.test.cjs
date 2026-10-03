const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deployCandidate } = require('./update.cjs');
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
