// Installed bootstrap polls one explicitly configured GitHub repository, never a developer checkout.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function backendPlan(manifest) {
  if (!manifest || manifest.backend == null) return null;
  const backend = manifest.backend;
  if (manifest.schemaVersion !== 1 || manifest.branch !== 'main' || backend.provider !== 'pc' ||
      backend.buildScript !== 'build:backend' || backend.entry !== 'dist/backend/server.cjs' ||
      backend.healthPath !== '/api/health') throw new Error('Unsupported explicit PC backend contract');
  return backend;
}

async function deployCandidate(manifest, ops) {
  if (!backendPlan(manifest)) return { status: 'skipped', reason: 'No PC backend declared' };
  await ops.build(); // A failed build must not stop or replace the running release.
  await ops.probe(); // A failed isolated probe must not stop the running release either.
  await ops.activate(); // Activation owns rollback to the previous release on failure.
  return { status: 'success' };
}

function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = data => { output = (output + data.toString()).slice(-12000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${executable} timed out`)); }, 180000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${path.basename(executable)} exited ${code}: ${output.slice(-2500)}`));
    });
  });
}

async function atomicJson(file, value) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

async function probe(release, config) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(config.probePort, '127.0.0.1', () => listener.close(resolve));
  });
  const child = spawn(process.execPath, ['dist/backend/server.cjs'], {
    cwd: release, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(config.probePort), SERVE_FRONTEND: 'false' },
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  try {
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('Candidate backend exited during preflight');
      try {
        const response = await fetch(`http://127.0.0.1:${config.probePort}/api/health`, { signal: AbortSignal.timeout(1000) });
        if ((await response.json()).status === 'ok') { healthy = true; break; }
      } catch {}
      await delay(250);
    }
    if (!healthy) throw new Error('Candidate health preflight failed');
    // Exercise rooms, match start, state/input relay, reconnect, polling and WebSocket.
    await command(process.execPath, [path.join(release, 'deployment/pc/smoke.cjs')], {
      cwd: release, env: { ...process.env, PILOT_BACKEND_URL: `http://127.0.0.1:${config.probePort}` },
    });
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
    }
  }
}

async function run(configFile, once = false) {
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(config.repository)) throw new Error('Expected an explicit GitHub HTTPS repository');
  if (!Number.isInteger(config.probePort) || config.probePort === 4103) throw new Error('Use a separate candidate test port');
  await fs.mkdir(config.root, { recursive: true });
  const cache = path.join(config.root, 'cache');
  const releases = path.join(config.root, 'releases');
  const stateFile = path.join(config.root, 'status.json');
  await fs.mkdir(releases, { recursive: true });
  const log = async message => {
    const file = path.join(config.root, 'updates.log');
    if ((await fs.stat(file).catch(() => ({ size: 0 }))).size > 1024 * 1024) await fs.rename(file, `${file}.previous`).catch(() => {});
    await fs.appendFile(file, `${new Date().toISOString()} ${message}\n`);
  };
  let state = JSON.parse(await fs.readFile(stateFile, 'utf8').catch(() => '{}'));
  do {
    let sha;
    try {
      if (await fs.stat(config.pauseFile).then(() => true, () => false)) {
        if (once) return { status: 'paused' };
        await delay(2000); continue;
      }
      if (!await fs.stat(path.join(cache, '.git')).then(() => true, () => false)) {
        await command('git.exe', ['clone', '--no-checkout', '--single-branch', '--branch', 'main', config.repository, cache]);
      }
      if (await command('git.exe', ['remote', 'get-url', 'origin'], { cwd: cache }) !== config.repository) throw new Error('Cache repository identity mismatch');
      await command('git.exe', ['fetch', 'origin', 'main'], { cwd: cache });
      sha = await command('git.exe', ['rev-parse', 'FETCH_HEAD'], { cwd: cache });
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid GitHub commit identity');
      const current = JSON.parse((await fs.readFile(config.currentFile, 'utf8')).replace(/^\uFEFF/, ''));
      if (current.commit === sha && state.status === 'success') {
        if (once) return state;
      } else if (sha !== state.sha || state.status === 'building' || once) {
        const raw = await command('git.exe', ['show', `${sha}:deployment.json`], { cwd: cache }).catch(() => '{}');
        const manifest = JSON.parse(raw);
        // Decide whether a backend exists before install, build, probe or any process changes.
        if (!backendPlan(manifest)) {
          state = { sha, status: 'skipped', reason: 'No PC backend declared', at: new Date().toISOString() };
        } else {
          const release = path.join(releases, sha);
          await fs.mkdir(release, { recursive: true });
          const archive = path.join(config.root, 'candidate.tar');
          state = { sha, status: 'building', at: new Date().toISOString() };
          await atomicJson(stateFile, state);
          await log(`Building GitHub main ${sha}`);
          const result = await deployCandidate(manifest, {
            build: async () => {
              await command('git.exe', ['archive', '--format=tar', `--output=${archive}`, sha], { cwd: cache });
              await command('tar.exe', ['-xf', archive, '-C', release]);
              // npm-cli.js avoids command-shell quoting and Windows .cmd spawning.
              await command(process.execPath, [config.npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: release });
              await command(process.execPath, [config.npmCli, 'run', 'lint'], { cwd: release });
              await command(process.execPath, [config.npmCli, 'run', 'build:backend'], { cwd: release });
            },
            probe: () => probe(release, config),
            activate: () => command('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', config.activateScript], {
              env: { ...process.env, RICOCHET_RELEASE: release, RICOCHET_COMMIT: sha, RICOCHET_DEPLOY_CONFIG: path.resolve(configFile) },
            }),
          });
          state = { sha, ...result, at: new Date().toISOString() };
        }
        await atomicJson(stateFile, state);
        await log(`${sha} ${state.status}`);
        // Pruning is restricted to validated release children; keep active + last good + latest attempt.
        await command('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', config.pruneScript], {
          env: { ...process.env, RICOCHET_DEPLOY_CONFIG: path.resolve(configFile) },
        }).catch(error => log(`Prune deferred: ${error.message}`));
      }
    } catch (error) {
      state = { sha: sha || state.sha, status: 'failed', error: error.message, at: new Date().toISOString() };
      await atomicJson(stateFile, state);
      await log(`Update failed; previous release retained: ${error.message}`);
    }
    if (once) return state;
    await delay(60000);
  } while (true);
}

module.exports = { backendPlan, deployCandidate, run };
if (require.main === module) (async () => {
  const configFile = process.argv[2];
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  await fs.mkdir(config.root, { recursive: true });
  const lockPath = path.join(config.root, 'updater.lock');
  const old = JSON.parse(await fs.readFile(lockPath, 'utf8').catch(() => '{}'));
  if (old.pid) {
    let alive = false;
    try { process.kill(old.pid, 0); alive = true; } catch {}
    if (alive) throw new Error('An updater is already running; stop its Windows task before a manual retry.');
    await fs.unlink(lockPath);
  }
  const lock = await fs.open(lockPath, 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  await lock.close();
  try {
    const result = await run(configFile, process.argv.includes('--once'));
    if (result) console.log(JSON.stringify(result));
    if (result?.status === 'failed') process.exitCode = 1;
  } finally { await fs.unlink(lockPath).catch(() => {}); }
  // Windows descendants may retain inherited pipe handles after activation.
  if (process.argv.includes('--once')) process.exit(process.exitCode || 0);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
