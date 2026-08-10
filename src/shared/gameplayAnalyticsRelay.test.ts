import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRelayedGameplayEvent } from './gameplayAnalyticsRelay';

test('accepts a bounded authoritative gameplay analytics event', () => {
  const parsed = parseRelayedGameplayEvent({
    roundId: 3,
    eventName: 'enemy_killed',
    occurredAtMs: 1234,
    fields: {
      player_x: 200,
      player_y: 300,
      enemy_id: 'e_14',
      enemy_x: 250,
      enemy_y: 310,
      points_awarded: 100,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.eventName, 'enemy_killed');
  assert.equal(parsed.fields.enemy_id, 'e_14');
});

test('rejects unsupported events, fields and unbounded coordinates', () => {
  assert.equal(parseRelayedGameplayEvent({
    roundId: 1,
    eventName: 'player_bullet_fired',
    occurredAtMs: 1,
    fields: { player_x: 0, player_y: 0 },
  }), null);
  assert.equal(parseRelayedGameplayEvent({
    roundId: 1,
    eventName: 'enemy_killed',
    occurredAtMs: 1,
    fields: { unexpected: 'value' },
  }), null);
  assert.equal(parseRelayedGameplayEvent({
    roundId: 1,
    eventName: 'enemy_killed',
    occurredAtMs: 1,
    fields: { enemy_x: Infinity },
  }), null);
});
