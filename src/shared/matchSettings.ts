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
] as const;

export function isValidMapId(mapId: unknown): mapId is string {
  return typeof mapId === 'string' && (VALID_MAP_IDS as readonly string[]).includes(mapId);
}

export function sanitizeMatchSettings(raw: any): MatchSettings {
  const mapId = raw && isValidMapId(raw?.mapId) ? raw.mapId : DEFAULT_MATCH_SETTINGS.mapId;
  const gameMode = raw && isValidGameMode(raw?.gameMode) ? raw.gameMode : DEFAULT_MATCH_SETTINGS.gameMode;
  return { mapId, gameMode };
}
