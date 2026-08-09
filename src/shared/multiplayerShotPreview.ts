export const PLAYER_BULLET_BURST_MS = 250;
export const PLAYER_BULLET_BURST_MULTIPLIER = 3.5;
// Long enough to cover a slow action round trip. The preview is replaced as
// soon as the shooter's unbuffered authoritative track is available.
export const MAX_GUEST_SHOT_PREVIEW_MS = 500;

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
  const boundedMs = Math.min(elapsedMs, MAX_GUEST_SHOT_PREVIEW_MS);
  return getPlayerBulletTravelSecondsBetween(0, 0, boundedMs);
}
