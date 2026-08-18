import {
  traceReflectedBulletMotion,
  type AxisAlignedSurface,
  type DynamicSurfaceResolver,
} from './multiplayerBulletPhysics';

export const PLAYER_BULLET_BURST_MS = 250;
export const PLAYER_BULLET_BURST_MULTIPLIER = 3.5;
export const GUEST_SHOT_VISUAL_END_FADE_MS = 80;

export interface GuestShotVisualState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  radius: number;
  colorIdx: number;
  allowedBlockKeys: string[];
  spawnTime: number;
  lastUpdateTime: number;
  isNeutral: boolean;
  bounceCount: number;
  lastWorldPhaseTime: number;
  endingAt?: number;
}

export function getPlayerBulletTravelSecondsBetween(
  spawnTimeMs: number,
  startTimeMs: number,
  endTimeMs: number,
): number {
  if (![spawnTimeMs, startTimeMs, endTimeMs].every(Number.isFinite) || endTimeMs <= startTimeMs) return 0;
  const start = Math.max(spawnTimeMs, startTimeMs);
  const end = Math.max(start, endTimeMs);
  const burstEnd = spawnTimeMs + PLAYER_BULLET_BURST_MS;
  const burstMs = Math.max(0, Math.min(end, burstEnd) - Math.min(start, burstEnd));
  const normalMs = Math.max(0, end - start - burstMs);
  return (burstMs * PLAYER_BULLET_BURST_MULTIPLIER + normalMs) / 1000;
}

export function getPlayerBulletTimeAtTravelFraction(
  spawnTimeMs: number,
  startTimeMs: number,
  endTimeMs: number,
  fraction: number,
): number {
  if (![spawnTimeMs, startTimeMs, endTimeMs, fraction].every(Number.isFinite) || endTimeMs <= startTimeMs) {
    return Number.isFinite(startTimeMs) ? startTimeMs : 0;
  }
  const safeFraction = Math.max(0, Math.min(1, fraction));
  const start = Math.max(spawnTimeMs, startTimeMs);
  const end = Math.max(start, endTimeMs);
  const totalTravel = getPlayerBulletTravelSecondsBetween(spawnTimeMs, start, end);
  const targetTravel = totalTravel * safeFraction;
  const burstEnd = spawnTimeMs + PLAYER_BULLET_BURST_MS;
  const burstDurationMs = Math.max(0, Math.min(end, burstEnd) - Math.min(start, burstEnd));
  const burstTravel = burstDurationMs * PLAYER_BULLET_BURST_MULTIPLIER / 1000;
  if (targetTravel <= burstTravel + 1e-12) {
    return start + targetTravel * 1000 / PLAYER_BULLET_BURST_MULTIPLIER;
  }
  return Math.min(end, start + burstDurationMs + (targetTravel - burstTravel) * 1000);
}

/**
 * Converts real time since a local guest shot into the equivalent amount of
 * normal-speed bullet travel. This mirrors the existing 250 ms player-bullet
 * burst without participating in gameplay simulation.
 */
export function getGuestShotPreviewTravelSeconds(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return getPlayerBulletTravelSecondsBetween(0, 0, elapsedMs);
}

export function advanceGuestShotVisual(
  visual: GuestShotVisualState,
  nowMs: number,
  surfaces: AxisAlignedSurface[],
  dynamicSurface?: DynamicSurfaceResolver,
  allowDynamicDepenetration = false,
): GuestShotVisualState {
  if (!Number.isFinite(nowMs) || nowMs <= visual.lastUpdateTime || visual.endingAt !== undefined) {
    return visual;
  }
  const durationSeconds = getPlayerBulletTravelSecondsBetween(
    visual.spawnTime,
    visual.lastUpdateTime,
    nowMs,
  );
  const trace = traceReflectedBulletMotion({
    x: visual.x,
    y: visual.y,
    dx: visual.dx,
    dy: visual.dy,
    durationSeconds,
    radius: visual.radius,
    surfaces,
    dynamicSurface,
    allowDynamicDepenetration,
  });
  const neutralized = trace.collisions.some(collision =>
    collision.kind === 'wall' || collision.kind === 'build');
  return {
    ...visual,
    x: trace.x,
    y: trace.y,
    dx: trace.dx,
    dy: trace.dy,
    isNeutral: visual.isNeutral || neutralized,
    bounceCount: visual.bounceCount + trace.collisions.length,
    lastUpdateTime: nowMs,
  };
}

export function getGuestShotVisualAlpha(visual: GuestShotVisualState, nowMs: number): number {
  if (visual.endingAt === undefined) return 1;
  if (!Number.isFinite(nowMs)) return 0;
  return Math.max(0, 1 - (nowMs - visual.endingAt) / GUEST_SHOT_VISUAL_END_FADE_MS);
}
