import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYTICS_TEST_TAG,
  ANALYTICS_TIMELINE_VERSION,
  GameplayAnalytics,
  type AnalyticsTransport,
} from './gameplayAnalytics';

function createHarness(options: { transportReady?: boolean; transportThrows?: boolean } = {}) {
  const sent: Array<{ eventName: string; fields: Record<string, string | number> }> = [];
  const scheduled: Array<() => void> = [];
  let monotonicNow = 1000;
  let wallNow = 2_000_000;
  let id = 0;
  let transportReady = options.transportReady ?? true;
  let transportThrows = options.transportThrows ?? false;
  const transport: AnalyticsTransport = {
    isReady: () => transportReady,
    send: (eventName, fields) => {
      if (transportThrows) throw new Error('transport unavailable');
      sent.push({ eventName, fields });
    },
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
    setTransportReady(value: boolean) {
      transportReady = value;
    },
    setTransportThrows(value: boolean) {
      transportThrows = value;
    },
    async runOneScheduled() {
      scheduled.shift()?.();
      await Promise.resolve();
    },
    async runScheduled() {
      while (scheduled.length > 0) {
        scheduled.shift()!();
        await Promise.resolve();
      }
    },
  };
}

function beginDefaultRun(analytics: GameplayAnalytics, overrides: Record<string, unknown> = {}) {
  analytics.beginRun({
    map_id: 'medium',
    game_mode: 'normal',
    match_type: 'singleplayer',
    player_role: 'single',
    device_type: 'desktop',
    control_scheme: 'keyboard_mouse',
    orientation: 'landscape',
    player_x: 100,
    player_y: 200,
    initial_spawner_count: 5,
    world_width: 3000,
    world_height: 3000,
    ...overrides,
  });
}

test('tracking is deferred and every event receives the version 2 shared fields', async () => {
  const harness = createHarness();
  beginDefaultRun(harness.analytics);
  harness.advance(125);
  harness.analytics.track('player_bullet_fired', {
    event_source: 'local_authoritative',
    player_x: 110,
    player_y: 205,
    direction_x: 1,
    direction_y: 0,
    target_x: 610,
    target_y: 205,
    invalid_key: undefined,
    'invalid.key': 'dropped',
  });

  assert.equal(harness.sent.length, 0, 'the gameplay call must never send synchronously');
  await Promise.resolve();
  await harness.runScheduled();

  assert.equal(harness.sent.length, 2);
  const shot = harness.sent[1];
  assert.equal(shot.eventName, 'player_bullet_fired');
  assert.equal(shot.fields.test_tag, ANALYTICS_TEST_TAG);
  assert.equal(shot.fields.timeline_version, ANALYTICS_TIMELINE_VERSION);
  assert.equal(shot.fields.event_sequence, 2);
  assert.equal(shot.fields.run_elapsed_ms, 125);
  assert.equal(shot.fields.active_run_elapsed_ms, 125);
  assert.equal(shot.fields.map_id, 'medium');
  assert.equal(shot.fields.event_category, 'combat');
  assert.equal(shot.fields.event_source, 'local_authoritative');
  assert.equal(shot.fields.actor_type, 'player');
  assert.equal(shot.fields.actor_x, 110);
  assert.equal(shot.fields.actor_y, 205);
  assert.equal(shot.fields.target_type, 'aim_point');
  assert.equal(shot.fields.target_x, 610);
  assert.equal(shot.fields.target_y, 205);
  assert.equal(shot.fields.run_origin, 'fresh_start');
  assert.equal(shot.fields.world_width, 3000);
  assert.equal(shot.fields.world_height, 3000);
  assert.equal(shot.fields.control_scheme, 'keyboard_mouse');
  assert.equal(shot.fields.orientation, 'landscape');
  assert.equal(shot.fields.analytics_sdk, 'bytebrew_web');
  assert.equal(shot.fields.analytics_sdk_version, '1.0.1');
  assert.equal(shot.fields.app_version, 'test_version');
  assert.equal(shot.fields['invalid.key'], undefined);
});

