import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('keeps a compatible predicted position and speeds up when it is behind', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet(),
    bullet({ x: 112 }),
  );

  assert.equal(result.x, 100);
  assert.equal(result.y, 100);
  assert.ok((result.visualSpeedScale ?? 1) > 1);
});

test('slows prediction instead of moving it backwards when it is ahead', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet({ x: 112 }),
    bullet({ x: 100 }),
  );

  assert.equal(result.x, 112);
  assert.ok((result.visualSpeedScale ?? 1) < 1);
});

test('snaps once when positional divergence is too large', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet(),
    bullet({ x: 100 + GUEST_BULLET_SNAP_DISTANCE + 1 }),
  );

  assert.equal(result.x, 100 + GUEST_BULLET_SNAP_DISTANCE + 1);
  assert.equal(result.visualSpeedScale, 1);
});

test('snaps to host authority when a bounce was missed', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet({ x: 104 }),
    bullet({ x: 102, dx: -120, bounceCount: 1 }),
  );

  assert.equal(result.x, 102);
  assert.equal(result.dx, -120);
  assert.equal(result.bounceCount, 1);
  assert.equal(result.visualSpeedScale, 1);
});

test('snaps when velocity reverses even if bounce metadata is unchanged', () => {
  const result = reconcileGuestBulletSnapshot(
    bullet({ x: 104 }),
    bullet({ x: 102, dx: -120 }),
  );

  assert.equal(result.x, 102);
  assert.equal(result.dx, -120);
});
