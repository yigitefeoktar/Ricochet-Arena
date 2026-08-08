import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_BULLET_BLEND,
  GUEST_BULLET_SNAP_DISTANCE,
  reconcileGuestBulletSnapshot,
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
