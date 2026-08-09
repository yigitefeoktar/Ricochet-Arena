export const GUEST_BULLET_SNAP_DISTANCE = 160;
export const GUEST_BULLET_BLEND = 0.65;
export const GUEST_BULLET_MIN_INTERPOLATION_MS = 1000 / 60;
export const GUEST_BULLET_MAX_INTERPOLATION_MS = 750;
export const GUEST_BULLET_MAX_VISUAL_SPEED_PX_PER_SECOND = 600;

export interface SyncableBullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bounceCount: number;
  [key: string]: unknown;
}

export interface GuestBulletVisualTrack {
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  startedAtMs: number;
  durationMs: number;
  lastSnapshotTimeMs: number;
  bounceCount: number;
}

export interface GuestBulletVisualPosition {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function sampleGuestBulletVisualTrack(
  track: GuestBulletVisualTrack,
  nowMs: number,
): GuestBulletVisualPosition {
  const elapsed = Math.max(0, nowMs - track.startedAtMs);
  const progress = track.durationMs <= 0
    ? 1
    : clamp(elapsed / track.durationMs, 0, 1);

  return {
    x: track.fromX + (track.targetX - track.fromX) * progress,
    y: track.fromY + (track.targetY - track.fromY) * progress,
  };
}

/**
 * Queue an authoritative host snapshot for visual playback on a guest.
 * The guest never extrapolates collisions or changes trajectory itself.
 */
export function ingestGuestBulletSnapshot(
  previous: GuestBulletVisualTrack | undefined,
  snapshot: SyncableBullet,
  receivedAtMs: number,
  snapshotTimeMs: number,
  initialPosition?: GuestBulletVisualPosition,
): GuestBulletVisualTrack {
  if (!previous) {
    const from = initialPosition ?? snapshot;
    const initialDistance = Math.hypot(snapshot.x - from.x, snapshot.y - from.y);
    const initialDuration = initialPosition
      ? clamp(
          Math.max(
            50,
            initialDistance / (GUEST_BULLET_MAX_VISUAL_SPEED_PX_PER_SECOND / 1000),
          ),
          GUEST_BULLET_MIN_INTERPOLATION_MS,
          GUEST_BULLET_MAX_INTERPOLATION_MS,
        )
      : 0;
    return {
      fromX: from.x,
      fromY: from.y,
      targetX: snapshot.x,
      targetY: snapshot.y,
      startedAtMs: receivedAtMs,
      durationMs: initialDuration,
      lastSnapshotTimeMs: snapshotTimeMs,
      bounceCount: snapshot.bounceCount,
    };
  }

  const current = sampleGuestBulletVisualTrack(previous, receivedAtMs);
  const snapshotGap = snapshotTimeMs - previous.lastSnapshotTimeMs;
  const distanceToTarget = Math.hypot(snapshot.x - current.x, snapshot.y - current.y);
  const speedLimitedDuration =
    distanceToTarget / (GUEST_BULLET_MAX_VISUAL_SPEED_PX_PER_SECOND / 1000);
  const timelineDuration = Number.isFinite(snapshotGap) && snapshotGap > 0
    ? snapshotGap
    : 50;
  const durationMs = clamp(
    Math.max(timelineDuration, speedLimitedDuration),
    GUEST_BULLET_MIN_INTERPOLATION_MS,
    GUEST_BULLET_MAX_INTERPOLATION_MS,
  );

  return {
    fromX: current.x,
    fromY: current.y,
    targetX: snapshot.x,
    targetY: snapshot.y,
    startedAtMs: receivedAtMs,
    durationMs,
    lastSnapshotTimeMs: snapshotTimeMs,
    bounceCount: snapshot.bounceCount,
  };
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
