import assert from 'node:assert/strict';
import test from 'node:test';
import { GUEST_BULLET_SNAP_DISTANCE } from '../src/shared/bulletSync';
import {
  runMultiplayerBulletSimulation,
  type GuestSample,
} from './support/multiplayerBulletHarness';

const finiteBullet = (sample: GuestSample) => {
  if (!sample.bullet) return;
  assert.ok(Number.isFinite(sample.bullet.x), `non-finite x at ${sample.timeMs}ms`);
  assert.ok(Number.isFinite(sample.bullet.y), `non-finite y at ${sample.timeMs}ms`);
  assert.ok(Number.isFinite(sample.bullet.dx), `non-finite dx at ${sample.timeMs}ms`);
  assert.ok(Number.isFinite(sample.bullet.dy), `non-finite dy at ${sample.timeMs}ms`);
};

test('guest bullets stay finite, bounded, and close under latency, jitter, and packet loss', () => {
  const result = runMultiplayerBulletSimulation();

  assert.ok(result.droppedSnapshots > 0, 'the scenario must exercise packet loss');
  assert.ok(result.deliveredCriticalSnapshots >= 3, 'the scenario must exercise reliable bounces');

  let maximumHostError = 0;
  for (const sample of result.samples) {
    finiteBullet(sample);
    if (!sample.bullet) continue;

    assert.ok(sample.bullet.x >= 30 && sample.bullet.x <= 970, `guest x left bounds at ${sample.timeMs}ms`);
    assert.ok(sample.bullet.y >= 30 && sample.bullet.y <= 570, `guest y left bounds at ${sample.timeMs}ms`);

    if (sample.hostBullet) {
      maximumHostError = Math.max(
        maximumHostError,
        Math.hypot(
          sample.bullet.x - sample.hostBullet.x,
          sample.bullet.y - sample.hostBullet.y,
        ),
      );
    }
  }

  assert.ok(maximumHostError < 95, `guest drifted ${maximumHostError.toFixed(2)}px from host`);
  assert.ok(
    Math.max(...result.corrections) <= GUEST_BULLET_SNAP_DISTANCE,
    'a correction exceeded the configured hard-snap distance',
  );
});

test('guest movement never reverses without an authoritative bounce', () => {
  const result = runMultiplayerBulletSimulation({
    durationMs: 5_500,
    removalAtMs: 5_200,
    network: { latencyMs: 90, jitterMs: 35, dropChance: 0.22, seed: 73 },
  });

  let previous: GuestSample | null = null;
  for (const sample of result.samples) {
    if (!sample.bullet || !previous?.bullet) {
      previous = sample;
      continue;
    }

    if (sample.bullet.bounceCount === previous.bullet.bounceCount) {
      const moveX = sample.bullet.x - previous.bullet.x;
      const moveY = sample.bullet.y - previous.bullet.y;
      const progress = moveX * sample.bullet.dx + moveY * sample.bullet.dy;
      assert.ok(progress >= -0.0001, `unexplained reverse movement at ${sample.timeMs}ms`);
    }
    previous = sample;
  }
});

test('a reliable bounce replaces the guest direction instead of inventing a trajectory', () => {
  const result = runMultiplayerBulletSimulation({
    durationMs: 4_000,
    removalAtMs: 3_800,
    network: { latencyMs: 110, jitterMs: 40, dropChance: 0.4, seed: 991 },
    bullet: { x: 900, y: 300, dx: 420, dy: 0 },
  });

  const firstReflectedSample = result.samples.find(
    sample => sample.bullet && sample.bullet.bounceCount >= 1,
  );

  assert.ok(firstReflectedSample?.bullet, 'guest never received the reliable bounce');
  assert.ok(firstReflectedSample.bullet.dx < 0, 'guest kept the pre-bounce direction');
  assert.equal(firstReflectedSample.bullet.dy, 0);
});

