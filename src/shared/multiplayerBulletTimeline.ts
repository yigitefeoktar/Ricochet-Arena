export const DEFAULT_MULTIPLAYER_BULLET_BUFFER_MS = 150;
export const MIN_MULTIPLAYER_BULLET_BUFFER_MS = 100;
export const MAX_MULTIPLAYER_BULLET_BUFFER_MS = 250;
export const MAX_CONFIRMED_BULLET_EXTRAPOLATION_MS = 250;

export interface AuthoritativeBulletState {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  radius: number;
  bounceCount: number;
  spawnTime: number;
  isPlayer: boolean;
  isNeutral: boolean;
  ownerId?: string;
  colorIdx?: number;
  clientShotId?: string;
  repelMultiplied?: boolean;
  allowedBlockKeys?: string[];
  leftBlockKeys?: string[];
}

export type AuthoritativeBulletEventType =
  | 'spawn'
  | 'bounce'
  | 'transform'
  | 'hit'
  | 'remove';

export interface AuthoritativeBulletEvent {
  roundId: number;
  sequence: number;
  tick: number;
  hostTime: number;
  type: AuthoritativeBulletEventType;
  bulletId: string;
  x: number;
  y: number;
  state?: AuthoritativeBulletState;
  reason?: string;
}

interface BulletKeyframe {
  timeMs: number;
  sequence: number;
  type: AuthoritativeBulletEventType | 'snapshot';
  x: number;
  y: number;
  state: AuthoritativeBulletState | null;
}

export interface GuestBulletTimeline {
  roundId: number;
  hostId: string;
  lastSequence: number;
  confirmedThroughMs: number;
  tracks: Map<string, BulletKeyframe[]>;
}

export interface GuestBulletTimelineIngestResult {
  accepted: number;
  duplicates: number;
  gap: { expected: number; received: number } | null;
}

export interface GuestBulletTimelineSample {
  bullets: AuthoritativeBulletState[];
  renderTimeMs: number;
  stale: boolean;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function isAuthoritativeBulletState(value: unknown): value is AuthoritativeBulletState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bullet = value as Partial<AuthoritativeBulletState>;
  return typeof bullet.id === 'string' && bullet.id.length > 0 && bullet.id.length <= 128 &&
    isFiniteNumber(bullet.x) && isFiniteNumber(bullet.y) &&
    isFiniteNumber(bullet.dx) && isFiniteNumber(bullet.dy) &&
    isFiniteNumber(bullet.radius) && bullet.radius > 0 && bullet.radius <= 100 &&
    Number.isInteger(bullet.bounceCount) && (bullet.bounceCount ?? -1) >= 0 &&
    isFiniteNumber(bullet.spawnTime) &&
    typeof bullet.isPlayer === 'boolean' && typeof bullet.isNeutral === 'boolean';
}

export function isAuthoritativeBulletEvent(value: unknown): value is AuthoritativeBulletEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<AuthoritativeBulletEvent>;
  const validType = event.type === 'spawn' || event.type === 'bounce' ||
    event.type === 'transform' || event.type === 'hit' || event.type === 'remove';
  const needsState = event.type === 'spawn' || event.type === 'bounce' || event.type === 'transform';
  return Number.isInteger(event.roundId) && (event.roundId ?? 0) > 0 &&
    Number.isInteger(event.sequence) && (event.sequence ?? 0) > 0 &&
    Number.isInteger(event.tick) && (event.tick ?? -1) >= 0 &&
    isFiniteNumber(event.hostTime) && event.hostTime >= 0 &&
    validType && typeof event.bulletId === 'string' && event.bulletId.length > 0 && event.bulletId.length <= 128 &&
    isFiniteNumber(event.x) && isFiniteNumber(event.y) &&
    (!needsState || (isAuthoritativeBulletState(event.state) && event.state.id === event.bulletId));
}

export function createGuestBulletTimeline(roundId: number, hostId: string): GuestBulletTimeline {
  return {
    roundId,
    hostId,
    lastSequence: 0,
    confirmedThroughMs: -Infinity,
    tracks: new Map(),
  };
}

function appendKeyframe(timeline: GuestBulletTimeline, event: AuthoritativeBulletEvent) {
  const existing = timeline.tracks.get(event.bulletId) ?? [];
  existing.push({
    timeMs: event.hostTime,
    sequence: event.sequence,
    type: event.type,
    x: event.x,
    y: event.y,
    state: event.state ? { ...event.state, x: event.x, y: event.y } : null,
  });
  existing.sort((a, b) => a.timeMs - b.timeMs || a.sequence - b.sequence);
  timeline.tracks.set(event.bulletId, existing);
}

