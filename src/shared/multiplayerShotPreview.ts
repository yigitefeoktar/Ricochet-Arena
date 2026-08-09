export const PLAYER_BULLET_BURST_MS = 250;
export const PLAYER_BULLET_BURST_MULTIPLIER = 3.5;
// Only bridge the immediate input-feedback window. The authoritative buffered
// bullet takes over later; keeping a prediction alive until then could require
// a backwards correction on high-latency connections.
export const MAX_GUEST_SHOT_PREVIEW_MS = 100;

/**
 * Converts real time since a local guest shot into the equivalent amount of
 * normal-speed bullet travel. This mirrors the existing 250 ms player-bullet
 * burst without participating in gameplay simulation.
 */
export function getGuestShotPreviewTravelSeconds(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const boundedMs = Math.min(elapsedMs, MAX_GUEST_SHOT_PREVIEW_MS);
  const burstMs = Math.min(boundedMs, PLAYER_BULLET_BURST_MS);
  const normalMs = Math.max(0, boundedMs - burstMs);
  return (burstMs * PLAYER_BULLET_BURST_MULTIPLIER + normalMs) / 1000;
}
