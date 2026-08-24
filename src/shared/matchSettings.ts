export type GameMode = 'normal' | 'hard' | 'impossible';

export interface MatchSettings {
  mapId: string;
  gameMode: GameMode;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  mapId: 'medium',
  gameMode: 'normal',
};

export const VALID_GAME_MODES: readonly GameMode[] = ['normal', 'hard', 'impossible'];

export function isValidGameMode(mode: unknown): mode is GameMode {
  return typeof mode === 'string' && (VALID_GAME_MODES as readonly string[]).includes(mode);
}

export const VALID_MAP_IDS = [
  'medium',
  'easy',
  'hard',
  'classic_arena',
  'crossroads',
  'snipers_nest',
  'fortress',
  'choke_points',
  'the_gauntlet',
  'pinball',
  'safe_haven',
  'gladiator_pit',
  'sector_control',
  'hellfire_ring',
  'gridlock',
  'labyrinth',
  'scattered_ruins',
  'checkerboard',
  'titan_orbit',
  'titan_tempest',
  'switchyard',
  'overflow',
  'containment_breach',
  'crossflow',
  'conveyor',
  'crush_circuit',
  'the_press',
  'kill_chambers',
] as const;

export const TITAN_RELIC_MAP_IDS = [
  'titan_orbit',
  'titan_tempest',
] as const;

export type TitanRelicMapId = typeof TITAN_RELIC_MAP_IDS[number];

export function isTitanRelicMapId(
  mapId: unknown,
): mapId is TitanRelicMapId {
  // Titan networking is opt-in by exact map ID. Relic geometry alone must
  // never switch an ordinary multiplayer room onto the Titan code paths.
  return typeof mapId === 'string' &&
    (TITAN_RELIC_MAP_IDS as readonly string[]).includes(mapId);
}

export const TIMED_GATE_MAP_IDS = [
  'switchyard',
  'overflow',
  'containment_breach',
  'crossflow',
  'conveyor',
  'crush_circuit',
  'the_press',
  'kill_chambers',
] as const;

export type TimedGateMapId = typeof TIMED_GATE_MAP_IDS[number];

export function isTimedGateMapId(
  mapId: unknown,
): mapId is TimedGateMapId {
  // Timed gates are deliberately opt-in by exact map identity. An ordinary
  // map containing a similar wall layout must never receive gate networking.
  return typeof mapId === 'string' &&
    (TIMED_GATE_MAP_IDS as readonly string[]).includes(mapId);
}

export function isValidMapId(mapId: unknown): mapId is string {
  return typeof mapId === 'string' && (VALID_MAP_IDS as readonly string[]).includes(mapId);
}

export function sanitizeMatchSettings(raw: any): MatchSettings {
  const mapId = raw && isValidMapId(raw?.mapId) ? raw.mapId : DEFAULT_MATCH_SETTINGS.mapId;
  const gameMode = raw && isValidGameMode(raw?.gameMode) ? raw.gameMode : DEFAULT_MATCH_SETTINGS.gameMode;
  return { mapId, gameMode };
}
