import type { GameplayAnalyticsEventName, GameplayAnalyticsFields } from '../analytics/gameplayAnalytics';

export const RELAYED_GAMEPLAY_EVENT_NAMES = [
  'enemy_killed',
  'spawner_destroyed',
  'bouncer_destroyed',
  'special_activated',
  'build_activated',
] as const satisfies readonly GameplayAnalyticsEventName[];

export type RelayedGameplayEventName = typeof RELAYED_GAMEPLAY_EVENT_NAMES[number];

export interface RelayedGameplayEvent {
  roundId: number;
  eventName: RelayedGameplayEventName;
  occurredAtMs: number;
  fields: GameplayAnalyticsFields;
}

const ALLOWED_RELAY_FIELDS = new Set([
  'player_x',
  'player_y',
  'enemy_id',
  'enemy_x',
  'enemy_y',
  'spawner_id',
  'spawner_x',
  'spawner_y',
  'spawners_remaining',
  'bouncer_id',
  'bouncer_x',
  'bouncer_y',
  'bouncer_size',
  'bullet_id',
  'bullet_bounce_count',
  'points_awarded',
]);

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -1000 && value <= 5000;

export function parseRelayedGameplayEvent(value: unknown): RelayedGameplayEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (!Number.isInteger(event.roundId) || (event.roundId as number) <= 0) return null;
  if (!RELAYED_GAMEPLAY_EVENT_NAMES.includes(event.eventName as RelayedGameplayEventName)) return null;
  if (typeof event.occurredAtMs !== 'number' || !Number.isFinite(event.occurredAtMs) || event.occurredAtMs < 0) return null;
  if (!event.fields || typeof event.fields !== 'object' || Array.isArray(event.fields)) return null;

  const cleanFields: GameplayAnalyticsFields = {};
  const entries = Object.entries(event.fields as Record<string, unknown>);
  if (entries.length > 20) return null;

  for (const [key, rawValue] of entries) {
    if (!ALLOWED_RELAY_FIELDS.has(key)) return null;
    if (key.endsWith('_x') || key.endsWith('_y')) {
      if (!isFiniteCoordinate(rawValue)) return null;
      cleanFields[key] = rawValue;
    } else if (typeof rawValue === 'number') {
      if (!Number.isFinite(rawValue) || Math.abs(rawValue) > 1_000_000) return null;
      cleanFields[key] = rawValue;
    } else if (typeof rawValue === 'string') {
      if (rawValue.length > 128 || /[\x00-\x1F\x7F-\x9F]/.test(rawValue)) return null;
      cleanFields[key] = rawValue;
    } else if (typeof rawValue === 'boolean') {
      cleanFields[key] = rawValue;
    } else {
      return null;
    }
  }

  return {
    roundId: event.roundId as number,
    eventName: event.eventName as RelayedGameplayEventName,
    occurredAtMs: event.occurredAtMs,
    fields: cleanFields,
  };
}
