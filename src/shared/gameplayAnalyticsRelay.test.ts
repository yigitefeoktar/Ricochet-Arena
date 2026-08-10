import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptRelayedGameplayEventId,
  isWorldRelayedGameplayEvent,
  parseRelayedGameplayEvent,
} from './gameplayAnalyticsRelay';

const baseEvent = {
  eventId: 'round_3:host_1:1:enemy_killed',
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
};

test('accepts a bounded owner gameplay analytics event', () => {
  const parsed = parseRelayedGameplayEvent(baseEvent);

  assert.ok(parsed);
  assert.equal(parsed.eventName, 'enemy_killed');
  assert.equal(parsed.fields.enemy_id, 'e_14');
  assert.equal(isWorldRelayedGameplayEvent(parsed), false);
});

test('accepts an authoritative world event for the current round', () => {
  const parsed = parseRelayedGameplayEvent({
    eventId: 'round_3:host_1:2:enemy_spawned',
    roundId: 3,
    eventName: 'enemy_spawned',
    occurredAtMs: 1300,
    fields: {
      event_source: 'host_authoritative',
      enemy_id: 'e_15',
      enemy_x: 275,
      enemy_y: 320,
      spawner_x: 300,
      spawner_y: 350,
      spawn_type: 'regular',
      enemies_alive: 4,
    },
  });

  assert.ok(parsed);
  assert.equal(isWorldRelayedGameplayEvent(parsed), true);
});

test('rejects unsupported events, malformed IDs, fields and unbounded coordinates', () => {
  assert.equal(parseRelayedGameplayEvent({ ...baseEvent, eventName: 'player_bullet_fired' }), null);
  assert.equal(parseRelayedGameplayEvent({ ...baseEvent, eventId: 'bad event id' }), null);
  assert.equal(parseRelayedGameplayEvent({ ...baseEvent, fields: { unexpected: 'value' } }), null);
  assert.equal(parseRelayedGameplayEvent({ ...baseEvent, fields: { enemy_x: Infinity } }), null);
});

test('rejects duplicate event IDs and bounds the remembered ID set', () => {
  const seen = new Set<string>();
  assert.equal(acceptRelayedGameplayEventId(seen, 'one', 2), true);
  assert.equal(acceptRelayedGameplayEventId(seen, 'one', 2), false);
  assert.equal(acceptRelayedGameplayEventId(seen, 'two', 2), true);
  assert.equal(acceptRelayedGameplayEventId(seen, 'three', 2), true);
  assert.deepEqual([...seen], ['two', 'three']);
});
