import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGuestShotPreviewTravelSeconds,
  MAX_GUEST_SHOT_PREVIEW_MS,
} from './multiplayerShotPreview';

test('guest shot preview exactly mirrors the existing initial speed burst', () => {
  assert.equal(getGuestShotPreviewTravelSeconds(0), 0);
  assert.equal(getGuestShotPreviewTravelSeconds(50), 0.175);
  assert.equal(getGuestShotPreviewTravelSeconds(100), 0.35);
});

test('guest shot preview is bounded and rejects invalid elapsed time', () => {
  const bounded = getGuestShotPreviewTravelSeconds(MAX_GUEST_SHOT_PREVIEW_MS);
  assert.equal(getGuestShotPreviewTravelSeconds(MAX_GUEST_SHOT_PREVIEW_MS + 10_000), bounded);
  assert.equal(getGuestShotPreviewTravelSeconds(Number.NaN), 0);
  assert.equal(getGuestShotPreviewTravelSeconds(-50), 0);
});
