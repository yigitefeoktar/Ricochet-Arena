import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTitanRelicMapId,
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

test('titan multiplayer behavior is restricted to the two titan map IDs', () => {
  for (const mapId of VALID_MAP_IDS) {
    assert.equal(
      isTitanRelicMapId(mapId),
      mapId === 'titan_orbit' || mapId === 'titan_tempest',
      `unexpected Titan networking classification for ${mapId}`,
    );
  }
  assert.equal(isTitanRelicMapId(''), false);
  assert.equal(isTitanRelicMapId(null), false);
  assert.equal(isTitanRelicMapId(undefined), false);
});

test('unknown map IDs remain rejected and sanitize to the existing default', () => {
  assert.equal(isValidMapId('not_a_real_map'), false);
  assert.equal(
    sanitizeMatchSettings({ mapId: 'not_a_real_map', gameMode: 'normal' }).mapId,
    'medium',
  );
});
