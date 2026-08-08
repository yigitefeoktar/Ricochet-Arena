export const GUEST_BULLET_SNAP_DISTANCE = 160;
export const GUEST_BULLET_BLEND = 0.65;

export interface SyncableBullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bounceCount: number;
  [key: string]: unknown;
}

/**
 * Smooth ordinary host snapshots without simulating guest-side physics.
 * A bounce, direction change, or large error always snaps to host authority.
 */
export function reconcileGuestBulletSnapshot<T extends SyncableBullet>(
  predicted: T,
  authoritative: T,
): T {
  const errorX = authoritative.x - predicted.x;
  const errorY = authoritative.y - predicted.y;
  const error = Math.hypot(errorX, errorY);

  const predictedSpeed = Math.hypot(predicted.dx, predicted.dy);
  const authoritativeSpeed = Math.hypot(authoritative.dx, authoritative.dy);
  const directionDot =
    predictedSpeed > 0.0001 && authoritativeSpeed > 0.0001
      ? (predicted.dx * authoritative.dx + predicted.dy * authoritative.dy) /
        (predictedSpeed * authoritativeSpeed)
      : 1;

  const canBlendSnapshot =
    error <= GUEST_BULLET_SNAP_DISTANCE &&
    predicted.bounceCount === authoritative.bounceCount &&
    directionDot > 0.25;

  if (!canBlendSnapshot) {
    return { ...authoritative };
  }

  return {
    ...authoritative,
    x: predicted.x + errorX * GUEST_BULLET_BLEND,
    y: predicted.y + errorY * GUEST_BULLET_BLEND,
  };
}