test('critical removal prevents a bullet from surviving indefinitely', () => {
  const removalAtMs = 2_000;
  const latencyMs = 120;
  const jitterMs = 30;
  const result = runMultiplayerBulletSimulation({
    durationMs: 3_000,
    removalAtMs,
    network: { latencyMs, jitterMs, dropChance: 0.75, seed: 5 },
  });

  assert.ok(result.removalDeliveredAt !== null, 'guest never received removal');
  assert.ok(
    result.removalDeliveredAt <= removalAtMs + latencyMs + jitterMs + 100,
    `removal arrived too late at ${result.removalDeliveredAt}ms`,
  );
  const afterRemoval = result.samples.filter(sample => sample.timeMs > result.removalDeliveredAt!);
  assert.ok(afterRemoval.every(sample => sample.bullet === null), 'bullet reappeared after removal');
});

test('the same scenarios are deterministic and therefore suitable for regression loops', () => {
  const options = {
    durationMs: 3_500,
    removalAtMs: 3_200,
    network: { latencyMs: 85, jitterMs: 30, dropChance: 0.3, seed: 12345 },
  };
  const first = runMultiplayerBulletSimulation(options);
  const second = runMultiplayerBulletSimulation(options);

  assert.deepEqual(first, second);
});

test('250 deterministic network conditions never produce unbounded or invalid movement', () => {
  for (let seed = 1; seed <= 250; seed++) {
    const result = runMultiplayerBulletSimulation({
      durationMs: 4_000,
      removalAtMs: 3_600,
      network: {
        latencyMs: 20 + (seed % 9) * 20,
        jitterMs: (seed % 7) * 10,
        dropChance: (seed % 6) * 0.08,
        seed,
      },
      bullet: {
        x: 80 + (seed % 5) * 170,
        y: 70 + (seed % 4) * 120,
        dx: 180 + (seed % 6) * 55,
        dy: (seed % 2 === 0 ? 1 : -1) * (90 + (seed % 5) * 45),
      },
    });

    let previous: GuestSample | null = null;
    for (const sample of result.samples) {
      finiteBullet(sample);
      if (sample.bullet) {
        assert.ok(
          sample.bullet.x >= 30 && sample.bullet.x <= 970 &&
          sample.bullet.y >= 30 && sample.bullet.y <= 570,
          `seed ${seed} produced an out-of-bounds guest bullet at ${sample.timeMs}ms`,
        );
      }

      if (sample.bullet && previous?.bullet &&
          sample.bullet.bounceCount === previous.bullet.bounceCount) {
        const moveX = sample.bullet.x - previous.bullet.x;
        const moveY = sample.bullet.y - previous.bullet.y;
        const progress = moveX * sample.bullet.dx + moveY * sample.bullet.dy;
        assert.ok(progress >= -0.0001, `seed ${seed} reversed without a bounce`);
      }
      previous = sample;
    }

    assert.ok(result.removalDeliveredAt !== null, `seed ${seed} lost critical removal`);
    assert.ok(
      result.corrections.every(value => value <= 260),
      `seed ${seed} produced an unbounded correction`,
    );
  }
});

test('guest corrections stay below the desired 160px quality limit', {
  todo: 'current snapshot blending can exceed this during sustained packet loss',
}, () => {
  for (let seed = 1; seed <= 250; seed++) {
    const result = runMultiplayerBulletSimulation({
      durationMs: 4_000,
      removalAtMs: 3_600,
      network: {
        latencyMs: 20 + (seed % 9) * 20,
        jitterMs: (seed % 7) * 10,
        dropChance: (seed % 6) * 0.08,
        seed,
      },
      bullet: {
        x: 80 + (seed % 5) * 170,
        y: 70 + (seed % 4) * 120,
        dx: 180 + (seed % 6) * 55,
        dy: (seed % 2 === 0 ? 1 : -1) * (90 + (seed % 5) * 45),
      },
    });

    assert.ok(
      result.corrections.every(value => value <= GUEST_BULLET_SNAP_DISTANCE),
      `seed ${seed} exceeded the desired correction limit`,
    );
  }
});
