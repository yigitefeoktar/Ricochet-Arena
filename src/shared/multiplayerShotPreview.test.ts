import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceGuestShotVisual,
  getGuestShotPreviewTravelSeconds,
  getGuestShotVisualAlpha,
  getPlayerBulletTimeAtTravelFraction,
  getPlayerBulletTravelSecondsBetween,
  type GuestShotVisualState,
} from './multiplayerShotPreview';

test('guest shot preview exactly mirrors the existing initial speed burst', () => {
  assert.equal(getGuestShotPreviewTravelSeconds(0), 0);
  assert.equal(getGuestShotPreviewTravelSeconds(50), 0.175);
  assert.equal(getGuestShotPreviewTravelSeconds(100), 0.35);
  assert.equal(getGuestShotPreviewTravelSeconds(250), 0.875);
  assert.equal(getGuestShotPreviewTravelSeconds(350), 0.975);
});

test('guest shot preview rejects invalid elapsed time', () => {
  assert.equal(getGuestShotPreviewTravelSeconds(Number.NaN), 0);
  assert.equal(getGuestShotPreviewTravelSeconds(-50), 0);
});

test('host catch-up integrates the burst boundary without changing bullet speed rules', () => {
  assert.equal(getPlayerBulletTravelSecondsBetween(1_000, 1_100, 1_200), 0.35);
  assert.equal(getPlayerBulletTravelSecondsBetween(1_000, 1_200, 1_300), 0.225);
  assert.equal(getPlayerBulletTravelSecondsBetween(1_000, 1_300, 1_400), 0.1);
});

test('collision timestamps invert distance fractions across the burst boundary', () => {
  const start = 1_200;
  const end = 1_300;
  const total = getPlayerBulletTravelSecondsBetween(1_000, start, end);
  const burstTravel = getPlayerBulletTravelSecondsBetween(1_000, start, 1_250);
  const fractionAtBurstEnd = burstTravel / total;
  assert.ok(Math.abs(getPlayerBulletTimeAtTravelFraction(1_000, start, end, fractionAtBurstEnd) - 1_250) < 1e-9);
  assert.equal(getPlayerBulletTimeAtTravelFraction(1_000, start, end, 0), start);
  assert.equal(getPlayerBulletTimeAtTravelFraction(1_000, start, end, 1), end);
});

const visual = (): GuestShotVisualState => ({
  x: 0,
  y: 50,
  dx: 120,
  dy: 0,
  radius: 5,
  colorIdx: 0,
  allowedBlockKeys: [],
  spawnTime: 0,
  lastUpdateTime: 0,
  lastWorldPhaseTime: 0,
  isNeutral: false,
  bounceCount: 0,
});

test('continuous local visual never depends on an authoritative position handoff', () => {
  const wall = [{ id: 'wall', kind: 'wall' as const, x: 100, y: 0, w: 10, h: 100 }];
  const run = (fps: number) => {
    let state = visual();
    const stepMs = 1_000 / fps;
    for (let time = stepMs; time < 300 - 1e-9; time += stepMs) {
      state = advanceGuestShotVisual(state, time, wall);
    }
    return advanceGuestShotVisual(state, 300, wall);
  };
  const at30 = run(30);
  const at120 = run(120);
  assert.ok(Math.abs(at30.x - at120.x) < 1e-5);
  assert.ok(Math.abs(at30.y - at120.y) < 1e-5);
  assert.ok(Math.abs(at30.dx - at120.dx) < 1e-5);
  assert.equal(at30.bounceCount, at120.bounceCount);
  assert.equal(at30.isNeutral, true);
});

test('host-confirmed endings fade instead of snapping the visual away', () => {
  const ending = { ...visual(), endingAt: 1_000 };
  assert.equal(getGuestShotVisualAlpha(ending, 1_000), 1);
  assert.equal(getGuestShotVisualAlpha(ending, 1_040), 0.5);
  assert.equal(getGuestShotVisualAlpha(ending, 1_080), 0);
});
