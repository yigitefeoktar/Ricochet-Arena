import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_BULLET_BLEND,
  GUEST_BULLET_SNAP_DISTANCE,
  ingestGuestBulletSnapshot,
  reconcileGuestBulletSnapshot,
  sampleGuestBulletVisualTrack,
  type SyncableBullet,
} from './bulletSync';

const bullet = (overrides: Partial<SyncableBullet> = {}): SyncableBullet => ({
  x: 100,
  y: 100,
  dx: 120,
  dy: 0,
  bounceCount: 0,
  ...overrides,
});

test('blends an ordinary same-direction host snapshot', () => {
  const result = reconcileGuestBulletSnapshot(bullet(), bullet({ x: 120 }));

  assert.equal(result.x, 100 + 20 * GUEST_BULLET_BLEND);
  assert.equal(result.y, 100);
  assert.equal(result.dx, 120);
});

test('uses host fields even while position is blended', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet({ x: 110 }),
    bullet({ x: 120, isNeutral: true }),
  );

  assert.equal(result.x, 110 + 10 * GUEST_BULLET_BLEND);
  assert.equal(result.isNeutral, true);
});

test('snaps when positional divergence is too large', () => {
  const authoritativeX = 100 + GUEST_BULLET_SNAP_DISTANCE + 1;
  const result = reconcileGuestBulletSnapshot(bullet(), bullet({ x: authoritativeX }));

  assert.equal(result.x, authoritativeX);
});

test('snaps to host authority when bounce count changes', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet({ x: 104 }),
    bullet({ x: 102, dx: -120, bounceCount: 1 }),
  );

  assert.equal(result.x, 102);
  assert.equal(result.dx, -120);
  assert.equal(result.bounceCount, 1);
});

test('snaps when velocity reverses even if bounce metadata is unchanged', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet({ x: 104 }),
    bullet({ x: 102, dx: -120 }),
  );

  assert.equal(result.x, 102);
  assert.equal(result.dx, -120);
});

test('visual tracks interpolate between authoritative snapshots without an immediate jump', () => {
  const first = ingestGuestBulletSnapshot(undefined, bullet(), 100, 50);
  const second = ingestGuestBulletSnapshot(first, bullet({ x: 130 }), 150, 100);

  assert.deepEqual(sampleGuestBulletVisualTrack(second, 150), { x: 100, y: 100 });
  assert.deepEqual(sampleGuestBulletVisualTrack(second, 175), { x: 115, y: 100 });
  assert.deepEqual(sampleGuestBulletVisualTrack(second, 200), { x: 130, y: 100 });
});

test('visual tracks retarget from the currently displayed position when packets arrive early', () => {
  const first = ingestGuestBulletSnapshot(undefined, bullet(), 0, 0);
  const second = ingestGuestBulletSnapshot(first, bullet({ x: 150 }), 50, 50);
  const third = ingestGuestBulletSnapshot(second, bullet({ x: 200 }), 75, 100);

  assert.deepEqual(sampleGuestBulletVisualTrack(third, 75), { x: 115, y: 100 });
  const later = sampleGuestBulletVisualTrack(third, 125);
  assert.ok(Math.abs(later.x - 145) < 0.0001);
  assert.equal(later.y, 100);
});
