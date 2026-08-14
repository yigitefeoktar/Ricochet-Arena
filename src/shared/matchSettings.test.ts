import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidMapId,
  sanitizeMatchSettings,
  VALID_MAP_IDS,
} from './matchSettings';

test('multiplayer accepts every titan relic map exposed by the selector', () => {
  for (const mapId of ['titan_orbit', 'titan_tempest']) {
    assert.ok(VALID_MAP_IDS.includes(mapId as (typeof VALID_MAP_IDS)[number]));
    assert.equal(isValidMapId(mapId), true);
    assert.deepEqual(sanitizeMatchSettings({ mapId, gameMode: 'normal' }), {
      mapId,
      gameMode: 'normal',
    });
  }
});

test('unknown map IDs remain rejected and sanitize to the existing default', () => {
  assert.equal(isValidMapId('not_a_real_map'), false);
  assert.equal(
    sanitizeMatchSettings({ mapId: 'not_a_real_map', gameMode: 'normal' }).mapId,
    'medium',
  );
});
