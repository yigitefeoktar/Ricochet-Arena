import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmAuthoritativeBulletSnapshot,
  createGuestBulletTimeline,
  ingestAuthoritativeBulletEvents,
  sampleGuestBulletTimeline,
  type AuthoritativeBulletEvent,
  type AuthoritativeBulletState,
} from './multiplayerBulletTimeline';

const bullet = (overrides: Partial<AuthoritativeBulletState> = {}): AuthoritativeBulletState => ({
  id: 'bullet-1',
  x: 0,
  y: 0,
  dx: 120,
  dy: 0,
  radius: 5,
  bounceCount: 0,
  spawnTime: 1_000,
  isPlayer: false,
  isNeutral: false,
  ...overrides,
});

const event = (
  sequence: number,
  type: AuthoritativeBulletEvent['type'],
  hostTime: number,
  state?: AuthoritativeBulletState,
): AuthoritativeBulletEvent => ({
  roundId: 3,
  sequence,
  tick: sequence,
  hostTime,
  type,
  bulletId: state?.id ?? 'bullet-1',
  x: state?.x ?? 0,
  y: state?.y ?? 0,
  state,
});

test('buffered timeline moves at authoritative constant speed', () => {
  const timeline = createGuestBulletTimeline(3, 'host');
  ingestAuthoritativeBulletEvents(timeline, [event(1, 'spawn', 1_000, bullet())]);
  confirmAuthoritativeBulletSnapshot(timeline, [bullet({ x: 60 })], 1_500, 1);
  const sample = sampleGuestBulletTimeline(timeline, 1_650, 150);
  assert.equal(sample.renderTimeMs, 1_500);
  assert.equal(sample.bullets.length, 1);
  assert.ok(Math.abs(sample.bullets[0].x - 60) < 1e-6);
});

test('bounce keyframe changes direction at the exact contact point', () => {
  const timeline = createGuestBulletTimeline(3, 'host');
  const spawn = bullet();
  const bounce = bullet({ x: 60, dx: -120, bounceCount: 1, isNeutral: true });
  ingestAuthoritativeBulletEvents(timeline, [
    event(1, 'spawn', 1_000, spawn),
    event(2, 'bounce', 1_500, bounce),
  ]);
  confirmAuthoritativeBulletSnapshot(timeline, [bullet({ x: 48, dx: -120, bounceCount: 1 })], 1_600, 2);

  const atContact = sampleGuestBulletTimeline(timeline, 1_650, 150).bullets[0];
  const afterContact = sampleGuestBulletTimeline(timeline, 1_750, 150).bullets[0];
  assert.equal(atContact.x, 60);
  assert.ok(Math.abs(afterContact.x - 48) < 1e-6);
});

test('hit event stops and removes the bullet at the authoritative position', () => {
  const timeline = createGuestBulletTimeline(3, 'host');
  ingestAuthoritativeBulletEvents(timeline, [
    event(1, 'spawn', 1_000, bullet()),
    { ...event(2, 'hit', 1_250), x: 30 },
  ]);
  confirmAuthoritativeBulletSnapshot(timeline, [], 1_300, 2);
  assert.equal(sampleGuestBulletTimeline(timeline, 1_399, 150).bullets.length, 1);
  assert.equal(sampleGuestBulletTimeline(timeline, 1_400, 150).bullets.length, 0);
});

test('duplicates are ignored and a sequence gap is detected', () => {
  const timeline = createGuestBulletTimeline(3, 'host');
  const first = event(1, 'spawn', 1_000, bullet());
  assert.deepEqual(ingestAuthoritativeBulletEvents(timeline, [first, first]), {
    accepted: 1,
    duplicates: 1,
    gap: null,
  });
  assert.deepEqual(ingestAuthoritativeBulletEvents(timeline, [event(3, 'bounce', 1_100, bullet())]), {
    accepted: 0,
    duplicates: 0,
    gap: { expected: 2, received: 3 },
  });
});

test('missing authority freezes the visual instead of inventing motion', () => {
  const timeline = createGuestBulletTimeline(3, 'host');
  ingestAuthoritativeBulletEvents(timeline, [event(1, 'spawn', 1_000, bullet())]);
  confirmAuthoritativeBulletSnapshot(timeline, [bullet({ x: 24 })], 1_200, 1);
  const first = sampleGuestBulletTimeline(timeline, 2_000, 150);
  const second = sampleGuestBulletTimeline(timeline, 2_500, 150);
  assert.equal(first.stale, true);
  assert.equal(second.stale, true);
  assert.equal(first.bullets[0].x, second.bullets[0].x);
});

test('a full snapshot recovers a sequence gap without replaying stale events', () => {
  const timeline = createGuestBulletTimeline(3, 'host');
  ingestAuthoritativeBulletEvents(timeline, [event(1, 'spawn', 1_000, bullet())]);
  const gap = ingestAuthoritativeBulletEvents(timeline, [event(3, 'bounce', 1_200, bullet())]);
  assert.ok(gap.gap);
  confirmAuthoritativeBulletSnapshot(timeline, [bullet({ x: 90 })], 1_300, 3, true);
  assert.equal(timeline.lastSequence, 3);
  assert.equal(sampleGuestBulletTimeline(timeline, 1_450, 150).bullets[0].x, 90);
});