test('run summary counts accepted events, first timings, pauses and sampled distance', async () => {
  const harness = createHarness();
  beginDefaultRun(harness.analytics);

  harness.advance(1000);
  harness.analytics.track('player_bullet_fired', { player_x: 0, player_y: 0, target_x: 1, target_y: 0 });
  harness.analytics.track('game_paused');
  harness.advance(2000);
  harness.analytics.track('game_resumed');
  harness.advance(500);
  harness.analytics.track('enemy_spawned', { enemy_x: 10, enemy_y: 20, spawner_x: 15, spawner_y: 25 });
  harness.analytics.track('enemy_killed', { enemy_x: 10, enemy_y: 20, player_x: 2, player_y: 2 });
  harness.analytics.track('spawner_engaged', { spawner_x: 100, spawner_y: 100, player_x: 2, player_y: 2 });
  harness.analytics.track('spawner_destroyed', { spawner_x: 100, spawner_y: 100, player_x: 2, player_y: 2 });
  harness.analytics.track('bouncer_destroyed', { bouncer_x: 4, bouncer_y: 4, player_x: 2, player_y: 2 });
  harness.analytics.track('special_activated', { player_x: 2, player_y: 2 });
  harness.analytics.track('build_activated', { player_x: 2, player_y: 2 });
  harness.analytics.track('player_state_sample', { player_x: 0, player_y: 0 });
  harness.analytics.track('player_state_sample', { player_x: 3, player_y: 4 });
  harness.analytics.endRun({ outcome: 'victory', final_score: 1200, enemies_remaining: 2 });
  await Promise.resolve();
  await harness.runScheduled();

  const ended = harness.sent.find(event => event.eventName === 'game_run_ended');
  assert.ok(ended);
  assert.equal(ended.fields.total_duration_ms, 3500);
  assert.equal(ended.fields.paused_duration_ms, 2000);
  assert.equal(ended.fields.active_duration_ms, 1500);
  assert.equal(ended.fields.bullets_fired_count, 1);
  assert.equal(ended.fields.enemy_spawns_observed_count, 1);
  assert.equal(ended.fields.enemy_kills_count, 1);
  assert.equal(ended.fields.spawner_engagements_count, 1);
  assert.equal(ended.fields.spawners_destroyed_count, 1);
  assert.equal(ended.fields.bouncers_destroyed_count, 1);
  assert.equal(ended.fields.special_uses_count, 1);
  assert.equal(ended.fields.build_uses_count, 1);
  assert.equal(ended.fields.state_samples_count, 2);
  assert.equal(ended.fields.approximate_distance_traveled, 5);
  assert.equal(ended.fields.first_shot_active_ms, 1000);
  assert.equal(ended.fields.first_enemy_kill_active_ms, 1500);
  assert.equal(ended.fields.first_spawner_engagement_active_ms, 1500);
  assert.equal(ended.fields.first_spawner_destroyed_active_ms, 1500);
  assert.equal(ended.fields.final_score, 1200);
  assert.equal(ended.fields.timeline_complete, 'true');
});

test('a new run closes an unfinished run and links the replacement segment', async () => {
  const harness = createHarness();
  beginDefaultRun(harness.analytics);
  harness.advance(50);
  beginDefaultRun(harness.analytics, { run_origin: 'quick_load' });
  await Promise.resolve();
  await harness.runScheduled();

  const started = harness.sent.filter(event => event.eventName === 'game_run_started');
  const ended = harness.sent.filter(event => event.eventName === 'game_run_ended');
  assert.equal(started.length, 2);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].fields.outcome, 'abandoned');
  assert.equal(ended[0].fields.cause_code, 'superseded');
  assert.equal(started[1].fields.previous_run_id, started[0].fields.run_id);
  assert.equal(started[1].fields.run_origin, 'quick_load');
});

test('ending a run is idempotent', async () => {
  const harness = createHarness();
  beginDefaultRun(harness.analytics, {
    game_mode: 'hard',
    match_type: 'multiplayer',
    player_role: 'guest',
    device_type: 'mobile',
    control_scheme: 'touch',
    orientation: 'portrait',
    match_id: 'ABCD_2',
    round_id: 2,
    run_origin: 'multiplayer_round',
  });
  harness.analytics.endRun({ outcome: 'defeat' });
  harness.analytics.endRun({ outcome: 'defeat' });
  harness.analytics.track('player_bullet_fired', { bullet_id: 'late_event' });
  await Promise.resolve();
  await harness.runScheduled();

  assert.equal(harness.sent.filter(event => event.eventName === 'game_run_ended').length, 1);
  assert.equal(harness.sent.some(event => event.fields.bullet_id === 'late_event'), false);
});

test('low-priority samples skip under pressure while the critical ending is retained', async () => {
  const harness = createHarness();
  beginDefaultRun(harness.analytics);
  for (let index = 0; index < 249; index += 1) {
    harness.analytics.track('player_bullet_fired', { bullet_id: `b_${index}` });
  }
  harness.analytics.track('player_state_sample', { player_x: 5, player_y: 5 });
  harness.analytics.endRun({ outcome: 'abandoned' });
  await Promise.resolve();
  await harness.runScheduled();

  assert.equal(harness.sent.some(event => event.eventName === 'player_state_sample'), false);
  const ended = harness.sent.find(event => event.eventName === 'game_run_ended');
  assert.ok(ended);
  assert.equal(ended.fields.state_samples_skipped, 1);
  assert.equal(ended.fields.timeline_complete, 'true');
});

test('a throwing transport never throws into gameplay and retries the same event', async () => {
  const harness = createHarness({ transportThrows: true });
  beginDefaultRun(harness.analytics);
  await Promise.resolve();
  await harness.runOneScheduled();
  await harness.runOneScheduled();
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.analytics.getPendingEventCountForTests(), 1);

  harness.setTransportThrows(false);
  await harness.runScheduled();
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].eventName, 'game_run_started');
});

test('an unavailable transport retains data without blocking gameplay', async () => {
  const harness = createHarness({ transportReady: false });
  beginDefaultRun(harness.analytics);
  await Promise.resolve();
  await harness.runOneScheduled();
  await harness.runOneScheduled();
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.analytics.getPendingEventCountForTests(), 1);

  harness.setTransportReady(true);
  await harness.runScheduled();
  assert.equal(harness.sent.length, 1);
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