export function ingestAuthoritativeBulletEvents(
  timeline: GuestBulletTimeline,
  events: unknown,
): GuestBulletTimelineIngestResult {
  if (!Array.isArray(events)) {
    return { accepted: 0, duplicates: 0, gap: null };
  }

  let accepted = 0;
  let duplicates = 0;
  for (const rawEvent of events) {
    if (!isAuthoritativeBulletEvent(rawEvent)) continue;
    if (rawEvent.roundId !== timeline.roundId) continue;
    if (rawEvent.sequence <= timeline.lastSequence) {
      duplicates += 1;
      continue;
    }
    const expected = timeline.lastSequence + 1;
    if (rawEvent.sequence !== expected) {
      return { accepted, duplicates, gap: { expected, received: rawEvent.sequence } };
    }
    appendKeyframe(timeline, rawEvent);
    timeline.lastSequence = rawEvent.sequence;
    timeline.confirmedThroughMs = Math.max(timeline.confirmedThroughMs, rawEvent.hostTime);
    accepted += 1;
  }
  return { accepted, duplicates, gap: null };
}

/**
 * Periodic authoritative snapshots confirm the safe playback horizon. They seed
 * new/reconnected tracks, but never retarget healthy tracks (which is what
 * caused the old backwards-moving snapshot chase).
 */
export function confirmAuthoritativeBulletSnapshot(
  timeline: GuestBulletTimeline,
  bullets: AuthoritativeBulletState[],
  snapshotTimeMs: number,
  sequence: number,
  recoverFromGap = false,
) {
  if (!isFiniteNumber(snapshotTimeMs) || !Number.isInteger(sequence) || sequence < 0) return;
  timeline.confirmedThroughMs = Math.max(timeline.confirmedThroughMs, snapshotTimeMs);

  if (recoverFromGap) {
    timeline.tracks.clear();
    timeline.lastSequence = sequence;
  }

  for (const bullet of bullets) {
    if (!isAuthoritativeBulletState(bullet)) continue;
    if (!timeline.tracks.has(bullet.id) || recoverFromGap) {
      timeline.tracks.set(bullet.id, [{
        timeMs: snapshotTimeMs,
        sequence,
        type: 'snapshot',
        x: bullet.x,
        y: bullet.y,
        state: { ...bullet },
      }]);
    }
  }

  if (recoverFromGap) return;

  // A bullet absent from a confirmed full snapshot is authoritatively gone.
  // Add a removal keyframe only when no reliable removal already exists.
  const liveIds = new Set(bullets.map(bullet => bullet.id));
  for (const [bulletId, frames] of timeline.tracks) {
    if (liveIds.has(bulletId)) continue;
    const last = frames[frames.length - 1];
    if (!last || last.state === null || last.timeMs > snapshotTimeMs) continue;
    frames.push({
      timeMs: snapshotTimeMs,
      sequence,
      type: 'remove',
      x: last.x,
      y: last.y,
      state: null,
    });
  }
}

function projectFromKeyframe(frame: BulletKeyframe, timeMs: number): AuthoritativeBulletState | null {
  if (!frame.state) return null;
  const state = frame.state;
  const endTime = Math.max(frame.timeMs, timeMs);
  let normalDurationMs = endTime - frame.timeMs;
  let burstDurationMs = 0;

  if (state.isPlayer) {
    const burstEnd = state.spawnTime + 250;
    burstDurationMs = Math.max(0, Math.min(endTime, burstEnd) - Math.min(frame.timeMs, burstEnd));
    normalDurationMs -= burstDurationMs;
  }

  const seconds = normalDurationMs / 1000;
  const burstSeconds = burstDurationMs / 1000;
  return {
    ...state,
    x: frame.x + state.dx * seconds + state.dx * 3.5 * burstSeconds,
    y: frame.y + state.dy * seconds + state.dy * 3.5 * burstSeconds,
  };
}

export function sampleGuestBulletTimeline(
  timeline: GuestBulletTimeline,
  nowMs: number,
  bufferMs = DEFAULT_MULTIPLAYER_BULLET_BUFFER_MS,
): GuestBulletTimelineSample {
  const safeBuffer = Math.max(
    MIN_MULTIPLAYER_BULLET_BUFFER_MS,
    Math.min(MAX_MULTIPLAYER_BULLET_BUFFER_MS, bufferMs),
  );
  const desiredRenderTime = nowMs - safeBuffer;
  // Reliable ordered events make the current velocity safe to project for a
  // short outage. Beyond that bounded recovery window, freeze rather than
  // inventing an unconfirmed trajectory.
  const safeHorizon = timeline.confirmedThroughMs + MAX_CONFIRMED_BULLET_EXTRAPOLATION_MS;
  const renderTimeMs = Math.min(desiredRenderTime, safeHorizon);
  const stale = desiredRenderTime > safeHorizon + 1;
  const bullets: AuthoritativeBulletState[] = [];

  for (const frames of timeline.tracks.values()) {
    let selected: BulletKeyframe | null = null;
    for (const frame of frames) {
      if (frame.timeMs <= renderTimeMs + 1e-7) selected = frame;
      else break;
    }
    if (!selected || !selected.state) continue;

    const next = frames.find(frame => frame.timeMs > selected!.timeMs + 1e-7);
    const sampleUntil = next ? Math.min(renderTimeMs, next.timeMs) : renderTimeMs;
    const projected = projectFromKeyframe(selected, sampleUntil);
    if (!projected) continue;

    if (next && renderTimeMs >= next.timeMs - 1e-7) continue;
    bullets.push(projected);
  }

  bullets.sort((a, b) => a.id.localeCompare(b.id));
  return { bullets, renderTimeMs, stale };
}
