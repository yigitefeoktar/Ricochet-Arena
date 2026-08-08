export const GUEST_BULLET_SNAP_DISTANCE = 48;

export interface SyncableBullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bounceCount: number;
  visualSpeedScale?: number;
  [key: string]: unknown;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/**
 * Reconcile an already-predicted guest bullet with a host snapshot.
 * Compatible snapshots keep the visual position and adjust speed so the
 * prediction converges without ever pulling the bullet backwards. A missed
 * bounce, direction reversal, or large error snaps once to host authority.
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

  const canPreservePrediction =
    error <= GUEST_BULLET_SNAP_DISTANCE &&
    predicted.bounceCount === authoritative.bounceCount &&
    directionDot > 0.25;

  if (!canPreservePrediction) {
    return {
      ...authoritative,
      visualSpeedScale: 1,
    };
  }

  const dirX = authoritativeSpeed > 0.0001 ? authoritative.dx / authoritativeSpeed : 0;
  const dirY = authoritativeSpeed > 0.0001 ? authoritative.dy / authoritativeSpeed : 0;
  const alongPathError = errorX * dirX + errorY * dirY;
  const visualSpeedScale = clamp(1 + alongPathError / 120, 0.85, 1.15);

  return {
    ...authoritative,
    x: predicted.x,
    y: predicted.y,
    visualSpeedScale,
  };
}