test('latency, jitter, packet loss, and duplicates never reverse or teleport a guest bullet', () => {
  let seed = 0xabc123;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000;
  };
  const timeline = createGuestBulletTimeline(3, 'host');
  const spawnState = bullet({ x: 0, dx: 120 });
  const bounceState = bullet({ x: 60, dx: -120, bounceCount: 1, isNeutral: true });
  const reliableEvents = [
    event(1, 'spawn', 1_000, spawnState),
    event(2, 'bounce', 1_500, bounceState),
    { ...event(3, 'hit', 1_900), x: 12 },
  ];
  const deliveries: Array<{ at: number; kind: 'event' | 'snapshot'; payload: any }> = [];

  for (const authoritativeEvent of reliableEvents) {
    const delay = 70 + Math.floor(random() * 80);
    deliveries.push({ at: authoritativeEvent.hostTime + delay, kind: 'event', payload: authoritativeEvent });
    if (random() < 0.75) {
      deliveries.push({ at: authoritativeEvent.hostTime + delay + 5, kind: 'event', payload: authoritativeEvent });
    }
  }
  for (let hostTime = 1_000; hostTime <= 2_000; hostTime += 50) {
    if (random() < 0.35) continue;
    const beforeBounce = hostTime < 1_500;
    const beforeHit = hostTime < 1_900;
    const x = beforeBounce ? (hostTime - 1_000) * 0.12 : 60 - (hostTime - 1_500) * 0.12;
    deliveries.push({
      at: hostTime + 70 + Math.floor(random() * 80),
      kind: 'snapshot',
      payload: {
        time: hostTime,
        sequence: hostTime < 1_500 ? 1 : hostTime < 1_900 ? 2 : 3,
        bullets: beforeHit ? [bullet({ x, dx: beforeBounce ? 120 : -120, bounceCount: beforeBounce ? 0 : 1 })] : [],
      },
    });
  }
  deliveries.sort((a, b) => a.at - b.at || (a.kind === 'event' ? -1 : 1));

  let deliveryIndex = 0;
  let previousX: number | null = null;
  let previousBounce = 0;
  let sawForward = false;
  let sawReverse = false;
  for (let now = 1_000; now <= 2_300; now += 1000 / 60) {
    while (deliveryIndex < deliveries.length && deliveries[deliveryIndex].at <= now) {
      const delivery = deliveries[deliveryIndex++];
      if (delivery.kind === 'event') {
        ingestAuthoritativeBulletEvents(timeline, [delivery.payload]);
      } else {
        confirmAuthoritativeBulletSnapshot(
          timeline,
          delivery.payload.bullets,
          delivery.payload.time,
          delivery.payload.sequence,
          delivery.payload.sequence > timeline.lastSequence,
        );
      }
    }
    const sample = sampleGuestBulletTimeline(timeline, now, 150);
    const current = sample.bullets[0];
    if (!current) continue;
    if (previousX !== null) {
      const movement = current.x - previousX;
      assert.ok(Math.abs(movement) <= 2.01, `teleported ${movement}px in one 60 FPS frame`);
      if (current.bounceCount === previousBounce) {
        if (current.dx > 0) assert.ok(movement >= -1e-6, 'reversed before authoritative bounce');
        if (current.dx < 0) assert.ok(movement <= 1e-6, 'reversed after authoritative bounce');
      }
      if (movement > 0.1) sawForward = true;
      if (movement < -0.1) sawReverse = true;
    }
    previousX = current.x;
    previousBounce = current.bounceCount;
  }
  assert.ok(sawForward && sawReverse, 'scenario did not render both sides of the bounce');
  assert.equal(sampleGuestBulletTimeline(timeline, 2_300, 150).bullets.length, 0);
});

test('reconnect installs a complete snapshot and ignores pre-reconnect events', () => {
  const beforeDisconnect = createGuestBulletTimeline(3, 'host-a');
  ingestAuthoritativeBulletEvents(beforeDisconnect, [event(1, 'spawn', 1_000, bullet())]);

  const reconnected = createGuestBulletTimeline(3, 'host-a');
  confirmAuthoritativeBulletSnapshot(reconnected, [bullet({ x: 84 })], 1_700, 4, true);
  assert.equal(reconnected.lastSequence, 4);
  assert.equal(sampleGuestBulletTimeline(reconnected, 1_850, 150).bullets[0].x, 84);
  assert.equal(ingestAuthoritativeBulletEvents(reconnected, [event(2, 'bounce', 1_500, bullet())]).duplicates, 1);
});

test('host migration starts a new host-scoped timeline from its authoritative snapshot', () => {
  const oldHost = createGuestBulletTimeline(3, 'host-a');
  ingestAuthoritativeBulletEvents(oldHost, [event(1, 'spawn', 1_000, bullet())]);

  const newHost = createGuestBulletTimeline(3, 'host-b');
  confirmAuthoritativeBulletSnapshot(newHost, [bullet({ x: 144, dx: -120 })], 2_000, 0, true);
  const migrated = sampleGuestBulletTimeline(newHost, 2_150, 150);
  assert.equal(migrated.bullets.length, 1);
  assert.equal(migrated.bullets[0].x, 144);
  assert.equal(newHost.hostId, 'host-b');
});
