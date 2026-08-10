import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYTICS_TEST_TAG,
  GameplayAnalytics,
  type AnalyticsTransport,
} from './gameplayAnalytics';

function createHarness() {
  const sent: Array<{ eventName: string; fields: Record<string, string | number> }> = [];
  const scheduled: Array<() => void> = [];
  let monotonicNow = 1000;
  let wallNow = 2_000_000;
  let id = 0;
  const transport: AnalyticsTransport = {
    isReady: () => true,
    send: (eventName, fields) => sent.push({ eventName, fields }),
  };
  const analytics = new GameplayAnalytics({
    loadConfig: async () => ({
      enabled: true,
      appId: 'test_app',
      sdkKey: 'test_key',
      appVersion: 'test_version',
    }),
    loadTransport: async () => transport,
    schedule: task => scheduled.push(task),
    monotonicNow: () => monotonicNow,
    wallNow: () => wallNow,
    createId: () => `id_${++id}`,
  });

  return {
    analytics,
    sent,
    scheduled,
    advance(ms: number) {
      monotonicNow += ms;
      wallNow += ms;
    },
    async runScheduled() {
      while (scheduled.length > 0) {
        scheduled.shift()!();
        await Promise.resolve();
      }
    },
  };
}

test('tracking is deferred and every event receives the mandatory test timeline fields', async () => {
  const harness = createHarness();
  harness.analytics.beginRun({
    map_id: 'medium',
    game_mode: 'normal',
    match_type: 'singleplayer',
    player_role: 'single',
    device_type: 'desktop',
    player_x: 100,
    player_y: 200,
    initial_spawner_count: 5,
  });
  harness.advance(125);
  harness.analytics.track('player_bullet_fired', {
    player_x: 110,
    player_y: 205,
    direction_x: 1,
    direction_y: 0,
    invalid_key: undefined,
    'invalid.key': 'dropped',
  });

  assert.equal(harness.sent.length, 0, 'the gameplay call must never send synchronously');
  await Promise.resolve();
  await harness.runScheduled();

  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[0].eventName, 'game_run_started');
  assert.equal(harness.sent[1].eventName, 'player_bullet_fired');
  assert.equal(harness.sent[1].fields.test_tag, ANALYTICS_TEST_TAG);
  assert.equal(harness.sent[1].fields.timeline_version, 1);
  assert.equal(harness.sent[1].fields.event_sequence, 2);
  assert.equal(harness.sent[1].fields.run_elapsed_ms, 125);
  assert.equal(harness.sent[1].fields.map_id, 'medium');
  assert.equal(harness.sent[1].fields['invalid.key'], undefined);
});

test('ending a run is idempotent', async () => {
  const harness = createHarness();
  harness.analytics.beginRun({
    map_id: 'medium',
    game_mode: 'hard',
    match_type: 'multiplayer',
    player_role: 'guest',
    device_type: 'mobile',
    match_id: 'ABCD_2',
    round_id: 2,
    player_x: 50,
    player_y: 75,
    initial_spawner_count: 5,
  });
  harness.analytics.endRun({ outcome: 'defeat' });
  harness.analytics.endRun({ outcome: 'defeat' });
  await Promise.resolve();
  await harness.runScheduled();

  assert.equal(harness.sent.filter(event => event.eventName === 'game_run_ended').length, 1);
});

test('disabled configuration discards queued events without throwing', async () => {
  const scheduled: Array<() => void> = [];
  const analytics = new GameplayAnalytics({
    loadConfig: async () => ({ enabled: false }),
    schedule: task => scheduled.push(task),
    createId: () => 'disabled_test',
  });

  analytics.track('game_paused');
  await Promise.resolve();
  while (scheduled.length > 0) scheduled.shift()!();
  await Promise.resolve();

  assert.equal(analytics.getPendingEventCountForTests(), 0);
});
