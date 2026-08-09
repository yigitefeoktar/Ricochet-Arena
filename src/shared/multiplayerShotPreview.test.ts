import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGuestShotPreviewTravelSeconds,
  getPlayerBulletTimeAtTravelFraction,
  getPlayerBulletTravelSecondsBetween,
  MAX_GUEST_SHOT_PREVIEW_MS,
} from './multiplayerShotPreview';

test('guest shot preview exactly mirrors the existing initial speed burst', () => {
  assert.equal(getGuestShotPreviewTravelSeconds(0), 0);
  assert.equal(getGuestShotPreviewTravelSeconds(50), 0.175);
  assert.equal(getGuestShotPreviewTravelSeconds(100), 0.35);
  assert.equal(getGuestShotPreviewTravelSeconds(250), 0.875);
  assert.equal(getGuestShotPreviewTravelSeconds(350), 0.975);
});

test('guest shot preview is bounded and rejects invalid elapsed time', () => {
  const bounded = getGuestShotPreviewTravelSeconds(MAX_GUEST_SHOT_PREVIEW_MS);
  assert.equal(getGuestShotPreviewTravelSeconds(MAX_GUEST_SHOT_PREVIEW_MS + 10_000), bounded);
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
