import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { Copy, Check, Shuffle } from 'lucide-react';
import {
  GameMode,
  MatchSettings,
  DEFAULT_MATCH_SETTINGS,
  isValidGameMode,
  isValidMapId,
} from '../shared/matchSettings';
import {
  findEarliestCircleTargetHit,
  traceReflectedBulletMotion,
  type AxisAlignedSurface,
  type SurfaceHit,
} from '../shared/multiplayerBulletPhysics';
import {
  confirmAuthoritativeBulletSnapshot,
  createGuestBulletTimeline,
  ingestAuthoritativeBulletEvents,
  sampleGuestBulletTimeline,
  type AuthoritativeBulletEvent,
  type AuthoritativeBulletEventType,
  type AuthoritativeBulletState,
  type GuestBulletTimeline,
} from '../shared/multiplayerBulletTimeline';
import {
  advanceGuestShotVisual,
  getGuestShotVisualAlpha,
  getPlayerBulletTimeAtTravelFraction,
  getPlayerBulletTravelSecondsBetween,
  GUEST_SHOT_VISUAL_END_FADE_MS,
  type GuestShotVisualState,
} from '../shared/multiplayerShotPreview';

interface ActiveMatchSettingsRequest {
  seq: number;
  roomId: string;
  timeoutId: ReturnType<typeof setTimeout> | null;
  resolve: (value: boolean) => void;
  isResolved: boolean;
}

export interface HostClockAnchor {
  roomId: string;
  roundId: number;
  hostId: string;
  hostTimeAtAnchor: number;
  localTimeAtAnchor: number;
}

const isValidMpPlayerId = (id: unknown): id is string => {
  if (typeof id !== 'string') return false;
  if (id.length < 1 || id.length > 128) return false;
  if (id === '__proto__' || id === 'prototype' || id === 'constructor') return false;
  if (/[\x00-\x1F\x7F-\x9F]/.test(id)) return false;
  return true;
};

export interface ValidatedRosterEntry {
  id: string;
  name: string;
  colorIdx: number;
  isHost: boolean;
}

export interface ValidatedRosterResult {
  selfEntry: ValidatedRosterEntry;
  otherPlayers: Record<string, { name: string; colorIdx: number; isHost: boolean }>;
  playerIds: Set<string>;
}

export const validateRoster = (playersList: unknown, currentSocketId: string): ValidatedRosterResult | null => {
  if (!Array.isArray(playersList) || playersList.length < 1 || playersList.length > 5) {
    return null;
  }
  if (!currentSocketId || !isValidMpPlayerId(currentSocketId)) {
    return null;
  }

  const seenIds = new Set<string>();
  const seenColors = new Set<number>();
  let hostCount = 0;
  let selfCount = 0;
  let selfEntry: ValidatedRosterEntry | null = null;
  const otherPlayers: Record<string, { name: string; colorIdx: number; isHost: boolean }> = {};

  for (const item of playersList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const { id, name, colorIdx, isHost } = item as any;

    if (!isValidMpPlayerId(id) || seenIds.has(id)) {
      return null;
    }

    if (typeof name !== 'string' || /[\x00-\x1F\x7F-\x9F]/.test(name)) {
      return null;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 12) {
      return null;
    }

    if (typeof colorIdx !== 'number' || !Number.isInteger(colorIdx) || colorIdx < 0 || colorIdx > 4) {
      return null;
    }
    if (seenColors.has(colorIdx)) {
      return null;
    }

    if (typeof isHost !== 'boolean') {
      return null;
    }

    seenIds.add(id);
    seenColors.add(colorIdx);

    if (isHost) {
      hostCount++;
    }

    const validatedEntry = { id, name: trimmedName, colorIdx, isHost };

    if (id === currentSocketId) {
      selfCount++;
      selfEntry = validatedEntry;
    } else {
      otherPlayers[id] = {
        name: trimmedName,
        colorIdx,
        isHost
      };
    }
  }

  if (hostCount !== 1 || selfCount !== 1 || !selfEntry) {
    return null;
  }

  return { selfEntry, otherPlayers, playerIds: seenIds };
};

const MAP_WIDTH = 3000;
const MAP_HEIGHT = 3000;
const PLAYER_SPEED = 200; // px per second
const BULLET_SPEED = 120; // px per second, slow to dodge
const PLAYER_RADIUS = 16;
const ENEMY_RADIUS = 16;
const BULLET_RADIUS = 5;
const FIRE_RATE = 800; // ms between shots (slow shooting)
const ENEMY_FIRE_RATE = 2500;
const ENEMY_SPEED = 60;
const DASH_COOLDOWN = 25000;
const BUILD_COOLDOWN = 25000;

const SAVE_FORMAT = "ricochet-arena-save";
const SAVE_VERSION = 1;
const MAX_SAVE_FILE_BYTES = 5 * 1024 * 1024;
const QUICK_SAVE_STORAGE_KEY = "ricochet-arena-quicksave-v1";

const WALLS = [
  // Outer boundaries
  { x: 0, y: 0, w: MAP_WIDTH, h: 50 },
  { x: 0, y: 0, w: 50, h: MAP_HEIGHT },
  { x: MAP_WIDTH - 50, y: 0, w: 50, h: MAP_HEIGHT },
  { x: 0, y: MAP_HEIGHT - 50, w: MAP_WIDTH, h: 50 },

  // Custom inner walls - Creating open areas and maze-like structures
  // Top left maze
  { x: 300, y: 300, w: 400, h: 40 },
  { x: 300, y: 300, w: 40, h: 400 },
  { x: 500, y: 500, w: 400, h: 40 },
  { x: 860, y: 300, w: 40, h: 240 },

  // Center large bloc
  { x: 1200, y: 1200, w: 600, h: 600 },

  // Bottom right corridors
  { x: 2000, y: 2000, w: 700, h: 40 },
  { x: 2000, y: 2300, w: 700, h: 40 },
  { x: 2000, y: 2000, w: 40, h: 340 },

  // Top right open but scattered pillars
  { x: 2200, y: 400, w: 80, h: 80 },
  { x: 2500, y: 700, w: 80, h: 80 },
  { x: 2000, y: 800, w: 80, h: 80 },

  // Bottom left open with weird angles (just rects for now)
  { x: 400, y: 2200, w: 100, h: 400 },
  { x: 700, y: 2400, w: 400, h: 100 },
];

const BASE_WALLS = [
  { x: 0, y: 0, w: MAP_WIDTH, h: 50 },
  { x: 0, y: 0, w: 50, h: MAP_HEIGHT },
  { x: MAP_WIDTH - 50, y: 0, w: 50, h: MAP_HEIGHT },
  { x: 0, y: MAP_HEIGHT - 50, w: MAP_WIDTH, h: 50 },
];

type MapDefinition = { name: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'; description: string; walls: {x: number, y: number, w: number, h: number}[]; spawners: {x: number, y: number, radius: number, hp: number, maxHp: number, specialType?: string}[]; spawnPoint?: { x: number; y: number } };

const MAPS: Record<string, MapDefinition> = {
  medium: {
    name: "The Original",
    difficulty: "MEDIUM",
    description: "The very first Ricochet Arena map. A distinctive asymmetrical battleground.",
    walls: WALLS,
    spawners: [
      { x: 800, y: 800, radius: 40, hp: 100, maxHp: 100 },
      { x: 2200, y: 800, radius: 40, hp: 100, maxHp: 100 },
      { x: 800, y: 2200, radius: 40, hp: 100, maxHp: 100 },
      { x: 2400, y: 2400, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 600, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  easy: {
    name: "Easy Classic",
    difficulty: "EASY",
    description: "The classic open layout of the early testing grounds.",
    walls: [
      ...BASE_WALLS,
      { x: 500, y: 500, w: 100, h: 100 },
      { x: 2400, y: 500, w: 100, h: 100 },
      { x: 500, y: 2400, w: 100, h: 100 },
      { x: 2400, y: 2400, w: 100, h: 100 }
    ],
    spawners: [
      { x: 1200, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1800, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1200, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1800, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  hard: {
    name: "Hard Classic",
    difficulty: "HARD",
    description: "The original unforgiving maze prototype.",
    walls: [
      ...BASE_WALLS,
      { x: 300, y: 300, w: 900, h: 50 },
      { x: 300, y: 300, w: 50, h: 900 },
      { x: 1700, y: 300, w: 1000, h: 50 },
      { x: 2650, y: 300, w: 50, h: 900 },

      { x: 300, y: 1700, w: 50, h: 1000 },
      { x: 300, y: 2650, w: 1000, h: 50 },

      { x: 2650, y: 1700, w: 50, h: 1000 },
      { x: 1700, y: 2650, w: 1000, h: 50 },

      { x: 800, y: 800, w: 500, h: 50 },
      { x: 800, y: 800, w: 50, h: 500 },

      { x: 1700, y: 800, w: 500, h: 50 },
      { x: 2150, y: 800, w: 50, h: 500 },

      { x: 800, y: 1700, w: 50, h: 500 },
      { x: 800, y: 2150, w: 500, h: 50 },

      { x: 2150, y: 1700, w: 50, h: 500 },
      { x: 1700, y: 2150, w: 500, h: 50 },

      { x: 1200, y: 1200, w: 600, h: 600 },
    ],
    spawners: [
      { x: 150, y: 150, radius: 40, hp: 100, maxHp: 100 },
      { x: 2850, y: 150, radius: 40, hp: 100, maxHp: 100 },
      { x: 150, y: 2850, radius: 40, hp: 100, maxHp: 100 },
      { x: 2850, y: 2850, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1000, radius: 40, hp: 100, maxHp: 100, specialType: 'singularity' }
    ]
  },

  classic_arena: {
    name: "Classic Arena",
    difficulty: "MEDIUM",
    description: "The standard battlefield. A balanced layout of offensive covers and central contested space.",
    walls: [
      ...BASE_WALLS,
      { x: 700, y: 700, w: 100, h: 400 },
      { x: 700, y: 700, w: 400, h: 100 },
      { x: 2200, y: 700, w: 100, h: 400 },
      { x: 1900, y: 700, w: 400, h: 100 },
      { x: 700, y: 1900, w: 100, h: 400 },
      { x: 700, y: 2200, w: 400, h: 100 },
      { x: 2200, y: 1900, w: 100, h: 400 },
      { x: 1900, y: 2200, w: 400, h: 100 },
      // Central pillar
      { x: 1400, y: 1400, w: 200, h: 200 },
    ],
    spawners: [
      { x: 900, y: 900, radius: 40, hp: 100, maxHp: 100 },
      { x: 2100, y: 900, radius: 40, hp: 100, maxHp: 100 },
      { x: 900, y: 2100, radius: 40, hp: 100, maxHp: 100 },
      { x: 2100, y: 2100, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 600, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  crossroads: {
    name: "Crossroads",
    difficulty: "MEDIUM",
    description: "Four distinct quarters divided by large walls. Predict ricochets at the central intersection.",
    walls: [
      ...BASE_WALLS,
      // Main cross
      { x: 1200, y: 0, w: 600, h: 900 },
      { x: 1200, y: 2100, w: 600, h: 900 },
      { x: 0, y: 1200, w: 900, h: 600 },
      { x: 2100, y: 1200, w: 900, h: 600 },

      // Top-Left: L-Shape
      { x: 300, y: 300, w: 500, h: 50 },
      { x: 300, y: 300, w: 50, h: 500 },

      // Top-Right: Parallel horizontal shields
      { x: 2150, y: 300, w: 500, h: 50 },
      { x: 2150, y: 850, w: 500, h: 50 },

      // Bottom-Left: Diagonal-like stairs
      { x: 300, y: 2100, w: 200, h: 50 },
      { x: 500, y: 2150, w: 200, h: 50 },
      { x: 800, y: 2650, w: 200, h: 50 },

      // Bottom-Right: 4 Pillars
      { x: 2150, y: 2150, w: 100, h: 100 },
      { x: 2650, y: 2150, w: 100, h: 100 },
      { x: 2150, y: 2650, w: 100, h: 100 },
      { x: 2650, y: 2650, w: 100, h: 100 },
    ],
    spawners: [
      { x: 600, y: 600, radius: 40, hp: 100, maxHp: 100 },
      { x: 2400, y: 600, radius: 40, hp: 100, maxHp: 100 },
      { x: 600, y: 2400, radius: 40, hp: 100, maxHp: 100 },
      { x: 2400, y: 2400, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  snipers_nest: {
    name: "Sniper's Nest",
    difficulty: "MEDIUM",
    description: "Features a protected central bunker with small firing slits. Defend the core or hunt outside.",
    walls: [
      ...BASE_WALLS,
      // Central bunker
      { x: 1100, y: 1100, w: 300, h: 50 },
      { x: 1600, y: 1100, w: 300, h: 50 },
      { x: 1100, y: 1850, w: 300, h: 50 },
      { x: 1600, y: 1850, w: 300, h: 50 },
      { x: 1100, y: 1100, w: 50, h: 300 },
      { x: 1100, y: 1600, w: 50, h: 300 },
      { x: 1850, y: 1100, w: 50, h: 300 },
      { x: 1850, y: 1600, w: 50, h: 300 },

      // Left Spawner Cover
      { x: 150, y: 1200, w: 50, h: 600 },
      { x: 150, y: 1200, w: 400, h: 50 },
      { x: 150, y: 1750, w: 400, h: 50 },

      // Right Spawner Cover
      { x: 2800, y: 1300, w: 50, h: 400 },
      { x: 2400, y: 1200, w: 100, h: 100 },
      { x: 2400, y: 1700, w: 100, h: 100 },

      // Top Spawner Cover
      { x: 1300, y: 650, w: 400, h: 50 },
      { x: 1475, y: 700, w: 50, h: 200 },

      // Bottom Spawner Cover
      { x: 1250, y: 2300, w: 50, h: 500 },
      { x: 1700, y: 2300, w: 50, h: 500 },
    ],
    spawners: [
      { x: 400, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2600, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 400, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 2600, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },

  fortress: {
    name: "Fortress",
    difficulty: "HARD",
    description: "Begin outside the main gate. Breach the fortress to reach its heavily guarded spawners.",
    walls: [
      ...BASE_WALLS,
      { x: 800, y: 800, w: 600, h: 100 },
      { x: 1600, y: 800, w: 600, h: 100 },
      { x: 800, y: 800, w: 100, h: 1400 },
      { x: 2100, y: 800, w: 100, h: 1400 },
      { x: 800, y: 2100, w: 1400, h: 100 },
      { x: 1000, y: 1000, w: 400, h: 100 },
      { x: 1600, y: 1000, w: 400, h: 100 },
    ],
    spawners: [
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100, specialType: 'shield' },
      { x: 1200, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1800, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1200, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1800, radius: 40, hp: 100, maxHp: 100 }
    ],
    spawnPoint: { x: 1500, y: 600 }
  },
  choke_points: {
    name: "Choke Points",
    difficulty: "HARD",
    description: "Several narrow pathways restrict movement. Position yourself carefully or be overrun.",
    walls: [
      ...BASE_WALLS,
      // Top-Left corner structure
      { x: 1000, y: 0, w: 100, h: 600 },
      { x: 0, y: 800, w: 600, h: 100 },
      { x: 300, y: 300, w: 400, h: 50 },

      // Top-Right corner structure
      { x: 1900, y: 200, w: 100, h: 600 },
      { x: 2200, y: 800, w: 800, h: 100 },
      { x: 2200, y: 300, w: 50, h: 400 },

      // Bottom-Left corner structure
      { x: 1000, y: 2100, w: 100, h: 900 },
      { x: 0, y: 1900, w: 800, h: 100 },
      { x: 300, y: 2200, w: 50, h: 400 },
      { x: 750, y: 2400, w: 50, h: 400 },

      // Bottom-Right corner structure
      { x: 1900, y: 1900, w: 100, h: 700 },
      { x: 2400, y: 1900, w: 600, h: 100 },
      { x: 2200, y: 2200, w: 300, h: 50 },
      { x: 2200, y: 2200, w: 50, h: 300 },

      // Center enclosure
      { x: 1000, y: 1000, w: 100, h: 900 },
      { x: 1900, y: 1000, w: 100, h: 700 },
      { x: 1200, y: 800, w: 600, h: 100 },
      { x: 1200, y: 1900, w: 800, h: 100 },
      { x: 1200, y: 1300, w: 100, h: 400 },
    ],
    spawners: [
      { x: 500, y: 500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2500, y: 500, radius: 40, hp: 100, maxHp: 100 },
      { x: 500, y: 2500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2500, y: 2500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  the_gauntlet: {
    name: "The Gauntlet",
    difficulty: "EXPERT",
    description: "Begin in the bottom-left and fight through a winding zig-zag of ricochets with very little room for error.",
    walls: [
      ...BASE_WALLS,
      { x: 0, y: 500, w: 2500, h: 100 },
      { x: 500, y: 1000, w: 2500, h: 100 },
      { x: 0, y: 1500, w: 2500, h: 100 },
      { x: 500, y: 2000, w: 2500, h: 100 },
      { x: 0, y: 2500, w: 2500, h: 100 },
    ],
    spawners: [
      { x: 2800, y: 250, radius: 40, hp: 100, maxHp: 100 },
      { x: 200, y: 750, radius: 40, hp: 100, maxHp: 100 },
      { x: 2800, y: 1250, radius: 40, hp: 100, maxHp: 100 },
      { x: 200, y: 1750, radius: 40, hp: 100, maxHp: 100 },
      { x: 2800, y: 2250, radius: 40, hp: 100, maxHp: 100 }
    ],
    spawnPoint: { x: 250, y: 2775 }
  },
  pinball: {
    name: "Pinball",
    difficulty: "EXPERT",
    description: "Chaos incarnate. Bullets bounce off a multitude of scattered bumpers in the center.",
    walls: [
      ...BASE_WALLS,
      // Top-Left Guard
      { x: 200, y: 600, w: 200, h: 50 },
      { x: 400, y: 700, w: 200, h: 50 },
      { x: 600, y: 200, w: 50, h: 200 },
      { x: 700, y: 400, w: 50, h: 200 },

      // Top-Right Guard
      { x: 2300, y: 200, w: 50, h: 400 },
      { x: 2300, y: 600, w: 400, h: 50 },

      // Bottom-Left Guard
      { x: 200, y: 2300, w: 400, h: 30 },
      { x: 200, y: 2450, w: 400, h: 30 },
      { x: 200, y: 2800, w: 400, h: 30 },

      // Bottom-Right Guard
      { x: 2400, y: 2400, w: 400, h: 50 },
      { x: 2400, y: 2400, w: 50, h: 400 },
      { x: 2400, y: 2800, w: 400, h: 50 },

      // Bumpers (small walls)
      { x: 900, y: 900, w: 100, h: 100 },
      { x: 2000, y: 900, w: 100, h: 100 },
      { x: 900, y: 2000, w: 100, h: 100 },
      { x: 2000, y: 2000, w: 100, h: 100 },

      { x: 1450, y: 600, w: 100, h: 100 },
      { x: 1450, y: 2300, w: 100, h: 100 },
      { x: 600, y: 1450, w: 100, h: 100 },
      { x: 2300, y: 1450, w: 100, h: 100 },

      { x: 1150, y: 1150, w: 150, h: 150 },
      { x: 1700, y: 1150, w: 150, h: 150 },
      { x: 1150, y: 1700, w: 150, h: 150 },
      { x: 1700, y: 1700, w: 150, h: 150 },
    ],
    spawners: [
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100, specialType: 'kinetic' },
      { x: 400, y: 400, radius: 40, hp: 100, maxHp: 100 },
      { x: 2600, y: 400, radius: 40, hp: 100, maxHp: 100 },
      { x: 400, y: 2600, radius: 40, hp: 100, maxHp: 100 },
      { x: 2600, y: 2600, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  safe_haven: {
    name: "Safe Haven",
    difficulty: "EASY",
    description: "An open arena with a protected bottom-left refuge where players can regroup before returning to battle.",
    walls: [
      ...BASE_WALLS,
      // Safe Start Room
      { x: 0, y: 1800, w: 700, h: 50 },
      { x: 1000, y: 2100, w: 50, h: 900 },

      // Center Spawner Brackets
      { x: 1200, y: 1300, w: 50, h: 400 },
      { x: 1750, y: 1300, w: 50, h: 400 },

      // Top-Left L Cover
      { x: 200, y: 800, w: 600, h: 50 },
      { x: 800, y: 200, w: 50, h: 600 },

      // Top-Right Massive Wall
      { x: 2100, y: 700, w: 600, h: 50 },

      // Bottom-Right Dispersed Dots
      { x: 2200, y: 2200, w: 50, h: 50 },
      { x: 2800, y: 2200, w: 50, h: 50 },
      { x: 2200, y: 2800, w: 50, h: 50 },
      { x: 2800, y: 2800, w: 50, h: 50 }
    ],
    spawners: [
      { x: 500, y: 2400, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2500, y: 500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2500, y: 2500, radius: 40, hp: 100, maxHp: 100 },
      { x: 500, y: 500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  gladiator_pit: {
    name: "Relic Sanctum",
    difficulty: "HARD",
    description: "An asymmetric battleground with five specialized chambers. Each spawner is protected by a powerful cosmic relic—from kinetic deflectors to thermal magma gates.",
    walls: [
      ...BASE_WALLS,
      // Sector 1 (Top-Left, Shield Generator)
      { x: 250, y: 250, w: 40, h: 500 },
      { x: 250, y: 250, w: 500, h: 40 },
      { x: 750, y: 250, w: 40, h: 250 },
      { x: 250, y: 750, w: 300, h: 40 },

      // Sector 2 (Top-Right, Kinetic Deflectors)
      { x: 2100, y: 300, w: 80, h: 80 },
      { x: 2400, y: 200, w: 80, h: 80 },
      { x: 2700, y: 350, w: 80, h: 80 },
      { x: 2300, y: 650, w: 120, h: 40 },
      { x: 2600, y: 750, w: 40, h: 120 },

      // Sector 3 (Center, Gravitational Singularity)
      { x: 1200, y: 1200, w: 150, h: 40 },
      { x: 1650, y: 1200, w: 150, h: 40 },
      { x: 1200, y: 1760, w: 150, h: 40 },
      { x: 1650, y: 1760, w: 150, h: 40 },
      { x: 1100, y: 1350, w: 40, h: 300 },
      { x: 1860, y: 1350, w: 40, h: 300 },

      // Sector 4 (Bottom-Left, Thermal Vent)
      { x: 200, y: 2100, w: 600, h: 40 },
      { x: 800, y: 2100, w: 40, h: 500 },
      { x: 400, y: 2700, w: 400, h: 40 },

      // Sector 5 (Bottom-Right, Crystal Spire)
      { x: 1900, y: 2000, w: 40, h: 600 },
      { x: 1900, y: 2000, w: 600, h: 40 },
      { x: 2200, y: 2300, w: 40, h: 400 },
      { x: 2200, y: 2300, w: 400, h: 40 }
    ],
    spawners: [
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100, specialType: 'singularity' },
      { x: 500, y: 500, radius: 40, hp: 100, maxHp: 100, specialType: 'shield' },
      { x: 2500, y: 500, radius: 40, hp: 100, maxHp: 100, specialType: 'kinetic' },
      { x: 500, y: 2500, radius: 40, hp: 100, maxHp: 100, specialType: 'magma_gates' },
      { x: 2500, y: 2500, radius: 40, hp: 100, maxHp: 100, specialType: 'crystal' }
    ]
  },
  sector_control: {
    name: "Sector Control",
    difficulty: "HARD",
    description: "Divided into 4 quadrants. Each room's spawner is fortified with a unique defensive layout and cosmic relic—from kinetic deflectors to rotating magma gates.",
    walls: [
      ...BASE_WALLS,
      { x: 50, y: 1450, w: 1200, h: 100 },
      { x: 1750, y: 1450, w: 1200, h: 100 },
      { x: 1450, y: 50, w: 100, h: 1200 },
      { x: 1450, y: 1750, w: 100, h: 1200 },

      // Sector Control Quadrant walls (additions)
      // Top-Left (Sector Alpha, Shield) - around (500, 500)
      { x: 300, y: 300, w: 40, h: 400 },
      { x: 300, y: 300, w: 400, h: 40 },
      { x: 300, y: 700, w: 400, h: 40 },

      // Top-Right (Sector Beta, Kinetic) - around (2500, 500)
      { x: 2300, y: 300, w: 40, h: 400 },
      { x: 2660, y: 300, w: 40, h: 400 },

      // Bottom-Left (Sector Gamma, Lava) - around (500, 2500)
      { x: 300, y: 2300, w: 400, h: 40 },
      { x: 300, y: 2660, w: 400, h: 40 },

      // Bottom-Right (Sector Delta, Crystal) - around (2500, 2500)
      { x: 2320, y: 2320, w: 80, h: 80 },
      { x: 2600, y: 2320, w: 80, h: 80 },
      { x: 2320, y: 2600, w: 80, h: 80 },
      { x: 2600, y: 2600, w: 80, h: 80 }
    ],
    spawners: [
      { x: 500, y: 500, radius: 40, hp: 100, maxHp: 100, specialType: 'shield' },
      { x: 2500, y: 500, radius: 40, hp: 100, maxHp: 100, specialType: 'kinetic' },
      { x: 500, y: 2500, radius: 40, hp: 100, maxHp: 100, specialType: 'magma_gates' },
      { x: 2500, y: 2500, radius: 40, hp: 100, maxHp: 100, specialType: 'crystal' }
    ]
  },
  hellfire_ring: {
    name: "Hellfire Ring",
    difficulty: "EXPERT",
    description: "A tight central bunker surrounded by an active outer ring of hostile spawners.",
    walls: [
      ...BASE_WALLS,
      // Central bunker
      { x: 1100, y: 1100, w: 300, h: 50 },
      { x: 1600, y: 1100, w: 300, h: 50 },
      { x: 1100, y: 1850, w: 300, h: 50 },
      { x: 1600, y: 1850, w: 300, h: 50 },
      { x: 1100, y: 1100, w: 50, h: 300 },
      { x: 1100, y: 1600, w: 50, h: 300 },
      { x: 1850, y: 1100, w: 50, h: 300 },
      { x: 1850, y: 1600, w: 50, h: 300 },

      // Top-Left Cage
      { x: 400, y: 400, w: 500, h: 50 },
      { x: 400, y: 400, w: 50, h: 500 },
      { x: 900, y: 450, w: 50, h: 200 },
      { x: 450, y: 900, w: 200, h: 50 },

      // Top-Right Chevron
      { x: 2100, y: 500, w: 50, h: 300 },
      { x: 2150, y: 800, w: 300, h: 50 },
      { x: 2500, y: 400, w: 50, h: 200 },

      // Bottom-Left Corridor
      { x: 300, y: 2100, w: 600, h: 50 },
      { x: 300, y: 2500, w: 600, h: 50 },

      // Bottom-Right Crossfire Blocks
      { x: 2000, y: 2250, w: 200, h: 100 },
      { x: 2400, y: 2250, w: 200, h: 100 },
      { x: 2250, y: 2000, w: 100, h: 200 },
      { x: 2250, y: 2400, w: 100, h: 200 }
    ],
    spawners: [
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 700, y: 700, radius: 40, hp: 100, maxHp: 100, specialType: 'shield' },
      { x: 2300, y: 700, radius: 40, hp: 100, maxHp: 100, specialType: 'kinetic' },
      { x: 700, y: 2300, radius: 40, hp: 100, maxHp: 100, specialType: 'magma_gates' },
      { x: 2300, y: 2300, radius: 40, hp: 100, maxHp: 100, specialType: 'crystal' }
    ]
  },
  gridlock: {
    name: "Gridlock",
    difficulty: "EXPERT",
    description: "An intense grid network of tight rooms that demand careful movement and precise ricochets.",
    walls: [
      ...BASE_WALLS,
      // Vertical divider 1 (at x=950, w=100)
      { x: 950, y: 50, w: 100, h: 350 },
      { x: 950, y: 600, w: 100, h: 800 },
      { x: 950, y: 1600, w: 100, h: 800 },
      { x: 950, y: 2600, w: 100, h: 350 },

      // Vertical divider 2 (at x=1950, w=100)
      { x: 1950, y: 50, w: 100, h: 350 },
      { x: 1950, y: 600, w: 100, h: 800 },
      { x: 1950, y: 1600, w: 100, h: 800 },
      { x: 1950, y: 2600, w: 100, h: 350 },

      // Horizontal divider 1 (at y=950, h=100)
      { x: 50, y: 950, w: 350, h: 100 },
      { x: 600, y: 950, w: 800, h: 100 },
      { x: 1600, y: 950, w: 800, h: 100 },
      { x: 2600, y: 950, w: 350, h: 100 },

      // Horizontal divider 2 (at y=1950, h=100)
      { x: 50, y: 1950, w: 350, h: 100 },
      { x: 600, y: 1950, w: 800, h: 100 },
      { x: 1600, y: 1950, w: 800, h: 100 },
      { x: 2600, y: 1950, w: 350, h: 100 },

      // Room 1 (Top-Left) Inner
      { x: 200, y: 200, w: 600, h: 50 },
      { x: 200, y: 200, w: 50, h: 600 },
      { x: 200, y: 750, w: 400, h: 50 },

      // Room 2 (Top-Right) Inner
      { x: 2200, y: 200, w: 100, h: 100 },
      { x: 2350, y: 200, w: 100, h: 100 },
      { x: 2650, y: 700, w: 100, h: 100 },
      { x: 2800, y: 800, w: 100, h: 100 },

      // Room 3 (Center) Inner
      { x: 1200, y: 1200, w: 100, h: 100 },
      { x: 1700, y: 1200, w: 100, h: 100 },
      { x: 1200, y: 1700, w: 100, h: 100 },
      { x: 1700, y: 1700, w: 100, h: 100 },

      // Room 4 (Bottom-Right) Inner
      { x: 2300, y: 2200, w: 400, h: 50 },
      { x: 2475, y: 2250, w: 50, h: 50 },
      { x: 2475, y: 2700, w: 50, h: 200 },

      // Room 5 (Bottom-Left - Start) Inner
      { x: 700, y: 2200, w: 100, h: 50 }
    ],
    spawners: [
      { x: 500, y: 2500, radius: 40, hp: 100, maxHp: 100 },
      { x: 500, y: 500, radius: 40, hp: 100, maxHp: 100, specialType: 'shield' },
      { x: 2500, y: 500, radius: 40, hp: 100, maxHp: 100, specialType: 'kinetic' },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100, specialType: 'singularity' },
      { x: 2500, y: 2500, radius: 40, hp: 100, maxHp: 100, specialType: 'crystal' }
    ]
  },
  labyrinth: {
    name: "Serpentine Labyrinth",
    difficulty: "HARD",
    description: "Begin near one end of a winding maze and fight toward the crystal-protected spawner at its far end.",
    walls: (() => {
      const walls: { x: number; y: number; w: number; h: number }[] = [...BASE_WALLS];
      const CELL_SIZE = 360;
      const WALL_THICKNESS = 80;
      const HALF_THICKNESS = 40;

      const openEdges = new Set<string>();

      const addEdge = (c1: number, r1: number, c2: number, r2: number) => {
        if (c1 > c2 || (c1 === c2 && r1 > r2)) {
          openEdges.add(`${c2},${r2}-${c1},${r1}`);
        } else {
          openEdges.add(`${c1},${r1}-${c2},${r2}`);
        }
      };

      // Top half (rows 0..3) serpentine winding path
      addEdge(0, 0, 0, 1);
      addEdge(0, 1, 0, 2);
      addEdge(0, 2, 0, 3);
      addEdge(0, 3, 1, 3);
      addEdge(1, 3, 1, 2);
      addEdge(1, 2, 1, 1);
      addEdge(1, 1, 1, 0);
      addEdge(1, 0, 2, 0);
      addEdge(2, 0, 2, 1);
      addEdge(2, 1, 2, 2);
      addEdge(2, 2, 2, 3);
      addEdge(2, 3, 3, 3);
      addEdge(3, 3, 3, 2);
      addEdge(3, 2, 3, 1);
      addEdge(3, 1, 3, 0);
      addEdge(3, 0, 4, 0);
      addEdge(4, 0, 4, 1);
      addEdge(4, 1, 4, 2);
      addEdge(4, 2, 4, 3);
      addEdge(4, 3, 5, 3);
      addEdge(5, 3, 5, 2);
      addEdge(5, 2, 5, 1);
      addEdge(5, 1, 5, 0);
      addEdge(5, 0, 6, 0);
      addEdge(6, 0, 6, 1);
      addEdge(6, 1, 6, 2);
      addEdge(6, 2, 6, 3);
      addEdge(6, 3, 7, 3);
      addEdge(7, 3, 7, 2);
      addEdge(7, 2, 7, 1);
      addEdge(7, 1, 7, 0);

      // Bridge Top half to Bottom half
      addEdge(7, 3, 7, 4);

      // Column 7 bottom half
      addEdge(7, 4, 7, 5);
      addEdge(7, 5, 7, 6);
      addEdge(7, 6, 7, 7);

      // Columns 0..6 vertical connectors for rows 4..7
      for (let c = 0; c <= 6; c++) {
        addEdge(c, 4, c, 5);
        addEdge(c, 5, c, 6);
        addEdge(c, 6, c, 7);
      }

      // Horizontal connectors on Row 4
      for (let c = 0; c <= 6; c++) {
        addEdge(c, 4, c + 1, 4);
      }

      // Generate walls for boundaries that are NOT open edges
      // 1. Vertical wall lines (c ranges from 1 to 7) separating col c-1 and col c
      for (let c = 1; c <= 7; c++) {
        for (let r = 0; r <= 7; r++) {
          const edgeKey = `${c - 1},${r}-${c},${r}`;
          if (!openEdges.has(edgeKey)) {
            const x = 50 + c * CELL_SIZE - HALF_THICKNESS;
            const y = 50 + r * CELL_SIZE - HALF_THICKNESS;
            const w = WALL_THICKNESS;
            const h = CELL_SIZE + WALL_THICKNESS;
            walls.push({ x, y, w, h });
          }
        }
      }

      // 2. Horizontal wall lines (r ranges from 1 to 7) separating row r-1 and row r
      for (let r = 1; r <= 7; r++) {
        for (let c = 0; c <= 7; c++) {
          const edgeKey = `${c},${r - 1}-${c},${r}`;
          if (!openEdges.has(edgeKey)) {
            const x = 50 + c * CELL_SIZE - HALF_THICKNESS;
            const y = 50 + r * CELL_SIZE - HALF_THICKNESS;
            const w = CELL_SIZE + WALL_THICKNESS;
            const h = WALL_THICKNESS;
            walls.push({ x, y, w, h });
          }
        }
      }

      return walls;
    })(),
    spawners: [
      { x: 320, y: 320, radius: 40, hp: 100, maxHp: 100 }, // Starting-region spawner in cell (0,0)
      { x: 2750, y: 230, radius: 40, hp: 100, maxHp: 100 }, // Cell (7,0)
      { x: 1310, y: 1670, radius: 40, hp: 100, maxHp: 100 }, // Cell (3,4)
      { x: 230, y: 2750, radius: 40, hp: 100, maxHp: 100 }, // Cell (0,7)
      { x: 2750, y: 2750, radius: 40, hp: 100, maxHp: 100, specialType: 'crystal' } // Cell (7,7) - the exact far end of the maze
    ],
    spawnPoint: { x: 180, y: 600 }
  },
  scattered_ruins: {
    name: "Scattered Ruins",
    difficulty: "EASY",
    description: "An ancient tactical arena littered with randomized-looking features and organic covers, perfect for multiplayer strategy.",
    walls: [
      ...BASE_WALLS,
      { x: 400, y: 1000, w: 200, h: 100 },
      { x: 1000, y: 400, w: 100, h: 300 },
      { x: 1600, y: 300, w: 150, h: 150 },
      { x: 2200, y: 800, w: 200, h: 100 },

      { x: 800, y: 1200, w: 100, h: 250 },
      { x: 1300, y: 1000, w: 300, h: 100 },
      { x: 1900, y: 1300, w: 150, h: 150 },

      { x: 600, y: 1700, w: 250, h: 100 },
      { x: 1200, y: 1900, w: 100, h: 300 },
      { x: 1700, y: 2100, w: 300, h: 100 },

      { x: 2300, y: 1800, w: 150, h: 250 },
      { x: 1100, y: 2500, w: 200, h: 100 },
      { x: 2100, y: 2500, w: 100, h: 200 }
    ],
    spawners: [
      { x: 500, y: 500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2500, y: 500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 500, y: 2500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2500, y: 2500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  checkerboard: {
    name: "Checkerboard",
    difficulty: "EXPERT",
    description: "An elegant matrix of small square pillars arranged in a grid-like checkerboard pattern. High-frequency ricochets are guaranteed!",
    walls: [
      ...BASE_WALLS,
      // Row 0
      { x: 900, y: 300, w: 200, h: 200 },
      { x: 1900, y: 300, w: 200, h: 200 },
      // Row 1
      { x: 300, y: 900, w: 200, h: 200 },
      { x: 1400, y: 900, w: 200, h: 200 },
      { x: 2500, y: 900, w: 200, h: 200 },
      // Row 2
      { x: 900, y: 1500, w: 200, h: 200 },
      { x: 1900, y: 1500, w: 200, h: 200 },
      // Row 3
      { x: 300, y: 2100, w: 200, h: 200 },
      { x: 1400, y: 2100, w: 200, h: 200 },
      { x: 2500, y: 2100, w: 200, h: 200 },
      // Row 4
      { x: 900, y: 2700, w: 200, h: 200 },
      { x: 1900, y: 2700, w: 200, h: 200 }
    ],
    spawners: [
      { x: 300, y: 300, radius: 40, hp: 100, maxHp: 100 },
      { x: 2700, y: 300, radius: 40, hp: 100, maxHp: 100, specialType: 'crystal' },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100, specialType: 'kinetic' },
      { x: 300, y: 2700, radius: 40, hp: 100, maxHp: 100 },
      { x: 2700, y: 2700, radius: 40, hp: 100, maxHp: 100 }
    ]
  }
};

let activeWalls = MAPS.medium.walls;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(val, max));
}

function circleOverlapsWall(x: number, y: number, radius: number, wall: { x: number; y: number; w: number; h: number }): boolean {
  const closestX = Math.max(wall.x, Math.min(x, wall.x + wall.w));
  const closestY = Math.max(wall.y, Math.min(y, wall.y + wall.h));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

function resolveWallCollisions(
  x: number,
  y: number,
  radius: number,
  walls: { x: number; y: number; w: number; h: number }[],
  prevX?: number,
  prevY?: number
): { x: number; y: number; normals: { nx: number; ny: number }[]; collided: boolean } {
  let curX = x;
  let curY = y;
  const normals: { nx: number; ny: number }[] = [];
  let anyCollision = false;

  const passes = 8;
  const epsilon = 0.05;

  for (let p = 0; p < passes; p++) {
    let passCollision = false;
    for (const wall of walls) {
      const closestX = Math.max(wall.x, Math.min(curX, wall.x + wall.w));
      const closestY = Math.max(wall.y, Math.min(curY, wall.y + wall.h));
      const dx = curX - closestX;
      const dy = curY - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius) {
        anyCollision = true;
        passCollision = true;
        const dist = Math.sqrt(distSq);
        let nx = 0;
        let ny = 0;

        if (dist > 0.001) {
          nx = dx / dist;
          ny = dy / dist;
          const overlap = radius - dist;
          curX += nx * (overlap + epsilon);
          curY += ny * (overlap + epsilon);
        } else {
          // Embedded centre recovery
          const candidates = [
            { x: wall.x - radius - epsilon, y: curY, nx: -1, ny: 0, side: 'left' },
            { x: wall.x + wall.w + radius + epsilon, y: curY, nx: 1, ny: 0, side: 'right' },
            { x: curX, y: wall.y - radius - epsilon, nx: 0, ny: -1, side: 'top' },
            { x: curX, y: wall.y + wall.h + radius + epsilon, nx: 0, ny: 1, side: 'bottom' }
          ];

          // Filter out-of-bounds candidates
          const legalCandidates = candidates.filter(c =>
            c.x >= radius && c.x <= MAP_WIDTH - radius &&
            c.y >= radius && c.y <= MAP_HEIGHT - radius
          );

          let chosen;
          if (legalCandidates.length > 0) {
            // Prefer returning to previous position
            if (prevX !== undefined && prevY !== undefined) {
              if (prevX <= wall.x - radius) chosen = legalCandidates.find(c => c.side === 'left');
              else if (prevX >= wall.x + wall.w + radius) chosen = legalCandidates.find(c => c.side === 'right');
              else if (prevY <= wall.y - radius) chosen = legalCandidates.find(c => c.side === 'top');
              else if (prevY >= wall.y + wall.h + radius) chosen = legalCandidates.find(c => c.side === 'bottom');
            }

            if (!chosen) {
              // Prefer candidates that are already free
              const freeCandidates = legalCandidates.filter(c => {
                for (const w of walls) {
                  if (circleOverlapsWall(c.x, c.y, radius - epsilon, w)) return false;
                }
                return true;
              });

              if (freeCandidates.length > 0) {
                freeCandidates.sort((a, b) => {
                  const da = (a.x - curX)**2 + (a.y - curY)**2;
                  const db = (b.x - curX)**2 + (b.y - curY)**2;
                  return da - db;
                });
                chosen = freeCandidates[0];
              } else {
                legalCandidates.sort((a, b) => {
                  const da = (a.x - curX)**2 + (a.y - curY)**2;
                  const db = (b.x - curX)**2 + (b.y - curY)**2;
                  return da - db;
                });
                chosen = legalCandidates[0];
              }
            }
          }

          if (chosen) {
            curX = chosen.x;
            curY = chosen.y;
            nx = chosen.nx;
            ny = chosen.ny;
          } else {
             curX = clamp(curX, radius + epsilon, MAP_WIDTH - radius - epsilon);
             curY = clamp(curY, radius + epsilon, MAP_HEIGHT - radius - epsilon);
          }
        }

        if (nx !== 0 || ny !== 0) {
          const isDup = normals.some(n => Math.abs(n.nx - nx) < 0.1 && Math.abs(n.ny - ny) < 0.1);
          if (!isDup) normals.push({ nx, ny });
        }
      }
    }
    if (!passCollision) break;
  }

  curX = Math.max(radius + epsilon, Math.min(curX, MAP_WIDTH - radius - epsilon));
  curY = Math.max(radius + epsilon, Math.min(curY, MAP_HEIGHT - radius - epsilon));

  let stillStuck = false;
  for (const wall of walls) {
    if (circleOverlapsWall(curX, curY, radius - epsilon/2, wall)) {
      stillStuck = true;
      break;
    }
  }

  if (stillStuck) {
    if (prevX !== undefined && prevY !== undefined) {
      let prevValid = true;
      for (const wall of walls) {
        if (circleOverlapsWall(prevX, prevY, radius - epsilon, wall)) {
          prevValid = false;
          break;
        }
      }
      if (prevValid) {
        curX = prevX;
        curY = prevY;
        stillStuck = false;
      }
    }

    if (stillStuck) {
      const steps = 30;
      const ringSize = 10;
      let found = false;
      for (let r = 1; r <= steps && !found; r++) {
        const d = r * ringSize;
        const angleSteps = r * 8;
        for (let a = 0; a < angleSteps; a++) {
          const angle = (a / angleSteps) * Math.PI * 2;
          const tx = curX + Math.cos(angle) * d;
          const ty = curY + Math.sin(angle) * d;
          if (tx < radius || tx > MAP_WIDTH - radius || ty < radius || ty > MAP_HEIGHT - radius) continue;
          let wallHit = false;
          for (const wall of walls) {
            if (circleOverlapsWall(tx, ty, radius, wall)) {
              wallHit = true;
              break;
            }
          }
          if (!wallHit) { curX = tx; curY = ty; found = true; break; }
        }
      }
    }
  }

  return { x: curX, y: curY, normals, collided: anyCollision };
}


function sweptMultiplayerPlayerResolve(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  radius: number,
  walls: { x: number; y: number; w: number; h: number }[]
): { x: number; y: number; normals: { nx: number; ny: number }[]; collided: boolean; clamped: boolean } {
  if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    const fallbackX = Number.isFinite(startX) ? startX : 0;
    const fallbackY = Number.isFinite(startY) ? startY : 0;
    const resolved = resolveWallCollisions(fallbackX, fallbackY, radius, walls);
    return {
      x: resolved.x,
      y: resolved.y,
      normals: resolved.normals,
      collided: resolved.collided,
      clamped: false
    };
  }

  // First check whether the starting position is embedded in a wall using resolveWallCollisions.
  const resolvedStart = resolveWallCollisions(startX, startY, radius, walls);
  
  // If the starting position required recovery, return the recovered position for this update instead of continuing the movement.
  let isEmbedded = false;
  for (const wall of walls) {
    if (circleOverlapsWall(startX, startY, radius - 0.05, wall)) {
      isEmbedded = true;
      break;
    }
  }
  
  if (isEmbedded || Math.hypot(resolvedStart.x - startX, resolvedStart.y - startY) > 0.01 || resolvedStart.collided) {
    return {
      x: resolvedStart.x,
      y: resolvedStart.y,
      normals: resolvedStart.normals,
      collided: resolvedStart.collided,
      clamped: false
    };
  }

  // Limit one accepted movement segment to 260 world units.
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.hypot(dx, dy);
  
  let clamped = false;
  let endX = targetX;
  let endY = targetY;
  let segmentDist = dist;
  if (dist > 260) {
    clamped = true;
    endX = startX + (dx / dist) * 260;
    endY = startY + (dy / dist) * 260;
    segmentDist = 260;
  }

  // Split the resulting movement into substeps no larger than max(2, radius * 0.5)
  const maxSubstep = Math.max(2, radius * 0.5);
  
  if (segmentDist <= 0.001) {
    return {
      x: startX,
      y: startY,
      normals: [],
      collided: false,
      clamped
    };
  }

  const numSubsteps = Math.ceil(segmentDist / maxSubstep);
  const stepX = (endX - startX) / numSubsteps;
  const stepY = (endY - startY) / numSubsteps;

  let currentX = startX;
  let currentY = startY;
  let anyCollision = false;
  const normals: { nx: number; ny: number }[] = [];

  for (let i = 1; i <= numSubsteps; i++) {
    // Move incrementally from the latest resolved position
    const candidateX = currentX + stepX;
    const candidateY = currentY + stepY;
    const prevX = currentX;
    const prevY = currentY;

    // Pass the candidate position through resolveWallCollisions
    const resolved = resolveWallCollisions(candidateX, candidateY, radius, walls, prevX, prevY);
    currentX = resolved.x;
    currentY = resolved.y;

    if (resolved.collided) {
      anyCollision = true;
      for (const n of resolved.normals) {
        const isDup = normals.some(existing => Math.abs(existing.nx - n.nx) < 0.1 && Math.abs(existing.ny - n.ny) < 0.1);
        if (!isDup) {
          normals.push(n);
        }
      }
    }
  }

  return {
    x: currentX,
    y: currentY,
    normals,
    collided: anyCollision,
    clamped
  };
}


function sweptMultiplayerBulletResolve(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  radius: number,
  walls: { x: number; y: number; w: number; h: number }[]
): { x: number; y: number; normals: { nx: number; ny: number }[]; collided: boolean } {
  // Validate all coordinates and radius as finite values.
  if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(radius) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    const fallbackX = Number.isFinite(startX) ? startX : 0;
    const fallbackY = Number.isFinite(startY) ? startY : 0;
    const fallbackRadius = Number.isFinite(radius) ? radius : 5;
    const resolved = resolveWallCollisions(fallbackX, fallbackY, fallbackRadius, walls);
    return {
      x: resolved.x,
      y: resolved.y,
      normals: resolved.normals,
      collided: resolved.collided
    };
  }

  // Resolve the starting position first with resolveWallCollisions.
  const resolvedStart = resolveWallCollisions(startX, startY, radius, walls);

  // If the bullet starts embedded and requires recovery, return that recovered position immediately for this frame.
  let isEmbedded = false;
  for (const wall of walls) {
    if (circleOverlapsWall(startX, startY, radius - 0.05, wall)) {
      isEmbedded = true;
      break;
    }
  }

  if (isEmbedded || Math.hypot(resolvedStart.x - startX, resolvedStart.y - startY) > 0.01 || resolvedStart.collided) {
    return {
      x: resolvedStart.x,
      y: resolvedStart.y,
      normals: resolvedStart.normals,
      collided: resolvedStart.collided
    };
  }

  // Include a defensive maximum intended segment length of 128 world units.
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.hypot(dx, dy);

  let endX = targetX;
  let endY = targetY;
  let segmentDist = dist;
  if (dist > 128) {
    endX = startX + (dx / dist) * 128;
    endY = startY + (dy / dist) * 128;
    segmentDist = 128;
  }

  if (segmentDist <= 0.001) {
    return {
      x: startX,
      y: startY,
      normals: [],
      collided: false
    };
  }

  // Divide the intended movement into incremental substeps no larger than max(1, radius * 0.5).
  const maxSubstep = Math.max(1, radius * 0.5);
  const numSubsteps = Math.ceil(segmentDist / maxSubstep);
  const stepX = (endX - startX) / numSubsteps;
  const stepY = (endY - startY) / numSubsteps;

  let currentX = startX;
  let currentY = startY;
  let anyCollision = false;
  const normals: { nx: number; ny: number }[] = [];

  for (let i = 1; i <= numSubsteps; i++) {
    // Move each substep from the latest resolved position.
    const candidateX = currentX + stepX;
    const candidateY = currentY + stepY;
    const prevX = currentX;
    const prevY = currentY;

    // Pass every candidate through resolveWallCollisions using the previous substep position as prevX/prevY.
    const resolved = resolveWallCollisions(candidateX, candidateY, radius, walls, prevX, prevY);

    if (resolved.collided) {
      currentX = resolved.x;
      currentY = resolved.y;
      anyCollision = true;
      for (const n of resolved.normals) {
        const isDup = normals.some(existing => Math.abs(existing.nx - n.nx) < 0.1 && Math.abs(existing.ny - n.ny) < 0.1);
        if (!isDup) {
          normals.push(n);
        }
      }
      // Stop movement for the frame on the first wall collision. Do not continue the unused movement after reflecting.
      break;
    } else {
      currentX = resolved.x;
      currentY = resolved.y;
    }
  }

  return {
    x: currentX,
    y: currentY,
    normals,
    collided: anyCollision
  };
}


function sweptBuildBlockCollision(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  radius: number,
  blocks: { x: number; y: number; size: number; createdAt: number; colorIdx?: number; ownerId?: string }[],
  allowedBlockKeys: string[]
): {
  x: number;
  y: number;
  nx: number;
  ny: number;
  contactX: number;
  contactY: number;
  blockIndex: number;
  block: { x: number; y: number; size: number; createdAt: number; colorIdx?: number; ownerId?: string };
} | null {
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isFinite(radius)
  ) {
    return null;
  }

  const allowedSet = new Set(allowedBlockKeys);
  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);
  const maxSubstep = Math.max(1, radius * 0.5);
  const numSubsteps = dist <= 0.001 ? 1 : Math.ceil(dist / maxSubstep);
  const stepX = dx / numSubsteps;
  const stepY = dy / numSubsteps;

  const epsilon = 0.05;

  for (let i = 0; i <= numSubsteps; i++) {
    const cx = startX + i * stepX;
    const cy = startY + i * stepY;
    const prevX = i > 0 ? (startX + (i - 1) * stepX) : undefined;
    const prevY = i > 0 ? (startY + (i - 1) * stepY) : undefined;

    for (let b = blocks.length - 1; b >= 0; b--) {
      const block = blocks[b];
      const key = `${block.x}_${block.y}`;
      if (allowedSet.has(key)) {
        continue;
      }

      const halfSize = block.size / 2;
      const closestX = Math.max(block.x - halfSize, Math.min(cx, block.x + halfSize));
      const closestY = Math.max(block.y - halfSize, Math.min(cy, block.y + halfSize));
      const bdx = cx - closestX;
      const bdy = cy - closestY;
      const distSq = bdx * bdx + bdy * bdy;

      const isInside = cx >= block.x - halfSize && cx <= block.x + halfSize &&
                       cy >= block.y - halfSize && cy <= block.y + halfSize;

      if (isInside || distSq < radius * radius) {
        if (isInside) {
          const distL = cx - (block.x - halfSize);
          const distR = (block.x + halfSize) - cx;
          const distT = cy - (block.y - halfSize);
          const distB = (block.y + halfSize) - cy;

          let chosenSide: string | null = null;
          if (prevX !== undefined && prevY !== undefined) {
            if (prevX <= block.x - halfSize) {
              chosenSide = 'left';
            } else if (prevX >= block.x + halfSize) {
              chosenSide = 'right';
            } else if (prevY <= block.y - halfSize) {
              chosenSide = 'top';
            } else if (prevY >= block.y + halfSize) {
              chosenSide = 'bottom';
            }
          }

          const candidates = [
            { x: block.x - halfSize - radius - epsilon, y: cy, nx: -1, ny: 0, dist: distL, side: 'left', contactX: block.x - halfSize, contactY: cy },
            { x: block.x + halfSize + radius + epsilon, y: cy, nx: 1, ny: 0, dist: distR, side: 'right', contactX: block.x + halfSize, contactY: cy },
            { x: cx, y: block.y - halfSize - radius - epsilon, nx: 0, ny: -1, dist: distT, side: 'top', contactX: cx, contactY: block.y - halfSize },
            { x: cx, y: block.y + halfSize + radius + epsilon, nx: 0, ny: 1, dist: distB, side: 'bottom', contactX: cx, contactY: block.y + halfSize }
          ];

          let chosen = candidates[0];
          if (chosenSide) {
            const matched = candidates.find(c => c.side === chosenSide);
            if (matched) {
              chosen = matched;
            } else {
              candidates.sort((a, b) => a.dist - b.dist);
              chosen = candidates[0];
            }
          } else {
            candidates.sort((a, b) => a.dist - b.dist);
            chosen = candidates[0];
          }

          return {
            x: chosen.x,
            y: chosen.y,
            nx: chosen.nx,
            ny: chosen.ny,
            contactX: chosen.contactX,
            contactY: chosen.contactY,
            blockIndex: b,
            block: block
          };
        } else {
          const distVal = Math.sqrt(distSq);
          let nx = 0;
          let ny = 0;
          if (distVal > 0.0001) {
            nx = bdx / distVal;
            ny = bdy / distVal;
          } else {
            nx = 1;
            ny = 0;
          }
          const overlap = radius - distVal;
          const rx = cx + nx * (overlap + epsilon);
          const ry = cy + ny * (overlap + epsilon);

          return {
            x: rx,
            y: ry,
            nx: nx,
            ny: ny,
            contactX: closestX,
            contactY: closestY,
            blockIndex: b,
            block: block
          };
        }
      }
    }
  }

  return null;
}


function getConnectedComponent(startBlock: { x: number; y: number }, allBlocks: { x: number; y: number }[]): { x: number; y: number }[] {
  const component: { x: number; y: number }[] = [startBlock];
  const visited = new Set<string>();
  visited.add(`${startBlock.x}_${startBlock.y}`);

  let head = 0;
  while (head < component.length) {
    const current = component[head++];
    for (const other of allBlocks) {
      const otherKey = `${other.x}_${other.y}`;
      if (visited.has(otherKey)) continue;

      if (Math.abs(current.x - other.x) <= 45 && Math.abs(current.y - other.y) <= 45) {
        visited.add(otherKey);
        component.push(other);
      }
    }
  }
  return component;
}

function distSqLinePoint(v: {x:number, y:number}, w: {x:number, y:number}, p: {x:number, y:number}) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

function segmentVersusCircle(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  circleX: number,
  circleY: number,
  combinedRadius: number
): { t: number; x: number; y: number } | null {
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isFinite(circleX) ||
    !Number.isFinite(circleY) ||
    !Number.isFinite(combinedRadius)
  ) {
    return null;
  }
  if (combinedRadius <= 0) {
    return null;
  }

  const fx = startX - circleX;
  const fy = startY - circleY;
  const distSq = fx * fx + fy * fy;
  const rSq = combinedRadius * combinedRadius;

  if (distSq <= rSq) {
    return { t: 0, x: startX, y: startY };
  }

  const dx = endX - startX;
  const dy = endY - startY;
  const a = dx * dx + dy * dy;

  if (a < 1e-9) {
    return null;
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = distSq - rSq;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  const validT: number[] = [];
  const eps = 1e-9;
  if (t1 >= -eps && t1 <= 1 + eps) {
    validT.push(Math.max(0, Math.min(1, t1)));
  }
  if (t2 >= -eps && t2 <= 1 + eps) {
    validT.push(Math.max(0, Math.min(1, t2)));
  }

  if (validT.length === 0) {
    return null;
  }

  const minT = Math.min(...validT);
  const hitX = startX + minT * dx;
  const hitY = startY + minT * dy;

  return {
    t: minT,
    x: hitX,
    y: hitY
  };
}

function isPositionSafe(
  x: number,
  y: number,
  walls: { x: number; y: number; w: number; h: number }[],
  minDistToWalls = 50,
  avoidPositions: { x: number; y: number }[] = [],
  minAvoidDist = 180
): boolean {
  if (x < minDistToWalls || x > MAP_WIDTH - minDistToWalls || y < minDistToWalls || y > MAP_HEIGHT - minDistToWalls) {
    return false;
  }
  for (const wall of walls) {
    if (
      x > wall.x - minDistToWalls &&
      x < wall.x + wall.w + minDistToWalls &&
      y > wall.y - minDistToWalls &&
      y < wall.y + wall.h + minDistToWalls
    ) {
      return false;
    }
  }
  for (const pos of avoidPositions) {
    if (Math.hypot(x - pos.x, y - pos.y) < minAvoidDist) {
      return false;
    }
  }
  return true;
}

function getSafeSpawn(
  walls: { x: number; y: number; w: number; h: number }[],
  minDistToWalls = 50,
  avoidPositions: { x: number; y: number }[] = [],
  minAvoidDist = 180
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const spawnX = 100 + Math.random() * (MAP_WIDTH - 200);
    const spawnY = 100 + Math.random() * (MAP_HEIGHT - 200);
    if (isPositionSafe(spawnX, spawnY, walls, minDistToWalls, avoidPositions, minAvoidDist)) {
      return { x: spawnX, y: spawnY };
    }
  }

  const gridStep = 40;
  for (let x = minDistToWalls + 20; x <= MAP_WIDTH - minDistToWalls - 20; x += gridStep) {
    for (let y = minDistToWalls + 20; y <= MAP_HEIGHT - minDistToWalls - 20; y += gridStep) {
      if (isPositionSafe(x, y, walls, minDistToWalls, avoidPositions, minAvoidDist)) {
        return { x, y };
      }
    }
  }

  return null;
}

function lineIntersectsLine(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
  const denom = (y4-y3)*(x2-x1) - (x4-x3)*(y2-y1);
  if (denom === 0) return false;
  const uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / denom;
  const uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / denom;
  return uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1;
}

function lineIntersectsRect(x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rw: number, rh: number) {
  if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true;
  if (x2 >= rx && x2 <= rx + rw && y2 >= ry && y2 <= ry + rh) return true;
  return lineIntersectsLine(x1,y1,x2,y2, rx,ry, rx+rw,ry) ||
         lineIntersectsLine(x1,y1,x2,y2, rx,ry+rh, rx+rw,ry+rh) ||
         lineIntersectsLine(x1,y1,x2,y2, rx,ry, rx,ry+rh) ||
         lineIntersectsLine(x1,y1,x2,y2, rx+rw,ry, rx+rw,ry+rh);
}

function isValidPlayerSpawnPos(px: number, py: number, targetSpawner: {x: number, y: number} | null, mapDef: MapDefinition): boolean {
  const MIN_DIST = 60; // 20 radius + 40 padding

  if (px < MIN_DIST || px > MAP_WIDTH - MIN_DIST || py < MIN_DIST || py > MAP_HEIGHT - MIN_DIST) {
    return false;
  }

  for (const wall of mapDef.walls) {
    if (px > wall.x - MIN_DIST && px < wall.x + wall.w + MIN_DIST &&
        py > wall.y - MIN_DIST && py < wall.y + wall.h + MIN_DIST) {
      return false;
    }
  }

  for (const spawner of mapDef.spawners) {
    const dx = px - spawner.x;
    const dy = py - spawner.y;
    if (Math.sqrt(dx*dx + dy*dy) < 160) {
      return false;
    }
  }

  if (targetSpawner) {
    for (const wall of mapDef.walls) {
      if (lineIntersectsRect(px, py, targetSpawner.x, targetSpawner.y, wall.x, wall.y, wall.w, wall.h)) {
        return false;
      }
    }
  }

  return true;
}

function getValidatedFallbackSpawn(mapDef: MapDefinition): {x: number, y: number} {
  for (let i = 0; i < 100; i++) {
    const px = Math.random() * MAP_WIDTH;
    const py = Math.random() * MAP_HEIGHT;
    if (isValidPlayerSpawnPos(px, py, null, mapDef)) {
      // @ts-ignore
      if (import.meta.env.DEV) console.warn("Fallback: Used full arena player spawn for map:", mapDef.name);
      return { x: px, y: py };
    }
  }
  for (let x = 0; x <= MAP_WIDTH; x += 50) {
    for (let y = 0; y <= MAP_HEIGHT; y += 50) {
      if (isValidPlayerSpawnPos(x, y, null, mapDef)) {
        // @ts-ignore
        if (import.meta.env.DEV) console.warn("Fallback: Used full arena player spawn for map:", mapDef.name);
        return { x, y };
      }
    }
  }

  throw new Error(`No valid player spawn position exists anywhere in the arena for map: ${mapDef.name}`);
}

function generateMultiplayerSpawnAssignments(
  playerIds: string[],
  mapDef: MapDefinition,
  walls: { x: number; y: number; w: number; h: number }[]
): Record<string, { x: number; y: number }> | null {
  if (!playerIds || playerIds.length === 0) return null;

  const shuffledIds = [...playerIds];
  for (let i = shuffledIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledIds[i], shuffledIds[j]] = [shuffledIds[j], shuffledIds[i]];
  }

  const N = shuffledIds.length;
  const activeWallsList = walls || mapDef.walls || [];
  const spawnersList = mapDef.spawners || [];

  const testCandidateFormation = (
    cx: number,
    cy: number,
    radius: number,
    startAngle: number
  ): { x: number; y: number }[] | null => {
    const slots: { x: number; y: number }[] = [];

    for (let i = 0; i < N; i++) {
      const angle = N === 1 ? 0 : startAngle + (2 * Math.PI * i) / N;
      const sx = N === 1 ? cx : cx + radius * Math.cos(angle);
      const sy = N === 1 ? cy : cy + radius * Math.sin(angle);

      const padding = PLAYER_RADIUS + 30;
      if (
        sx < padding ||
        sx > MAP_WIDTH - padding ||
        sy < padding ||
        sy > MAP_HEIGHT - padding
      ) {
        return null;
      }

      for (const wall of activeWallsList) {
        if (
          sx > wall.x - padding &&
          sx < wall.x + wall.w + padding &&
          sy > wall.y - padding &&
          sy < wall.y + wall.h + padding
        ) {
          return null;
        }
      }

      for (const spawner of spawnersList) {
        const dx = sx - spawner.x;
        const dy = sy - spawner.y;
        if (Math.hypot(dx, dy) < 160) {
          return null;
        }
      }

      slots.push({ x: Math.round(sx), y: Math.round(sy) });
    }

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = slots[i].x - slots[j].x;
        const dy = slots[i].y - slots[j].y;
        if (Math.hypot(dx, dy) < 160) {
          return null;
        }
      }
    }

    for (let i = 0; i < N; i++) {
      if (N > 1 && radius > 0) {
        for (const wall of activeWallsList) {
          if (
            lineIntersectsRect(
              slots[i].x,
              slots[i].y,
              cx,
              cy,
              wall.x,
              wall.y,
              wall.w,
              wall.h
            )
          ) {
            return null;
          }
        }
      }

      for (let j = i + 1; j < N; j++) {
        for (const wall of activeWallsList) {
          if (
            lineIntersectsRect(
              slots[i].x,
              slots[i].y,
              slots[j].x,
              slots[j].y,
              wall.x,
              wall.y,
              wall.w,
              wall.h
            )
          ) {
            return null;
          }
        }
      }
    }

    return slots;
  };

  const spacingCandidates = [200, 180, 160];

  for (const spacing of spacingCandidates) {
    const radius = N <= 1 ? 0 : spacing / (2 * Math.sin(Math.PI / N));

    for (let attempt = 0; attempt < 300; attempt++) {
      const margin = 100 + radius;
      const cx = margin + Math.random() * Math.max(1, MAP_WIDTH - 2 * margin);
      const cy = margin + Math.random() * Math.max(1, MAP_HEIGHT - 2 * margin);
      const rotation = Math.random() * Math.PI * 2;

      const slots = testCandidateFormation(cx, cy, radius, rotation);
      if (slots) {
        const assignments: Record<string, { x: number; y: number }> = {};
        for (let i = 0; i < N; i++) {
          assignments[shuffledIds[i]] = slots[i];
        }
        return assignments;
      }
    }

    const gridStep = 30;
    const margin = 60 + radius;
    const anglesToTry = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];

    for (let cx = margin; cx <= MAP_WIDTH - margin; cx += gridStep) {
      for (let cy = margin; cy <= MAP_HEIGHT - margin; cy += gridStep) {
        for (const rotation of anglesToTry) {
          const slots = testCandidateFormation(cx, cy, radius, rotation);
          if (slots) {
            const assignments: Record<string, { x: number; y: number }> = {};
            for (let i = 0; i < N; i++) {
              assignments[shuffledIds[i]] = slots[i];
            }
            return assignments;
          }
        }
      }
    }
  }

  return null;
}

function getPlayerSpawn(mapDef: MapDefinition): { pos: { x: number; y: number }, tutorialSpawnerIndex: number | null } {
  if (mapDef.spawnPoint) {
    let tutorialSpawnerIndex: number | null = null;
    if (mapDef.name === "Fortress") tutorialSpawnerIndex = 3;
    if (mapDef.name === "The Gauntlet") tutorialSpawnerIndex = 4;
    if (mapDef.name === "Serpentine Labyrinth") tutorialSpawnerIndex = 0;

    if (isValidPlayerSpawnPos(mapDef.spawnPoint.x, mapDef.spawnPoint.y, null, mapDef)) {
      return { pos: mapDef.spawnPoint, tutorialSpawnerIndex };
    }
    // @ts-ignore
    if (import.meta.env.DEV) console.warn("Fallback: Configured spawnPoint is invalid for map:", mapDef.name);
    return { pos: getValidatedFallbackSpawn(mapDef), tutorialSpawnerIndex };
  }

  const spawnerIndices = Array.from({length: mapDef.spawners.length}, (_, i) => i);
  // Fisher-Yates shuffle
  for (let i = spawnerIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spawnerIndices[i], spawnerIndices[j]] = [spawnerIndices[j], spawnerIndices[i]];
  }

  for (const idx of spawnerIndices) {
    const spawner = mapDef.spawners[idx];

    // try random angles/distances first
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 220 + Math.random() * 100; // 220 to 320
      const px = spawner.x + Math.cos(angle) * dist;
      const py = spawner.y + Math.sin(angle) * dist;

      if (isValidPlayerSpawnPos(px, py, spawner, mapDef)) {
        return { pos: { x: px, y: py }, tutorialSpawnerIndex: idx };
      }
    }

    // deterministic sweep if random fails
    for (let dist = 220; dist <= 320; dist += 20) {
      for (let a = 0; a < 360; a += 15) {
        const angle = a * Math.PI / 180;
        const px = spawner.x + Math.cos(angle) * dist;
        const py = spawner.y + Math.sin(angle) * dist;
        if (isValidPlayerSpawnPos(px, py, spawner, mapDef)) {
          return { pos: { x: px, y: py }, tutorialSpawnerIndex: idx };
        }
      }
    }
  }

  return { pos: getValidatedFallbackSpawn(mapDef), tutorialSpawnerIndex: null };
}

function getBulletRelicCollision(
  bulletX: number,
  bulletY: number,
  bulletRadius: number,
  spawner: { x: number; y: number; specialType?: string },
  currentTime: number
): { nx: number; ny: number; overlap: number } | null {
  if (!spawner.specialType) return null;

  // Helper for circle collision
  const checkCircle = (cx: number, cy: number, r: number) => {
    const dx = bulletX - cx;
    const dy = bulletY - cy;
    const distSq = dx * dx + dy * dy;
    const minDist = bulletRadius + r;
    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq);
      if (dist > 0) {
        return {
          nx: dx / dist,
          ny: dy / dist,
          overlap: minDist - dist,
        };
      } else {
        return {
          nx: 0,
          ny: -1,
          overlap: minDist,
        };
      }
    }
    return null;
  };

  // Helper for segment collision
  const checkSegment = (ax: number, ay: number, bx: number, by: number, thickness: number = 0) => {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = bulletX - ax;
    const wy = bulletY - ay;

    const vLenSq = vx * vx + vy * vy;
    if (vLenSq === 0) return checkCircle(ax, ay, thickness);

    let t = (wx * vx + wy * vy) / vLenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    const px = ax + t * vx;
    const py = ay + t * vy;

    const dx = bulletX - px;
    const dy = bulletY - py;
    const distSq = dx * dx + dy * dy;
    const minDist = bulletRadius + thickness;

    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq);
      if (dist > 0) {
        return {
          nx: dx / dist,
          ny: dy / dist,
          overlap: minDist - dist,
        };
      }
    }
    return null;
  };

  if (spawner.specialType === 'shield') {
    // 5 small nodes of radius 12 at distance 95, rotated by -currentTime * 0.001
    const angleOffset = -currentTime * 0.001;
    for (let i = 0; i < 5; i++) {
      const angle = angleOffset + (i * Math.PI * 2) / 5;
      const cx = spawner.x + Math.cos(angle) * 95;
      const cy = spawner.y + Math.sin(angle) * 95;
      const col = checkCircle(cx, cy, 12);
      if (col) return col;
    }
  } else if (spawner.specialType === 'kinetic') {
    // 4 petals rotated by currentTime * 0.0015
    const angleOffset = currentTime * 0.0015;
    for (let i = 0; i < 4; i++) {
      const angle = angleOffset + (i * Math.PI) / 2;
      const p1x = spawner.x + Math.cos(angle) * 50;
      const p1y = spawner.y + Math.sin(angle) * 50;
      const p2x = spawner.x + Math.cos(angle + 0.2) * 85;
      const p2y = spawner.y + Math.sin(angle + 0.2) * 85;
      const p3x = spawner.x + Math.cos(angle) * 95;
      const p3y = spawner.y + Math.sin(angle) * 95;
      const p4x = spawner.x + Math.cos(angle - 0.2) * 85;
      const p4y = spawner.y + Math.sin(angle - 0.2) * 85;

      const col1 = checkSegment(p1x, p1y, p2x, p2y);
      if (col1) return col1;
      const col2 = checkSegment(p2x, p2y, p3x, p3y);
      if (col2) return col2;
      const col3 = checkSegment(p3x, p3y, p4x, p4y);
      if (col3) return col3;
      const col4 = checkSegment(p4x, p4y, p1x, p1y);
      if (col4) return col4;
    }
  } else if (spawner.specialType === 'singularity') {
    // 3 spiral arms rotated by currentTime * 0.002
    const angleOffset = currentTime * 0.002;
    for (let arm = 0; arm < 3; arm++) {
      const startA = angleOffset + (arm * Math.PI * 2) / 3;
      let lastX = spawner.x + Math.cos(startA) * 35;
      let lastY = spawner.y + Math.sin(startA) * 35;
      for (let r = 45; r <= 95; r += 10) {
        const theta = startA + (r - 35) * 0.05;
        const rx = spawner.x + Math.cos(theta) * r;
        const ry = spawner.y + Math.sin(theta) * r;
        const col = checkSegment(lastX, lastY, rx, ry, 3);
        if (col) return col;
        lastX = rx;
        lastY = ry;
      }
    }
  } else if (spawner.specialType === 'magma_gates') {
    // 6 asymmetric rectangular rotating obstacles with parallel orientations
    const orbitAngle = currentTime * 0.0008;
    const cosO = Math.cos(orbitAngle);
    const sinO = Math.sin(orbitAngle);

    const rects = [
      { angle: 0.2, distance: 75, w: 22, h: 45 },
      { angle: 1.2, distance: 95, w: 35, h: 20 },
      { angle: 2.2, distance: 80, w: 18, h: 32 },
      { angle: 3.3, distance: 100, w: 40, h: 15 },
      { angle: 4.4, distance: 70, w: 25, h: 38 },
      { angle: 5.5, distance: 90, w: 20, h: 28 },
    ];
    for (const r of rects) {
      const cx_local = Math.cos(r.angle) * r.distance;
      const cy_local = Math.sin(r.angle) * r.distance;
      const hw = r.w / 2;
      const hh = r.h / 2;

      // Unrotated corners relative to the spawner center
      const c0x_local = cx_local - hw;
      const c0y_local = cy_local - hh;
      const c1x_local = cx_local + hw;
      const c1y_local = cy_local - hh;
      const c2x_local = cx_local + hw;
      const c2y_local = cy_local + hh;
      const c3x_local = cx_local - hw;
      const c3y_local = cy_local + hh;

      // Rotated world-space corners
      const c0x = spawner.x + c0x_local * cosO - c0y_local * sinO;
      const c0y = spawner.y + c0x_local * sinO + c0y_local * cosO;
      const c1x = spawner.x + c1x_local * cosO - c1y_local * sinO;
      const c1y = spawner.y + c1x_local * sinO + c1y_local * cosO;
      const c2x = spawner.x + c2x_local * cosO - c2y_local * sinO;
      const c2y = spawner.y + c2x_local * sinO + c2y_local * cosO;
      const c3x = spawner.x + c3x_local * cosO - c3y_local * sinO;
      const c3y = spawner.y + c3x_local * sinO + c3y_local * cosO;

      const col1 = checkSegment(c0x, c0y, c1x, c1y, 2);
      if (col1) return col1;
      const col2 = checkSegment(c1x, c1y, c2x, c2y, 2);
      if (col2) return col2;
      const col3 = checkSegment(c2x, c2y, c3x, c3y, 2);
      if (col3) return col3;
      const col4 = checkSegment(c3x, c3y, c0x, c0y, 2);
      if (col4) return col4;
    }
  } else if (spawner.specialType === 'crystal') {
    // 6 shards rotated by currentTime * 0.0006
    const angleOffset = currentTime * 0.0006;
    for (let i = 0; i < 6; i++) {
      const angle = angleOffset + (i * Math.PI) / 3;
      const p1x = spawner.x + Math.cos(angle) * 45;
      const p1y = spawner.y + Math.sin(angle) * 45;
      const p2x = spawner.x + Math.cos(angle - 0.1) * 70;
      const p2y = spawner.y + Math.sin(angle - 0.1) * 70;
      const p3x = spawner.x + Math.cos(angle) * 85;
      const p3y = spawner.y + Math.sin(angle) * 85;
      const p4x = spawner.x + Math.cos(angle + 0.1) * 70;
      const p4y = spawner.y + Math.sin(angle + 0.1) * 70;

      const col1 = checkSegment(p1x, p1y, p2x, p2y);
      if (col1) return col1;
      const col2 = checkSegment(p2x, p2y, p3x, p3y);
      if (col2) return col2;
      const col3 = checkSegment(p3x, p3y, p4x, p4y);
      if (col3) return col3;
      const col4 = checkSegment(p4x, p4y, p1x, p1y);
      if (col4) return col4;
    }
  }

  return null;
}

function sweptMultiplayerBulletRelicCollision(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  bulletRadius: number,
  spawners: any[],
  startPhaseTime: number,
  endPhaseTime: number
): {
  x: number;
  y: number;
  nx: number;
  ny: number;
  overlap: number;
  t: number;
  spawner: any;
  specialType: string;
} | null {
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isFinite(bulletRadius) ||
    !Number.isFinite(startPhaseTime) ||
    !Number.isFinite(endPhaseTime) ||
    !Array.isArray(spawners)
  ) {
    return null;
  }

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);

  const maxDistStep = Math.max(1, bulletRadius * 0.5);
  const bulletSteps = Math.ceil(dist / maxDistStep);

  const phaseDiff = Math.abs(endPhaseTime - startPhaseTime);
  const phaseSteps = Math.ceil(phaseDiff / 5);

  const numSteps = Math.max(1, Math.max(bulletSteps, phaseSteps));

  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    const curX = startX + dx * t;
    const curY = startY + dy * t;
    const curPhase = startPhaseTime + (endPhaseTime - startPhaseTime) * t;

    for (const spawner of spawners) {
      if (!spawner || !spawner.specialType) continue;

      const collision = getBulletRelicCollision(curX, curY, bulletRadius, spawner, curPhase);
      if (collision) {
        return {
          x: curX + collision.nx * collision.overlap,
          y: curY + collision.ny * collision.overlap,
          nx: collision.nx,
          ny: collision.ny,
          overlap: collision.overlap,
          t: t,
          spawner: spawner,
          specialType: spawner.specialType
        };
      }
    }
  }

  return null;
}

const DashStatus = ({ stateRef }: { stateRef: any }) => {
  const [text, setText] = useState('READY');
  const [color, setColor] = useState('#fff');
  const [shadow, setShadow] = useState('0 0 10px rgba(181,0,255,0.8)');

  useEffect(() => {
    let animationFrameId: number;
    let wasReady = true;

    const loop = () => {
      const currentTime = performance.now();
      const dashRemaining = DASH_COOLDOWN - (currentTime - stateRef.current.player.dash.lastTime);

      if (dashRemaining > 0) {
        setText((dashRemaining / 1000).toFixed(1) + 'S');
        setColor('rgba(181, 0, 255, 0.5)');
        setShadow('none');
        wasReady = false;
      } else {
        if (!wasReady) {
          setText('READY');
          setColor('#fff');
          setShadow('0 0 10px rgba(181,0,255,0.8)');
          wasReady = true;

          const specialBtn = document.getElementById('tool-btn-special');
          if (specialBtn) {
            specialBtn.animate([
              { transform: 'scale(1)', boxShadow: '0 0px 0px #b500ff' },
              { transform: 'scale(1.1)', boxShadow: '0 0 30px #b500ff' },
              { transform: 'scale(1)', boxShadow: '0 0px 0px #b500ff' }
            ], { duration: 400, easing: 'ease-out' });
          }
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [stateRef]);

  return (
    <div className="text-white font-black tracking-tighter text-2xl sm:text-4xl leading-none"
         style={{
           fontFamily: 'var(--font-display, Anton, sans-serif)',
           minWidth: '60px',
           textAlign: 'right',
           color: color,
           textShadow: shadow
         }}
    >
      {text}
    </div>
  );
};

// Helper functions for spawner direction indicator and offscreen pointer calculations
function isSpawnerVisible(
  spawner: { x: number; y: number; radius?: number },
  camera: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const radius = spawner.radius || 30;
  const screenX = spawner.x - camera.x;
  const screenY = spawner.y - camera.y;

  const closestX = Math.max(0, Math.min(canvasWidth, screenX));
  const closestY = Math.max(0, Math.min(canvasHeight, screenY));
  const distSq = (screenX - closestX) ** 2 + (screenY - closestY) ** 2;
  return distSq <= radius * radius;
}

function getClosestSpawner<T extends { x: number; y: number; hp?: number }>(
  spawners: T[],
  player: { x: number; y: number }
): T | null {
  let closest: T | null = null;
  let minDistSq = Infinity;
  for (const s of spawners) {
    if (s.hp !== undefined && s.hp <= 0) continue;
    const dx = s.x - player.x;
    const dy = s.y - player.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      closest = s;
    }
  }
  return closest;
}

export interface PointerSafeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function calculateEdgePointerPosition(
  targetScreenX: number,
  targetScreenY: number,
  canvasWidth: number,
  canvasHeight: number,
  safeRect: PointerSafeRect | null
): { x: number; y: number; angle: number } {
  const rect = safeRect || {
    left: 24,
    top: 24,
    right: canvasWidth - 24,
    bottom: canvasHeight - 24,
  };

  const anchorX = canvasWidth / 2;
  const anchorY = canvasHeight / 2;

  const dx = targetScreenX - anchorX;
  const dy = targetScreenY - anchorY;
  const angle = Math.atan2(dy, dx);

  if (dx === 0 && dy === 0) {
    return { x: anchorX, y: anchorY, angle };
  }

  const boxX1 = rect.left;
  const boxY1 = rect.top;
  const boxX2 = rect.right;
  const boxY2 = rect.bottom;

  let tMin = Infinity;

  if (dx < 0) {
    const t = (boxX1 - anchorX) / dx;
    if (t >= 0 && t < tMin) tMin = t;
  }
  if (dx > 0) {
    const t = (boxX2 - anchorX) / dx;
    if (t >= 0 && t < tMin) tMin = t;
  }
  if (dy < 0) {
    const t = (boxY1 - anchorY) / dy;
    if (t >= 0 && t < tMin) tMin = t;
  }
  if (dy > 0) {
    const t = (boxY2 - anchorY) / dy;
    if (t >= 0 && t < tMin) tMin = t;
  }

  let ix = targetScreenX;
  let iy = targetScreenY;
  if (tMin !== Infinity) {
    ix = anchorX + dx * tMin;
    iy = anchorY + dy * tMin;
  }

  ix = Math.max(boxX1, Math.min(boxX2, ix));
  iy = Math.max(boxY1, Math.min(boxY2, iy));

  return { x: ix, y: iy, angle };
}

export interface EndReasonData {
  outcome: 'defeat' | 'victory';
  causeCode: string;
  label: string;
  impactPos: { x: number; y: number } | null;
  markerColor: string;
  startTimestamp: number;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapListRef = useRef<HTMLDivElement>(null);

  const hudTopLeftRef = useRef<HTMLDivElement>(null);
  const hudTopRightRef = useRef<HTMLDivElement>(null);
  const hudTopCenterRef = useRef<HTMLDivElement>(null);
  const hudBottomCenterRef = useRef<HTMLDivElement>(null);
  const hudBottomLeftRef = useRef<HTMLDivElement>(null);
  const hudBottomRightRef = useRef<HTMLDivElement>(null);
  const pointerSafeRectRef = useRef<PointerSafeRect | null>(null);

  const updateExclusionRects = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      pointerSafeRectRef.current = null;
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) {
      pointerSafeRectRef.current = null;
      return;
    }

    const scaleY = canvas.height / canvasRect.height;

    const EDGE_INSET = 24;
    const POINTER_CLEARANCE = 24;

    let left = EDGE_INSET;
    let right = canvas.width - EDGE_INSET;
    let top = EDGE_INSET;
    let bottom = canvas.height - EDGE_INSET;

    const topRefs = [hudTopLeftRef, hudTopRightRef, hudTopCenterRef];
    for (const r of topRefs) {
      if (r.current) {
        const domRect = r.current.getBoundingClientRect();
        if (domRect.width > 0 && domRect.height > 0) {
          const groupBottom = (domRect.top - canvasRect.top) * scaleY + domRect.height * scaleY;
          top = Math.max(top, groupBottom + POINTER_CLEARANCE);
        }
      }
    }

    const bottomRefs = [hudBottomCenterRef, hudBottomLeftRef, hudBottomRightRef];
    for (const r of bottomRefs) {
      if (r.current) {
        const domRect = r.current.getBoundingClientRect();
        if (domRect.width > 0 && domRect.height > 0) {
          const groupTop = (domRect.top - canvasRect.top) * scaleY;
          bottom = Math.min(bottom, groupTop - POINTER_CLEARANCE);
        }
      }
    }

    if (uiRef.current.status === 'PLAYING' && uiRef.current.deviceType === 'mobile') {
      const joyOffset = Math.min(160, Math.max(85, Math.floor(canvas.height * 0.22)));
      const leftJoyY = canvas.height - joyOffset;
      const joyRadius = 60;
      const joystickTop = leftJoyY - joyRadius;
      bottom = Math.min(bottom, joystickTop - POINTER_CLEARANCE);
    }

    pointerSafeRectRef.current = { left, top, right, bottom };
  }, []);

  const PLAYER_COLORS = [
    { n: '#00f0ff', g: 'rgba(0, 240, 255, 0.4)', name: 'CYAN' },
    { n: '#00ff88', g: 'rgba(0, 255, 136, 0.4)', name: 'GREEN' },
    { n: '#ffcc00', g: 'rgba(255, 204, 0, 0.4)', name: 'YELLOW' },
    { n: '#b500ff', g: 'rgba(181, 0, 255, 0.4)', name: 'PURPLE' },
    { n: '#ff6600', g: 'rgba(255, 102, 0, 0.4)', name: 'ORANGE' }
  ];

  const [playerProfile, setPlayerProfile] = useState<{name: string, colorIdx: number}>({ name: 'PLAYER', colorIdx: 0 });
  const [callsignDraft, setCallsignDraft] = useState<string>('PLAYER');
  const [isEditingCallsign, setIsEditingCallsign] = useState<boolean>(false);
  const isEditingCallsignRef = useRef<boolean>(false);
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  const [loadError, setLoadError] = useState<string | null>(null);
  interface PendingGuestShot {
    clientShotId: string;
    localBulletId: string;
    authoritativeBulletId: string | null;
    roundId: number;
    spawnTime: number;
    status: 'pending' | 'accepted' | 'rejected';
    authoritativeSeen: boolean;
    preview?: GuestShotVisualState;
  }

  const [quickSaveExists, setQuickSaveExists] = useState<boolean>(false);
  const quickSaveRef = useRef<{ runId: number; serialized: string } | null>(null);
  const activeSinglePlayerRunIdRef = useRef<number>(1);
  const currentRoomRoundIdRef = useRef<number>(0);
  const activeMultiplayerRoundIdRef = useRef<number>(0);
  const clientShotSeqRef = useRef<number>(0);
  const pendingGuestShotsRef = useRef<Map<string, PendingGuestShot>>(new Map());
  const guestBulletTimelineRef = useRef<GuestBulletTimeline | null>(null);
  const guestBulletGapRequestedRef = useRef<boolean>(false);
  const hostBulletEventSequenceRef = useRef<number>(0);
  const hostBulletSimulationTickRef = useRef<number>(0);
  const pendingHostBulletEventsRef = useRef<AuthoritativeBulletEvent[]>([]);
  const knownHostBulletStatesRef = useRef<Map<string, AuthoritativeBulletState>>(new Map());
  const pendingSpecialRequestRef = useRef<{ roundId: number; requestedAt: number } | null>(null);
  const pendingBuildRequestRef = useRef<{ roundId: number; requestedAt: number } | null>(null);

  const clearPendingGuestShots = useCallback((removeBullets: boolean = false) => {
    clientShotSeqRef.current = 0;
    if (removeBullets && pendingGuestShotsRef.current.size > 0 && stateRef.current) {
      const idsToRemove = new Set<string>();
      for (const entry of pendingGuestShotsRef.current.values()) {
        if (entry.localBulletId) {
          idsToRemove.add(entry.localBulletId);
        }
      }
      if (idsToRemove.size > 0 && stateRef.current.bullets) {
        stateRef.current.bullets = stateRef.current.bullets.filter(
          b => !b.id || !idsToRemove.has(b.id)
        );
      }
    }
    pendingGuestShotsRef.current.clear();
    guestBulletTimelineRef.current = null;
    guestBulletGapRequestedRef.current = false;
    hostBulletEventSequenceRef.current = 0;
    hostBulletSimulationTickRef.current = 0;
    pendingHostBulletEventsRef.current = [];
    knownHostBulletStatesRef.current.clear();
  }, []);

  const multiplayerStartPendingRef = useRef<boolean>(false);
  const [multiplayerStartPending, setMultiplayerStartPending] = useState<boolean>(false);
  const multiplayerStartRequestGenerationRef = useRef<number>(0);

  const invalidateStartRequestGeneration = useCallback((skipStateUpdate?: boolean) => {
    multiplayerStartRequestGenerationRef.current += 1;
    multiplayerStartPendingRef.current = false;
    if (!skipStateUpdate) {
      setMultiplayerStartPending(false);
    }
  }, []);

  const invalidateQuickSave = useCallback(() => {
    quickSaveRef.current = null;
    setQuickSaveExists(false);
  }, []);

  const [pauseMenuFeedback, setPauseMenuFeedback] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Migration cleanup: On component mount, delete the legacy key once
    try {
      localStorage.removeItem(QUICK_SAVE_STORAGE_KEY);
    } catch (e) {
      console.error("Failed to remove legacy quicksave key from localStorage on startup:", e);
    }
    setQuickSaveExists(false);

    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, []);


  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyLinkFeedback, setCopyLinkFeedback] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [activeLobbyTab, setActiveLobbyTab] = useState<'invite' | 'players' | 'match'>('invite');
  const [lobbyPlayers, setLobbyPlayers] = useState<Record<string, { name: string, colorIdx: number, isHost: boolean }>>({});
  const lobbyPlayersRef = useRef<Record<string, { name: string, colorIdx: number, isHost: boolean }>>({});

  useEffect(() => {
    lobbyPlayersRef.current = lobbyPlayers;
  }, [lobbyPlayers]);
  const [lobbyMatchSettings, setLobbyMatchSettings] = useState<MatchSettings>(DEFAULT_MATCH_SETTINGS);
  const lobbyMatchSettingsRef = useRef<MatchSettings>(DEFAULT_MATCH_SETTINGS);
  const [isMatchSettingsUpdatePending, setIsMatchSettingsUpdatePending] = useState(false);
  const matchSettingsUpdatePendingRef = useRef(false);
  const pendingUpdateSeqRef = useRef(0);
  const activeMatchSettingsRequestRef = useRef<ActiveMatchSettingsRequest | null>(null);

  const [isMpMapSelectOpen, setIsMpMapSelectOpen] = useState(false);
  const [pendingLobbyMapId, setPendingLobbyMapId] = useState<string>('medium');
  const mpMapListRef = useRef<HTMLDivElement>(null);

  const setMatchSettingsPending = useCallback((pending: boolean) => {
    matchSettingsUpdatePendingRef.current = pending;
    setIsMatchSettingsUpdatePending(pending);
  }, []);

  const closeMpMapSelector = useCallback(() => {
    setIsMpMapSelectOpen(false);
    setPendingLobbyMapId(lobbyMatchSettingsRef.current.mapId);
  }, []);

  const cancelPendingMatchSettingsUpdate = useCallback(() => {
    pendingUpdateSeqRef.current++;
    const activeReq = activeMatchSettingsRequestRef.current;
    if (activeReq) {
      if (activeReq.timeoutId) {
        clearTimeout(activeReq.timeoutId);
        activeReq.timeoutId = null;
      }
      if (!activeReq.isResolved) {
        activeReq.isResolved = true;
        activeReq.resolve(false);
      }
      activeMatchSettingsRequestRef.current = null;
    }
    matchSettingsUpdatePendingRef.current = false;
    setIsMatchSettingsUpdatePending(false);
  }, []);

  const applyAuthoritativeMatchSettings = useCallback((rawSettings: unknown): boolean => {
    if (!rawSettings || typeof rawSettings !== 'object' || rawSettings === null) {
      return false;
    }
    const settings = rawSettings as Record<string, any>;
    if (!isValidMapId(settings.mapId) || !isValidGameMode(settings.gameMode)) {
      return false;
    }
    const cleanSettings: MatchSettings = {
      mapId: settings.mapId,
      gameMode: settings.gameMode,
    };
    lobbyMatchSettingsRef.current = cleanSettings;
    setLobbyMatchSettings(cleanSettings);
    return true;
  }, []);

  const [uiState, setUiState] = useState<{ status: 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY' | 'LOBBY'; score: number; deviceType: 'desktop' | 'mobile'; activeTool: 'weapon' | 'special' | 'build'; blocks: number; spawnersLeft: number; mapId: string; hardMode: boolean; gameMode: GameMode; buttonCounters: { special: number; build: number } }>({ status: 'MENU', score: 0, deviceType: 'desktop', activeTool: 'special', blocks: 50, spawnersLeft: 5, mapId: 'medium', hardMode: false, gameMode: 'normal', buttonCounters: { special: 0, build: 0 } });
  const uiRef = useRef(uiState);
  uiRef.current = uiState;

  const shouldReduceMotion = useReducedMotion();

  const [presentationStage, setPresentationStage] = useState<'idle' | 'impact' | 'results'>('idle');
  const presentationStageRef = useRef<'idle' | 'impact' | 'results'>('idle');
  presentationStageRef.current = presentationStage;

  const [endReason, setEndReason] = useState<EndReasonData | null>(null);
  const endReasonRef = useRef<EndReasonData | null>(null);
  endReasonRef.current = endReason;

  const presentationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetEndPresentation = useCallback(() => {
    if (presentationTimerRef.current) {
      clearTimeout(presentationTimerRef.current);
      presentationTimerRef.current = null;
    }
    setPresentationStage('idle');
    presentationStageRef.current = 'idle';
    setEndReason(null);
    endReasonRef.current = null;
  }, []);

  const triggerEndPresentation = useCallback((reason: EndReasonData) => {
    if (presentationStageRef.current !== 'idle' || endReasonRef.current !== null) {
      return;
    }

    setEndReason(reason);
    endReasonRef.current = reason;

    if (shouldReduceMotion) {
      setPresentationStage('results');
      presentationStageRef.current = 'results';
    } else {
      setPresentationStage('impact');
      presentationStageRef.current = 'impact';

      if (presentationTimerRef.current) {
        clearTimeout(presentationTimerRef.current);
      }
      const isScoreBased = reason.causeCode === 'highest_score' || reason.causeCode === 'outscored' || reason.causeCode === 'match_concluded';
      const delay = isScoreBased ? 200 : 650;
      presentationTimerRef.current = setTimeout(() => {
        setPresentationStage('results');
        presentationStageRef.current = 'results';
        presentationTimerRef.current = null;
      }, delay);
    }
  }, [shouldReduceMotion]);

  useEffect(() => {
    return () => {
      if (presentationTimerRef.current) {
        clearTimeout(presentationTimerRef.current);
        presentationTimerRef.current = null;
      }
    };
  }, []);

  const triggerMultiplayerMatchConclusion = useCallback((winnerId?: string | null) => {
    const myId = socketRef.current?.id;
    if (myId && winnerId) {
      if (myId === winnerId) {
        triggerEndPresentation({
          outcome: 'victory',
          causeCode: 'highest_score',
          label: 'HIGHEST SCORE',
          impactPos: null,
          markerColor: '#00f0ff',
          startTimestamp: performance.now(),
        });
      } else {
        triggerEndPresentation({
          outcome: 'defeat',
          causeCode: 'outscored',
          label: 'OUTSCORED',
          impactPos: null,
          markerColor: '#ff003c',
          startTimestamp: performance.now(),
        });
      }
    } else {
      triggerEndPresentation({
        outcome: 'defeat',
        causeCode: 'match_concluded',
        label: 'MATCH CONCLUDED',
        impactPos: null,
        markerColor: '#ffcc00',
        startTimestamp: performance.now(),
      });
    }
  }, [triggerEndPresentation]);

  useEffect(() => {
    const currentStatus = uiState.status;
    if ((currentStatus === 'GAME_OVER' || currentStatus === 'VICTORY') && presentationStage === 'idle' && !endReason) {
      if (mpRef.current.roomId && stateRef.current.matchPhase === 'FINISHED') {
        triggerMultiplayerMatchConclusion(stateRef.current.winnerId);
      } else if (currentStatus === 'VICTORY') {
        triggerEndPresentation({
          outcome: 'victory',
          causeCode: 'spawner_destroyed',
          label: 'ALL SPAWNERS DESTROYED',
          impactPos: null,
          markerColor: '#00f0ff',
          startTimestamp: performance.now(),
        });
      } else {
        triggerEndPresentation({
          outcome: 'defeat',
          causeCode: 'arena_elimination',
          label: 'ARENA ELIMINATION',
          impactPos: null,
          markerColor: '#ff003c',
          startTimestamp: performance.now(),
        });
      }
    }
  }, [uiState.status, presentationStage, endReason, triggerEndPresentation, triggerMultiplayerMatchConclusion]);

  const resolvePlayerName = useCallback((ownerId?: string): string | null => {
    if (!ownerId || ownerId === 'local') return null;
    const myId = socketRef.current?.id;
    if (myId && ownerId === myId) return null;

    let name: string | undefined = undefined;
    if (stateRef.current.multiplayerPlayers && stateRef.current.multiplayerPlayers[ownerId]) {
      name = stateRef.current.multiplayerPlayers[ownerId].name;
    }
    if (!name && mpRef.current && mpRef.current.roomId && stateRef.current.matchPlayers && stateRef.current.matchPlayers[ownerId]) {
      name = stateRef.current.matchPlayers[ownerId].name;
    }

    if (!name) return null;
    const trimmed = name.trim();
    if (trimmed === ownerId || trimmed.length === 0) return null;
    return trimmed;
  }, []);

  const playerProfileRef = useRef(playerProfile);
  playerProfileRef.current = playerProfile;

  const [mpState, setMpState] = useState<{ isConnected: boolean, roomId: string | null, isHost: boolean, joinCode: string, error: string }>({ isConnected: false, roomId: null, isHost: false, joinCode: '', error: '' });
  const [mpError, setMpError] = useState<string | null>(null);
  const mpRef = useRef(mpState);
  mpRef.current = mpState;

  const prevStatusRef = useRef<'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY' | 'LOBBY'>('MENU');

  useEffect(() => {
    const prev = prevStatusRef.current;
    const current = uiState.status;
    prevStatusRef.current = current;

    if (!mpRef.current.roomId) { // only for single-player
      if ((prev === 'PLAYING' || prev === 'PAUSED') && (current === 'GAME_OVER' || current === 'VICTORY')) {
        activeSinglePlayerRunIdRef.current += 1;
        invalidateQuickSave();
      } else if ((prev === 'PLAYING' || prev === 'PAUSED') && current === 'MENU') {
        activeSinglePlayerRunIdRef.current += 1;
        invalidateQuickSave();
      }
    }
  }, [uiState.status, invalidateQuickSave]);
  const socketRef = useRef<Socket | null>(null);
  const resumeSessionRef = useRef<{ roomId: string; resumeToken: string } | null>(null);
  const resumeInFlightRef = useRef<boolean>(false);
  const awaitingResumeSnapshotRef = useRef<boolean>(false);
  const resumeAttemptGenerationRef = useRef<number>(0);

  const roomRequestGenerationRef = useRef<number>(0);
  const roomRequestInFlightRef = useRef<boolean>(false);
  const inviteJoinHandledRef = useRef<boolean>(false);
  const [pendingRoomRequest, setPendingRoomRequest] = useState<'create' | 'join' | null>(null);

  const isValidResumeToken = useCallback((token: any): boolean => {
    return typeof token === 'string' && token.length >= 20 && token.length <= 128;
  }, []);

  const clearResumeSession = useCallback(() => {
    resumeSessionRef.current = null;
    resumeInFlightRef.current = false;
    awaitingResumeSnapshotRef.current = false;
    resumeAttemptGenerationRef.current++;
  }, []);

  const clearPendingAbilityRequests = useCallback(() => {
    pendingSpecialRequestRef.current = null;
    pendingBuildRequestRef.current = null;
  }, []);

  const lastReceivedGameStateTimeRef = useRef<number>(0);

  const hostClockAnchorRef = useRef<HostClockAnchor | null>(null);

  const resetHostClockAnchor = useCallback(() => {
    hostClockAnchorRef.current = null;
  }, []);
  const triggerEliminationRef = useRef<((x: number, y: number, colorIdx: number, label?: string) => void) | null>(null);
  const eliminateRemotePlayerRef = useRef<((victimId: string, impactPos: { x: number, y: number }, currentTime: number) => void) | null>(null);
  const bannerShowingRef = useRef(false);

  const isMobileRef = useRef(typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent));
  const [confirmResign, setConfirmResign] = useState(false);
  const confirmResignRef = useRef(confirmResign);
  confirmResignRef.current = confirmResign;

  const [mpMenuOpen, setMpMenuOpen] = useState(false);
  const mpMenuOpenRef = useRef(false);
  mpMenuOpenRef.current = mpMenuOpen;

  useEffect(() => {
    if (uiState.status !== 'PLAYING') {
      setMpMenuOpen(false);
      mpMenuOpenRef.current = false;
    }
  }, [uiState.status]);

  useEffect(() => {
    if (isMpMapSelectOpen && (!mpState.isHost || !mpState.roomId || !mpState.isConnected || uiState.status !== 'LOBBY')) {
      closeMpMapSelector();
    }
  }, [isMpMapSelectOpen, mpState.isHost, mpState.roomId, mpState.isConnected, uiState.status, closeMpMapSelector]);

  const [isMapSelectOpen, setIsMapSelectOpen] = useState(false);
  const [mpTick, setMpTick] = useState(0);
  const [confirmLeaveMatches, setConfirmLeaveMatches] = useState(false);

  const mappedClientDeadlineRef = useRef<number | null>(null);
  const mappedProtectionDeadlineRef = useRef<number | null>(null);
  const awaitingOpeningProtectionAuthorityRef = useRef<boolean>(false);
  const wasProtectionActiveRef = useRef<boolean>(false);
  const [currentMatchPhase, setCurrentMatchPhase] = useState<'PLAYING' | 'FINAL_RUN' | 'FINISHED'>('PLAYING');
  const [, setFinalRunTick] = useState<number>(0);
  const [protectionTick, setProtectionTick] = useState<number>(0);

  const isOpeningProtectionActiveForHost = useCallback((currentTime: number = performance.now()) => {
    if (!mpRef.current.roomId || !mpRef.current.isHost) return false;
    if (stateRef.current.openingProtectionDeadline === null) return false;
    return currentTime < stateRef.current.openingProtectionDeadline;
  }, []);

  const getRemainingProtectionSeconds = useCallback((currentTime: number = performance.now()) => {
    if (!mpRef.current.roomId) return 0;
    let remMs = 0;
    if (mpRef.current.isHost) {
      if (stateRef.current.openingProtectionDeadline === null) return 0;
      remMs = stateRef.current.openingProtectionDeadline - currentTime;
    } else {
      if (mappedProtectionDeadlineRef.current === null) return 0;
      remMs = mappedProtectionDeadlineRef.current - currentTime;
    }
    return Math.max(0, remMs / 1000);
  }, []);

  const isOpeningProtectionActiveLocal = useCallback((currentTime: number = performance.now()) => {
    if (!mpRef.current.roomId) {
      awaitingOpeningProtectionAuthorityRef.current = false;
      return false;
    }
    if (mpRef.current.isHost) {
      awaitingOpeningProtectionAuthorityRef.current = false;
      return isOpeningProtectionActiveForHost(currentTime);
    }
    if (awaitingOpeningProtectionAuthorityRef.current) return true;
    return getRemainingProtectionSeconds(currentTime) > 0;
  }, [getRemainingProtectionSeconds, isOpeningProtectionActiveForHost]);

  useEffect(() => {
    if (!mpState.roomId) {
      wasProtectionActiveRef.current = false;
      return;
    }
    const timer = setInterval(() => {
      const isActive = isOpeningProtectionActiveLocal();
      if (isActive) {
        wasProtectionActiveRef.current = true;
        setProtectionTick(t => t + 1);
      } else if (wasProtectionActiveRef.current) {
        wasProtectionActiveRef.current = false;
        setProtectionTick(t => t + 1);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [mpState.roomId, isOpeningProtectionActiveLocal]);

  const getRemainingFinalRunSeconds = useCallback(() => {
    let remMs = 0;
    if (mpRef.current.isHost) {
      if (stateRef.current.matchPhase !== 'FINAL_RUN' || !stateRef.current.finalRunDeadline) return 0;
      remMs = stateRef.current.finalRunDeadline - performance.now();
    } else {
      if (stateRef.current.matchPhase !== 'FINAL_RUN' || !mappedClientDeadlineRef.current) return 0;
      remMs = mappedClientDeadlineRef.current - performance.now();
    }
    return Math.max(0, Math.ceil(remMs / 1000));
  }, []);

  const displayFinalRunSeconds = currentMatchPhase === 'FINAL_RUN' ? getRemainingFinalRunSeconds() : 0;

  useEffect(() => {
    if (!mpState.roomId || currentMatchPhase !== 'FINAL_RUN') {
      return;
    }

    const timer = setInterval(() => {
      setFinalRunTick(t => t + 1);
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, [mpState.roomId, currentMatchPhase]);

  useEffect(() => {
    if (!mpState.roomId) {
      mappedClientDeadlineRef.current = null;
      setCurrentMatchPhase('PLAYING');
    }
  }, [mpState.roomId]);

  const [bannerState, setBannerState] = useState<{ show: boolean; isLeaving: boolean; mode: 'single' | 'multi' | null }>({
    show: false,
    isLeaving: false,
    mode: null,
  });
  const [bannerCountdown, setBannerCountdown] = useState(3);
  const [pulseSpawnerCounter, setPulseSpawnerCounter] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spawnerPointerAnimRef = useRef<{
    startWorldX: number;
    startWorldY: number;
    startTime: number;
    duration: number;
    targetWorldX: number;
    targetWorldY: number;
  } | null>(null);

  const pauseStartRef = useRef<number | null>(null);
  const accumulatedPauseOffsetRef = useRef<number>(0);

  const multiplayerWorldPhaseAnchorRef = useRef<{
    phaseAtAnchor: number;
    localTimeAtAnchor: number;
    initialized: boolean;
  }>({
    phaseAtAnchor: 0,
    localTimeAtAnchor: 0,
    initialized: false,
  });

  const getMultiplayerWorldPhaseTime = useCallback((localTime: number): number => {
    const anchor = multiplayerWorldPhaseAnchorRef.current;
    if (!anchor.initialized) {
      anchor.phaseAtAnchor = 0;
      anchor.localTimeAtAnchor = localTime;
      anchor.initialized = true;
      return 0;
    }
    const calculatedPhase = anchor.phaseAtAnchor + (localTime - anchor.localTimeAtAnchor);
    if (!Number.isFinite(calculatedPhase)) {
      anchor.phaseAtAnchor = 0;
      anchor.localTimeAtAnchor = localTime;
      anchor.initialized = true;
      return 0;
    }
    return Math.max(0, calculatedPhase);
  }, []);

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      updateExclusionRects();
    });
    return () => cancelAnimationFrame(handle);
  }, [
    containerSize.width,
    containerSize.height,
    uiState.status,
    uiState.deviceType,
    mpState.roomId,
    currentMatchPhase,
    bannerState.show,
    protectionTick,
    updateExclusionRects,
  ]);

  const handleSpawnerDestroyed = useCallback((destroyedSpawner: { x: number; y: number; radius?: number }) => {
    const state = stateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas || uiRef.current.status !== 'PLAYING') {
      spawnerPointerAnimRef.current = null;
      return;
    }

    const isNormalMode = state.gameMode ? state.gameMode === 'normal' : !uiRef.current.hardMode;
    if (!isNormalMode) {
      spawnerPointerAnimRef.current = null;
      return;
    }

    const camera = state.camera;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const player = state.player;

    const wasDestroyedSpawnerVisible = isSpawnerVisible(destroyedSpawner, camera, canvasW, canvasH);
    const livingSpawners = state.spawners.filter(s => s.hp === undefined || s.hp > 0);
    const remainingVisible = livingSpawners.some(s => isSpawnerVisible(s, camera, canvasW, canvasH));

    if (wasDestroyedSpawnerVisible && !remainingVisible && livingSpawners.length > 0) {
      const closest = getClosestSpawner(livingSpawners, player);
      if (closest) {
        spawnerPointerAnimRef.current = {
          startWorldX: destroyedSpawner.x,
          startWorldY: destroyedSpawner.y,
          startTime: performance.now(),
          duration: 350,
          targetWorldX: closest.x,
          targetWorldY: closest.y,
        };
        return;
      }
    }

    if (livingSpawners.length === 0) {
      spawnerPointerAnimRef.current = null;
    } else if (spawnerPointerAnimRef.current) {
      const targetIsDestroyed = Math.abs(spawnerPointerAnimRef.current.targetWorldX - destroyedSpawner.x) < 5 &&
                                Math.abs(spawnerPointerAnimRef.current.targetWorldY - destroyedSpawner.y) < 5;
      if (targetIsDestroyed) {
        spawnerPointerAnimRef.current = null;
      }
    }
  }, []);

  const triggerSpawnerPulse = useCallback(() => {
    if (mpRef.current.roomId) return;
    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
    setPulseKey(prev => prev + 1);
    setPulseSpawnerCounter(true);
    pulseTimeoutRef.current = setTimeout(() => {
      setPulseSpawnerCounter(false);
      pulseTimeoutRef.current = null;
    }, 800);
  }, []);

  useEffect(() => {
    if (uiState.status !== 'PLAYING') {
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
        pulseTimeoutRef.current = null;
      }
      setPulseSpawnerCounter(false);
    }
  }, [uiState.status]);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
        pulseTimeoutRef.current = null;
      }
    };
  }, []);
  const [flashScore, setFlashScore] = useState(false);

  useEffect(() => {
    if (uiState.status === 'PLAYING') {
      const mode = mpState.roomId ? 'multi' : 'single';

      // Easy toggle switch for the objective banner pop-up. Change to true to re-enable!
      const enableObjectiveBanner = false;

      if (!enableObjectiveBanner) {
        setBannerState({ show: false, isLeaving: false, mode: null });
        bannerShowingRef.current = false;

        setFlashScore(false);
        return;
      }

      setBannerState({ show: true, isLeaving: false, mode });
      bannerShowingRef.current = true;
      setBannerCountdown(3);

      setFlashScore(false);

      const interval = setInterval(() => {
        setBannerCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      const hideTimeout = setTimeout(() => {
        setBannerState({ show: false, isLeaving: false, mode: null });
        bannerShowingRef.current = false;
        if (mode === 'single') {


        } else {
          setFlashScore(true);
          setTimeout(() => setFlashScore(false), 2000);
        }
      }, 3000);

      return () => {
        clearInterval(interval);
        clearTimeout(hideTimeout);
      };
    } else {
      setBannerState({ show: false, isLeaving: false, mode: null });
      bannerShowingRef.current = false;

      setFlashScore(false);
    }
  }, [uiState.status, mpState.roomId]);

  const getMultiplayerStandings = () => {
    const list: Array<{
      id: string;
      name: string;
      score: number;
      isDead: boolean;
      colorIdx: number;
      isLocal: boolean;
    }> = [];
    const myId = socketRef.current?.id || 'local';

    const matchPlayers = stateRef.current?.matchPlayers;

    if (mpRef.current.roomId && matchPlayers && Object.keys(matchPlayers).length > 0) {
      for (const pid in matchPlayers) {
        const mp = matchPlayers[pid];
        list.push({
          id: mp.id,
          name: mp.name || 'PLAYER',
          score: mp.score || 0,
          isDead: !!mp.isDead,
          colorIdx: mp.colorIdx || 0,
          isLocal: mp.id === myId,
        });
      }
    } else {
      // Local player
      list.push({
        id: myId,
        name: playerProfileRef.current.name || 'PLAYER 1',
        score: uiRef.current.score || 0,
        isDead: uiRef.current.status === 'GAME_OVER',
        colorIdx: playerProfileRef.current.colorIdx || 0,
        isLocal: true,
      });

      // Remote players
      const mpPlayers = stateRef.current?.multiplayerPlayers || {};
      for (const pid in mpPlayers) {
        if (mpPlayers[pid]) {
          list.push({
            id: pid,
            name: mpPlayers[pid].name || 'PLAYER',
            score: mpPlayers[pid].score || 0,
            isDead: !!mpPlayers[pid].isDead,
            colorIdx: mpPlayers[pid].colorIdx || 0,
            isLocal: false,
          });
        }
      }
    }

    list.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (stateRef.current?.matchPhase === 'FINISHED') {
        const winnerId = stateRef.current?.winnerId;
        if (winnerId) {
          if (a.id === winnerId) return -1;
          if (b.id === winnerId) return 1;
        }
      }
      return a.id.localeCompare(b.id);
    });

    const isWholeGameEnded = mpRef.current.roomId
      ? stateRef.current?.matchPhase === 'FINISHED'
      : list.every(p => p.isDead);

    return { list, isWholeGameEnded };
  };

  const getPlayerRank = () => {
    const { list } = getMultiplayerStandings();
    const myId = socketRef.current?.id || 'local';
    const idx = list.findIndex(p => p.id === myId);
    return idx === -1 ? 1 : idx + 1;
  };

  const handleStartMultiplayerMatch = () => {
    if (multiplayerStartPendingRef.current) return;

    const capturedSocket = socketRef.current;
    if (!capturedSocket || !capturedSocket.connected) return;

    const capturedRoomId = mpRef.current.roomId ? mpRef.current.roomId.trim().toUpperCase() : null;
    if (!capturedRoomId || !mpRef.current.isHost || !mpRef.current.isConnected) return;

    if (matchSettingsUpdatePendingRef.current) {
      setMpError("WAITING FOR SETTINGS SYNC");
      return;
    }

    const currentLobby = lobbyPlayersRef.current;
    const lobbyPlayerCount = Object.keys(currentLobby).length + 1;
    if (lobbyPlayerCount < 2) {
      setMpError("WAITING FOR ANOTHER PLAYER");
      return;
    }

    setMpError(null);

    const myId = capturedSocket.id;
    if (!myId) return;

    const playerIds = [myId];
    for (const pid in currentLobby) {
      if (pid !== myId && !playerIds.includes(pid)) {
        playerIds.push(pid);
      }
    }
    const capturedPlayerIds = [...playerIds];

    const mapIdToUse = lobbyMatchSettingsRef.current.mapId;
    const mapDef = MAPS[mapIdToUse] || MAPS.classic_arena;
    const spawnAssignments = generateMultiplayerSpawnAssignments(playerIds, mapDef, mapDef.walls);

    if (!spawnAssignments) {
      setMpError("NO SAFE START FORMATION");
      return;
    }

    multiplayerStartRequestGenerationRef.current += 1;
    const requestGen = multiplayerStartRequestGenerationRef.current;

    multiplayerStartPendingRef.current = true;
    setMultiplayerStartPending(true);

    capturedSocket.emit(
      'start_game',
      capturedRoomId,
      {
        spawnAssignments
      },
      (response?: {
        success?: boolean;
        roundId?: number;
        roomId?: string;
        config?: {
          roomId?: string;
          mapId: string;
          gameMode: GameMode;
          hardMode: boolean;
          spawnAssignments: Record<string, { x: number; y: number }>;
          roundId?: number;
        };
        error?: string;
      }) => {
        try {
          if (
            multiplayerStartRequestGenerationRef.current !== requestGen ||
            socketRef.current !== capturedSocket ||
            !capturedSocket.connected ||
            !mpRef.current.isConnected ||
            !mpRef.current.roomId ||
            mpRef.current.roomId.trim().toUpperCase() !== capturedRoomId ||
            !mpRef.current.isHost
          ) {
            return;
          }

          if (!response || !response.success) {
            const err = response?.error || 'START_FAILED';
            const msg =
              err === 'ROSTER_MISMATCH'
                ? 'ROSTER CHANGED - TRY AGAIN'
                : err === 'NO_SPAWN_ASSIGNMENTS' || err === 'INVALID_SPAWN_COORDINATES'
                ? 'NO SAFE START FORMATION'
                : err === 'NOT_ENOUGH_PLAYERS'
                ? 'WAITING FOR ANOTHER PLAYER'
                : err === 'ROSTER_NOT_READY'
                ? 'LOBBY ROSTER NOT READY - TRY AGAIN'
                : `START FAILED: ${err}`;
            setMpError(msg);
            return;
          }

          const resRoomId =
            (typeof response.config?.roomId === 'string' && response.config.roomId.trim().toUpperCase()) ||
            (typeof response.roomId === 'string' && response.roomId.trim().toUpperCase());

          const roundId = response.roundId;
          const mapId = response.config?.mapId;
          const gameMode = response.config?.gameMode;
          const hardMode = response.config?.hardMode;
          const resSpawns = response.config?.spawnAssignments;

          let isValidResponse = true;

          if (!resRoomId || resRoomId !== capturedRoomId) isValidResponse = false;
          if (typeof roundId !== 'number' || !Number.isInteger(roundId) || roundId <= 0) isValidResponse = false;
          if (roundId !== currentRoomRoundIdRef.current + 1) isValidResponse = false;
          if (response.config?.roundId !== roundId) isValidResponse = false;
          if (!mapId || !isValidMapId(mapId)) isValidResponse = false;
          if (!gameMode || !isValidGameMode(gameMode)) isValidResponse = false;
          if (typeof hardMode !== 'boolean' || hardMode !== (gameMode !== 'normal')) isValidResponse = false;
          if (!resSpawns || typeof resSpawns !== 'object' || Array.isArray(resSpawns)) isValidResponse = false;

          if (isValidResponse && resSpawns) {
            const resAssignedKeys = Object.keys(resSpawns);
            if (resAssignedKeys.length !== capturedPlayerIds.length) {
              isValidResponse = false;
            } else if (!capturedPlayerIds.every(id => id in resSpawns)) {
              isValidResponse = false;
            } else {
              for (const pid of capturedPlayerIds) {
                const pos = resSpawns[pid];
                if (
                  !pos ||
                  typeof pos !== 'object' ||
                  Array.isArray(pos) ||
                  typeof pos.x !== 'number' ||
                  typeof pos.y !== 'number' ||
                  !Number.isFinite(pos.x) ||
                  !Number.isFinite(pos.y) ||
                  pos.x < 0 ||
                  pos.x > 3000 ||
                  pos.y < 0 ||
                  pos.y > 3000
                ) {
                  isValidResponse = false;
                  break;
                }
              }
            }
          }

          if (!isValidResponse) {
            setMpError("INVALID START RESPONSE");
            return;
          }

          const ok = resetGame(isMobileRef.current ? 'mobile' : 'desktop', mapId, gameMode, resSpawns);
          if (ok) {
            clearPendingGuestShots();
            clearPendingAbilityRequests();
            currentRoomRoundIdRef.current = roundId;
            activeMultiplayerRoundIdRef.current = roundId;
            resetHostClockAnchor();
            setMpError(null);
            setUiState(prev => ({
              ...prev,
              status: 'PLAYING',
              mapId,
              hardMode: gameMode !== 'normal',
              gameMode
            }));
          } else {
            setMpError("FAILED TO INITIALIZE MATCH");
          }
        } finally {
          if (multiplayerStartRequestGenerationRef.current === requestGen) {
            multiplayerStartPendingRef.current = false;
            setMultiplayerStartPending(false);
          }
        }
      }
    );
  };

  const handleMultiplayerRestart = handleStartMultiplayerMatch;

  // We use a ref for the entire game state to avoid stale closures
  const initialSpawn = useRef({ x: 500, y: 500 }).current;
  const stateRef = useRef({
    player: { x: initialSpawn.x, y: initialSpawn.y, vx: 0, vy: 0, kbvx: 0, kbvy: 0, processedZoneKbs: [] as number[], radius: PLAYER_RADIUS, lastShoot: 0, dash: { active: false, endTime: 0, targetX: 0, targetY: 0, shieldRadius: 60, lastTime: performance.now() - DASH_COOLDOWN, wasReady: true }, build: { active: false, endTime: 0, lastBlockX: 0, lastBlockY: 0, lastTime: performance.now() - BUILD_COOLDOWN }, recentBlocks: [] as { key: string, x: number, y: number, timestamp: number }[] },
    multiplayerPlayers: {} as Record<string, { x: number, y: number, radius: number, isDash: boolean, name?: string, colorIdx?: number, isDead?: boolean, kbvx?: number, kbvy?: number, recentBlocks?: { key: string, x: number, y: number, timestamp: number }[] }>,
    matchPhase: 'PLAYING' as 'PLAYING' | 'FINAL_RUN' | 'FINISHED',
    finalRunnerId: null as string | null,
    finalRunDeadline: null as number | null,
    openingProtectionDeadline: null as number | null,
    winnerId: null as string | null,
    matchPlayers: {} as Record<string, { id: string, name: string, colorIdx: number, score: number, isDead: boolean, isDisconnected?: boolean }>,
    playerActionAuthority: {} as Record<string, {
      lastShootAt: number;
      specialActiveUntil: number;
      specialReadyAt: number;
      buildActiveUntil: number;
      buildReadyAt: number;
    }>,
    forceBroadcast: false,
    blocks: [] as { x: number; y: number; size: number; createdAt: number, colorIdx?: number, ownerId?: string }[],
    nextBlockScore: 100,
    bullets: [] as { id?: string; clientShotId?: string; x: number; y: number; dx: number; dy: number; radius: number, isPlayer: boolean, bounceCount: number, spawnTime: number, isNeutral: boolean, ownerId?: string, colorIdx?: number, targetX?: number, targetY?: number, repelMultiplied?: boolean, allowedBlockKeys?: string[], leftBlockKeys?: string[] }[],
    enemies: [] as { id?: string; x: number; y: number; radius: number; lastShoot: number, speed: number, targetX?: number, targetY?: number, kbvx?: number, kbvy?: number, processedZoneKbs?: number[] }[],
    bouncers: [] as { id?: string; x: number; y: number; dx: number; dy: number; size: number; radius: number; speed: number; lastDirChange: number; lastMultiply: number, targetX?: number, targetY?: number, kbvx?: number, kbvy?: number, processedZoneKbs?: number[] }[],
    zones: [] as { x: number; y: number; innerRadius: number; outerRadius: number; duration: number; spawnTime: number; ownerId: string; colorIdx?: number, type?: 'repel' }[],
    nextEntityId: 1,
    bouncerCapacity: 2,
    spawners: [
      { x: 800, y: 800, radius: 40, hp: 100, maxHp: 100, specialType: undefined as string | undefined },
      { x: 2200, y: 800, radius: 40, hp: 100, maxHp: 100, specialType: undefined as string | undefined },
      { x: 800, y: 2200, radius: 40, hp: 100, maxHp: 100, specialType: undefined as string | undefined },
      { x: 2400, y: 2400, radius: 40, hp: 100, maxHp: 100, specialType: undefined as string | undefined },
      { x: 1500, y: 600, radius: 40, hp: 100, maxHp: 100, specialType: undefined as string | undefined }
    ],
    keys: { w: false, a: false, s: false, d: false },
    mouse: { x: 0, y: 0, worldX: 0, worldY: 0, down: false, justDown: false, rightDown: false, rightJustDown: false },
    touches: {
      left: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0 },
      right: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0, justReleased: false, releaseDx: 0, releaseDy: 0, aimLength: 0, startTime: 0 },
      tap: { active: false, x: 0, y: 0 }
    },
    camera: { x: 0, y: 0, width: 0, height: 0, z: 1 },
    lastBroadcastTime: 0,
    particles: [] as { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; radius: number }[],
    trails: [] as { x: number; y: number; age: number; color: string; radius: number, isSuperStrong?: boolean }[],
    shockwaves: [] as { x: number; y: number; color: string; maxRadius: number; age: number; maxAge: number; thickness: number }[],
    floatingTexts: [] as { x: number; y: number; text: string; age: number; maxAge: number; color: string; vy: number }[],
    shake: 0,
    lastTime: performance.now(),
    lastEnemySpawn: 0,
    enemySpawnRate: 3000,
    gameMode: 'normal' as GameMode,
    hardMode: false,
    tutorial: { active: false, spawnerIndex: null as number | null, enemySpawned: false, timer: 0 },
  });

  const toAuthoritativeBulletState = useCallback((bullet: typeof stateRef.current.bullets[number]): AuthoritativeBulletState | null => {
    if (!bullet.id) return null;
    return {
      id: String(bullet.id),
      x: bullet.x,
      y: bullet.y,
      dx: bullet.dx,
      dy: bullet.dy,
      radius: bullet.radius,
      bounceCount: bullet.bounceCount,
      spawnTime: bullet.spawnTime,
      isPlayer: bullet.isPlayer,
      isNeutral: bullet.isNeutral,
      ...(bullet.ownerId !== undefined ? { ownerId: bullet.ownerId } : {}),
      ...(bullet.colorIdx !== undefined ? { colorIdx: bullet.colorIdx } : {}),
      ...(bullet.clientShotId !== undefined ? { clientShotId: bullet.clientShotId } : {}),
      ...(bullet.repelMultiplied !== undefined ? { repelMultiplied: bullet.repelMultiplied } : {}),
      ...(bullet.allowedBlockKeys !== undefined ? { allowedBlockKeys: [...bullet.allowedBlockKeys] } : {}),
      ...(bullet.leftBlockKeys !== undefined ? { leftBlockKeys: [...bullet.leftBlockKeys] } : {}),
    };
  }, []);

  const queueAuthoritativeBulletEvent = useCallback((
    type: AuthoritativeBulletEventType,
    bullet: typeof stateRef.current.bullets[number],
    hostTime: number,
    reason?: string,
  ) => {
    if (!mpRef.current.roomId || !mpRef.current.isHost || !bullet.id) return;
    const roundId = activeMultiplayerRoundIdRef.current;
    if (!Number.isInteger(roundId) || roundId <= 0) return;
    const state = (type === 'hit' || type === 'remove')
      ? undefined
      : toAuthoritativeBulletState(bullet) ?? undefined;
    const event: AuthoritativeBulletEvent = {
      roundId,
      sequence: ++hostBulletEventSequenceRef.current,
      tick: hostBulletSimulationTickRef.current,
      hostTime,
      type,
      bulletId: String(bullet.id),
      x: bullet.x,
      y: bullet.y,
      ...(state ? { state } : {}),
      ...(reason ? { reason } : {}),
    };
    pendingHostBulletEventsRef.current.push(event);
    if (state) knownHostBulletStatesRef.current.set(state.id, state);
    stateRef.current.forceBroadcast = true;
  }, [toAuthoritativeBulletState]);

  const getOrInitializeAuthority = (clientId: string) => {
    if (!stateRef.current.playerActionAuthority) {
      stateRef.current.playerActionAuthority = {};
    }
    if (!stateRef.current.playerActionAuthority[clientId]) {
      stateRef.current.playerActionAuthority[clientId] = {
        lastShootAt: 0,
        specialActiveUntil: 0,
        specialReadyAt: 0,
        buildActiveUntil: 0,
        buildReadyAt: 0
      };
    }
    return stateRef.current.playerActionAuthority[clientId];
  };

  const releaseAllInputs = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;

    state.keys.w = false;
    state.keys.a = false;
    state.keys.s = false;
    state.keys.d = false;

    state.mouse.down = false;
    state.mouse.justDown = false;
    state.mouse.rightDown = false;
    state.mouse.rightJustDown = false;

    state.touches.left.active = false;
    state.touches.left.id = -1;
    state.touches.left.dirX = 0;
    state.touches.left.dirY = 0;
    state.touches.left.currentX = state.touches.left.startX;
    state.touches.left.currentY = state.touches.left.startY;

    state.touches.right.active = false;
    state.touches.right.id = -1;
    state.touches.right.dirX = 0;
    state.touches.right.dirY = 0;
    state.touches.right.justReleased = false;
    state.touches.right.releaseDx = 0;
    state.touches.right.releaseDy = 0;
    state.touches.right.aimLength = 0;
    state.touches.right.startTime = 0;
    state.touches.right.currentX = state.touches.right.startX;
    state.touches.right.currentY = state.touches.right.startY;

    state.touches.tap = { active: false, x: 0, y: 0 };
  }, []);

  const emitLeaveRoom = useCallback(() => {
    invalidateStartRequestGeneration();
    currentRoomRoundIdRef.current = 0;
    activeMultiplayerRoundIdRef.current = 0;
    resetHostClockAnchor();
    const currentRoomId = mpRef.current.roomId;
    roomRequestGenerationRef.current++;
    roomRequestInFlightRef.current = false;
    setPendingRoomRequest(null);
    clearResumeSession();
    clearPendingGuestShots(true);
    clearPendingAbilityRequests();
    cancelPendingMatchSettingsUpdate();
    closeMpMapSelector();
    releaseAllInputs();
    lobbyPlayersRef.current = {};
    setLobbyPlayers({});
    mpRef.current.roomId = null;
    mpRef.current.isHost = false;
    setMpError(null);
    setMpState(prev => ({
      ...prev,
      roomId: null,
      isHost: false,
      error: null
    }));
    if (currentRoomId) {
      socketRef.current?.emit('leave_room', currentRoomId);
    }
  }, [clearResumeSession, clearPendingGuestShots, clearPendingAbilityRequests, cancelPendingMatchSettingsUpdate, closeMpMapSelector, releaseAllInputs, invalidateStartRequestGeneration, resetHostClockAnchor]);

  useEffect(() => {
    const isDisconnected = mpState.roomId && !mpState.isConnected;
    if (uiState.status !== 'PLAYING' || mpMenuOpen || confirmResign || isDisconnected) {
      releaseAllInputs();
    }
  }, [uiState.status, mpMenuOpen, confirmResign, mpState.roomId, mpState.isConnected, releaseAllInputs]);

  const remapPlayerId = useCallback((oldId: string, newId: string) => {
    if (!isValidMpPlayerId(oldId) || !isValidMpPlayerId(newId)) return;
    if (oldId === newId) return;

    const state = stateRef.current;
    if (!state) return;

    const localSocketId = socketRef.current?.id;

    // 1. matchPlayers
    if (state.matchPlayers) {
      if (state.matchPlayers[oldId]) {
        const p = state.matchPlayers[oldId];
        p.id = newId;
        state.matchPlayers[newId] = p;
        if (oldId !== newId) {
          delete state.matchPlayers[oldId];
        }
      } else if (state.matchPlayers[newId]) {
        state.matchPlayers[newId].id = newId;
      }
    }

    // 2. multiplayerPlayers
    if (state.multiplayerPlayers) {
      if (newId === localSocketId) {
        // Local player should NOT be in multiplayerPlayers
        delete state.multiplayerPlayers[oldId];
        delete state.multiplayerPlayers[newId];
      } else if (state.multiplayerPlayers[oldId]) {
        state.multiplayerPlayers[newId] = state.multiplayerPlayers[oldId];
        if (oldId !== newId) {
          delete state.multiplayerPlayers[oldId];
        }
      }
    }

    // 3. playerActionAuthority
    if (state.playerActionAuthority && state.playerActionAuthority[oldId]) {
      state.playerActionAuthority[newId] = state.playerActionAuthority[oldId];
      if (oldId !== newId) {
        delete state.playerActionAuthority[oldId];
      }
    }

    // 4. Ownership in blocks, bullets, zones
    if (state.blocks) {
      state.blocks.forEach((block: any) => {
        if (block.ownerId === oldId) {
          block.ownerId = newId;
        }
      });
    }

    if (state.bullets) {
      state.bullets.forEach((bullet: any) => {
        if (bullet.ownerId === oldId) {
          bullet.ownerId = newId;
        }
      });
    }

    if (state.zones) {
      state.zones.forEach((zone: any) => {
        if (zone.ownerId === oldId) {
          zone.ownerId = newId;
        }
      });
    }

    // 5. Match Identity & Lobby State
    if (state.finalRunnerId === oldId) {
      state.finalRunnerId = newId;
    }
    if (state.winnerId === oldId) {
      state.winnerId = newId;
    }

    setLobbyPlayers(prev => {
      if (prev && prev[oldId]) {
        const next = { ...prev, [newId]: prev[oldId] };
        if (oldId !== newId) {
          delete next[oldId];
        }
        return next;
      }
      return prev;
    });

    state.forceBroadcast = true;
    state.lastBroadcastTime = 0;
    setMpTick(t => t + 1);
  }, []);

  const handleCopyCode = () => {
    if (mpState.roomId) {
      navigator.clipboard.writeText(mpState.roomId);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  const handleCopyInviteLink = () => {
    if (mpState.roomId) {
      const inviteLink = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${mpState.roomId}`;
      navigator.clipboard.writeText(inviteLink);
      setCopyLinkFeedback(true);
      setTimeout(() => setCopyLinkFeedback(false), 2000);
    }
  };

  const updateProfile = (name: string, colorIdx: number) => {
    setPlayerProfile({ name, colorIdx });
    if (!isEditingCallsignRef.current) {
      setCallsignDraft(name);
    }
    if (mpRef.current.roomId) {
      socketRef.current?.emit('update_profile', mpRef.current.roomId, {
        name,
        colorIdx
      });
    }
  };

  const startCallsignEditing = () => {
    setIsEditingCallsign(true);
    isEditingCallsignRef.current = true;
    setCallsignDraft(playerProfile.name);
  };

  const cancelCallsignEditing = () => {
    if (!isEditingCallsignRef.current) return;
    setIsEditingCallsign(false);
    isEditingCallsignRef.current = false;
    setCallsignDraft(playerProfile.name);
  };

  const commitCallsignDraft = () => {
    if (!isEditingCallsignRef.current) return;
    setIsEditingCallsign(false);
    isEditingCallsignRef.current = false;
    const trimmed = callsignDraft.trim();
    if (trimmed === '') {
      setCallsignDraft(playerProfile.name);
    } else {
      setCallsignDraft(trimmed);
      if (trimmed !== playerProfile.name) {
        updateProfile(trimmed, playerProfile.colorIdx);
      }
    }
  };

  const downloadQrCode = async () => {
    if (!mpState.roomId) return;
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${mpState.roomId}`)}`;
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `match-${mpState.roomId}-qr.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Failed to download QR code blob:", err);
      const link = document.createElement('a');
      link.href = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${mpState.roomId}`)}`;
      link.target = "_blank";
      link.download = `match-${mpState.roomId}-qr.png`;
      link.click();
    }
  };

  const shiftSinglePlayerTimestamps = (pauseDuration: number) => {
    const state = stateRef.current;

    state.player.lastShoot += pauseDuration;
    state.player.dash.lastTime += pauseDuration;
    if (state.player.dash.endTime !== 0) {
      state.player.dash.endTime += pauseDuration;
    }
    state.player.build.lastTime += pauseDuration;
    if (state.player.build.endTime !== 0) {
      state.player.build.endTime += pauseDuration;
    }

    if (state.player.recentBlocks) {
      for (const block of state.player.recentBlocks) {
        block.timestamp += pauseDuration;
      }
    }

    if (state.player.processedZoneKbs) {
      for (let i = 0; i < state.player.processedZoneKbs.length; i++) {
        state.player.processedZoneKbs[i] += pauseDuration;
      }
    }

    state.lastEnemySpawn += pauseDuration;

    if (state.enemies) {
      for (const enemy of state.enemies) {
        enemy.lastShoot += pauseDuration;
        if (enemy.processedZoneKbs) {
          for (let i = 0; i < enemy.processedZoneKbs.length; i++) {
            enemy.processedZoneKbs[i] += pauseDuration;
          }
        }
      }
    }

    if (state.bullets) {
      for (const bullet of state.bullets) {
        bullet.spawnTime += pauseDuration;
      }
    }

    if (state.bouncers) {
      for (const bouncer of state.bouncers) {
        bouncer.lastDirChange += pauseDuration;
        bouncer.lastMultiply += pauseDuration;
        if (bouncer.processedZoneKbs) {
          for (let i = 0; i < bouncer.processedZoneKbs.length; i++) {
            bouncer.processedZoneKbs[i] += pauseDuration;
          }
        }
      }
    }

    if (state.zones) {
      for (const zone of state.zones) {
        zone.spawnTime += pauseDuration;
      }
    }

    if (state.blocks) {
      for (const block of state.blocks) {
        if (block.createdAt !== undefined) {
          block.createdAt += pauseDuration;
        }
      }
    }

    if (spawnerPointerAnimRef.current) {
      spawnerPointerAnimRef.current.startTime += pauseDuration;
    }
  };

  const beginSinglePlayerPause = () => {
    if (mpRef.current.roomId) return;
    if (uiRef.current.status !== 'PLAYING') return;

    pauseStartRef.current = performance.now();
    releaseAllInputs();

    const newUi = { ...uiRef.current, status: 'PAUSED' as const };
    uiRef.current = newUi;
    setUiState(newUi);
  };

  const resumeSinglePlayerFromPause = () => {
    if (mpRef.current.roomId) return;
    if (uiRef.current.status !== 'PAUSED') return;

    if (pauseStartRef.current === null) return;
    const pauseDuration = performance.now() - pauseStartRef.current;

    shiftSinglePlayerTimestamps(pauseDuration);
    accumulatedPauseOffsetRef.current += pauseDuration;
    pauseStartRef.current = null;
    stateRef.current.lastTime = performance.now();
    releaseAllInputs();

    const newUi = { ...uiRef.current, status: 'PLAYING' as const };
    uiRef.current = newUi;
    setUiState(newUi);
  };

  const constructSaveEnvelope = () => {
    const now = Date.now();
    const perfNow = pauseStartRef.current !== null ? pauseStartRef.current : performance.now();

    const state = stateRef.current;
    const ui = uiRef.current;

    // Safe snapshot: Do not mutate live state while saving.
    const snapshotUi = {
      ...ui,
      status: 'PAUSED' as const,
    };

    const snapshotState = {
      player: {
        x: state.player.x,
        y: state.player.y,
        vx: state.player.vx,
        vy: state.player.vy,
        kbvx: state.player.kbvx,
        kbvy: state.player.kbvy,
        processedZoneKbs: [...(state.player.processedZoneKbs || [])],
        radius: state.player.radius,
        lastShoot: state.player.lastShoot,
        dash: { ...state.player.dash },
        build: { ...state.player.build },
        recentBlocks: (state.player.recentBlocks || []).map(rb => ({ ...rb })),
      },
      // Neutralize multiplayer / authority / room / roster state
      multiplayerPlayers: {},
      matchPhase: 'PLAYING' as const,
      finalRunnerId: null,
      finalRunDeadline: null,
      openingProtectionDeadline: null,
      winnerId: null,
      matchPlayers: {},
      playerActionAuthority: {},
      forceBroadcast: false,
      lastBroadcastTime: 0,

      blocks: (state.blocks || []).map(b => ({ ...b })),
      nextBlockScore: state.nextBlockScore,
      bullets: (state.bullets || []).map(b => ({
        ...b,
        allowedBlockKeys: b.allowedBlockKeys ? [...b.allowedBlockKeys] : undefined,
        leftBlockKeys: b.leftBlockKeys ? [...b.leftBlockKeys] : undefined,
      })),
      enemies: (state.enemies || []).map(e => ({
        ...e,
        kbvx: e.kbvx ?? 0,
        kbvy: e.kbvy ?? 0,
        processedZoneKbs: e.processedZoneKbs ? [...e.processedZoneKbs] : [],
      })),
      bouncers: (state.bouncers || []).map(b => ({
        ...b,
        kbvx: b.kbvx ?? 0,
        kbvy: b.kbvy ?? 0,
        processedZoneKbs: b.processedZoneKbs ? [...b.processedZoneKbs] : [],
      })),
      zones: (state.zones || []).map(z => ({ ...z })),
      nextEntityId: state.nextEntityId,
      bouncerCapacity: state.bouncerCapacity,
      spawners: (state.spawners || []).map(s => ({ ...s })),

      // Neutralize transient input
      keys: { w: false, a: false, s: false, d: false },
      mouse: {
        x: state.mouse.x,
        y: state.mouse.y,
        worldX: state.mouse.worldX,
        worldY: state.mouse.worldY,
        down: false,
        justDown: false,
        rightDown: false,
        rightJustDown: false,
      },
      touches: {
        left: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0 },
        right: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0, justReleased: false, releaseDx: 0, releaseDy: 0, aimLength: 0, startTime: 0 },
        tap: { active: false, x: 0, y: 0 },
      },
      camera: { ...state.camera },

      // Transient visual effects cleared from snapshot
      particles: [],
      trails: [],
      shockwaves: [],
      floatingTexts: [],
      shake: 0,

      lastTime: state.lastTime,
      lastEnemySpawn: state.lastEnemySpawn,
      enemySpawnRate: state.enemySpawnRate,
      gameMode: state.gameMode,
      hardMode: state.hardMode,
      tutorial: { active: false, spawnerIndex: null, enemySpawned: false, timer: 0 },
    };

    return {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      savedAt: now,
      savedClockMs: perfNow,
      ui: snapshotUi,
      state: snapshotState,
    };
  };

  const serializeSaveEnvelope = (envelope: any): string => {
    return JSON.stringify(envelope);
  };

  const getByteSize = (str: string): number => {
    try {
      return new TextEncoder().encode(str).length;
    } catch {
      return new Blob([str]).size;
    }
  };

  const showPauseFeedback = (text: string, type: 'success' | 'error') => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setPauseMenuFeedback({ text, type });
    feedbackTimerRef.current = setTimeout(() => {
      setPauseMenuFeedback(null);
      feedbackTimerRef.current = null;
    }, 3000);
  };

  const handleSaveMatch = () => {
    // Single-player saving only; guard against saving or loading during a multiplayer room
    if (mpRef.current.roomId) return;

    setUiState(prev => ({ ...prev, status: 'PAUSED' }));

    try {
      const envelope = constructSaveEnvelope();
      const serialized = serializeSaveEnvelope(envelope);

      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ricochet_save_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (err) {
      console.error("Failed to download save:", err);
    }
  };

  const handleQuickSave = () => {
    if (mpRef.current.roomId) return;
    if (uiRef.current.status !== 'PAUSED') {
      console.warn("[Save Lifecycle] Quick save attempted when not paused");
      return;
    }

    let stage = "snapshot construction";
    try {
      const envelope = constructSaveEnvelope();

      stage = "serialization/size";
      const serialized = serializeSaveEnvelope(envelope);
      const bytes = getByteSize(serialized);
      if (bytes > MAX_SAVE_FILE_BYTES) {
        throw new Error("FILE TOO LARGE");
      }

      stage = "dry validation";
      parseAndReconstructSave(serialized);

      // Store in memory
      quickSaveRef.current = {
        runId: activeSinglePlayerRunIdRef.current,
        serialized
      };

      setQuickSaveExists(true);
      showPauseFeedback("QUICK SAVE STORED", "success");
    } catch (err: any) {
      console.error(`[Save Lifecycle] Failure during stage "${stage}":`, err);
      showPauseFeedback("QUICK SAVE FAILED", "error");
    }
  };

  const parseAndReconstructSave = (text: string) => {
    if (!text || typeof text !== 'string') {
      throw new Error("INVALID SAVE FILE");
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("INVALID SAVE FILE");
    }

    const isFiniteNum = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);
    const isBoundedNum = (v: any, min: number, max: number): v is number => isFiniteNum(v) && v >= min && v <= max;
    const isBoundedInt = (v: any, min: number, max: number): v is number => isFiniteNum(v) && Number.isInteger(v) && v >= min && v <= max;
    const isObject = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isValidColorIdx = (c: any): boolean => c === undefined || isBoundedInt(c, 0, PLAYER_COLORS.length - 1);
    const isValidStringOpt = (s: any, maxLen = 128): boolean => s === undefined || (typeof s === 'string' && s.length <= maxLen);

    if (!isObject(data)) {
      throw new Error("INVALID SAVE FILE");
    }

    let version = 0;
    if (data.format === undefined && data.version === undefined) {
      version = 0;
    } else if (data.version !== undefined) {
      if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 0) {
        throw new Error("INVALID SAVE FILE");
      }
      if (data.version > SAVE_VERSION) {
        throw new Error("UNSUPPORTED SAVE VERSION");
      }
      if (data.version === 1) {
        if (data.format !== SAVE_FORMAT) {
          throw new Error("INVALID SAVE FILE");
        }
        if (!isFiniteNum(data.savedClockMs) || data.savedClockMs < 0) {
          throw new Error("INVALID SAVE FILE");
        }
        if (!isFiniteNum(data.savedAt) || data.savedAt < 0) {
          throw new Error("INVALID SAVE FILE");
        }
      } else if (data.version === 0) {
        throw new Error("INVALID SAVE FILE");
      }
      version = data.version;
    } else {
      throw new Error("INVALID SAVE FILE");
    }

    if (!isObject(data.ui) || !isObject(data.state)) {
      throw new Error("INVALID SAVE FILE");
    }

    const rawUi = data.ui;
    const rawState = data.state;

    if (typeof rawUi.mapId !== 'string' || !MAPS[rawUi.mapId]) {
      throw new Error("UNKNOWN MAP");
    }
    const mapId = rawUi.mapId;
    const mapDef = MAPS[mapId];

    if (rawUi.gameMode !== undefined && !isValidGameMode(rawUi.gameMode)) {
      throw new Error("INVALID SAVE FILE");
    }

    if (rawUi.score !== undefined && !isBoundedInt(rawUi.score, 0, 1_000_000_000)) {
      throw new Error("INVALID SAVE FILE");
    }
    if (rawUi.blocks !== undefined && !isBoundedInt(rawUi.blocks, 0, 10_000)) {
      throw new Error("INVALID SAVE FILE");
    }

    if (rawState.nextBlockScore !== undefined && !isBoundedNum(rawState.nextBlockScore, 0, 100_000_000)) {
      throw new Error("INVALID SAVE FILE");
    }
    if (rawState.nextEntityId !== undefined && !isBoundedInt(rawState.nextEntityId, 1, 1_000_000_000)) {
      throw new Error("INVALID SAVE FILE");
    }
    if (rawState.bouncerCapacity !== undefined && !isBoundedNum(rawState.bouncerCapacity, 0, 100)) {
      throw new Error("INVALID SAVE FILE");
    }
    if (rawState.enemySpawnRate !== undefined && !isBoundedNum(rawState.enemySpawnRate, 100, 60000)) {
      throw new Error("INVALID SAVE FILE");
    }

    if (!isObject(rawState.player)) {
      throw new Error("INVALID SAVE FILE");
    }

    const rawPlayer = rawState.player;
    if (!isFiniteNum(rawPlayer.x) || !isFiniteNum(rawPlayer.y)) {
      throw new Error("INVALID SAVE FILE");
    }
    if (!isBoundedNum(rawPlayer.vx, -10000, 10000) ||
        !isBoundedNum(rawPlayer.vy, -10000, 10000) ||
        !isBoundedNum(rawPlayer.kbvx, -10000, 10000) ||
        !isBoundedNum(rawPlayer.kbvy, -10000, 10000)) {
      throw new Error("INVALID SAVE FILE");
    }

    const rawEnemies = rawState.enemies;
    const rawBullets = rawState.bullets;
    const rawBlocks = rawState.blocks;
    const rawBouncers = rawState.bouncers;
    const rawZones = rawState.zones;

    if (!Array.isArray(rawEnemies) || !Array.isArray(rawBullets) || !Array.isArray(rawBlocks) || !Array.isArray(rawBouncers) || !Array.isArray(rawZones)) {
      throw new Error("INVALID SAVE FILE");
    }

    if (rawBullets.length > 1000 || rawBlocks.length > 500 || rawEnemies.length > 200 || rawBouncers.length > 200 || rawZones.length > 50) {
      throw new Error("INVALID SAVE FILE");
    }

    const loadNow = performance.now();
    const savedClockMs = (version >= 1 && isFiniteNum(data.savedClockMs) && data.savedClockMs >= 0)
      ? data.savedClockMs
      : null;

    const MAX_OFFSET_MS = 24 * 60 * 60 * 1000;
    const adjustTime = (val: any): number => {
      if (!isFiniteNum(val)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (val === 0) return 0;
      if (version >= 1 && savedClockMs !== null) {
        const offset = val - savedClockMs;
        if (Math.abs(offset) > MAX_OFFSET_MS) {
          throw new Error("INVALID SAVE FILE");
        }
        return loadNow + offset;
      }
      return loadNow;
    };

    const cleanGameMode: GameMode = (rawUi.gameMode && isValidGameMode(rawUi.gameMode))
      ? rawUi.gameMode
      : (rawUi.hardMode ? 'hard' : 'normal');

    let px = rawPlayer.x;
    let py = rawPlayer.y;

    px = Math.max(PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, px));
    py = Math.max(PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, py));

    const wallResolved = resolveWallCollisions(px, py, PLAYER_RADIUS, mapDef.walls);
    px = wallResolved.x;
    py = wallResolved.y;

    let stillOverlaps = false;
    for (const wall of mapDef.walls) {
      if (circleOverlapsWall(px, py, PLAYER_RADIUS, wall)) {
        stillOverlaps = true;
        break;
      }
    }
    if (stillOverlaps) {
      const pSpawn = getPlayerSpawn(mapDef);
      px = pSpawn.pos.x;
      py = pSpawn.pos.y;
    }

    let processedZoneKbs: number[] = [];
    if (rawPlayer.processedZoneKbs !== undefined) {
      if (!Array.isArray(rawPlayer.processedZoneKbs) || rawPlayer.processedZoneKbs.length > 50) {
        throw new Error("INVALID SAVE FILE");
      }
      if (version >= 1) {
        processedZoneKbs = rawPlayer.processedZoneKbs.map((t: any) => adjustTime(t));
      } else {
        processedZoneKbs = [];
      }
    } else if (version >= 1) {
      throw new Error("INVALID SAVE FILE");
    }

    let reconstructedDash;
    let reconstructedBuild;

    if (version === 0) {
      reconstructedDash = {
        active: false,
        endTime: 0,
        targetX: 0,
        targetY: 0,
        shieldRadius: 60,
        lastTime: loadNow - DASH_COOLDOWN,
        wasReady: true,
      };
      reconstructedBuild = {
        active: false,
        endTime: 0,
        lastBlockX: 0,
        lastBlockY: 0,
        lastTime: loadNow - BUILD_COOLDOWN,
      };
    } else {
      if (!isObject(rawPlayer.dash) || !isObject(rawPlayer.build)) {
        throw new Error("INVALID SAVE FILE");
      }

      const rawDash = rawPlayer.dash;
      const rawBuild = rawPlayer.build;

      if (typeof rawDash.active !== 'boolean' || typeof rawDash.wasReady !== 'boolean') {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(rawDash.targetX, -100000, 100000) ||
          !isBoundedNum(rawDash.targetY, -100000, 100000) ||
          !isBoundedNum(rawDash.shieldRadius, 1, 500)) {
        throw new Error("INVALID SAVE FILE");
      }

      if (typeof rawBuild.active !== 'boolean') {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(rawBuild.lastBlockX, -100000, 100000) ||
          !isBoundedNum(rawBuild.lastBlockY, -100000, 100000)) {
        throw new Error("INVALID SAVE FILE");
      }

      const dashEndTime = adjustTime(rawDash.endTime);
      const dashLastTime = adjustTime(rawDash.lastTime);
      reconstructedDash = {
        active: rawDash.active && dashEndTime > loadNow,
        endTime: dashEndTime,
        targetX: rawDash.targetX,
        targetY: rawDash.targetY,
        shieldRadius: rawDash.shieldRadius,
        lastTime: dashLastTime,
        wasReady: rawDash.wasReady,
      };

      const buildEndTime = adjustTime(rawBuild.endTime);
      const buildLastTime = adjustTime(rawBuild.lastTime);
      reconstructedBuild = {
        active: rawBuild.active && buildEndTime > loadNow,
        endTime: buildEndTime,
        lastBlockX: rawBuild.lastBlockX,
        lastBlockY: rawBuild.lastBlockY,
        lastTime: buildLastTime,
      };
    }

    let recentBlocks: { key: string; x: number; y: number; timestamp: number }[] = [];
    if (rawPlayer.recentBlocks !== undefined) {
      if (!Array.isArray(rawPlayer.recentBlocks) || rawPlayer.recentBlocks.length > 50) {
        throw new Error("INVALID SAVE FILE");
      }
      if (version >= 1) {
        recentBlocks = rawPlayer.recentBlocks.map((rb: any) => {
          if (!isObject(rb)) throw new Error("INVALID SAVE FILE");
          if (typeof rb.key !== 'string' || rb.key.length > 64) throw new Error("INVALID SAVE FILE");
          if (!isBoundedNum(rb.x, 0, MAP_WIDTH) || !isBoundedNum(rb.y, 0, MAP_HEIGHT)) throw new Error("INVALID SAVE FILE");
          const ts = adjustTime(rb.timestamp);
          return {
            key: rb.key,
            x: rb.x,
            y: rb.y,
            timestamp: ts,
          };
        });
      } else {
        recentBlocks = [];
      }
    } else if (version >= 1) {
      throw new Error("INVALID SAVE FILE");
    }

    const lastShootTime = version === 0 ? (loadNow - 1000) : adjustTime(rawPlayer.lastShoot);

    const reconstructedPlayer = {
      x: px,
      y: py,
      vx: rawPlayer.vx,
      vy: rawPlayer.vy,
      kbvx: rawPlayer.kbvx,
      kbvy: rawPlayer.kbvy,
      processedZoneKbs,
      radius: PLAYER_RADIUS,
      lastShoot: lastShootTime,
      dash: reconstructedDash,
      build: reconstructedBuild,
      recentBlocks,
    };

    let reconstructedSpawners: any[] = [];
    if (version >= 1) {
      if (!Array.isArray(rawState.spawners) || !isBoundedNum(rawState.spawners.length, 0, mapDef.spawners.length)) {
        throw new Error("INVALID SAVE FILE");
      }

      if (cleanGameMode === 'impossible' && rawState.spawners.length !== mapDef.spawners.length) {
        throw new Error("INVALID SAVE FILE");
      }

      const matchedCanonicalIndices = new Set<number>();
      const tempSpawners: any[] = [];

      for (const savedSpawner of rawState.spawners) {
        if (!isObject(savedSpawner)) {
          throw new Error("INVALID SAVE FILE");
        }
        if (!isFiniteNum(savedSpawner.x) || !isFiniteNum(savedSpawner.y)) {
          throw new Error("INVALID SAVE FILE");
        }

        let matchedIdx = -1;
        for (let i = 0; i < mapDef.spawners.length; i++) {
          const canonical = mapDef.spawners[i];
          if (Math.abs(canonical.x - savedSpawner.x) < 0.1 && Math.abs(canonical.y - savedSpawner.y) < 0.1) {
            matchedIdx = i;
            break;
          }
        }

        if (matchedIdx === -1) {
          throw new Error("INVALID SAVE FILE");
        }
        if (matchedCanonicalIndices.has(matchedIdx)) {
          throw new Error("INVALID SAVE FILE");
        }
        matchedCanonicalIndices.add(matchedIdx);

        const canonical = mapDef.spawners[matchedIdx];
        const maxHp = canonical.maxHp ?? canonical.hp ?? 100;

        if (!isBoundedNum(savedSpawner.hp, 0, maxHp)) {
          throw new Error("INVALID SAVE FILE");
        }

        if (cleanGameMode === 'impossible' && savedSpawner.hp !== maxHp) {
          throw new Error("INVALID SAVE FILE");
        }

        const hp = Math.floor(savedSpawner.hp);
        if (hp > 0) {
          tempSpawners.push({
            ...canonical,
            hp,
            maxHp,
          });
        }
      }

      reconstructedSpawners = tempSpawners;
    } else {
      reconstructedSpawners = mapDef.spawners.map((canonicalSpawner, idx) => {
        const savedSpawner = Array.isArray(rawState.spawners) ? rawState.spawners[idx] : null;
        const maxHp = canonicalSpawner.maxHp ?? canonicalSpawner.hp ?? 100;
        let hp = canonicalSpawner.hp;
        if (savedSpawner) {
          if (!isObject(savedSpawner) || !isBoundedNum(savedSpawner.hp, 0, maxHp)) {
            throw new Error("INVALID SAVE FILE");
          }
          hp = Math.floor(savedSpawner.hp);
        }
        return {
          ...canonicalSpawner,
          hp,
          maxHp,
        };
      }).filter(s => (s.hp ?? 0) > 0);
    }

    const reconstructedBlocks = rawBlocks.map((b: any) => {
      if (!isObject(b)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(b.x, 0, MAP_WIDTH) || !isBoundedNum(b.y, 0, MAP_HEIGHT)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(b.size, 1, 500)) throw new Error("INVALID SAVE FILE");
      if (!isValidColorIdx(b.colorIdx)) throw new Error("INVALID SAVE FILE");
      const createdAt = adjustTime(b.createdAt);
      return {
        x: b.x,
        y: b.y,
        size: b.size,
        createdAt,
        colorIdx: b.colorIdx,
        ownerId: 'local',
      };
    });

    const reconstructedBullets = rawBullets.map((b: any) => {
      if (!isObject(b)) throw new Error("INVALID SAVE FILE");
      if (!isValidStringOpt(b.id, 128)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(b.x, 0, MAP_WIDTH) || !isBoundedNum(b.y, 0, MAP_HEIGHT)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(b.dx, -10000, 10000) || !isBoundedNum(b.dy, -10000, 10000)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(b.radius, 1, 100)) throw new Error("INVALID SAVE FILE");
      if (typeof b.isPlayer !== 'boolean' || typeof b.isNeutral !== 'boolean') {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedInt(b.bounceCount, 0, 1000)) throw new Error("INVALID SAVE FILE");
      if (!isValidColorIdx(b.colorIdx)) throw new Error("INVALID SAVE FILE");
      if (b.targetX !== undefined && !isFiniteNum(b.targetX)) throw new Error("INVALID SAVE FILE");
      if (b.targetY !== undefined && !isFiniteNum(b.targetY)) throw new Error("INVALID SAVE FILE");
      if (b.repelMultiplied !== undefined && typeof b.repelMultiplied !== 'boolean') {
        throw new Error("INVALID SAVE FILE");
      }

      let allowedBlockKeys: string[] | undefined = undefined;
      if (b.allowedBlockKeys !== undefined) {
        if (!Array.isArray(b.allowedBlockKeys) || b.allowedBlockKeys.length > 50) {
          throw new Error("INVALID SAVE FILE");
        }
        for (const k of b.allowedBlockKeys) {
          if (typeof k !== 'string' || k.length > 64) throw new Error("INVALID SAVE FILE");
        }
        allowedBlockKeys = b.allowedBlockKeys;
      }

      let leftBlockKeys: string[] | undefined = undefined;
      if (b.leftBlockKeys !== undefined) {
        if (!Array.isArray(b.leftBlockKeys) || b.leftBlockKeys.length > 50) {
          throw new Error("INVALID SAVE FILE");
        }
        for (const k of b.leftBlockKeys) {
          if (typeof k !== 'string' || k.length > 64) throw new Error("INVALID SAVE FILE");
        }
        leftBlockKeys = b.leftBlockKeys;
      }

      const spawnTime = adjustTime(b.spawnTime);

      return {
        id: b.id,
        x: b.x,
        y: b.y,
        dx: b.dx,
        dy: b.dy,
        radius: b.radius,
        isPlayer: b.isPlayer,
        bounceCount: b.bounceCount,
        spawnTime,
        isNeutral: b.isNeutral,
        ownerId: b.isPlayer ? 'local' : (b.ownerId !== undefined && typeof b.ownerId === 'string' && b.ownerId.length <= 128 ? 'local' : undefined),
        colorIdx: b.colorIdx,
        targetX: b.targetX,
        targetY: b.targetY,
        repelMultiplied: Boolean(b.repelMultiplied),
        allowedBlockKeys,
        leftBlockKeys,
      };
    });

    const reconstructedEnemies = rawEnemies.map((e: any) => {
      if (!isObject(e)) throw new Error("INVALID SAVE FILE");
      if (!isValidStringOpt(e.id, 128)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(e.x, 0, MAP_WIDTH) || !isBoundedNum(e.y, 0, MAP_HEIGHT)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(e.radius, 1, 200)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(e.speed, 0, 2000)) throw new Error("INVALID SAVE FILE");
      if (e.targetX !== undefined && !isFiniteNum(e.targetX)) throw new Error("INVALID SAVE FILE");
      if (e.targetY !== undefined && !isFiniteNum(e.targetY)) throw new Error("INVALID SAVE FILE");

      let ekbvx = 0;
      if (e.kbvx !== undefined) {
        if (!isBoundedNum(e.kbvx, -10000, 10000)) throw new Error("INVALID SAVE FILE");
        ekbvx = e.kbvx;
      }

      let ekbvy = 0;
      if (e.kbvy !== undefined) {
        if (!isBoundedNum(e.kbvy, -10000, 10000)) throw new Error("INVALID SAVE FILE");
        ekbvy = e.kbvy;
      }

      let enemyProcessedZoneKbs: number[] = [];
      if (e.processedZoneKbs !== undefined) {
        if (!Array.isArray(e.processedZoneKbs) || e.processedZoneKbs.length > 50) {
          throw new Error("INVALID SAVE FILE");
        }
        if (version >= 1) {
          enemyProcessedZoneKbs = e.processedZoneKbs.map((t: any) => adjustTime(t));
        } else {
          enemyProcessedZoneKbs = [];
        }
      }

      const lastShoot = adjustTime(e.lastShoot);

      return {
        id: e.id,
        x: e.x,
        y: e.y,
        radius: e.radius,
        lastShoot,
        speed: e.speed,
        targetX: e.targetX,
        targetY: e.targetY,
        kbvx: ekbvx,
        kbvy: ekbvy,
        processedZoneKbs: enemyProcessedZoneKbs,
      };
    });

    const reconstructedBouncers = rawBouncers.map((b: any) => {
      if (!isObject(b)) throw new Error("INVALID SAVE FILE");
      if (!isValidStringOpt(b.id, 128)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(b.x, 0, MAP_WIDTH) || !isBoundedNum(b.y, 0, MAP_HEIGHT)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(b.dx, -10000, 10000) || !isBoundedNum(b.dy, -10000, 10000)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(b.size, 0.1, 100)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(b.radius, 1, 200)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(b.speed, 0, 2000)) throw new Error("INVALID SAVE FILE");
      if (b.targetX !== undefined && !isFiniteNum(b.targetX)) throw new Error("INVALID SAVE FILE");
      if (b.targetY !== undefined && !isFiniteNum(b.targetY)) throw new Error("INVALID SAVE FILE");

      let bkbvx = 0;
      if (b.kbvx !== undefined) {
        if (!isBoundedNum(b.kbvx, -10000, 10000)) throw new Error("INVALID SAVE FILE");
        bkbvx = b.kbvx;
      }

      let bkbvy = 0;
      if (b.kbvy !== undefined) {
        if (!isBoundedNum(b.kbvy, -10000, 10000)) throw new Error("INVALID SAVE FILE");
        bkbvy = b.kbvy;
      }

      let bouncerProcessedZoneKbs: number[] = [];
      if (b.processedZoneKbs !== undefined) {
        if (!Array.isArray(b.processedZoneKbs) || b.processedZoneKbs.length > 50) {
          throw new Error("INVALID SAVE FILE");
        }
        if (version >= 1) {
          bouncerProcessedZoneKbs = b.processedZoneKbs.map((t: any) => adjustTime(t));
        } else {
          bouncerProcessedZoneKbs = [];
        }
      }

      const lastDirChange = adjustTime(b.lastDirChange);
      const lastMultiply = adjustTime(b.lastMultiply);

      return {
        id: b.id,
        x: b.x,
        y: b.y,
        dx: b.dx,
        dy: b.dy,
        size: b.size,
        radius: b.radius,
        speed: b.speed,
        lastDirChange,
        lastMultiply,
        targetX: b.targetX,
        targetY: b.targetY,
        kbvx: bkbvx,
        kbvy: bkbvy,
        processedZoneKbs: bouncerProcessedZoneKbs,
      };
    });

    const reconstructedZones = rawZones.map((z: any) => {
      if (!isObject(z)) throw new Error("INVALID SAVE FILE");
      if (!isBoundedNum(z.x, 0, MAP_WIDTH) || !isBoundedNum(z.y, 0, MAP_HEIGHT)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(z.innerRadius, 0, 1000) || !isBoundedNum(z.outerRadius, 1, 2000)) {
        throw new Error("INVALID SAVE FILE");
      }
      if (!isBoundedNum(z.duration, 0, 60000)) throw new Error("INVALID SAVE FILE");
      if (!isValidColorIdx(z.colorIdx)) throw new Error("INVALID SAVE FILE");
      if (z.type !== undefined && z.type !== 'repel') throw new Error("INVALID SAVE FILE");

      const spawnTime = adjustTime(z.spawnTime);

      return {
        x: z.x,
        y: z.y,
        innerRadius: z.innerRadius,
        outerRadius: z.outerRadius,
        duration: z.duration,
        spawnTime,
        ownerId: 'local',
        colorIdx: z.colorIdx,
        type: z.type === 'repel' ? ('repel' as const) : undefined,
      };
    });

    const spawnersLeftCount = reconstructedSpawners.filter(s => (s.hp ?? 0) > 0).length;

    let specialCooldown = 0;
    if (reconstructedDash.active) {
      specialCooldown = Math.max(0, Math.ceil((reconstructedDash.endTime - loadNow) / 1000));
    } else if (reconstructedDash.endTime > 0) {
      specialCooldown = Math.max(0, Math.ceil((DASH_COOLDOWN - (loadNow - reconstructedDash.endTime)) / 1000));
    } else {
      specialCooldown = Math.max(0, Math.ceil((DASH_COOLDOWN - (loadNow - reconstructedDash.lastTime)) / 1000));
    }

    let buildCooldown = 0;
    if (reconstructedBuild.active) {
      buildCooldown = Math.max(0, Math.ceil((reconstructedBuild.endTime - loadNow) / 1000));
    } else if (reconstructedBuild.endTime > 0) {
      buildCooldown = Math.max(0, Math.ceil((BUILD_COOLDOWN - (loadNow - reconstructedBuild.endTime)) / 1000));
    } else {
      buildCooldown = Math.max(0, Math.ceil((BUILD_COOLDOWN - (loadNow - reconstructedBuild.lastTime)) / 1000));
    }

    const cleanUi = {
      status: 'PAUSED' as const,
      score: rawUi.score !== undefined ? rawUi.score : 0,
      deviceType: isMobileRef.current ? ('mobile' as const) : ('desktop' as const),
      activeTool: rawUi.activeTool === 'build' ? ('build' as const) : ('special' as const),
      blocks: rawUi.blocks !== undefined ? rawUi.blocks : 50,
      spawnersLeft: spawnersLeftCount,
      mapId: mapId,
      hardMode: cleanGameMode !== 'normal',
      gameMode: cleanGameMode,
      buttonCounters: {
        special: specialCooldown,
        build: buildCooldown,
      }
    };

    const camW = canvasRef.current?.width || containerSize.width || 1200;
    const camH = canvasRef.current?.height || containerSize.height || 800;

    const lastEnemySpawnTime = adjustTime(rawState.lastEnemySpawn);

    const cleanState = {
      player: reconstructedPlayer,
      multiplayerPlayers: {},
      matchPhase: 'PLAYING' as const,
      finalRunnerId: null,
      finalRunDeadline: null,
      openingProtectionDeadline: null,
      winnerId: null,
      matchPlayers: {},
      playerActionAuthority: {},
      forceBroadcast: false,
      blocks: reconstructedBlocks,
      nextBlockScore: rawState.nextBlockScore !== undefined ? rawState.nextBlockScore : 100,
      bullets: reconstructedBullets,
      enemies: reconstructedEnemies,
      bouncers: reconstructedBouncers,
      zones: reconstructedZones,
      nextEntityId: rawState.nextEntityId !== undefined ? rawState.nextEntityId : 1,
      bouncerCapacity: rawState.bouncerCapacity !== undefined ? rawState.bouncerCapacity : 2,
      spawners: reconstructedSpawners,
      keys: { w: false, a: false, s: false, d: false },
      mouse: { x: 0, y: 0, worldX: 0, worldY: 0, down: false, justDown: false, rightDown: false, rightJustDown: false },
      touches: {
        left: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0 },
        right: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0, justReleased: false, releaseDx: 0, releaseDy: 0, aimLength: 0, startTime: 0 },
        tap: { active: false, x: 0, y: 0 }
      },
      camera: {
        x: px - camW / 2,
        y: py - camH / 2,
        width: camW,
        height: camH,
        z: 1,
      },
      lastBroadcastTime: 0,
      particles: [],
      trails: [],
      shockwaves: [],
      floatingTexts: [],
      shake: 0,
      lastTime: loadNow,
      lastEnemySpawn: lastEnemySpawnTime,
      enemySpawnRate: rawState.enemySpawnRate !== undefined ? rawState.enemySpawnRate : 3000,
      gameMode: cleanGameMode,
      hardMode: cleanGameMode !== 'normal',
      tutorial: { active: false, spawnerIndex: null, enemySpawned: false, timer: 0 },
    };

    return {
      cleanUi,
      cleanState,
      walls: mapDef.walls,
    };
  };

  const applyReconstructedSave = (reconstructed: ReturnType<typeof parseAndReconstructSave>) => {
    resetEndPresentation();
    // Set activeWalls from the reconstructed map
    activeWalls = reconstructed.walls;

    // Copy the reconstructed state into the existing live state object
    const liveState = stateRef.current;
    Object.assign(liveState, reconstructed.cleanState);

    // Treat the newly loaded PAUSED state as beginning a new pause at the load time
    accumulatedPauseOffsetRef.current = 0;
    pauseStartRef.current = performance.now();

    // Clear pulse and spawner-pointer effects
    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
    setPulseSpawnerCounter(false);
    setPulseKey(0);
    spawnerPointerAnimRef.current = null;

    // Release all inputs using the newly copied live state
    releaseAllInputs();

    // Apply reconstructed.cleanUi to uiRef.current and setUiState
    uiRef.current = reconstructed.cleanUi;
    setUiState(reconstructed.cleanUi);
  };

  const handleQuickLoad = () => {
    if (mpRef.current.roomId) return;
    if (uiRef.current.status !== 'PAUSED') {
      console.warn("[Save Lifecycle] Quick load attempted when not paused");
      return;
    }

    if (!quickSaveRef.current) {
      showPauseFeedback("INVALID QUICK SAVE", "error");
      return;
    }

    if (quickSaveRef.current.runId !== activeSinglePlayerRunIdRef.current) {
      console.error(`[Save Lifecycle] Quick Load failed: Run ID mismatch. Expected ${activeSinglePlayerRunIdRef.current}, got ${quickSaveRef.current.runId}`);
      invalidateQuickSave();
      showPauseFeedback("INVALID QUICK SAVE", "error");
      return;
    }

    let stage = "dry validation";
    try {
      const serialized = quickSaveRef.current.serialized;

      // Enforce MAX_SAVE_FILE_BYTES on the stored string
      const bytes = getByteSize(serialized);
      if (bytes > MAX_SAVE_FILE_BYTES) {
        showPauseFeedback("INVALID QUICK SAVE", "error");
        return;
      }

      // Dry parse first, if it fails, it will throw and the live game won't change
      const reconstructed = parseAndReconstructSave(serialized);

      // Now apply successfully
      stage = "applying a save";
      applyReconstructedSave(reconstructed);

      // Close unrelated confirmations if active
      setConfirmResign(false);

      showPauseFeedback("QUICK SAVE LOADED", "success");
    } catch (err: any) {
      console.error(`[Save Lifecycle] Failure during stage "${stage}":`, err);
      showPauseFeedback("INVALID QUICK SAVE", "error");
    }
  };

  const handleLoadMatch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (mpRef.current.roomId) {
      setLoadError("INVALID SAVE FILE");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > MAX_SAVE_FILE_BYTES) {
      console.error(`[Save Lifecycle] Failure during stage "serialization/size": file size ${file.size} exceeds maximum`);
      setLoadError("FILE TOO LARGE");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => {
      console.error(`[Save Lifecycle] Failure during stage "serialization/size": FileReader error`);
      setLoadError("INVALID SAVE FILE");
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    reader.onabort = () => {
      console.error(`[Save Lifecycle] Failure during stage "serialization/size": FileReader aborted`);
      setLoadError("INVALID SAVE FILE");
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    reader.onload = (event) => {
      let stage = "dry validation";
      try {
        const text = event.target?.result as string;
        const reconstructed = parseAndReconstructSave(text);

        stage = "applying a save";
        applyReconstructedSave(reconstructed);
        setLoadError(null);

        // A downloaded save file is successfully validated and applied, because that loaded file becomes a new run.
        activeSinglePlayerRunIdRef.current += 1;
        invalidateQuickSave();
      } catch (err: any) {
        console.error(`[Save Lifecycle] Failure during stage "${stage}":`, err);
        const allowedMessages = ["INVALID SAVE FILE", "FILE TOO LARGE", "UNSUPPORTED SAVE VERSION", "UNKNOWN MAP"];
        const msg = (err && typeof err.message === 'string' && allowedMessages.includes(err.message))
          ? err.message
          : "INVALID SAVE FILE";
        setLoadError(msg);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    try {
      reader.readAsText(file);
    } catch (err: any) {
      console.error(`[Save Lifecycle] Failure during stage "serialization/size": readAsText failed`, err);
      setLoadError("INVALID SAVE FILE");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const selectAndScrollToMap = (mapId: string) => {
    setUiState(prev => ({ ...prev, mapId }));

    setTimeout(() => {
      if (mapListRef.current) {
        const container = mapListRef.current;
        const button = container.querySelector(`[data-map-id="${mapId}"]`) as HTMLElement;
        if (button) {
          const containerRect = container.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();

          const isFullyVisible = (
            buttonRect.top >= containerRect.top - 1 &&
            buttonRect.bottom <= containerRect.bottom + 1
          );

          if (!isFullyVisible) {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    }, 50);
  };

  const isValidRoomResponse = useCallback((
    res: any,
    capturedSocket: Socket | null,
    expectedRoom: string | null,
    type: 'create' | 'join'
  ): boolean => {
    if (!res || typeof res !== 'object') return false;
    if (res.success !== true) return false;
    if (!capturedSocket || typeof capturedSocket.id !== 'string' || capturedSocket.id.length === 0) return false;

    if (typeof res.roomId !== 'string') return false;
    const normRoomId = res.roomId.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normRoomId)) return false;

    if (type === 'join') {
      if (!expectedRoom || normRoomId !== expectedRoom) return false;
    }

    if (typeof res.roundId !== 'number' || !Number.isFinite(res.roundId) || !Number.isInteger(res.roundId) || res.roundId < 0) return false;

    const rosterResult = validateRoster(res.players, capturedSocket.id);
    if (!rosterResult) return false;

    const { selfEntry, otherPlayers } = rosterResult;

    const singleHostId = selfEntry.isHost
      ? selfEntry.id
      : Object.entries(otherPlayers).find(([_, p]) => p.isHost)?.[0];

    if (!singleHostId) return false;

    if (typeof res.hostId !== 'string' || res.hostId !== singleHostId) return false;
    if (typeof res.isHost !== 'boolean' || res.isHost !== selfEntry.isHost) return false;
    if (typeof res.colorIdx !== 'number' || res.colorIdx !== selfEntry.colorIdx) return false;

    if (type === 'create') {
      if (res.isHost !== true || res.hostId !== capturedSocket.id) return false;
    }

    if (!isValidResumeToken(res.resumeToken)) return false;
    if (!res.matchSettings || typeof res.matchSettings !== 'object') return false;
    if (!isValidMapId(res.matchSettings.mapId) || !isValidGameMode(res.matchSettings.gameMode)) return false;
    return true;
  }, [isValidResumeToken]);

  const finishRoomRequest = useCallback(() => {
    roomRequestInFlightRef.current = false;
    setPendingRoomRequest(null);
  }, []);

  const executeRoomRequest = useCallback((
    type: 'create' | 'join',
    eventName: 'create_room' | 'join_room',
    payload: any
  ) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setMpState(prev => ({ ...prev, error: 'NOT CONNECTED TO SERVER' }));
      return;
    }

    if (roomRequestInFlightRef.current) {
      return;
    }

    const currentGen = ++roomRequestGenerationRef.current;
    roomRequestInFlightRef.current = true;
    setPendingRoomRequest(type);

    setMpError(null);
    setMpState(prev => ({ ...prev, error: '' }));

    const expectedRoom = type === 'join' && typeof payload?.code === 'string'
      ? payload.code.trim().toUpperCase()
      : null;

    const handleResponse = (res: any) => {
      const isStale = currentGen !== roomRequestGenerationRef.current ||
        socketRef.current !== socket ||
        !socket.connected;

      if (isStale) {
        if (
          socketRef.current === socket &&
          socket.connected &&
          res &&
          res.success === true &&
          typeof res.roomId === 'string'
        ) {
          const returnedRoomId = res.roomId.trim().toUpperCase();
          if (
            /^[A-Z0-9]{4}$/.test(returnedRoomId) &&
            mpRef.current.roomId !== returnedRoomId
          ) {
            socket.emit('leave_room', returnedRoomId);
          }
        }
        return;
      }

      if (res && res.success === true) {
        if (isValidRoomResponse(res, socket, expectedRoom, type)) {
          const cleanRoom = res.roomId.trim().toUpperCase();
          const rosterResult = validateRoster(res.players, socket.id)!;

          if (mpRef.current.roomId === cleanRoom) {
            mpRef.current.roomId = cleanRoom;
            currentRoomRoundIdRef.current = res.roundId;
            activeMultiplayerRoundIdRef.current = 0;

            setPlayerProfile({
              name: rosterResult.selfEntry.name,
              colorIdx: rosterResult.selfEntry.colorIdx
            });
            if (!isEditingCallsignRef.current) {
              setCallsignDraft(rosterResult.selfEntry.name);
            }

            lobbyPlayersRef.current = rosterResult.otherPlayers;
            setLobbyPlayers(rosterResult.otherPlayers);

            resumeSessionRef.current = {
              roomId: cleanRoom,
              resumeToken: res.resumeToken
            };

            applyAuthoritativeMatchSettings(res.matchSettings);

            setMpError(null);
            setMpState(prev => ({
              ...prev,
              roomId: cleanRoom,
              joinCode: cleanRoom,
              error: ''
            }));

            handleHostRoleTransitionRef.current(rosterResult.selfEntry.isHost);
            finishRoomRequest();
          } else {
            const prevRoom = mpRef.current.roomId;
            if (prevRoom && prevRoom !== cleanRoom && socket.connected) {
              socket.emit('leave_room', prevRoom);
            }

            resetHostClockAnchor();
            clearPendingGuestShots(true);
            clearPendingAbilityRequests();
            releaseAllInputs();
            cancelPendingMatchSettingsUpdate();
            closeMpMapSelector();

            currentRoomRoundIdRef.current = 0;
            activeMultiplayerRoundIdRef.current = 0;
            invalidateStartRequestGeneration();
            awaitingResumeSnapshotRef.current = false;

            mpRef.current.roomId = cleanRoom;
            currentRoomRoundIdRef.current = res.roundId;

            setPlayerProfile({
              name: rosterResult.selfEntry.name,
              colorIdx: rosterResult.selfEntry.colorIdx
            });
            if (!isEditingCallsignRef.current) {
              setCallsignDraft(rosterResult.selfEntry.name);
            }

            lobbyPlayersRef.current = rosterResult.otherPlayers;
            setLobbyPlayers(rosterResult.otherPlayers);

            setMpError(null);
            setMpState(prev => ({
              ...prev,
              roomId: cleanRoom,
              joinCode: cleanRoom,
              error: ''
            }));

            resumeSessionRef.current = {
              roomId: cleanRoom,
              resumeToken: res.resumeToken
            };

            applyAuthoritativeMatchSettings(res.matchSettings);

            handleHostRoleTransitionRef.current(rosterResult.selfEntry.isHost);

            if (type === 'create') {
              setActiveLobbyTab('invite');
            } else {
              setActiveLobbyTab('players');
            }

            setUiState(prev => {
              const nextUi = { ...prev, status: 'LOBBY' as const };
              uiRef.current = nextUi;
              return nextUi;
            });

            finishRoomRequest();
          }
        } else {
          if (
            typeof res.roomId === 'string' &&
            /^[A-Z0-9]{4}$/.test(res.roomId.trim().toUpperCase()) &&
            socketRef.current === socket &&
            socket.connected
          ) {
            socket.emit('leave_room', res.roomId.trim().toUpperCase());
          }

          clearResumeSession();
          clearPendingGuestShots(true);
          clearPendingAbilityRequests();
          releaseAllInputs();
          cancelPendingMatchSettingsUpdate();
          closeMpMapSelector();
          resetHostClockAnchor();

          currentRoomRoundIdRef.current = 0;
          activeMultiplayerRoundIdRef.current = 0;
          invalidateStartRequestGeneration();
          awaitingResumeSnapshotRef.current = false;

          lobbyPlayersRef.current = {};
          setLobbyPlayers({});

          mpRef.current.roomId = null;
          mpRef.current.isHost = false;

          setMpError('INVALID SERVER RESPONSE');
          setMpState(prev => ({
            ...prev,
            roomId: null,
            isHost: false,
            error: 'INVALID SERVER RESPONSE'
          }));

          setUiState(prev => {
            const nextUi = { ...prev, status: 'LOBBY' as const };
            uiRef.current = nextUi;
            return nextUi;
          });

          finishRoomRequest();
        }
      } else {
        finishRoomRequest();

        const rawErr = res?.error;
        let mappedMsg = type === 'create' ? 'CREATE FAILED' : 'JOIN FAILED';

        if (rawErr === 'ROOM_NOT_FOUND') {
          mappedMsg = 'ROOM NOT FOUND';
        } else if (rawErr === 'ROOM_FULL') {
          mappedMsg = 'ROOM IS FULL';
        } else if (rawErr === 'MATCH_IN_PROGRESS') {
          mappedMsg = 'MATCH ALREADY IN PROGRESS';
        } else if (rawErr === 'INVALID_ROOM_CODE') {
          mappedMsg = 'INVALID ROOM CODE';
        }

        setMpError(mappedMsg);
        setMpState(prev => ({ ...prev, error: mappedMsg }));
      }
    };

    if (eventName === 'create_room') {
      socket.emit('create_room', payload, handleResponse);
    } else {
      socket.emit('join_room', payload.code, payload.profile, handleResponse);
    }
  }, [isValidRoomResponse, finishRoomRequest, applyAuthoritativeMatchSettings, cancelPendingMatchSettingsUpdate, closeMpMapSelector, clearPendingGuestShots, clearPendingAbilityRequests, releaseAllInputs, clearResumeSession]);

  const createRoom = useCallback(() => {
    const initialMode: GameMode = uiState.hardMode ? 'hard' : 'normal';
    const initialSettings: MatchSettings = {
      mapId: uiState.mapId,
      gameMode: initialMode,
    };
    executeRoomRequest('create', 'create_room', {
      name: playerProfileRef.current.name,
      matchSettings: initialSettings
    });
  }, [uiState.hardMode, uiState.mapId, executeRoomRequest]);

  const joinRoom = useCallback(() => {
    const code = (mpState.joinCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      setMpError('ENTER A 4-CHARACTER ROOM CODE');
      setMpState(prev => ({ ...prev, error: 'ENTER A 4-CHARACTER ROOM CODE' }));
      return;
    }
    executeRoomRequest('join', 'join_room', {
      code,
      profile: { name: playerProfileRef.current.name }
    });
  }, [mpState.joinCode, executeRoomRequest]);

  const requestMatchSettingsUpdate = useCallback((proposed: MatchSettings): Promise<boolean> => {
    cancelPendingMatchSettingsUpdate();

    if (
      !mpRef.current.isHost ||
      !mpRef.current.roomId ||
      !socketRef.current?.connected ||
      !proposed ||
      typeof proposed !== 'object' ||
      !isValidMapId(proposed.mapId) ||
      !isValidGameMode(proposed.gameMode)
    ) {
      return Promise.resolve(false);
    }

    const currentRoomId = mpRef.current.roomId;
    const seq = ++pendingUpdateSeqRef.current;

    setMatchSettingsPending(true);

    return new Promise<boolean>((resolve) => {
      let isResolved = false;

      const activeReq: ActiveMatchSettingsRequest = {
        seq,
        roomId: currentRoomId,
        timeoutId: null,
        resolve: (val: boolean) => {
          if (!isResolved) {
            isResolved = true;
            resolve(val);
          }
        },
        isResolved: false,
      };

      const timeoutId = setTimeout(() => {
        if (
          activeMatchSettingsRequestRef.current === activeReq &&
          pendingUpdateSeqRef.current === seq &&
          mpRef.current.roomId === currentRoomId &&
          !activeReq.isResolved
        ) {
          activeReq.isResolved = true;
          activeMatchSettingsRequestRef.current = null;
          matchSettingsUpdatePendingRef.current = false;
          setIsMatchSettingsUpdatePending(false);
          setMpError('SETTINGS SYNC TIMEOUT');
          activeReq.resolve(false);
        }
      }, 5000);

      activeReq.timeoutId = timeoutId;
      activeMatchSettingsRequestRef.current = activeReq;

      socketRef.current?.emit(
        'update_match_settings',
        currentRoomId,
        proposed,
        (res: any) => {
          if (
            activeMatchSettingsRequestRef.current !== activeReq ||
            pendingUpdateSeqRef.current !== seq ||
            mpRef.current.roomId !== currentRoomId ||
            activeReq.isResolved
          ) {
            return;
          }

          if (activeReq.timeoutId) {
            clearTimeout(activeReq.timeoutId);
            activeReq.timeoutId = null;
          }
          activeReq.isResolved = true;
          activeMatchSettingsRequestRef.current = null;
          matchSettingsUpdatePendingRef.current = false;
          setIsMatchSettingsUpdatePending(false);

          if (
            res &&
            res.success === true &&
            typeof res.roomId === 'string' &&
            res.roomId.trim().toUpperCase() === currentRoomId &&
            res.roundId === currentRoomRoundIdRef.current &&
            res.matchSettings &&
            typeof res.matchSettings === 'object' &&
            isValidMapId(res.matchSettings.mapId) &&
            isValidGameMode(res.matchSettings.gameMode)
          ) {
            const applied = applyAuthoritativeMatchSettings(res.matchSettings);
            if (applied) {
              setMpError(null);
              activeReq.resolve(true);
            } else {
              setMpError('SETTINGS UPDATE FAILED: INVALID SETTINGS');
              activeReq.resolve(false);
            }
          } else {
            const err = res?.error || 'UPDATE_FAILED';
            setMpError(`SETTINGS UPDATE FAILED: ${err}`);
            activeReq.resolve(false);
          }
        }
      );
    });
  }, [applyAuthoritativeMatchSettings, cancelPendingMatchSettingsUpdate, setMatchSettingsPending]);

  const selectAndScrollToMpMap = useCallback((mapId: string) => {
    setPendingLobbyMapId(mapId);
    setTimeout(() => {
      if (mpMapListRef.current) {
        const container = mpMapListRef.current;
        const button = container.querySelector(`[data-mp-map-id="${mapId}"]`) as HTMLElement;
        if (button) {
          const containerRect = container.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          const isFullyVisible = (
            buttonRect.top >= containerRect.top - 1 &&
            buttonRect.bottom <= containerRect.bottom + 1
          );
          if (!isFullyVisible) {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    }, 50);
  }, []);

  const handleOpenMpMapSelector = useCallback(() => {
    if (!mpState.isHost || isMatchSettingsUpdatePending) return;
    const currentMap = lobbyMatchSettingsRef.current.mapId;
    setPendingLobbyMapId(currentMap);
    setIsMpMapSelectOpen(true);
    selectAndScrollToMpMap(currentMap);
  }, [mpState.isHost, isMatchSettingsUpdatePending, selectAndScrollToMpMap]);

  const handleConfirmMpMap = useCallback(async () => {
    if (
      !mpRef.current.isHost ||
      !mpRef.current.roomId ||
      !socketRef.current?.connected ||
      matchSettingsUpdatePendingRef.current ||
      !pendingLobbyMapId ||
      !MAPS[pendingLobbyMapId]
    ) {
      return;
    }
    const targetMap = pendingLobbyMapId;
    const latestMode = lobbyMatchSettingsRef.current.gameMode;
    const success = await requestMatchSettingsUpdate({
      mapId: targetMap,
      gameMode: latestMode,
    });
    if (success) {
      closeMpMapSelector();
      setActiveLobbyTab('match');
    }
  }, [pendingLobbyMapId, requestMatchSettingsUpdate, closeMpMapSelector]);

  const handleRandomMpMap = useCallback(() => {
    if (!mpRef.current.isHost || matchSettingsUpdatePendingRef.current) return;
    const keys = Object.keys(MAPS);
    if (keys.length > 0) {
      const randomKey = keys[Math.floor(Math.random() * keys.length)];
      selectAndScrollToMpMap(randomKey);
    }
  }, [selectAndScrollToMpMap]);

  const resetGame = (
    deviceType?: 'desktop' | 'mobile',
    mapId?: string,
    gameModeOrHardMode?: GameMode | boolean,
    spawnAssignments?: Record<string, { x: number; y: number }>
  ): boolean => {
    resetEndPresentation();
    clearPendingGuestShots();
    clearPendingAbilityRequests();
    const dType = deviceType || uiRef.current.deviceType;
    const selectedMapId = mapId || uiRef.current.mapId;
    const isMultiplayer = !!mpRef.current.roomId;

    let selectedGameMode: GameMode = 'normal';
    if (typeof gameModeOrHardMode === 'string' && isValidGameMode(gameModeOrHardMode)) {
      selectedGameMode = gameModeOrHardMode;
    } else if (typeof gameModeOrHardMode === 'boolean') {
      selectedGameMode = gameModeOrHardMode ? 'hard' : 'normal';
    } else {
      selectedGameMode = uiRef.current.gameMode || (uiRef.current.hardMode ? 'hard' : 'normal');
    }

    const isHardMode = selectedGameMode !== 'normal';
    const mapDef = MAPS[selectedMapId] || MAPS.classic_arena;

    const myId = socketRef.current?.id || 'host';
    let startPos = { x: 500, y: 500 };
    let tutIdx: number | null = null;
    if (isMultiplayer) {
      if (!spawnAssignments || !spawnAssignments[myId]) {
        if (import.meta.env.DEV) {
          console.error("resetGame aborted: missing spawn assignment for local player", myId, spawnAssignments);
        }
        return false;
      }
      startPos = spawnAssignments[myId];
    } else {
      const pSpawn = getPlayerSpawn(mapDef);
      startPos = pSpawn.pos;
      tutIdx = pSpawn.tutorialSpawnerIndex;
    }

    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
    setPulseSpawnerCounter(false);
    setPulseKey(0);
    spawnerPointerAnimRef.current = null;
    activeWalls = mapDef.walls;

    const state = stateRef.current;
    state.gameMode = selectedGameMode;
    state.hardMode = isHardMode;
    state.nextEntityId = 1;

    state.tutorial = {
      active: !isMultiplayer,
      spawnerIndex: tutIdx,
      enemySpawned: false,
      timer: 0
    };

    state.player.x = startPos.x;
    state.player.y = startPos.y;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.kbvx = 0;
    state.player.kbvy = 0;
    state.player.processedZoneKbs = [];
    state.player.lastShoot = performance.now();
    state.player.dash = { active: false, endTime: 0, targetX: 0, targetY: 0, shieldRadius: 60, lastTime: performance.now() - DASH_COOLDOWN, wasReady: true };
    state.player.build = { active: false, endTime: 0, lastBlockX: 0, lastBlockY: 0, lastTime: performance.now() - BUILD_COOLDOWN };
    state.blocks = [];
    state.nextBlockScore = 100;
    state.bullets = [];
    state.enemies = [];
    state.bouncers = [];
    state.zones = [];

    const playerSpawnsToAvoid = isMultiplayer && spawnAssignments
      ? Object.values(spawnAssignments)
      : [startPos];

    for (let i = 0; i < 2; i++) {
      const spawn = getSafeSpawn(mapDef.walls, 60, playerSpawnsToAvoid, 200);
      if (spawn) {
        const angle = Math.random() * Math.PI * 2;
        state.bouncers.push({ id: 'b_' + state.nextEntityId++, x: spawn.x, y: spawn.y, dx: Math.cos(angle), dy: Math.sin(angle), size: 1, radius: 24, speed: ENEMY_SPEED + Math.random() * 20, lastDirChange: performance.now(), lastMultiply: performance.now() });
      }
    }
    state.bouncerCapacity = 2;
    state.spawners = mapDef.spawners.map((s: any) => ({
      ...s,
      hp: selectedGameMode === 'impossible' ? (s.maxHp ?? s.hp ?? 100) : s.hp
    }));
    state.particles = [];
    state.trails = [];
    state.shockwaves = [];
    state.floatingTexts = [];
    state.shake = 0;
    state.lastTime = performance.now();
    state.lastEnemySpawn = performance.now();
    state.enemySpawnRate = 3000;
    pauseStartRef.current = null;
    accumulatedPauseOffsetRef.current = 0;
    releaseAllInputs();

    const uiHardMode = isMultiplayer ? (selectedGameMode !== 'normal') : isHardMode;
    const newUi = { status: 'PLAYING' as const, score: 0, deviceType: dType, activeTool: 'special' as const, blocks: 50, spawnersLeft: state.spawners.length, mapId: selectedMapId, hardMode: uiHardMode, gameMode: selectedGameMode, buttonCounters: { special: 0, build: 0 } };
    uiRef.current = newUi;
    setUiState(newUi);

    if (isMultiplayer) {
      multiplayerWorldPhaseAnchorRef.current = {
        phaseAtAnchor: 0,
        localTimeAtAnchor: performance.now(),
        initialized: true,
      };
      state.matchPhase = 'PLAYING';
      state.finalRunnerId = null;
      state.finalRunDeadline = null;
      state.winnerId = null;
      mappedClientDeadlineRef.current = null;
      setCurrentMatchPhase('PLAYING');

      if (mpRef.current.isHost) {
        state.openingProtectionDeadline = performance.now() + 1500;
        mappedProtectionDeadlineRef.current = null;
        awaitingOpeningProtectionAuthorityRef.current = false;
      } else {
        state.openingProtectionDeadline = null;
        mappedProtectionDeadlineRef.current = performance.now() + 1500;
        awaitingOpeningProtectionAuthorityRef.current = true;
      }

      const initialMatchPlayers: Record<string, { id: string, name: string, colorIdx: number, score: number, isDead: boolean, isDisconnected?: boolean }> = {};

      initialMatchPlayers[myId] = {
        id: myId,
        name: playerProfileRef.current.name || 'PLAYER 1',
        colorIdx: playerProfileRef.current.colorIdx || 0,
        score: 0,
        isDead: false,
      };

      if (spawnAssignments) {
        state.multiplayerPlayers = {};
        for (const pid in spawnAssignments) {
          if (pid !== myId) {
            const assignedPos = spawnAssignments[pid];
            const existingColor = lobbyPlayersRef.current[pid]?.colorIdx ?? state.matchPlayers[pid]?.colorIdx ?? 0;
            const existingName = lobbyPlayersRef.current[pid]?.name ?? state.matchPlayers[pid]?.name ?? 'PLAYER';

            state.multiplayerPlayers[pid] = {
              x: assignedPos.x,
              y: assignedPos.y,
              radius: PLAYER_RADIUS,
              isDash: false,
              name: existingName,
              colorIdx: existingColor,
              isDead: false
            };

            initialMatchPlayers[pid] = {
              id: pid,
              name: existingName,
              colorIdx: existingColor,
              score: 0,
              isDead: false,
            };
          }
        }
      } else {
        for (const pid in state.multiplayerPlayers) {
          if (state.multiplayerPlayers[pid]) {
            state.multiplayerPlayers[pid].isDead = false;
            initialMatchPlayers[pid] = {
              id: pid,
              name: state.multiplayerPlayers[pid].name || 'PLAYER',
              colorIdx: state.multiplayerPlayers[pid].colorIdx || 0,
              score: 0,
              isDead: false,
            };
          }
        }

        for (const lpid in lobbyPlayersRef.current) {
          if (!initialMatchPlayers[lpid]) {
            initialMatchPlayers[lpid] = {
              id: lpid,
              name: lobbyPlayersRef.current[lpid].name || 'PLAYER',
              colorIdx: lobbyPlayersRef.current[lpid].colorIdx || 0,
              score: 0,
              isDead: false,
            };
          }
        }
      }

      state.matchPlayers = initialMatchPlayers;
      state.playerActionAuthority = {};
      for (const pid in initialMatchPlayers) {
        state.playerActionAuthority[pid] = {
          lastShootAt: 0,
          specialActiveUntil: 0,
          specialReadyAt: 0,
          buildActiveUntil: 0,
          buildReadyAt: 0
        };
      }
      state.forceBroadcast = true;
    } else {
      state.openingProtectionDeadline = null;
      mappedProtectionDeadlineRef.current = null;
      awaitingOpeningProtectionAuthorityRef.current = false;
    }

    return true;
  };

  const startFreshSinglePlayerRun = (mapId?: string, gameMode?: GameMode): boolean => {
    if (mpRef.current.roomId) return false;

    // Validate/fallback the requested map and game mode using existing definitions
    const selectedMapId = mapId && MAPS[mapId] ? mapId : (uiRef.current.mapId && MAPS[uiRef.current.mapId] ? uiRef.current.mapId : 'classic_arena');
    const selectedGameMode: GameMode = gameMode && isValidGameMode(gameMode) ? gameMode : (uiRef.current.gameMode && isValidGameMode(uiRef.current.gameMode) ? uiRef.current.gameMode : (uiRef.current.hardMode ? 'hard' : 'normal'));

    // Clear any active pause-feedback timeout before clearing its state
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setPauseMenuFeedback(null);

    // Close single-player overlays and stale confirmations
    setConfirmResign(false);
    confirmResignRef.current = false;
    setConfirmLeaveMatches(false);
    setIsMapSelectOpen(false);
    setLoadError(null);

    // Neutralize all input
    releaseAllInputs();

    // Call existing resetGame logic with explicit device type, map ID, and game mode
    const dType = isMobileRef.current ? 'mobile' : 'desktop';
    const ok = resetGame(dType, selectedMapId, selectedGameMode);

    if (ok) {
      const state = stateRef.current;

      // Complete per-run cleanup
      state.player.vx = 0;
      state.player.vy = 0;
      state.player.kbvx = 0;
      state.player.kbvy = 0;
      state.player.processedZoneKbs = [];
      state.player.recentBlocks = [];
      state.player.lastShoot = performance.now();
      state.player.dash = {
        active: false,
        endTime: 0,
        targetX: 0,
        targetY: 0,
        shieldRadius: 60,
        lastTime: performance.now() - DASH_COOLDOWN,
        wasReady: true
      };
      state.player.build = {
        active: false,
        endTime: 0,
        lastBlockX: 0,
        lastBlockY: 0,
        lastTime: performance.now() - BUILD_COOLDOWN
      };

      state.blocks = [];
      state.nextBlockScore = 100;
      state.bullets = [];
      state.enemies = [];
      state.bouncers = [];
      state.zones = [];
      
      const mapDef = MAPS[selectedMapId] || MAPS.classic_arena;
      state.spawners = mapDef.spawners.map((s: any) => ({
        ...s,
        hp: selectedGameMode === 'impossible' ? (s.maxHp ?? s.hp ?? 100) : s.hp
      }));
      state.nextEntityId = 1;
      state.bouncerCapacity = 2;

      // Re-create bouncers starting from 0 to ensure clean run
      const startPos = { x: state.player.x, y: state.player.y };
      for (let i = 0; i < 2; i++) {
        const spawn = getSafeSpawn(mapDef.walls, 60, [startPos], 200);
        if (spawn) {
          const angle = Math.random() * Math.PI * 2;
          state.bouncers.push({
            id: 'b_' + state.nextEntityId++,
            x: spawn.x,
            y: spawn.y,
            dx: Math.cos(angle),
            dy: Math.sin(angle),
            size: 1,
            radius: 24,
            speed: ENEMY_SPEED + Math.random() * 20,
            lastDirChange: performance.now(),
            lastMultiply: performance.now()
          });
        }
      }

      state.particles = [];
      state.trails = [];
      state.shockwaves = [];
      state.floatingTexts = [];
      state.shake = 0;
      state.lastTime = performance.now();
      state.lastEnemySpawn = performance.now();
      state.enemySpawnRate = 3000;
      pauseStartRef.current = null;
      accumulatedPauseOffsetRef.current = 0;

      // Single-player leftovers cleanup
      state.multiplayerPlayers = {};
      state.matchPhase = 'PLAYING';
      state.finalRunnerId = null;
      state.finalRunDeadline = null;
      state.openingProtectionDeadline = null;
      state.winnerId = null;
      state.matchPlayers = {};
      state.playerActionAuthority = {};
      state.forceBroadcast = false;
      state.lastBroadcastTime = 0;

      mappedClientDeadlineRef.current = null;
      mappedProtectionDeadlineRef.current = null;
      awaitingOpeningProtectionAuthorityRef.current = false;
      setCurrentMatchPhase('PLAYING');

      // Update UI state
      const isHardMode = selectedGameMode !== 'normal';
      const finalUi = {
        status: 'PLAYING' as const,
        score: 0,
        deviceType: dType,
        activeTool: 'special' as const,
        blocks: 50,
        spawnersLeft: state.spawners.length,
        mapId: selectedMapId,
        hardMode: isHardMode,
        gameMode: selectedGameMode,
        buttonCounters: { special: 0, build: 0 }
      };
      uiRef.current = finalUi;
      setUiState(finalUi);

      activeSinglePlayerRunIdRef.current += 1;
      invalidateQuickSave();
    }

    return ok;
  };

  const evaluateMatchState = (currentTime: number) => {
    if (!mpRef.current.isConnected || !mpRef.current.roomId || !mpRef.current.isHost) {
      return;
    }

    const state = stateRef.current;

    if (state.openingProtectionDeadline !== null && currentTime >= state.openingProtectionDeadline) {
      state.openingProtectionDeadline = null;
      state.forceBroadcast = true;
    }

    if (state.matchPhase === 'FINISHED') {
      return;
    }

    const hostId = socketRef.current?.id || 'host';

    // Synchronize host player state strictly if in match roster snapshot
    if (state.matchPlayers[hostId]) {
      state.matchPlayers[hostId].score = uiRef.current.score || 0;
      state.matchPlayers[hostId].isDead = (uiRef.current.status === 'GAME_OVER');
    }

    // Synchronize remote players state strictly if in match roster snapshot
    for (const pid in state.multiplayerPlayers) {
      const mpP = state.multiplayerPlayers[pid];
      if (mpP && state.matchPlayers[pid]) {
        state.matchPlayers[pid].score = Math.max(state.matchPlayers[pid].score || 0, mpP.score || 0);
        state.matchPlayers[pid].isDead = state.matchPlayers[pid].isDead || !!mpP.isDead;
      }
    }

    type MatchPlayer = { id: string; name: string; colorIdx: number; score: number; isDead: boolean; isDisconnected?: boolean };
    const allMatchPlayers: MatchPlayer[] = Object.values(state.matchPlayers) as MatchPlayer[];
    const alivePlayers = allMatchPlayers.filter(p => !p.isDead);

    const getBestPlayer = (players: MatchPlayer[]): MatchPlayer | null => {
      if (players.length === 0) return null;
      return [...players].sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.id.localeCompare(b.id);
      })[0];
    };

    const previousPhase = state.matchPhase;

    if (state.matchPhase === 'PLAYING') {
      if (alivePlayers.length === 0) {
        state.matchPhase = 'FINISHED';
        const bestOverall = getBestPlayer(allMatchPlayers);
        state.winnerId = bestOverall ? bestOverall.id : hostId;
      } else if (alivePlayers.length === 1) {
        const remainingPlayer = alivePlayers[0];
        const opponents = allMatchPlayers.filter(p => p.id !== remainingPlayer.id);
        const bestOpponent = getBestPlayer(opponents);

        if (!bestOpponent || remainingPlayer.score > bestOpponent.score) {
          state.matchPhase = 'FINISHED';
          state.winnerId = remainingPlayer.id;
        } else {
          state.matchPhase = 'FINAL_RUN';
          state.finalRunnerId = remainingPlayer.id;
          state.finalRunDeadline = currentTime + 20000;
        }
      } else if (state.gameMode !== 'impossible' && state.spawners.length === 0) {
        state.matchPhase = 'FINAL_RUN';
        state.finalRunnerId = null;
        state.finalRunDeadline = currentTime + 20000;
      }
    }

    if (state.matchPhase === 'FINAL_RUN') {
      if (state.finalRunnerId === null) {
        if (alivePlayers.length === 0) {
          state.matchPhase = 'FINISHED';
          const bestOverall = getBestPlayer(allMatchPlayers);
          state.winnerId = bestOverall ? bestOverall.id : hostId;
        } else if (alivePlayers.length === 1) {
          const survivor = alivePlayers[0];
          const opponents = allMatchPlayers.filter(p => p.id !== survivor.id);
          const bestOpponent = getBestPlayer(opponents);

          if (!bestOpponent || survivor.score > bestOpponent.score) {
            state.matchPhase = 'FINISHED';
            state.winnerId = survivor.id;
          } else {
            state.finalRunnerId = survivor.id;
            state.forceBroadcast = true;
          }
        } else {
          const isExpired = state.finalRunDeadline !== null && currentTime >= state.finalRunDeadline;
          if (isExpired) {
            state.matchPhase = 'FINISHED';
            const bestOverall = getBestPlayer(allMatchPlayers);
            state.winnerId = bestOverall ? bestOverall.id : hostId;
          }
        }
      }

      if (state.finalRunnerId !== null && state.matchPhase === 'FINAL_RUN') {
        const runnerId = state.finalRunnerId;
        const runner = runnerId ? state.matchPlayers[runnerId] : null;

        const nonRunnerOpponents = allMatchPlayers.filter(p => p.id !== runnerId);
        const bestOpponent = getBestPlayer(nonRunnerOpponents);

        const isRunnerDead = !runner || runner.isDead;
        const isExpired = state.finalRunDeadline !== null && currentTime >= state.finalRunDeadline;

        const didSurpass = !!(runner && !runner.isDead && (!bestOpponent || runner.score > bestOpponent.score));

        if (didSurpass) {
          state.matchPhase = 'FINISHED';
          state.winnerId = runner!.id;
        } else if (isRunnerDead || isExpired) {
          state.matchPhase = 'FINISHED';
          // Never include the runner in fallback selection when failing to surpass
          state.winnerId = bestOpponent ? bestOpponent.id : (runner ? runner.id : hostId);
        }
      }
    }

    if (state.matchPhase !== previousPhase) {
      state.forceBroadcast = true;
      setCurrentMatchPhase(state.matchPhase);
    }
  };

  const authMultiplayerPlaceBlock = useCallback((
    builderId: string,
    builderPos: { x: number; y: number },
    gridX: number,
    gridY: number,
    colorIdx: number,
    currentTime: number
  ): boolean => {
     try {
         const s = stateRef.current;
         const hostId = socketRef.current?.id || 'host';

         // 1. builderId is a valid current match player
         const matchPlayer = s.matchPlayers[builderId];
         if (!matchPlayer) return false;

         // 2. builder is alive and connected
         if (matchPlayer.isDead || matchPlayer.isDisconnected) return false;
         
         // If guest, check s.multiplayerPlayers[builderId].isDead
         if (builderId !== hostId) {
             const clientPlayer = s.multiplayerPlayers[builderId];
             if (!clientPlayer || clientPlayer.isDead) return false;
         } else {
             if (uiRef.current.status !== 'PLAYING' && uiRef.current.status !== 'LOBBY') {
                 return false;
             }
         }

         // 3. gridX and gridY are finite numbers
         if (gridX === undefined || typeof gridX !== 'number' || !Number.isFinite(gridX) ||
             gridY === undefined || typeof gridY !== 'number' || !Number.isFinite(gridY)) {
             return false;
         }

         // 4. both coordinates are exact multiples of 40
         if (gridX % 40 !== 0 || gridY % 40 !== 0) return false;

         // 5. the complete 40×40 block remains within map bounds
         if (gridX - 20 < 0 || gridX + 20 > MAP_WIDTH || gridY - 20 < 0 || gridY + 20 > MAP_HEIGHT) {
             return false;
         }

         // 6. the position is no farther than 160 pixels from the authoritative builder position
         const dx = gridX - builderPos.x;
         const dy = gridY - builderPos.y;
         if (dx * dx + dy * dy > 160 * 160) return false;

         // 7. the block does not overlap any active static wall in activeWalls
         for (const w of activeWalls) {
            if (gridX > w.x - 20 && gridX < w.x + w.w + 20 &&
                gridY > w.y - 20 && gridY < w.y + w.h + 20) {
               return false;
            }
         }

         // 8. the block does not overlap an enemy
         for (const enemy of s.enemies) {
            if (enemy.x > gridX - 20 - enemy.radius && enemy.x < gridX + 20 + enemy.radius &&
                enemy.y > gridY - 20 - enemy.radius && enemy.y < gridY + 20 + enemy.radius) {
               return false;
            }
         }

         // 9. the block does not overlap a bouncer
         for (const b of s.bouncers) {
            if (b.x > gridX - 20 - b.radius && b.x < gridX + 20 + b.radius &&
                b.y > gridY - 20 - b.radius && b.y < gridY + 20 + b.radius) {
               return false;
            }
         }

         // 10. the block does not overlap a living spawner
         for (const spawner of s.spawners) {
             if (spawner.hp > 0 && spawner.x > gridX - 20 - spawner.radius && spawner.x < gridX + 20 + spawner.radius &&
                 spawner.y > gridY - 20 - spawner.radius && spawner.y < gridY + 20 + spawner.radius) {
                 return false;
             }
         }

         // 11. the block does not overlap any living player other than the builder
         for (const pid in s.multiplayerPlayers) {
            if (pid === builderId) continue;
            const p = s.multiplayerPlayers[pid] as any;
            if (p && !p.isDead && p.x > gridX - 20 - p.radius && p.x < gridX + 20 + p.radius &&
                p.y > gridY - 20 - p.radius && p.y < gridY + 20 + p.radius) {
               return false;
            }
         }
         if (builderId !== hostId) {
            const lp = s.player;
            const hostMatchPlayer = s.matchPlayers[hostId];
            const isHostAlive = hostMatchPlayer ? !hostMatchPlayer.isDead : (uiRef.current.status === 'PLAYING');
            if (isHostAlive && lp.x > gridX - 20 - PLAYER_RADIUS && lp.x < gridX + 20 + PLAYER_RADIUS &&
                lp.y > gridY - 20 - PLAYER_RADIUS && lp.y < gridY + 20 + PLAYER_RADIUS) {
               return false;
            }
         }

         // Existing block rules: use ownerId to check ownership
         const existingIdx = s.blocks.findIndex(b => b.x === gridX && b.y === gridY);
         if (existingIdx !== -1) {
             const existingBlock = s.blocks[existingIdx];
             if (existingBlock.ownerId === builderId) {
                 return false;
             } else {
                 s.blocks[existingIdx] = {
                     x: gridX,
                     y: gridY,
                     size: 40,
                     createdAt: currentTime,
                     colorIdx: colorIdx,
                     ownerId: builderId
                 };
             }
         } else {
             s.blocks.push({
                 x: gridX,
                 y: gridY,
                 size: 40,
                 createdAt: currentTime,
                 colorIdx: colorIdx,
                 ownerId: builderId
             });
         }

         // Remove authoritative bullets whose centers occupy the newly materialized area
         for (let i = s.bullets.length - 1; i >= 0; i--) {
            const b = s.bullets[i];
            if (b.x > gridX - 20 && b.x < gridX + 20 && b.y > gridY - 20 && b.y < gridY + 20) {
               s.bullets.splice(i, 1);
            }
         }

         s.forceBroadcast = true;
         return true;
     } catch (e) {
         console.error("Error in authMultiplayerPlaceBlock:", e);
         return false;
     }
  }, [activeWalls]);

  const tryPlaceBuildBlock = useCallback((currentTime: number, gridX: number, gridY: number, cIdx: number) => {
     if (isOpeningProtectionActiveLocal(currentTime)) return;
     try {
         const roomId = mpRef.current.roomId;

         // A. Single-player
         if (!roomId) {
             const s = stateRef.current;
             let blockOccupied = false;

             for (const enemy of s.enemies) {
                if (enemy.x > gridX - 20 - enemy.radius && enemy.x < gridX + 20 + enemy.radius &&
                    enemy.y > gridY - 20 - enemy.radius && enemy.y < gridY + 20 + enemy.radius) {
                   blockOccupied = true;
                   break;
                }
             }
             if (!blockOccupied) {
                 for (const b of s.bouncers) {
                    if (b.x > gridX - 20 - b.radius && b.x < gridX + 20 + b.radius &&
                        b.y > gridY - 20 - b.radius && b.y < gridY + 20 + b.radius) {
                       blockOccupied = true;
                       break;
                    }
                 }
             }
             if (!blockOccupied) {
                 for (const spawner of s.spawners) {
                     if (spawner.hp > 0 && spawner.x > gridX - 20 - spawner.radius && spawner.x < gridX + 20 + spawner.radius &&
                         spawner.y > gridY - 20 - spawner.radius && spawner.y < gridY + 20 + spawner.radius) {
                         blockOccupied = true;
                         break;
                     }
                 }
             }
             if (!blockOccupied) {
                 const players = Object.values(s.multiplayerPlayers) as any[];
                 for (const p of players) {
                    if (!p.isDead && p.x > gridX - 20 - p.radius && p.x < gridX + 20 + p.radius &&
                        p.y > gridY - 20 - p.radius && p.y < gridY + 20 + p.radius) {
                       blockOccupied = true;
                       break;
                    }
                 }
             }
             if (blockOccupied) return;

             for (let i = s.bullets.length - 1; i >= 0; i--) {
                const b = s.bullets[i];
                if (b.x > gridX - 20 && b.x < gridX + 20 && b.y > gridY - 20 && b.y < gridY + 20) {
                   s.bullets.splice(i, 1);
                }
             }

             const existingIdx = s.blocks.findIndex(b => b.x === gridX && b.y === gridY);
             if (existingIdx !== -1) {
                if (s.blocks[existingIdx].colorIdx === cIdx) {
                   return;
                } else {
                   s.blocks.splice(existingIdx, 1);
                }
             }

             s.blocks.push({ x: gridX, y: gridY, size: 40, createdAt: currentTime, colorIdx: cIdx, ownerId: 'local' });
             return;
         }

         // B. Multiplayer host
         if (mpRef.current.isHost) {
             const hostId = socketRef.current?.id || 'host';
             const hostPos = { x: stateRef.current.player.x, y: stateRef.current.player.y };
             const hostColorIdx = playerProfileRef.current.colorIdx;
             authMultiplayerPlaceBlock(hostId, hostPos, gridX, gridY, hostColorIdx, currentTime);
             return;
         }

         // C. Multiplayer guest
         const socket = socketRef.current;
         const roundId = activeMultiplayerRoundIdRef.current;
         if (socket && socket.connected && roomId && typeof roundId === 'number' && Number.isFinite(roundId) && Number.isInteger(roundId) && roundId > 0 && !awaitingResumeSnapshotRef.current) {
             socket.emit('client_action', roomId, {
                 roundId,
                 type: 'build',
                 x: gridX,
                 y: gridY
             });
         }
     } catch(e) {
         console.error("Error in tryPlaceBuildBlock:", e);
     }
  }, [authMultiplayerPlaceBlock]);

  const applySpecialAbility = useCallback((x: number, y: number, colorIdx: number, ownerId: string) => {
     if (isOpeningProtectionActiveLocal()) return;
     const radius = 240;
     const s = stateRef.current;

     s.zones.push({
         x: x,
         y: y,
         innerRadius: 0,
         outerRadius: radius,
         duration: 6000,
         spawnTime: performance.now(),
         ownerId: ownerId,
         colorIdx: colorIdx,
         type: 'repel'
     });
     const pDef = PLAYER_COLORS[colorIdx !== undefined ? colorIdx : 0] || PLAYER_COLORS[0];
     s.shockwaves.push({ x: x, y: y, color: pDef.n, maxRadius: radius, age: 0, maxAge: 0.5, thickness: 30 });
     s.shockwaves.push({ x: x, y: y, color: '#ffffff', maxRadius: radius * 0.8, age: 0, maxAge: 0.3, thickness: 10 });
  }, []);

  const isGuestSpecialReady = useCallback((currentTime: number) => {
     const socketId = socketRef.current?.id;
     if (!socketId) return false;
     const auth = stateRef.current.playerActionAuthority?.[socketId];
     if (!auth) return false;
     if (typeof auth.specialActiveUntil !== 'number' || !Number.isFinite(auth.specialActiveUntil)) return false;
     if (typeof auth.specialReadyAt !== 'number' || !Number.isFinite(auth.specialReadyAt)) return false;
     return currentTime >= auth.specialReadyAt && currentTime >= auth.specialActiveUntil;
  }, []);

  const isGuestBuildReady = useCallback((currentTime: number) => {
     const socketId = socketRef.current?.id;
     if (!socketId) return false;
     const auth = stateRef.current.playerActionAuthority?.[socketId];
     if (!auth) return false;
     if (typeof auth.buildActiveUntil !== 'number' || !Number.isFinite(auth.buildActiveUntil)) return false;
     if (typeof auth.buildReadyAt !== 'number' || !Number.isFinite(auth.buildReadyAt)) return false;
     return currentTime >= auth.buildReadyAt && currentTime >= auth.buildActiveUntil;
  }, []);

  const requestSpecialActivation = useCallback((currentTime: number) => {
     if (mpRef.current.roomId && (!mpRef.current.isConnected || awaitingResumeSnapshotRef.current)) return;
     const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
     if (isLocalMenuOpen) return;

     if (isOpeningProtectionActiveLocal(currentTime)) return;

     const isMultiplayer = Boolean(mpRef.current.roomId);
     const isHost = mpRef.current.isHost;

     if (!isMultiplayer) {
         const dash = stateRef.current.player.dash;
         const endTime = dash.endTime || 0;
         if (!dash.active && (endTime === 0 || currentTime - endTime >= DASH_COOLDOWN)) {
             dash.active = true;
             dash.endTime = currentTime + 6000;
             dash.lastTime = currentTime;

             const finalX = stateRef.current.player.x;
             const finalY = stateRef.current.player.y;
             const cIdx = playerProfileRef.current.colorIdx;
             applySpecialAbility(finalX, finalY, cIdx, 'local');
         }
     } else if (isHost) {
         const dash = stateRef.current.player.dash;
         const endTime = dash.endTime || 0;
         if (!dash.active && (endTime === 0 || currentTime - endTime >= DASH_COOLDOWN)) {
             dash.active = true;
             dash.endTime = currentTime + 6000;
             dash.lastTime = currentTime;

             const myId = socketRef.current?.id || 'host';
             const finalX = stateRef.current.player.x;
             const finalY = stateRef.current.player.y;
             const cIdx = playerProfileRef.current.colorIdx;

             applySpecialAbility(finalX, finalY, cIdx, myId);

             const auth = getOrInitializeAuthority(myId);
             auth.specialActiveUntil = currentTime + 6000;
             auth.specialReadyAt = currentTime + 6000 + DASH_COOLDOWN;

             stateRef.current.forceBroadcast = true;
         }
     } else {
         const socket = socketRef.current;
         const roundId = activeMultiplayerRoundIdRef.current;
         const isRoundValid = typeof roundId === 'number' && Number.isFinite(roundId) && Number.isInteger(roundId) && roundId > 0;
         const socketId = socket?.id;

         if (socket && socket.connected && socketId && socketId !== '' &&
             isRoundValid && uiRef.current.status === 'PLAYING') {

             const isReady = isGuestSpecialReady(currentTime);
             if (isReady) {
                 const p = pendingSpecialRequestRef.current;
                 const isSpam = p && p.roundId === roundId && (currentTime - p.requestedAt < 1500);
                 if (!isSpam) {
                     pendingSpecialRequestRef.current = {
                         roundId,
                         requestedAt: currentTime
                     };
                     socket.emit('client_action', mpRef.current.roomId, {
                         roundId,
                         type: 'special'
                     });
                 }
             }
         }
     }
  }, [applySpecialAbility, isGuestSpecialReady]);

  const requestBuildActivation = useCallback((currentTime: number) => {
     if (mpRef.current.roomId && (!mpRef.current.isConnected || awaitingResumeSnapshotRef.current)) return;
     const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
     if (isLocalMenuOpen) return;

     if (isOpeningProtectionActiveLocal(currentTime)) return;

     const isMultiplayer = Boolean(mpRef.current.roomId);
     const isHost = mpRef.current.isHost;

     if (!isMultiplayer) {
         const build = stateRef.current.player.build;
         const endTime = build.endTime || 0;
         if (!build.active && (endTime === 0 || currentTime - endTime >= BUILD_COOLDOWN)) {
             build.active = true;
             build.endTime = currentTime + 8000;
             build.lastTime = currentTime;

             const gridX = Math.round(stateRef.current.player.x / 40) * 40;
             const gridY = Math.round(stateRef.current.player.y / 40) * 40;
             build.lastBlockX = gridX;
             build.lastBlockY = gridY;

             const cIdx = playerProfileRef.current.colorIdx;
             tryPlaceBuildBlock(currentTime, gridX, gridY, cIdx);
         }
     } else if (isHost) {
         const build = stateRef.current.player.build;
         const endTime = build.endTime || 0;
         if (!build.active && (endTime === 0 || currentTime - endTime >= BUILD_COOLDOWN)) {
             build.active = true;
             build.endTime = currentTime + 8000;
             build.lastTime = currentTime;

             const myId = socketRef.current?.id || 'host';
             const gridX = Math.round(stateRef.current.player.x / 40) * 40;
             const gridY = Math.round(stateRef.current.player.y / 40) * 40;
             build.lastBlockX = gridX;
             build.lastBlockY = gridY;

             const cIdx = playerProfileRef.current.colorIdx;
             authMultiplayerPlaceBlock(myId, { x: stateRef.current.player.x, y: stateRef.current.player.y }, gridX, gridY, cIdx, currentTime);

             const auth = getOrInitializeAuthority(myId);
             auth.buildActiveUntil = currentTime + 8000;
             auth.buildReadyAt = currentTime + 8000 + BUILD_COOLDOWN;

             stateRef.current.forceBroadcast = true;
         }
     } else {
         const socket = socketRef.current;
         const roundId = activeMultiplayerRoundIdRef.current;
         const isRoundValid = typeof roundId === 'number' && Number.isFinite(roundId) && Number.isInteger(roundId) && roundId > 0;
         const socketId = socket?.id;

         if (socket && socket.connected && socketId && socketId !== '' &&
             isRoundValid && uiRef.current.status === 'PLAYING') {

             const isReady = isGuestBuildReady(currentTime);
             if (isReady) {
                 const p = pendingBuildRequestRef.current;
                 const isSpam = p && p.roundId === roundId && (currentTime - p.requestedAt < 1500);
                 if (!isSpam) {
                     pendingBuildRequestRef.current = {
                         roundId,
                         requestedAt: currentTime
                     };
                     socket.emit('client_action', mpRef.current.roomId, {
                         roundId,
                         type: 'build_start'
                     });
                 }
             }
         }
     }
  }, [tryPlaceBuildBlock, authMultiplayerPlaceBlock, isGuestBuildReady]);

  const handleHostRoleTransition = useCallback((newIsHost: boolean) => {
    const oldIsHost = mpRef.current.isHost;
    if (oldIsHost !== newIsHost) {
      resetHostClockAnchor();
    }
    mpRef.current.isHost = newIsHost;
    setMpState(prev => ({ ...prev, isHost: newIsHost }));

    if (!newIsHost) {
      invalidateStartRequestGeneration();
    }

    if (oldIsHost === newIsHost) {
      return;
    }

    const roomId = mpRef.current.roomId;
    const roundId = activeMultiplayerRoundIdRef.current;
    const isActiveRound = Boolean(
      roomId &&
      typeof roundId === 'number' &&
      Number.isInteger(roundId) &&
      roundId > 0 &&
      (uiRef.current.status === 'PLAYING' || uiRef.current.status === 'GAME_OVER')
    );

    if (!isActiveRound) {
      return;
    }

    clearPendingGuestShots(true);
    clearPendingAbilityRequests();
    releaseAllInputs();
    lastReceivedGameStateTimeRef.current = performance.now();

    if (newIsHost) {
      awaitingResumeSnapshotRef.current = false;

      if (stateRef.current.matchPhase === 'FINAL_RUN') {
        if (mappedClientDeadlineRef.current !== null) {
          stateRef.current.finalRunDeadline = mappedClientDeadlineRef.current;
        }
      }
      mappedClientDeadlineRef.current = null;

      const now = performance.now();
      if (mappedProtectionDeadlineRef.current !== null) {
        const rem = mappedProtectionDeadlineRef.current - now;
        if (rem > 0) {
          stateRef.current.openingProtectionDeadline = now + rem;
        } else {
          stateRef.current.openingProtectionDeadline = null;
        }
      } else {
        stateRef.current.openingProtectionDeadline = null;
      }
      mappedProtectionDeadlineRef.current = null;

      awaitingOpeningProtectionAuthorityRef.current = false;

      const currentPhase = getMultiplayerWorldPhaseTime(now);
      multiplayerWorldPhaseAnchorRef.current = {
        phaseAtAnchor: currentPhase,
        localTimeAtAnchor: now,
        initialized: true,
      };

      stateRef.current.forceBroadcast = true;
      stateRef.current.lastBroadcastTime = 0;
      setMpTick(t => t + 1);
    } else {
      stateRef.current.forceBroadcast = false;
      stateRef.current.lastBroadcastTime = 0;
      awaitingResumeSnapshotRef.current = true;
    }
  }, [clearPendingGuestShots, clearPendingAbilityRequests, releaseAllInputs, getMultiplayerWorldPhaseTime, resetHostClockAnchor]);

  const handleHostRoleTransitionRef = useRef(handleHostRoleTransition);
  handleHostRoleTransitionRef.current = handleHostRoleTransition;

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    const isCurrentRoom = (roomId: unknown): boolean => {
      const currentRoom = mpRef.current.roomId;
      if (!currentRoom) return false;
      if (typeof roomId !== 'string') return false;
      return roomId.trim().toUpperCase() === currentRoom.trim().toUpperCase();
    };

    const isCurrentRoomRound = (roomId: unknown, roundId: unknown): boolean => {
      if (!isCurrentRoom(roomId)) return false;
      if (typeof roundId !== 'number' || !Number.isFinite(roundId) || !Number.isInteger(roundId) || roundId < 0) return false;
      return roundId === currentRoomRoundIdRef.current;
    };

    const spawnParticlesDirect = (x: number, y: number, color: string, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 150 + 50;
        stateRef.current.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: Math.random() * 0.4 + 0.2,
          color,
          radius: Math.random() * 3 + 1
        });
      }
    };

    socket.on('connect', () => {
      const session = resumeSessionRef.current;
      const expectedRoom = session?.roomId ? session.roomId.trim().toUpperCase() : '';
      const isRoomCodeValid = /^[A-Z0-9]{4}$/.test(expectedRoom);
      const hasValidSession = session && isRoomCodeValid && isValidResumeToken(session.resumeToken);

      if (session && !isRoomCodeValid) {
        clearResumeSession();
      }

      if (hasValidSession) {
        if (resumeInFlightRef.current) {
          return;
        }
        resumeInFlightRef.current = true;
        awaitingResumeSnapshotRef.current = false;
        const currentGen = ++resumeAttemptGenerationRef.current;

        socket.emit('resume_room', expectedRoom, session.resumeToken, (res: any) => {
          if (resumeAttemptGenerationRef.current !== currentGen || !socket.connected) {
            return;
          }

          const isServerSuccess = res && typeof res === 'object' && res.success === true;
          let isValidSuccess = false;
          let rosterResult: ValidatedRosterResult | null = null;

          if (isServerSuccess) {
            const isRoomMatch = typeof res.roomId === 'string' && res.roomId.trim().toUpperCase() === expectedRoom;
            const isOldIdValid = typeof res.oldId === 'string' && res.oldId.length >= 1 && res.oldId.length <= 128;
            const isNewIdValid = typeof res.newId === 'string' && res.newId.length >= 1 && res.newId.length <= 128 && res.newId === socket.id;
            const isDifferentIds = res.oldId !== res.newId;
            const isHostBool = typeof res.isHost === 'boolean';
            const isMatchActiveBool = typeof res.matchActive === 'boolean';
            const isRoundIdValid = typeof res.roundId === 'number' && Number.isInteger(res.roundId) && res.roundId >= 0;
            const isTokenValid = isValidResumeToken(res.resumeToken);
            const isMatchSettingsValid = Boolean(
              res.matchSettings &&
              typeof res.matchSettings === 'object' &&
              isValidMapId(res.matchSettings.mapId) &&
              isValidGameMode(res.matchSettings.gameMode)
            );

            if (isRoomMatch && isOldIdValid && isNewIdValid && isDifferentIds && isHostBool && isMatchActiveBool && isRoundIdValid && isTokenValid && isMatchSettingsValid) {
              rosterResult = validateRoster(res.players, socket.id);
              if (rosterResult && res.isHost === rosterResult.selfEntry.isHost) {
                isValidSuccess = true;
              }
            }
          }

          if (isValidSuccess && rosterResult) {
            clearPendingGuestShots(true);
            clearPendingAbilityRequests();
            releaseAllInputs();
            cancelPendingMatchSettingsUpdate();

            remapPlayerId(res.oldId, res.newId);

            resumeSessionRef.current = {
              roomId: expectedRoom,
              resumeToken: res.resumeToken
            };

            currentRoomRoundIdRef.current = res.roundId;
            if (res.matchActive === true) {
              activeMultiplayerRoundIdRef.current = res.roundId;
            } else {
              activeMultiplayerRoundIdRef.current = 0;
            }

            setPlayerProfile({
              name: rosterResult.selfEntry.name,
              colorIdx: rosterResult.selfEntry.colorIdx
            });
            if (!isEditingCallsignRef.current) {
              setCallsignDraft(rosterResult.selfEntry.name);
            }

            lobbyPlayersRef.current = rosterResult.otherPlayers;
            setLobbyPlayers(rosterResult.otherPlayers);

            applyAuthoritativeMatchSettings(res.matchSettings);
            lastReceivedGameStateTimeRef.current = performance.now();
            resumeInFlightRef.current = false;

            mpRef.current.isConnected = true;
            mpRef.current.roomId = expectedRoom;

            socket.emit('confirm_resume', expectedRoom, res.resumeToken);

            setMpState(prev => ({
              ...prev,
              isConnected: true,
              roomId: expectedRoom,
              error: ''
            }));

            handleHostRoleTransition(res.isHost);

            if (res.isHost === false) {
              resetHostClockAnchor();
            }

            if (res.matchActive === true && res.isHost === false) {
              awaitingResumeSnapshotRef.current = true;
            }

            if (res.matchActive === false) {
              setUiState(prev => {
                const nextUi = { ...prev, status: 'LOBBY' as const };
                uiRef.current = nextUi;
                return nextUi;
              });
            }
          } else {
            if (isServerSuccess) {
              socket.emit('leave_room', expectedRoom);
            }

            clearResumeSession();
            clearPendingGuestShots(true);
            clearPendingAbilityRequests();
            releaseAllInputs();
            resetHostClockAnchor();
            currentRoomRoundIdRef.current = 0;
            activeMultiplayerRoundIdRef.current = 0;
            lobbyPlayersRef.current = {};
            setLobbyPlayers({});

            mpRef.current.isConnected = true;
            mpRef.current.roomId = null;
            mpRef.current.isHost = false;

            const errorMsg = isServerSuccess ? 'INVALID RESUME RESPONSE' : (res?.error || 'RECONNECT FAILED');
            setMpState(prev => ({
              ...prev,
              isConnected: true,
              roomId: null,
              isHost: false,
              error: errorMsg
            }));

            setUiState(prev => {
              const nextUi = { ...prev, status: 'LOBBY' as const };
              uiRef.current = nextUi;
              return nextUi;
            });
          }
        });
      } else {
        mpRef.current.isConnected = true;
        setMpState(prev => ({ ...prev, isConnected: true }));
      }
    });

    socket.on('disconnect', () => {
      roomRequestGenerationRef.current++;
      roomRequestInFlightRef.current = false;
      setPendingRoomRequest(null);

      resumeAttemptGenerationRef.current++;
      resumeInFlightRef.current = false;
      awaitingResumeSnapshotRef.current = false;
      clearPendingGuestShots(true);
      clearPendingAbilityRequests();
      invalidateStartRequestGeneration();
      cancelPendingMatchSettingsUpdate();
      closeMpMapSelector();
      releaseAllInputs();
      mpRef.current.isConnected = false;
      setMpState(prev => ({ ...prev, isConnected: false }));
    });

    socket.on('player_reconnected', (data: any) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const { roomId, oldId, newId, roundId } = data;
      if (!isCurrentRoomRound(roomId, roundId)) return;
      if (!isValidMpPlayerId(oldId) || !isValidMpPlayerId(newId) || oldId === newId) {
        return;
      }
      remapPlayerId(oldId, newId);
    });

    socket.on('player_joined', (data: any) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const { roomId, roundId, playerId } = data;
      if (!isCurrentRoomRound(roomId, roundId)) return;
      if (!isValidMpPlayerId(playerId)) return;
      if (socket.id && playerId === socket.id) return;

      if (!stateRef.current.multiplayerPlayers[playerId]) {
        stateRef.current.multiplayerPlayers[playerId] = {
          x: stateRef.current.player.x,
          y: stateRef.current.player.y,
          radius: PLAYER_RADIUS,
          isDash: false
        };
      }

      setLobbyPlayers(prev => {
        if (prev[playerId]) return prev;
        const next = {
          ...prev,
          [playerId]: { name: 'CONNECTING...', colorIdx: 0, isHost: false }
        };
        lobbyPlayersRef.current = next;
        return next;
      });
    });

    socket.on('player_left', (data: any) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const { roomId, roundId, playerId } = data;
      if (!isCurrentRoomRound(roomId, roundId)) return;
      if (!isValidMpPlayerId(playerId)) return;
      if (socket.id && playerId === socket.id) return;

      if (mpRef.current.isHost) {
        const state = stateRef.current;
        if (state.matchPlayers[playerId]) {
          state.matchPlayers[playerId].isDead = true;
          state.matchPlayers[playerId].isDisconnected = true;
        }
        if (state.multiplayerPlayers[playerId]) {
          state.multiplayerPlayers[playerId].isDead = true;
        }
        evaluateMatchState(performance.now());
      }
      delete stateRef.current.multiplayerPlayers[playerId];
      setLobbyPlayers(prev => {
        if (!prev[playerId]) return prev;
        const next = { ...prev };
        delete next[playerId];
        lobbyPlayersRef.current = next;
        return next;
      });
    });

    socket.on('player_disconnected', (data: any) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const { roomId, roundId } = data;
      if (!isCurrentRoomRound(roomId, roundId)) return;
    });

    socket.on('lobby_players', (payload: any) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return;
      }

      const { roomId, roundId, players } = payload;
      if (!isCurrentRoomRound(roomId, roundId)) {
        return;
      }

      const currentSocketId = socket.id;
      if (!currentSocketId) {
        return;
      }

      const rosterResult = validateRoster(players, currentSocketId);
      if (!rosterResult) {
        return;
      }

      const { selfEntry, otherPlayers } = rosterResult;

      setPlayerProfile({
        name: selfEntry.name,
        colorIdx: selfEntry.colorIdx
      });
      if (!isEditingCallsignRef.current) {
        setCallsignDraft(selfEntry.name);
      }
      handleHostRoleTransition(selfEntry.isHost);
      lobbyPlayersRef.current = otherPlayers;
      setLobbyPlayers(otherPlayers);

      setMpError(prev => (prev === 'INVALID LOBBY ROSTER' ? null : prev));
      setMpState(prev => (prev.error === 'INVALID LOBBY ROSTER' ? { ...prev, error: null } : prev));
    });

    socket.on('match_settings', (data: any) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const { roomId, roundId, matchSettings } = data;
      if (!isCurrentRoomRound(roomId, roundId)) return;
      applyAuthoritativeMatchSettings(matchSettings);
    });

    socket.on('start_game', (config: any) => {
      const currentSocketId = socketRef.current?.id;

      if (!mpRef.current.isConnected || !currentSocketId) {
        return;
      }

      if (mpRef.current.isHost) {
        return;
      }

      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return;
      }

      const { roomId, roundId, mapId, gameMode, hardMode, spawnAssignments } = config;
      if (!isCurrentRoom(roomId)) {
        return;
      }

      if (typeof roundId !== 'number' || !Number.isInteger(roundId) || roundId <= 0) {
        return;
      }

      if (roundId !== currentRoomRoundIdRef.current + 1) {
        return;
      }

      if (!mapId || !isValidMapId(mapId)) {
        setMpError("INVALID START ASSIGNMENT");
        return;
      }

      const gameModeTyped: GameMode = gameMode;
      if (!gameModeTyped || !isValidGameMode(gameModeTyped)) {
        setMpError("INVALID START ASSIGNMENT");
        return;
      }

      if (typeof hardMode !== 'boolean' || hardMode !== (gameModeTyped !== 'normal')) {
        setMpError("INVALID START ASSIGNMENT");
        return;
      }

      if (!spawnAssignments || typeof spawnAssignments !== 'object' || Array.isArray(spawnAssignments)) {
        setMpError("INVALID START ASSIGNMENT");
        return;
      }

      const assignedIds = Object.keys(spawnAssignments);
      for (const id of assignedIds) {
        const pos = spawnAssignments[id];
        if (
          !pos ||
          typeof pos !== 'object' ||
          Array.isArray(pos) ||
          typeof pos.x !== 'number' ||
          typeof pos.y !== 'number' ||
          !Number.isFinite(pos.x) ||
          !Number.isFinite(pos.y) ||
          pos.x < 0 ||
          pos.x > 3000 ||
          pos.y < 0 ||
          pos.y > 3000
        ) {
          setMpError("INVALID START ASSIGNMENT");
          return;
        }
      }

      const myPos = spawnAssignments[currentSocketId];
      if (!myPos) {
        setMpError("INVALID START ASSIGNMENT");
        return;
      }

      const expectedRosterIds = new Set([currentSocketId, ...Object.keys(lobbyPlayersRef.current)]);
      if (
        assignedIds.length !== expectedRosterIds.size ||
        !assignedIds.every(id => expectedRosterIds.has(id))
      ) {
        setMpError("INVALID START ASSIGNMENT");
        return;
      }

      const ok = resetGame(isMobileRef.current ? 'mobile' : 'desktop', mapId, gameModeTyped, spawnAssignments);
      if (ok) {
        currentRoomRoundIdRef.current = roundId;
        activeMultiplayerRoundIdRef.current = roundId;
        resetHostClockAnchor();
        clearPendingGuestShots();
        clearPendingAbilityRequests();
        lastReceivedGameStateTimeRef.current = performance.now();
        setMpError(null);
        setUiState(prev => ({
          ...prev,
          status: 'PLAYING',
          mapId,
          hardMode,
          gameMode: gameModeTyped
        }));
      } else {
        setMpError("INVALID START ASSIGNMENT");
      }
    });

    socket.on('client_action_result', (result: any) => {
      if (mpRef.current.isHost) return;
      if (!result || typeof result !== 'object') return;
      if (!isCurrentRoom(result.roomId)) return;

      const activeRoundId = activeMultiplayerRoundIdRef.current;
      if (typeof activeRoundId !== 'number' || activeRoundId <= 0 || !Number.isInteger(activeRoundId)) return;
      if (result.roundId !== activeRoundId) return;
      if (result.actionType !== 'shoot') return;

      const clientShotId = result.clientShotId;
      if (typeof clientShotId !== 'string' || clientShotId.length < 1 || clientShotId.length > 96 || !/^[a-zA-Z0-9_\-:]+$/.test(clientShotId)) return;

      if (result.status !== 'accepted' && result.status !== 'rejected') return;

      const pending = pendingGuestShotsRef.current.get(clientShotId);
      if (!pending) return;
      if (pending.roundId !== result.roundId) return;

      if (result.status === 'rejected') {
        pending.status = 'rejected';
        if (pending.preview && pending.preview.endingAt === undefined) {
          pending.preview.endingAt = performance.now();
        }
      } else if (result.status === 'accepted') {
        pending.status = 'accepted';
        if (typeof result.authoritativeBulletId === 'string' && result.authoritativeBulletId.length > 0 && result.authoritativeBulletId.length <= 96 && /^[a-zA-Z0-9_\-:]+$/.test(result.authoritativeBulletId)) {
          pending.authoritativeBulletId = result.authoritativeBulletId;
        }
      }
    });

    socket.on('game_state', (state: any) => {
      if (mpRef.current.isHost) return;
      if (!state || typeof state !== 'object') return;

      // 1. Validation Requirements (Requirement 3):
      if (!isCurrentRoom(state.roomId)) return;

      const activeRoundId = activeMultiplayerRoundIdRef.current;
      if (typeof state.roundId !== 'number' || !Number.isInteger(state.roundId) || state.roundId <= 0 || state.roundId !== activeRoundId) {
        return;
      }

      if (!isValidMpPlayerId(state.hostId)) return;

      const myId = socket.id || socketRef.current?.id;
      if (!myId || state.hostId === myId) return;

      if (typeof state.hostTime !== 'number' || !Number.isFinite(state.hostTime) || state.hostTime < 0) {
        return;
      }

      // 2. Clock Anchor setup (Requirements 4 & 5):
      const normRoomId = state.roomId.trim().toUpperCase();
      const currentAnchor = hostClockAnchorRef.current;
      const needsNewAnchor = !currentAnchor ||
        currentAnchor.roomId !== normRoomId ||
        currentAnchor.roundId !== state.roundId ||
        currentAnchor.hostId !== state.hostId;

      if (needsNewAnchor) {
        hostClockAnchorRef.current = {
          roomId: normRoomId,
          roundId: state.roundId,
          hostId: state.hostId,
          hostTimeAtAnchor: state.hostTime,
          localTimeAtAnchor: performance.now()
        };
      }

      // 3. Mapping Helper and Precomputation (Requirements 6, 9, 10, 11, 12, 13, 14):
      const mapHostTime = (hostTimestamp: unknown): number => {
        if (typeof hostTimestamp !== 'number' || !Number.isFinite(hostTimestamp)) {
          throw new Error('Malformed or non-finite host timestamp');
        }
        const anchor = hostClockAnchorRef.current;
        if (!anchor) {
          throw new Error('No clock anchor established');
        }
        return anchor.localTimeAtAnchor + (hostTimestamp - anchor.hostTimeAtAnchor);
      };

      const mapPlayerSnapshot = (p: any) => {
        if (!p || typeof p !== 'object') {
          throw new Error('Malformed player snapshot');
        }
        const cloned = { ...p };
        if (cloned.lastShoot !== undefined && cloned.lastShoot !== null) {
          cloned.lastShoot = mapHostTime(cloned.lastShoot);
        }
        if (cloned.processedZoneKbs !== undefined && Array.isArray(cloned.processedZoneKbs)) {
          cloned.processedZoneKbs = cloned.processedZoneKbs.map((t: any) => mapHostTime(t));
        }
        if (cloned.recentBlocks !== undefined && Array.isArray(cloned.recentBlocks)) {
          cloned.recentBlocks = cloned.recentBlocks.map((rb: any) => {
            if (!rb || typeof rb !== 'object') {
              throw new Error('Malformed recent block');
            }
            return {
              ...rb,
              timestamp: mapHostTime(rb.timestamp)
            };
          });
        }
        if (cloned.dash !== undefined && cloned.dash !== null && typeof cloned.dash === 'object') {
          cloned.dash = {
            ...cloned.dash,
            endTime: mapHostTime(cloned.dash.endTime),
            lastTime: mapHostTime(cloned.dash.lastTime)
          };
        }
        if (cloned.build !== undefined && cloned.build !== null && typeof cloned.build === 'object') {
          cloned.build = {
            ...cloned.build,
            endTime: mapHostTime(cloned.build.endTime),
            lastTime: mapHostTime(cloned.build.lastTime)
          };
        }
        return cloned;
      };

      let mappedBlocks: any[];
      let mappedEnemies: any[];
      let mappedBouncers: any[];
      let mappedZones: any[];
      let mappedHostPlayer: any;
      let mappedMultiplayerPlayers: Record<string, any>;
      let mappedIncomingBullets: any[];
      let mappedBulletEvents: AuthoritativeBulletEvent[];
      let mappedBulletSnapshotTime: number;
      let mappedPlayerActionAuthority: any = undefined;
      let mappedFinalRunDeadline: number | null = null;
      let mappedOpeningProtectionDeadline: number | null = null;

      try {
        mappedBlocks = (state.blocks || []).map((block: any) => {
          if (!block || typeof block !== 'object') {
            throw new Error('Malformed block');
          }
          return {
            ...block,
            createdAt: mapHostTime(block.createdAt)
          };
        });

        mappedEnemies = (state.enemies || []).map((enemy: any) => {
          if (!enemy || typeof enemy !== 'object') {
            throw new Error('Malformed enemy');
          }
          const lastShoot = mapHostTime(enemy.lastShoot);
          const processedZoneKbs = Array.isArray(enemy.processedZoneKbs)
            ? enemy.processedZoneKbs.map((t: any) => mapHostTime(t))
            : undefined;
          return {
            ...enemy,
            lastShoot,
            ...(processedZoneKbs !== undefined ? { processedZoneKbs } : {})
          };
        });

        mappedBouncers = (state.bouncers || []).map((bouncer: any) => {
          if (!bouncer || typeof bouncer !== 'object') {
            throw new Error('Malformed bouncer');
          }
          const lastDirChange = mapHostTime(bouncer.lastDirChange);
          const lastMultiply = mapHostTime(bouncer.lastMultiply);
          const processedZoneKbs = Array.isArray(bouncer.processedZoneKbs)
            ? bouncer.processedZoneKbs.map((t: any) => mapHostTime(t))
            : undefined;
          return {
            ...bouncer,
            lastDirChange,
            lastMultiply,
            ...(processedZoneKbs !== undefined ? { processedZoneKbs } : {})
          };
        });

        mappedZones = (state.zones || []).map((zone: any) => {
          if (!zone || typeof zone !== 'object') {
            throw new Error('Malformed zone');
          }
          return {
            ...zone,
            spawnTime: mapHostTime(zone.spawnTime)
          };
        });

        mappedHostPlayer = state.hostPlayer ? mapPlayerSnapshot(state.hostPlayer) : undefined;

        mappedMultiplayerPlayers = {};
        if (state.multiplayerPlayers && typeof state.multiplayerPlayers === 'object') {
          for (const pid in state.multiplayerPlayers) {
            mappedMultiplayerPlayers[pid] = mapPlayerSnapshot(state.multiplayerPlayers[pid]);
          }
        }

        mappedIncomingBullets = (state.bullets || []).map((ib: any) => {
          if (!ib || typeof ib !== 'object') {
            throw new Error('Malformed bullet');
          }
          return {
            ...ib,
            spawnTime: mapHostTime(ib.spawnTime)
          };
        });
        mappedBulletSnapshotTime = mapHostTime(state.hostTime);
        mappedBulletEvents = (state.bulletEvents || []).map((rawEvent: any) => {
          if (!rawEvent || typeof rawEvent !== 'object') {
            throw new Error('Malformed bullet event');
          }
          const mappedEvent = {
            ...rawEvent,
            hostTime: mapHostTime(rawEvent.hostTime),
          };
          if (rawEvent.state !== undefined) {
            mappedEvent.state = {
              ...rawEvent.state,
              spawnTime: mapHostTime(rawEvent.state.spawnTime),
            };
          }
          return mappedEvent;
        });

        if (state.playerActionAuthority !== undefined) {
          if (state.playerActionAuthority && typeof state.playerActionAuthority === 'object') {
            mappedPlayerActionAuthority = {};
            for (const pid in state.playerActionAuthority) {
              const hostAuth = state.playerActionAuthority[pid];
              if (hostAuth && typeof hostAuth === 'object') {
                mappedPlayerActionAuthority[pid] = {
                  specialActiveUntil: mapHostTime(hostAuth.specialActiveUntil),
                  specialReadyAt: mapHostTime(hostAuth.specialReadyAt),
                  buildActiveUntil: mapHostTime(hostAuth.buildActiveUntil),
                  buildReadyAt: mapHostTime(hostAuth.buildReadyAt),
                  lastShootAt: mapHostTime(hostAuth.lastShootAt)
                };
              }
            }
          } else {
            throw new Error('Malformed playerActionAuthority');
          }
        }

        mappedFinalRunDeadline = (state.finalRunDeadline !== null && state.finalRunDeadline !== undefined)
          ? mapHostTime(state.finalRunDeadline)
          : null;

        mappedOpeningProtectionDeadline = (state.openingProtectionDeadline !== null && state.openingProtectionDeadline !== undefined)
          ? mapHostTime(state.openingProtectionDeadline)
          : null;

      } catch (e) {
        return;
      }

      // 4. Watchdog Correctness: (Requirement 16)
      lastReceivedGameStateTimeRef.current = performance.now();

      // 5. Successful resume snapshot installation (Requirement 8 & 15)
      if (awaitingResumeSnapshotRef.current) {
        let hostSnap: any = null;
        if (mappedMultiplayerPlayers[myId]) {
          hostSnap = mappedMultiplayerPlayers[myId];
        } else if (mappedHostPlayer && state.hostId === myId) {
          hostSnap = mappedHostPlayer;
        }
        if (hostSnap && typeof hostSnap.x === 'number' && Number.isFinite(hostSnap.x) && typeof hostSnap.y === 'number' && Number.isFinite(hostSnap.y)) {
          stateRef.current.player.x = hostSnap.x;
          stateRef.current.player.y = hostSnap.y;
          if (typeof hostSnap.kbvx === 'number' && Number.isFinite(hostSnap.kbvx)) {
            stateRef.current.player.kbvx = hostSnap.kbvx;
          }
          if (typeof hostSnap.kbvy === 'number' && Number.isFinite(hostSnap.kbvy)) {
            stateRef.current.player.kbvy = hostSnap.kbvy;
          }
          releaseAllInputs();
          awaitingResumeSnapshotRef.current = false;
        }
      }

      if (typeof state.worldPhaseTime === 'number' && Number.isFinite(state.worldPhaseTime) && state.worldPhaseTime >= 0) {
        multiplayerWorldPhaseAnchorRef.current = {
          phaseAtAnchor: state.worldPhaseTime,
          localTimeAtAnchor: performance.now(),
          initialized: true,
        };
      }

      if (state.matchPhase !== undefined) {
        if (state.matchPhase !== stateRef.current.matchPhase) {
          setCurrentMatchPhase(state.matchPhase);
        }
        stateRef.current.matchPhase = state.matchPhase;
      }

      if (state.finalRunnerId !== undefined) stateRef.current.finalRunnerId = state.finalRunnerId;
      stateRef.current.finalRunDeadline = mappedFinalRunDeadline;

      if (state.openingProtectionDeadline !== undefined) {
        awaitingOpeningProtectionAuthorityRef.current = false;
        stateRef.current.openingProtectionDeadline = mappedOpeningProtectionDeadline;
        mappedProtectionDeadlineRef.current = mappedOpeningProtectionDeadline;
      }

      if (state.winnerId !== undefined) stateRef.current.winnerId = state.winnerId;

      if (state.matchPlayers !== undefined) {
        const prevMe = stateRef.current.matchPlayers[myId];
        const incomingMe = state.matchPlayers[myId];
        if (prevMe && incomingMe && !prevMe.isDead && incomingMe.isDead && uiRef.current.status === 'PLAYING') {
          triggerEndPresentation({
            outcome: 'defeat',
            causeCode: 'eliminated_by_host',
            label: 'ELIMINATED',
            impactPos: { x: stateRef.current.player.x, y: stateRef.current.player.y },
            markerColor: '#ff003c',
            startTimestamp: performance.now(),
          });
          setUiState(prev => {
            uiRef.current = { ...prev, status: 'GAME_OVER' };
            return uiRef.current;
          });
        }
        stateRef.current.matchPlayers = state.matchPlayers;
      }

      // Action Authority Mapping (Requirement 11 & 15)
      if (mappedPlayerActionAuthority !== undefined) {
        stateRef.current.playerActionAuthority = mappedPlayerActionAuthority;

        pendingSpecialRequestRef.current = null;
        pendingBuildRequestRef.current = null;

        const myAuth = mappedPlayerActionAuthority[myId];
        if (myAuth &&
            Number.isFinite(myAuth.specialActiveUntil) &&
            Number.isFinite(myAuth.specialReadyAt) &&
            Number.isFinite(myAuth.buildActiveUntil) &&
            Number.isFinite(myAuth.buildReadyAt)) {

          const dash = stateRef.current.player.dash;
          const build = stateRef.current.player.build;
          const localNow = performance.now();

          const specialActive = localNow < myAuth.specialActiveUntil;
          dash.active = specialActive;
          dash.endTime = myAuth.specialActiveUntil;

          const buildActive = localNow < myAuth.buildActiveUntil;
          const prevBuildActive = build.active;
          build.active = buildActive;
          build.endTime = myAuth.buildActiveUntil;

          if (!prevBuildActive && buildActive) {
            build.lastBlockX = -999999;
            build.lastBlockY = -999999;
          }
        }
      }

      // Deadlines handling (Requirement 12)
      if (state.matchPhase === 'FINAL_RUN' && mappedFinalRunDeadline !== null) {
        mappedClientDeadlineRef.current = mappedFinalRunDeadline;
      } else if (state.matchPhase !== 'FINAL_RUN') {
        mappedClientDeadlineRef.current = null;
      }

      if (state.matchPhase === 'FINISHED' && uiRef.current.status === 'PLAYING') {
        triggerMultiplayerMatchConclusion(state.winnerId);
        setUiState(prev => ({ ...prev, status: 'GAME_OVER' }));
      }

      // Delta tracking for client-side visual particle effects on death (Requirement 15)
      const prevEnemies = stateRef.current.enemies || [];
      const prevSpawners = stateRef.current.spawners || [];
      const prevBlocks = stateRef.current.blocks || [];

      stateRef.current.blocks = mappedBlocks;
      stateRef.current.spawners = state.spawners;

      const newEnemies = mappedEnemies;
      if (prevEnemies.length > newEnemies.length) {
        for (const oldEnemy of prevEnemies) {
          const stillAlive = newEnemies.some((e: any) => Math.abs(e.x - oldEnemy.x) < 5 && Math.abs(e.y - oldEnemy.y) < 5);
          if (!stillAlive) {
            spawnParticlesDirect(oldEnemy.x, oldEnemy.y, '#ff3333', 25);
          }
        }
      }

      const newSpawners = state.spawners || [];
      if (prevSpawners.length > newSpawners.length) {
        for (const oldSpawner of prevSpawners) {
          const stillAlive = newSpawners.some((s: any) => Math.abs(s.x - oldSpawner.x) < 5 && Math.abs(s.y - oldSpawner.y) < 5);
          if (!stillAlive) {
            const spawnerColor = uiRef.current.hardMode ? '#ff3300' : '#ff00ff';
            spawnParticlesDirect(oldSpawner.x, oldSpawner.y, spawnerColor, 80);
            stateRef.current.shockwaves.push({ x: oldSpawner.x, y: oldSpawner.y, color: spawnerColor, maxRadius: 200, age: 0, maxAge: 0.5, thickness: 20 });
            handleSpawnerDestroyed(oldSpawner);
          }
        }
      }

      const newBlocks = mappedBlocks;
      if (prevBlocks.length > newBlocks.length) {
        for (const oldBlock of prevBlocks) {
          const stillAlive = newBlocks.some((b: any) => Math.abs(b.x - oldBlock.x) < 5 && Math.abs(b.y - oldBlock.y) < 5);
          if (!stillAlive) {
            spawnParticlesDirect(oldBlock.x, oldBlock.y, '#ffcc00', 15);
          }
        }
      }

      // Client-side smooth coordinates interpolation (Requirement 15)
      const receivedPlayers = { ...mappedMultiplayerPlayers, [state.hostId]: mappedHostPlayer };
      delete receivedPlayers[myId];

      const mergedPlayers: Record<string, any> = {};
      for (const pid in receivedPlayers) {
        const incoming = receivedPlayers[pid];
        if (!incoming) continue;

        const prev = stateRef.current.multiplayerPlayers[pid];
        if (prev) {
          if (!prev.isDead && incoming.isDead) {
            triggerEliminationRef.current?.(incoming.x, incoming.y, incoming.colorIdx !== undefined ? incoming.colorIdx : 0, incoming.name || 'PLAYER');
          }
          mergedPlayers[pid] = {
            ...incoming,
            x: prev.x,
            y: prev.y,
            targetX: incoming.x,
            targetY: incoming.y
          };
        } else {
          mergedPlayers[pid] = {
            ...incoming,
            targetX: incoming.x,
            targetY: incoming.y
          };
        }
      }
      stateRef.current.multiplayerPlayers = mergedPlayers;

      // Direct dead-reckoned synchronization using mapped data (Requirement 15)
      stateRef.current.enemies = mappedEnemies;
      stateRef.current.bouncers = mappedBouncers;
      stateRef.current.zones = mappedZones;

      // Multiplayer bullets use a reliable authoritative event timeline. Normal
      // snapshots only confirm the playback horizon and recover reconnects;
      // they never pull an existing visual bullet toward a moving target.
      let bulletTimeline = guestBulletTimelineRef.current;
      if (!bulletTimeline ||
          bulletTimeline.roundId !== activeRoundId ||
          bulletTimeline.hostId !== state.hostId) {
        bulletTimeline = createGuestBulletTimeline(activeRoundId, state.hostId);
        guestBulletTimelineRef.current = bulletTimeline;
        guestBulletGapRequestedRef.current = false;
      }

      const ingestResult = ingestAuthoritativeBulletEvents(bulletTimeline, mappedBulletEvents);
      const snapshotSequence = Number.isInteger(state.bulletEventSequence) && state.bulletEventSequence >= 0
        ? state.bulletEventSequence
        : bulletTimeline.lastSequence;
      const needsRecovery = ingestResult.gap !== null || snapshotSequence > bulletTimeline.lastSequence;
      confirmAuthoritativeBulletSnapshot(
        bulletTimeline,
        mappedIncomingBullets as AuthoritativeBulletState[],
        mappedBulletSnapshotTime,
        snapshotSequence,
        needsRecovery,
      );

      if (needsRecovery && !guestBulletGapRequestedRef.current) {
        guestBulletGapRequestedRef.current = true;
        socket.emit('request_bullet_snapshot', normRoomId, { roundId: activeRoundId });
      } else if (!needsRecovery) {
        guestBulletGapRequestedRef.current = false;
      }

      const sampledGuestBullets = sampleGuestBulletTimeline(
        bulletTimeline,
        performance.now(),
      ).bullets;

      for (const [shotId, pending] of pendingGuestShotsRef.current.entries()) {
        if (pending.roundId !== activeRoundId) {
          pendingGuestShotsRef.current.delete(shotId);
          continue;
        }
        const matchingSpawn = mappedBulletEvents.find(event =>
          event.type === 'spawn' && event.state?.clientShotId === pending.clientShotId);
        if (matchingSpawn) {
          pending.status = 'accepted';
          pending.authoritativeBulletId = matchingSpawn.bulletId;
          pending.authoritativeSeen = true;
        }
        const matchingSnapshot = mappedIncomingBullets.find((bullet: any) =>
          bullet.clientShotId === pending.clientShotId || bullet.id === pending.authoritativeBulletId);
        if (matchingSnapshot) {
          pending.status = 'accepted';
          pending.authoritativeBulletId = matchingSnapshot.id;
          pending.authoritativeSeen = true;
        }
        const matchingTransform = pending.authoritativeBulletId
          ? [...mappedBulletEvents].reverse().find(event =>
              event.bulletId === pending.authoritativeBulletId && event.type === 'transform' && event.state)
          : undefined;
        if (matchingTransform?.state && pending.preview && pending.preview.endingAt === undefined) {
          // Apply authoritative rule changes without copying the delayed host
          // position into the local visual.
          pending.preview.dx = matchingTransform.state.dx;
          pending.preview.dy = matchingTransform.state.dy;
          pending.preview.isNeutral = matchingTransform.state.isNeutral;
          pending.preview.colorIdx = matchingTransform.state.colorIdx ?? pending.preview.colorIdx;
          pending.preview.lastUpdateTime = performance.now();
        }
        const terminalEvent = pending.authoritativeBulletId
          ? mappedBulletEvents.find(event =>
              event.bulletId === pending.authoritativeBulletId &&
              (event.type === 'hit' || event.type === 'remove'))
          : undefined;
        if (terminalEvent) {
          if (pending.preview && pending.preview.endingAt === undefined) {
            const visual = pending.preview;
            visual.endingAt = performance.now();
            const colorDef = PLAYER_COLORS[visual.colorIdx] || PLAYER_COLORS[0];
            const impactColor = visual.isNeutral ? '#aaaaaa' : colorDef.n;
            spawnParticlesDirect(visual.x, visual.y, impactColor, 8);
            stateRef.current.shockwaves.push({
              x: visual.x,
              y: visual.y,
              color: impactColor,
              maxRadius: 24,
              age: 0,
              maxAge: 0.12,
              thickness: 3,
            });
          }
        } else if (pending.authoritativeSeen && !matchingSnapshot && pending.preview?.endingAt === undefined) {
          // Full snapshots are authoritative recovery. If a previously seen
          // bullet is absent, end its visual even if a terminal event was lost.
          pending.preview.endingAt = performance.now();
        }
        const authoritativeStillBuffered = sampledGuestBullets.some((bullet: any) =>
          bullet.clientShotId === pending.clientShotId || bullet.id === pending.authoritativeBulletId);
        if (pending.preview?.endingAt !== undefined &&
            performance.now() - pending.preview.endingAt >= GUEST_SHOT_VISUAL_END_FADE_MS &&
            !authoritativeStillBuffered) {
          pendingGuestShotsRef.current.delete(shotId);
        }
      }

      stateRef.current.bullets = sampledGuestBullets.filter((bullet: any) => {
        if (bullet.ownerId !== myId) return true;
        return ![...pendingGuestShotsRef.current.values()].some(pending =>
          bullet.clientShotId === pending.clientShotId || bullet.id === pending.authoritativeBulletId);
      });

      if (uiRef.current.status === 'PLAYING') {
        const targetScore = (mappedMultiplayerPlayers[myId] !== undefined)
          ? (mappedMultiplayerPlayers[myId].score || 0)
          : uiRef.current.score;

        if (state.spawnersLeft === 0 && !mpRef.current.roomId) {
          uiRef.current.status = 'VICTORY';
          uiRef.current.score = targetScore;
          setUiState(prev => ({ ...prev, status: 'VICTORY', score: targetScore, spawnersLeft: 0 }));
        } else if (uiRef.current.score !== targetScore || uiRef.current.spawnersLeft !== state.spawnersLeft || uiRef.current.blocks !== state.blocksLeft) {
          uiRef.current.score = targetScore;
          uiRef.current.spawnersLeft = state.spawnersLeft;
          uiRef.current.blocks = state.blocksLeft;
          setUiState(prev => ({ ...prev, score: targetScore, spawnersLeft: state.spawnersLeft, blocks: state.blocksLeft }));
        }
      }
      setMpTick(t => t + 1);
    });

    socket.on('client_input', (clientId, input) => {
      // A. Authority checks
      if (!mpRef.current.isHost) return;
      if (!input || typeof input !== 'object') return;
      if (!isCurrentRoom(input.roomId)) return;
      if (typeof input.roundId !== 'number' || input.roundId !== activeMultiplayerRoundIdRef.current) return;

      const matchPlayer = stateRef.current.matchPlayers[clientId];
      const prevPlayer = stateRef.current.multiplayerPlayers[clientId];
      if (!matchPlayer || !prevPlayer) return;

      if (matchPlayer.isDead || matchPlayer.isDisconnected) return;
      if (prevPlayer.isDead) return;

      // B. Coordinate validation
      if (!input || typeof input !== 'object') return;
      if (typeof input.x !== 'number' || !Number.isFinite(input.x)) return;
      if (typeof input.y !== 'number' || !Number.isFinite(input.y)) return;

      const resolved = sweptMultiplayerPlayerResolve(prevPlayer.x, prevPlayer.y, input.x, input.y, PLAYER_RADIUS, activeWalls);
      const clampedX = resolved.x;
      const clampedY = resolved.y;

      if (resolved.clamped || resolved.collided) {
        stateRef.current.forceBroadcast = true;
      }

      const currentTime = performance.now();

      // D. Authoritative dash state
      const authority = getOrInitializeAuthority(clientId);
      const isDash = currentTime < authority.specialActiveUntil;

      // C. Preserve authoritative fields
      const score = (prevPlayer.score !== undefined) ? prevPlayer.score : (matchPlayer.score || 0);

      const isProtected = isOpeningProtectionActiveForHost(currentTime) || isDash;

      if (!isProtected) {
        const startX = prevPlayer.x;
        const startY = prevPlayer.y;
        const endX = clampedX;
        const endY = clampedY;

        const candidates: {
          type: 'enemy' | 'bouncer' | 'relic' | 'bullet';
          t: number;
          impactX: number;
          impactY: number;
          stableKey: string;
          ref?: any;
        }[] = [];

        // 1. Enemies
        const enemies = stateRef.current.enemies || [];
        enemies.forEach((enemy: any, index: number) => {
          if (!enemy) return;
          const combinedRadius = PLAYER_RADIUS + (enemy.radius || 16);
          const hit = segmentVersusCircle(startX, startY, endX, endY, enemy.x, enemy.y, combinedRadius);
          if (hit !== null) {
            const enemyId = enemy.id !== undefined ? String(enemy.id) : `enemy_${index}`;
            candidates.push({
              type: 'enemy',
              t: hit.t,
              impactX: hit.x,
              impactY: hit.y,
              stableKey: enemyId
            });
          }
        });

        // 2. Bouncers
        const bouncers = stateRef.current.bouncers || [];
        bouncers.forEach((bouncer: any, index: number) => {
          if (!bouncer) return;
          const combinedRadius = PLAYER_RADIUS + (bouncer.radius || 24);
          const hit = segmentVersusCircle(startX, startY, endX, endY, bouncer.x, bouncer.y, combinedRadius);
          if (hit !== null) {
            const bouncerId = bouncer.id !== undefined ? String(bouncer.id) : `bouncer_${index}`;
            candidates.push({
              type: 'bouncer',
              t: hit.t,
              impactX: hit.x,
              impactY: hit.y,
              stableKey: bouncerId
            });
          }
        });

        // 3. Orbiting relic obstacles
        const spawners = stateRef.current.spawners || [];
        const currentPhase = getMultiplayerWorldPhaseTime(currentTime);
        const relicHit = sweptMultiplayerBulletRelicCollision(
          startX,
          startY,
          endX,
          endY,
          PLAYER_RADIUS,
          spawners,
          currentPhase,
          currentPhase
        );
        if (relicHit !== null) {
          const t = relicHit.t;
          const impactX = startX + t * (endX - startX);
          const impactY = startY + t * (endY - startY);
          const spawnerIndex = spawners.indexOf(relicHit.spawner);
          const stableKey = `relic_${spawnerIndex}_${relicHit.specialType}`;
          candidates.push({
            type: 'relic',
            t: t,
            impactX,
            impactY,
            stableKey
          });
        }

        // 4. Host-authoritative bullets
        const bullets = stateRef.current.bullets || [];
        const remotePlayerColorIdx = matchPlayer.colorIdx !== undefined ? matchPlayer.colorIdx : 0;
        const remotePlayerColorDef = PLAYER_COLORS[remotePlayerColorIdx] || PLAYER_COLORS[0];
        const remotePlayerColor = remotePlayerColorDef?.n || '#00f0ff';

        bullets.forEach((bullet: any, index: number) => {
          if (!bullet) return;

          let bulletColor = '#ff0066';
          if (bullet.isNeutral) {
            bulletColor = '#aaaaaa';
          } else if (bullet.isPlayer) {
            const pDef = PLAYER_COLORS[bullet.colorIdx !== undefined ? bullet.colorIdx : 0] || PLAYER_COLORS[0];
            bulletColor = pDef?.n || '#00f0ff';
          }

          if (bulletColor === remotePlayerColor) {
            return;
          }

          const combinedRadius = PLAYER_RADIUS + (bullet.radius || 6) * 0.5;
          const hit = segmentVersusCircle(startX, startY, endX, endY, bullet.x, bullet.y, combinedRadius);
          if (hit !== null) {
            const bulletId = bullet.id !== undefined ? String(bullet.id) : `bullet_${index}`;
            candidates.push({
              type: 'bullet',
              t: hit.t,
              impactX: hit.x,
              impactY: hit.y,
              stableKey: bulletId,
              ref: bullet
            });
          }
        });

        if (candidates.length > 0) {
          candidates.sort((a, b) => {
            if (Math.abs(a.t - b.t) > 1e-9) {
              return a.t - b.t;
            }
            return a.stableKey.localeCompare(b.stableKey);
          });

          const winner = candidates[0];

          stateRef.current.multiplayerPlayers[clientId] = {
            ...prevPlayer,
            x: winner.impactX,
            y: winner.impactY,
            isDead: prevPlayer.isDead,
            isDash,
            radius: PLAYER_RADIUS,
            name: matchPlayer.name,
            colorIdx: matchPlayer.colorIdx,
            score
          };

          if (winner.type === 'bullet' && winner.ref) {
            const currentBullets = stateRef.current.bullets || [];
            let removeIndex = currentBullets.findIndex((b: any) => b === winner.ref);
            if (removeIndex === -1 && winner.ref.id !== undefined && winner.ref.id !== null && String(winner.ref.id).trim() !== '') {
              const targetId = String(winner.ref.id);
              removeIndex = currentBullets.findIndex((b: any) => b && b.id !== undefined && b.id !== null && String(b.id) === targetId);
            }
            if (removeIndex !== -1) {
              currentBullets.splice(removeIndex, 1);
            }
          }

          stateRef.current.forceBroadcast = true;
          eliminateRemotePlayerRef.current?.(clientId, { x: winner.impactX, y: winner.impactY }, currentTime);
          setMpTick(t => t + 1);
          return;
        }
      }

      stateRef.current.multiplayerPlayers[clientId] = {
        ...prevPlayer,
        x: clampedX,
        y: clampedY,
        isDead: prevPlayer.isDead,
        isDash,
        radius: PLAYER_RADIUS,
        name: matchPlayer.name,
        colorIdx: matchPlayer.colorIdx,
        score
      };

      setMpTick(t => t + 1);
    });

    socket.on('client_action', (clientId, action) => {
       if (mpRef.current.isHost) {
          if (!action || typeof action !== 'object') return;
          if (!isCurrentRoom(action.roomId)) return;
          if (typeof action.roundId !== 'number' || action.roundId !== activeMultiplayerRoundIdRef.current) return;
          // Confirm clientId exists in matchPlayers and multiplayerPlayers
          const matchPlayer = stateRef.current.matchPlayers[clientId];
          const clientPlayer = stateRef.current.multiplayerPlayers[clientId];
          if (!matchPlayer || !clientPlayer) {
            if (action && action.type === 'shoot' && typeof action.clientShotId === 'string' && action.clientShotId.length >= 1 && action.clientShotId.length <= 96 && /^[a-zA-Z0-9_\-:]+$/.test(action.clientShotId)) {
              socket.emit('host_action_result', mpRef.current.roomId, {
                targetClientId: clientId,
                roundId: activeMultiplayerRoundIdRef.current,
                actionType: 'shoot',
                clientShotId: action.clientShotId,
                status: 'rejected',
                reason: 'missing_player_state'
              });
            }
            return;
          }

          // Reject if dead or disconnected
          if (matchPlayer.isDead || matchPlayer.isDisconnected || clientPlayer.isDead) {
            if (action && action.type === 'shoot' && typeof action.clientShotId === 'string') {
              socket.emit('host_action_result', mpRef.current.roomId, {
                targetClientId: clientId,
                roundId: activeMultiplayerRoundIdRef.current,
                actionType: 'shoot',
                clientShotId: action.clientShotId,
                status: 'rejected',
                reason: 'player_dead'
              });
            }
            return;
          }

          if (isOpeningProtectionActiveForHost(performance.now())) {
            if (action && action.type === 'shoot' && typeof action.clientShotId === 'string') {
              socket.emit('host_action_result', mpRef.current.roomId, {
                targetClientId: clientId,
                roundId: activeMultiplayerRoundIdRef.current,
                actionType: 'shoot',
                clientShotId: action.clientShotId,
                status: 'rejected',
                reason: 'opening_protection'
              });
            }
            if (action.type === 'shoot' || action.type === 'special' || action.type === 'build' || action.type === 'build_remove' || action.type === 'build_start') {
              return;
            }
          }

          if (action.type === 'shoot') {
               const clientShotId = action.clientShotId;
               if (typeof clientShotId !== 'string' || !clientShotId || clientShotId.length > 96 || !/^[a-zA-Z0-9_\-:]+$/.test(clientShotId)) {
                 return;
               }

               if (action.dx === undefined || typeof action.dx !== 'number' || !Number.isFinite(action.dx) ||
                   action.dy === undefined || typeof action.dy !== 'number' || !Number.isFinite(action.dy)) {
                 socket.emit('host_action_result', mpRef.current.roomId, {
                   targetClientId: clientId,
                   roundId: activeMultiplayerRoundIdRef.current,
                   actionType: 'shoot',
                   clientShotId,
                   status: 'rejected',
                   reason: 'invalid_vector'
                 });
                 return;
               }

               if (action.x === undefined || typeof action.x !== 'number' || !Number.isFinite(action.x) ||
                   action.y === undefined || typeof action.y !== 'number' || !Number.isFinite(action.y)) {
                 socket.emit('host_action_result', mpRef.current.roomId, {
                   targetClientId: clientId,
                   roundId: activeMultiplayerRoundIdRef.current,
                   actionType: 'shoot',
                   clientShotId,
                   status: 'rejected',
                   reason: 'invalid_origin'
                 });
                 return;
               }

               const len = Math.sqrt(action.dx * action.dx + action.dy * action.dy);
               if (len < 0.0001) {
                 socket.emit('host_action_result', mpRef.current.roomId, {
                   targetClientId: clientId,
                   roundId: activeMultiplayerRoundIdRef.current,
                   actionType: 'shoot',
                   clientShotId,
                   status: 'rejected',
                   reason: 'invalid_vector'
                 });
                 return;
               }

               const currentTime = performance.now();
               const auth = getOrInitializeAuthority(clientId);
               if (currentTime - auth.lastShootAt < FIRE_RATE) {
                 socket.emit('host_action_result', mpRef.current.roomId, {
                   targetClientId: clientId,
                   roundId: activeMultiplayerRoundIdRef.current,
                   actionType: 'shoot',
                   clientShotId,
                   status: 'rejected',
                   reason: 'rate_limit'
                 });
                 return;
               }

               auth.lastShootAt = currentTime;

               const clientAllowedKeys: string[] = [];
               if (clientPlayer.recentBlocks) {
                 for (const rb of clientPlayer.recentBlocks) {
                   const blockObj = stateRef.current.blocks.find(b => b.x === rb.x && b.y === rb.y);
                   if (blockObj) {
                     const comp = getConnectedComponent(blockObj, stateRef.current.blocks.filter(b => b.colorIdx === blockObj.colorIdx));
                     for (const cb of comp) {
                       const cbKey = `${cb.x}_${cb.y}`;
                       if (!clientAllowedKeys.includes(cbKey)) {
                         clientAllowedKeys.push(cbKey);
                       }
                     }
                   }
                 }
               }

               const bvx = (action.dx / len) * BULLET_SPEED;
               const bvy = (action.dy / len) * BULLET_SPEED;
               const authoritativeBulletId = 'bl_' + stateRef.current.nextEntityId++;
               const requestedShotTime = typeof action.shotHostTime === 'number' && Number.isFinite(action.shotHostTime)
                 ? action.shotHostTime
                 : currentTime;
               // Bound lag compensation so a forged or badly skewed client
               // clock cannot rewind a shot arbitrarily far into the round.
               const authoritativeShotTime = Math.max(
                 currentTime - 300,
                 Math.min(currentTime, requestedShotTime)
               );
               // The reliable shoot action carries the guest's position from
               // the exact local firing frame. Volatile movement packets can
               // be dropped, so using only clientPlayer.x/y makes every shot
               // originate from an older position. Resolve that requested
               // origin through the same bounded swept wall validation used by
               // normal guest movement; the host still owns the accepted
               // origin, bullet simulation, collisions, damage, and removal.
               const shotOrigin = sweptMultiplayerPlayerResolve(
                 clientPlayer.x,
                 clientPlayer.y,
                 action.x,
                 action.y,
                 PLAYER_RADIUS,
                 activeWalls
               );

               stateRef.current.bullets.push({
                 id: authoritativeBulletId,
                 clientShotId,
                 x: shotOrigin.x,
                 y: shotOrigin.y,
                 dx: bvx,
                 dy: bvy,
                 radius: BULLET_RADIUS,
                 isPlayer: true,
                 bounceCount: 0,
                 spawnTime: authoritativeShotTime,
                 multiplayerCatchUpFromTime: authoritativeShotTime,
                 isNeutral: false,
                 ownerId: clientId,
                 colorIdx: matchPlayer.colorIdx,
                 allowedBlockKeys: clientAllowedKeys,
                 leftBlockKeys: []
               });

               socket.emit('host_action_result', mpRef.current.roomId, {
                 targetClientId: clientId,
                 roundId: activeMultiplayerRoundIdRef.current,
                 actionType: 'shoot',
                 clientShotId,
                 status: 'accepted',
                 authoritativeBulletId
               });
          } else if (action.type === 'special') {
              const currentTime = performance.now();
              const auth = getOrInitializeAuthority(clientId);

              if (currentTime >= auth.specialReadyAt) {
                  auth.specialActiveUntil = currentTime + 6000;
                  auth.specialReadyAt = currentTime + 6000 + DASH_COOLDOWN;
                  clientPlayer.isDash = true;

                  // Use authoritative player position and frozen color
                  applySpecialAbility(clientPlayer.x, clientPlayer.y, matchPlayer.colorIdx, clientId);
              }
              stateRef.current.forceBroadcast = true;
          } else if (action.type === 'build_start') {
              const currentTime = performance.now();
              const auth = getOrInitializeAuthority(clientId);

              if (currentTime >= auth.buildReadyAt) {
                  auth.buildActiveUntil = currentTime + 8000;
                  auth.buildReadyAt = currentTime + 8000 + BUILD_COOLDOWN;
              }
              stateRef.current.forceBroadcast = true;
          } else if (action.type === 'build') {
              const currentTime = performance.now();
              const auth = getOrInitializeAuthority(clientId);
              if (currentTime >= auth.buildActiveUntil) return;

              if (action.x === undefined || typeof action.x !== 'number' || !Number.isFinite(action.x) ||
                  action.y === undefined || typeof action.y !== 'number' || !Number.isFinite(action.y)) return;

              authMultiplayerPlaceBlock(
                  clientId,
                  clientPlayer,
                  action.x,
                  action.y,
                  matchPlayer.colorIdx,
                  currentTime
              );
          } else if (action.type === 'build_remove') {
              // Harmless ignored legacy action: do not mutate authoritative game state
          }
        }
    });

    socket.on('bullet_snapshot_requested', (request: any) => {
      if (!mpRef.current.isHost || !request || typeof request !== 'object') return;
      if (!isCurrentRoom(request.roomId)) return;
      if (request.roundId !== activeMultiplayerRoundIdRef.current) return;
      stateRef.current.forceBroadcast = true;
      stateRef.current.lastBroadcastTime = 0;
    });

    return () => {
      roomRequestGenerationRef.current++;
      roomRequestInFlightRef.current = false;
      setPendingRoomRequest(null);

      cancelPendingMatchSettingsUpdate();
      clearPendingGuestShots(true);
      clearPendingAbilityRequests();
      resetHostClockAnchor();
      invalidateStartRequestGeneration(true);
      currentRoomRoundIdRef.current = 0;
      activeMultiplayerRoundIdRef.current = 0;
      lobbyPlayersRef.current = {};
      setLobbyPlayers({});
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (mpState.isConnected) {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room') || params.get('join');
      if (roomParam) {
        if (inviteJoinHandledRef.current) {
          return;
        }
        inviteJoinHandledRef.current = true;

        if (window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        if (roomRequestInFlightRef.current) {
          return;
        }

        const cleanRoom = roomParam.trim().toUpperCase();

        if (!/^[A-Z0-9]{4}$/.test(cleanRoom)) {
          setMpState(prev => ({
            ...prev,
            joinCode: '',
            error: 'INVALID ROOM CODE'
          }));
          return;
        }

        setUiState(prev => ({ ...prev, status: 'LOBBY' }));
        setMpState(prev => ({
          ...prev,
          joinCode: cleanRoom,
          error: ''
        }));

        executeRoomRequest('join', 'join_room', {
          code: cleanRoom,
          profile: { name: playerProfileRef.current.name }
        });
      }
    }
  }, [mpState.isConnected, executeRoomRequest]);

  useEffect(() => {
    if (uiState.status === 'GAME_OVER' || uiState.status === 'VICTORY' || uiState.status === 'MENU') {
      setMpMenuOpen(false);
      mpMenuOpenRef.current = false;
      setConfirmResign(false);
      confirmResignRef.current = false;
    }
  }, [uiState.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const state = stateRef.current;

    const eliminateRemotePlayer = (victimId: string, impactPos: { x: number, y: number }, currentTime: number) => {
      if (!mpRef.current.isHost) return;

      const state = stateRef.current;
      const mpPlayer = state.multiplayerPlayers[victimId];
      const matchPlayer = state.matchPlayers[victimId];

      if (!mpPlayer || !matchPlayer) return;
      if (mpPlayer.isDead || matchPlayer.isDead || matchPlayer.isDisconnected) return;

      if (isOpeningProtectionActiveForHost(currentTime)) return;

      mpPlayer.isDead = true;
      matchPlayer.isDead = true;

      triggerEliminationRef.current?.(mpPlayer.x, mpPlayer.y, mpPlayer.colorIdx !== undefined ? mpPlayer.colorIdx : 0, matchPlayer.name);

      state.forceBroadcast = true;
    };
    eliminateRemotePlayerRef.current = eliminateRemotePlayer;

    const handleResize = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w;
      canvas.height = h;
      state.camera.width = w;
      state.camera.height = h;
      state.lastTime = performance.now();
      setContainerSize({ width: w, height: h });
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        if (!entries || entries.length === 0) return;
        handleResize();
      });
      resizeObserver.observe(wrapper);
    } else {
      window.addEventListener('resize', handleResize);
    }
    handleResize();

    const canAcceptGameplayInput = () => {
      if (document.hidden || !document.hasFocus()) return false;
      if (mpRef.current.roomId && !mpRef.current.isConnected) return false;
      return true;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (key === 'escape') {
        if (mpRef.current.roomId) {
          if (confirmResignRef.current) {
            setConfirmResign(false);
            confirmResignRef.current = false;
            setMpMenuOpen(true);
            mpMenuOpenRef.current = true;
          } else {
            setMpMenuOpen(prev => {
              const next = !prev;
              mpMenuOpenRef.current = next;
              if (next) {
                releaseAllInputs();
              }
              return next;
            });
          }
        } else {
          if (uiRef.current.status === 'PAUSED' && confirmResignRef.current) return;
          if (uiRef.current.status === 'PLAYING') {
            beginSinglePlayerPause();
          } else if (uiRef.current.status === 'PAUSED') {
            resumeSinglePlayerFromPause();
          }
        }
        return;
      }

      if (!canAcceptGameplayInput()) {
        return;
      }

      // Silently ignore inputs if multiplayer menu or resignation is active
      const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
      if (isLocalMenuOpen) {
        return;
      }

      if (key === 'w') state.keys.w = true;
      if (key === 'a') state.keys.a = true;
      if (key === 's') state.keys.s = true;
      if (key === 'd') state.keys.d = true;

      const currentTime = performance.now();

      if (key === '1') {
         if (uiRef.current.status === 'PLAYING') {
            requestSpecialActivation(currentTime);
         }
      }
      if (key === '2') {
         if (uiRef.current.status === 'PLAYING') {
            requestBuildActivation(currentTime);
         }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') state.keys.w = false;
      if (key === 'a') state.keys.a = false;
      if (key === 's') state.keys.s = false;
      if (key === 'd') state.keys.d = false;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = e.clientX - rect.left;
      state.mouse.y = e.clientY - rect.top;
      state.mouse.worldX = state.mouse.x + state.camera.x;
      state.mouse.worldY = state.mouse.y + state.camera.y;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!canAcceptGameplayInput()) return;
      if (e.target !== canvas) return;
      if (uiRef.current.status !== 'PLAYING') return;
      if (mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current)) {
         return;
      }
      if (e.button === 2) {
         state.mouse.rightDown = true;
         state.mouse.rightJustDown = true;
      } else {
         state.mouse.down = true;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.target !== canvas) return;
      if (e.button === 2) {
         state.mouse.rightDown = false;
      } else {
         state.mouse.down = false;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (document.hidden) return;
      if (uiRef.current.status !== 'PLAYING') return; // let normal touches pass
      if (mpRef.current.roomId && !mpRef.current.isConnected) return;
      if (mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current)) {
         return;
      }

      const isMobile = uiRef.current.deviceType === 'mobile';

      // Recover from stale touch identifiers if touches were lost/reset
      const activeTouchIds = new Set<number>();
      for (let i = 0; i < e.touches.length; i++) {
        activeTouchIds.add(e.touches[i].identifier);
      }

      if (state.touches.left.active && !activeTouchIds.has(state.touches.left.id)) {
        state.touches.left.active = false;
        state.touches.left.id = -1;
        state.touches.left.dirX = 0;
        state.touches.left.dirY = 0;
        if (isMobile) {
          state.touches.left.currentX = state.touches.left.startX;
          state.touches.left.currentY = state.touches.left.startY;
        }
      }

      if (state.touches.right.active && !activeTouchIds.has(state.touches.right.id)) {
        state.touches.right.active = false;
        state.touches.right.id = -1;
        state.touches.right.dirX = 0;
        state.touches.right.dirY = 0;
        state.touches.right.aimLength = 0;
        state.touches.right.startTime = 0;
        state.touches.right.justReleased = false;
        state.touches.right.releaseDx = 0;
        state.touches.right.releaseDy = 0;
        if (isMobile) {
          state.touches.right.currentX = state.touches.right.startX;
          state.touches.right.currentY = state.touches.right.startY;
        }
      }

      e.preventDefault();
      const rect = canvas.getBoundingClientRect();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;

        if (isMobile) {
          const joyOffset = Math.min(160, Math.max(85, Math.floor(canvas.height * 0.22)));
          const leftJoyX = Math.min(80, Math.floor(canvas.width * 0.18));
          const leftJoyY = canvas.height - joyOffset;
          const rightJoyX = canvas.width - leftJoyX;
          const rightJoyY = canvas.height - joyOffset;
          const joyRadius = 120; // Radius for activation
          const maxDist = 40;

          if (!state.touches.left.active && (x - leftJoyX)**2 + (y - leftJoyY)**2 <= joyRadius**2) {
            state.touches.left.active = true;
            state.touches.left.id = t.identifier;
            state.touches.left.startX = leftJoyX;
            state.touches.left.startY = leftJoyY;

            let dx = x - leftJoyX;
            let dy = y - leftJoyY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxDist) {
              dx = (dx / dist) * maxDist;
              dy = (dy / dist) * maxDist;
            }
            state.touches.left.currentX = leftJoyX + dx;
            state.touches.left.currentY = leftJoyY + dy;
            state.touches.left.dirX = dx / maxDist;
            state.touches.left.dirY = dy / maxDist;
          } else if (!state.touches.right.active && (x - rightJoyX)**2 + (y - rightJoyY)**2 <= joyRadius**2) {
            state.touches.right.active = true;
            state.touches.right.id = t.identifier;
            state.touches.right.startX = rightJoyX;
            state.touches.right.startY = rightJoyY;
            state.touches.right.startTime = performance.now();

            let dx = x - rightJoyX;
            let dy = y - rightJoyY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxDist) {
              dx = (dx / dist) * maxDist;
              dy = (dy / dist) * maxDist;
            }
            state.touches.right.currentX = rightJoyX + dx;
            state.touches.right.currentY = rightJoyY + dy;
            state.touches.right.dirX = dx / maxDist;
            state.touches.right.dirY = dy / maxDist;
          } else {
             state.touches.tap = { active: true, x, y };
          }
        } else {
          if (x < canvas.width / 2) {
            if (!state.touches.left.active) {
              state.touches.left.active = true;
              state.touches.left.id = t.identifier;
              state.touches.left.startX = x;
              state.touches.left.startY = y;
              state.touches.left.currentX = x;
              state.touches.left.currentY = y;
              state.touches.left.dirX = 0;
              state.touches.left.dirY = 0;
            }
          } else {
            if (!state.touches.right.active) {
              state.touches.right.active = true;
              state.touches.right.id = t.identifier;
              state.touches.right.startX = x;
              state.touches.right.startY = y;
              state.touches.right.currentX = x;
              state.touches.right.currentY = y;
              state.touches.right.dirX = 0;
              state.touches.right.dirY = 0;
              state.touches.right.startTime = performance.now();
            }
          }
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (uiRef.current.status !== 'PLAYING') return;
      if (mpRef.current.roomId && !mpRef.current.isConnected) return;
      const isMobile = uiRef.current.deviceType === 'mobile';
      const rect = canvas.getBoundingClientRect();
      const maxDist = 40;
      const joyOffset = Math.min(160, Math.max(85, Math.floor(canvas.height * 0.22)));
      const leftJoyX = Math.min(80, Math.floor(canvas.width * 0.18));
      const leftJoyY = canvas.height - joyOffset;
      const rightJoyX = canvas.width - leftJoyX;
      const rightJoyY = canvas.height - joyOffset;

      let processed = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;

        if (state.touches.left.active && t.identifier === state.touches.left.id) {
          processed = true;
          let dx = x - state.touches.left.startX;
          let dy = y - state.touches.left.startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
          }
          if (isMobile) {
            state.touches.left.currentX = leftJoyX + dx;
            state.touches.left.currentY = leftJoyY + dy;
          } else {
             state.touches.left.currentX = state.touches.left.startX + dx;
             state.touches.left.currentY = state.touches.left.startY + dy;
          }
          state.touches.left.dirX = dx / maxDist;
          state.touches.left.dirY = dy / maxDist;
        } else if (state.touches.right.active && t.identifier === state.touches.right.id) {
          processed = true;
          let dx = x - state.touches.right.startX;
          let dy = y - state.touches.right.startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
          }
          if (isMobile) {
            state.touches.right.currentX = rightJoyX + dx;
            state.touches.right.currentY = rightJoyY + dy;
          } else {
             state.touches.right.currentX = state.touches.right.startX + dx;
             state.touches.right.currentY = state.touches.right.startY + dy;
          }
          state.touches.right.dirX = dx / maxDist;
          state.touches.right.dirY = dy / maxDist;
        }
      }
      if (processed) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const isPlaying = uiRef.current.status === 'PLAYING';
      if (isPlaying) {
        e.preventDefault();
      }
      const isMobile = uiRef.current.deviceType === 'mobile';
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (state.touches.left.active && t.identifier === state.touches.left.id) {
          state.touches.left.active = false;
          state.touches.left.id = -1;
          state.touches.left.dirX = 0;
          state.touches.left.dirY = 0;
          if (isMobile) {
            state.touches.left.currentX = state.touches.left.startX;
            state.touches.left.currentY = state.touches.left.startY;
          }
        }
        if (state.touches.right.active && t.identifier === state.touches.right.id) {
          if (isPlaying) {
            state.touches.right.justReleased = true;
            state.touches.right.releaseDx = state.touches.right.currentX - state.touches.right.startX;
            state.touches.right.releaseDy = state.touches.right.currentY - state.touches.right.startY;
          } else {
            state.touches.right.justReleased = false;
            state.touches.right.releaseDx = 0;
            state.touches.right.releaseDy = 0;
            state.touches.right.aimLength = 0;
            state.touches.right.startTime = 0;
          }
          state.touches.right.active = false;
          state.touches.right.id = -1;
          state.touches.right.dirX = 0;
          state.touches.right.dirY = 0;
          if (isMobile) {
            state.touches.right.currentX = state.touches.right.startX;
            state.touches.right.currentY = state.touches.right.startY;
          }
        }
      }
    };

    const handleTouchCancel = (e: TouchEvent) => {
      if (uiRef.current.status === 'PLAYING') {
        e.preventDefault();
      }
      releaseAllInputs();
    };

    const handleBlurOrHide = () => {
      releaseAllInputs();
      if (!mpRef.current.roomId && uiRef.current.status === 'PLAYING') {
        beginSinglePlayerPause();
      }
    };

    const handleFocusOrShow = () => {
      releaseAllInputs();
      stateRef.current.lastTime = performance.now();
    };

    const handleWindowBlur = () => {
      handleBlurOrHide();
    };

    const handleWindowFocus = () => {
      handleFocusOrShow();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleBlurOrHide();
      } else {
        handleFocusOrShow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleTouchCancel, { passive: false });
    window.addEventListener('pagehide', handleBlurOrHide);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const triggerEliminationAnimation = (x: number, y: number, colorIdx: number, label?: string) => {
      const pDef = PLAYER_COLORS[colorIdx !== undefined ? colorIdx : 0] || PLAYER_COLORS[0];
      const pColor = pDef.n;

      // 1. Vector Ring Burst (Option 1)
      const count = 48; // A beautiful complete circle of particles
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() * 0.1 - 0.05);
        const speed = Math.random() * 120 + 260; // High-velocity shockwave burst
        stateRef.current.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: Math.random() * 0.4 + 0.6, // Longer lifecycle for maximum visual impact
          color: pColor,
          radius: Math.random() * 3.5 + 2 // Slightly larger particles for dramatic impact
        });
      }

      // Add 15 extra smaller trailing dust sparks for dramatic lingering feedback
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 100 + 30;
        stateRef.current.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: Math.random() * 0.6 + 0.5,
          color: '#ffffff',
          radius: Math.random() * 1.5 + 0.8
        });
      }

      // 2. High-contrast expanding colored shockwave
      stateRef.current.shockwaves.push({
        x, y,
        color: pColor,
        maxRadius: 240,
        age: 0,
        maxAge: 0.65,
        thickness: 16
      });

      // 3. Tactile camera shake of 25px
      stateRef.current.shake = 25;

      // 4. Floating holographic / neon panel
      if (label && label.trim().length > 0) {
        if (!stateRef.current.floatingTexts) {
          stateRef.current.floatingTexts = [];
        }
        stateRef.current.floatingTexts.push({
          x,
          y: y - 10,
          text: label.trim().toUpperCase(),
          age: 0,
          maxAge: 1.5,
          color: pColor,
          vy: -45
        });
      }
    };
    triggerEliminationRef.current = triggerEliminationAnimation;

    let animationFrameId: number;
    let lastStatus = uiRef.current.status;

    const gameLoop = (rawCurrentTime: number) => {
      const STATUS = uiRef.current.status;

      const currentTime =
        STATUS === 'PAUSED' && pauseStartRef.current !== null
          ? pauseStartRef.current
          : rawCurrentTime;

      const isMultiplayer = !!mpRef.current.roomId;
      const worldPhaseTime = isMultiplayer
        ? getMultiplayerWorldPhaseTime(currentTime)
        : (currentTime - accumulatedPauseOffsetRef.current);

      const dt =
        STATUS === 'PAUSED'
          ? 0
          : Math.max(
              0,
              Math.min((currentTime - state.lastTime) / 1000, 0.1)
            );

      state.lastTime = currentTime;

      // Defensive timeout / cleanup for pending guest shots
      if (mpRef.current.roomId && !mpRef.current.isHost && pendingGuestShotsRef.current.size > 0) {
        for (const [shotId, entry] of pendingGuestShotsRef.current.entries()) {
          const ageMs = currentTime - entry.spawnTime;
          if (entry.preview?.endingAt !== undefined &&
              currentTime - entry.preview.endingAt >= GUEST_SHOT_VISUAL_END_FADE_MS &&
              !entry.authoritativeBulletId) {
            pendingGuestShotsRef.current.delete(shotId);
          } else if (entry.status === 'pending' && ageMs > 1500) {
            entry.status = 'rejected';
            if (entry.preview && entry.preview.endingAt === undefined) {
              entry.preview.endingAt = currentTime;
            }
          }
        }
      }

      const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
      if (STATUS !== 'PLAYING' || isLocalMenuOpen) {
        releaseAllInputs();
      }

      if (lastStatus === 'PLAYING' && STATUS === 'GAME_OVER') {
        if (!shouldReduceMotion) {
          const reason = endReasonRef.current;
          const causeCode = reason?.causeCode;
          const isScoreBased = causeCode === 'highest_score' || causeCode === 'outscored' || causeCode === 'match_concluded';
          const isDefeat = reason?.outcome === 'defeat' || !reason;

          if (isDefeat && !isScoreBased) {
            const myColorIdx = playerProfileRef.current.colorIdx;
            triggerEliminationAnimation(state.player.x, state.player.y, myColorIdx);
          }
        }
      }
      lastStatus = STATUS;
      const isMultiplayerDisconnected = Boolean(mpRef.current.roomId && !mpRef.current.isConnected);
      const isAwaitingResumeSnapshot =
        Boolean(mpRef.current.roomId && awaitingResumeSnapshotRef.current);
      const shouldRunUpdates =
        !isMultiplayerDisconnected &&
        !isAwaitingResumeSnapshot &&
        (
          (STATUS === 'PLAYING' && !bannerShowingRef.current) ||
          (
            STATUS === 'GAME_OVER' &&
            mpRef.current.isConnected &&
            mpRef.current.roomId &&
            mpRef.current.isHost
          )
        );

      // Auto Host-Migration claiming protocol
      if (
        mpRef.current.isConnected &&
        mpRef.current.roomId &&
        !mpRef.current.isHost &&
        (STATUS === 'PLAYING' || STATUS === 'GAME_OVER')
      ) {
        if (currentTime - lastReceivedGameStateTimeRef.current > 1500) {
          lastReceivedGameStateTimeRef.current = currentTime; // throttle requests
          socketRef.current?.emit('claim_host', mpRef.current.roomId);
        }
      }

      // Direct high-performance input/status sync (runs even when client status is GAME_OVER)
      if (currentTime - state.lastBroadcastTime > 16 && mpRef.current.isConnected && mpRef.current.roomId && !mpRef.current.isHost && !awaitingResumeSnapshotRef.current && (STATUS === 'PLAYING' || STATUS === 'GAME_OVER')) {
        state.lastBroadcastTime = currentTime;
        socketRef.current?.emit('client_input', mpRef.current.roomId, {
          roundId: activeMultiplayerRoundIdRef.current,
          x: state.player.x,
          y: state.player.y
        });
      }

      if (shouldRunUpdates) {
        // Track blocks each player has been inside during the last 1 second to prevent bullet self-elimination
        if (!state.player.recentBlocks) {
          state.player.recentBlocks = [];
        }
        const pRadius = state.player.radius;
        const myColorIdx = playerProfileRef.current.colorIdx;
        for (const block of state.blocks) {
          // Only track blocks placed by the same player
          if (block.colorIdx !== myColorIdx) {
            continue;
          }
          const halfSize = block.size / 2;
          const closestX = Math.max(block.x - halfSize, Math.min(state.player.x, block.x + halfSize));
          const closestY = Math.max(block.y - halfSize, Math.min(state.player.y, block.y + halfSize));
          const pdx = state.player.x - closestX;
          const pdy = state.player.y - closestY;
          if (pdx * pdx + pdy * pdy < pRadius * pRadius) {
            const key = `${block.x}_${block.y}`;
            const exists = state.player.recentBlocks.some((b: any) => b.key === key);
            if (!exists) {
              state.player.recentBlocks.push({ key, x: block.x, y: block.y, timestamp: currentTime });
            } else {
              const found = state.player.recentBlocks.find((b: any) => b.key === key);
              if (found) found.timestamp = currentTime;
            }
          }
        }
        state.player.recentBlocks = state.player.recentBlocks.filter((b: any) => currentTime - b.timestamp <= 1000);

        for (const pid in state.multiplayerPlayers) {
          const mpPlayer = state.multiplayerPlayers[pid];
          if (!mpPlayer.recentBlocks) {
            mpPlayer.recentBlocks = [];
          }
          const rRadius = mpPlayer.radius || PLAYER_RADIUS;
          const mpColorIdx = mpPlayer.colorIdx;
          for (const block of state.blocks) {
            // Only track blocks placed by this specific player
            if (block.colorIdx !== mpColorIdx) {
              continue;
            }
            const halfSize = block.size / 2;
            const closestX = Math.max(block.x - halfSize, Math.min(mpPlayer.x, block.x + halfSize));
            const closestY = Math.max(block.y - halfSize, Math.min(mpPlayer.y, block.y + halfSize));
            const pdx = mpPlayer.x - closestX;
            const pdy = mpPlayer.y - closestY;
            if (pdx * pdx + pdy * pdy < rRadius * rRadius) {
              const key = `${block.x}_${block.y}`;
              const exists = mpPlayer.recentBlocks.some((b: any) => b.key === key);
              if (!exists) {
                mpPlayer.recentBlocks.push({ key, x: block.x, y: block.y, timestamp: currentTime });
              } else {
                const found = mpPlayer.recentBlocks.find((b: any) => b.key === key);
                if (found) found.timestamp = currentTime;
              }
            }
          }
          mpPlayer.recentBlocks = mpPlayer.recentBlocks.filter((b: any) => currentTime - b.timestamp <= 1000);
          if (mpRef.current.isHost && state.playerActionAuthority && state.playerActionAuthority[pid]) {
            const auth = state.playerActionAuthority[pid];
            mpPlayer.isDash = (currentTime < auth.specialActiveUntil);
          }
        }

        const mouseJustDown = state.mouse.justDown;
        state.mouse.justDown = false;
        const mouseRightJustDown = state.mouse.rightJustDown;
        state.mouse.rightJustDown = false;

        const rightJustReleased = state.touches.right.justReleased;
        state.touches.right.justReleased = false;

        if (state.touches.right.active && currentTime - state.touches.right.startTime > 100) {
          state.touches.right.aimLength = Math.min(1.0, state.touches.right.aimLength + dt * 10);
        } else {
          state.touches.right.aimLength = Math.max(0, state.touches.right.aimLength - dt * 10);
        }

        const spawnParticles = (x: number, y: number, color: string, count: number) => {
          for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 150 + 50;
            state.particles.push({
              x, y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: 0,
              maxLife: Math.random() * 0.4 + 0.2,
              color,
              radius: Math.random() * 3 + 1
            });
          }
        };

        // --- LOGIC UPDATES ---

        // Remote bullets are rendered from the reliable buffered host timeline.
        // A guest's own bullet keeps one continuous local-only visual; the host
        // still owns every gameplay collision, hit, score, and removal.
        if (!mpRef.current.isHost) {
          if (mpRef.current.roomId && guestBulletTimelineRef.current) {
            state.bullets = sampleGuestBulletTimeline(
              guestBulletTimelineRef.current,
              currentTime,
            ).bullets;

            for (const [shotId, pending] of pendingGuestShotsRef.current.entries()) {
              if (pending.roundId !== activeMultiplayerRoundIdRef.current) {
                pendingGuestShotsRef.current.delete(shotId);
                continue;
              }
              const authoritativeStillBuffered = state.bullets.some((bullet: any) =>
                bullet.clientShotId === pending.clientShotId || bullet.id === pending.authoritativeBulletId);
              if (pending.preview?.endingAt !== undefined &&
                  currentTime - pending.preview.endingAt >= GUEST_SHOT_VISUAL_END_FADE_MS &&
                  !authoritativeStillBuffered) {
                pendingGuestShotsRef.current.delete(shotId);
              }
            }
            const localId = socketRef.current?.id;
            if (localId) {
              state.bullets = state.bullets.filter((bullet: any) => {
                if (bullet.ownerId !== localId) return true;
                return ![...pendingGuestShotsRef.current.values()].some(pending =>
                  bullet.clientShotId === pending.clientShotId || bullet.id === pending.authoritativeBulletId);
              });
            }
          }

          if (mpRef.current.roomId) {
            for (const pending of pendingGuestShotsRef.current.values()) {
              const visual = pending.preview;
              if (!visual || visual.endingAt !== undefined) continue;

              if (visual.allowedBlockKeys.length > 0) {
                const stillInsideAllowedBlock = state.blocks.some(block => {
                  if (!visual.allowedBlockKeys.includes(`${block.x}_${block.y}`)) return false;
                  const halfSize = block.size / 2;
                  const closestX = Math.max(block.x - halfSize, Math.min(visual.x, block.x + halfSize));
                  const closestY = Math.max(block.y - halfSize, Math.min(visual.y, block.y + halfSize));
                  return (visual.x - closestX) ** 2 + (visual.y - closestY) ** 2 < visual.radius ** 2;
                });
                if (!stillInsideAllowedBlock) visual.allowedBlockKeys = [];
              }

              const allowedBuildKeys = new Set(visual.allowedBlockKeys);
              const visualSurfaces: AxisAlignedSurface[] = [
                ...activeWalls.map((wall, index) => ({
                  id: `wall:${index}`,
                  kind: 'wall' as const,
                  x: wall.x,
                  y: wall.y,
                  w: wall.w,
                  h: wall.h,
                })),
                ...state.blocks.flatMap((block, index) => {
                  if (allowedBuildKeys.has(`${block.x}_${block.y}`)) return [];
                  return [{
                    id: `build:${index}:${block.x}:${block.y}`,
                    kind: 'build' as const,
                    x: block.x - block.size / 2,
                    y: block.y - block.size / 2,
                    w: block.size,
                    h: block.size,
                  }];
                }),
              ];
              const startWorldPhaseTime = visual.lastWorldPhaseTime;
              const advanced = advanceGuestShotVisual(
                visual,
                currentTime,
                visualSurfaces,
                (startX, startY, endX, endY, startFraction, endFraction): SurfaceHit | null => {
                  const relicCollision = sweptMultiplayerBulletRelicCollision(
                    startX,
                    startY,
                    endX,
                    endY,
                    visual.radius,
                    state.spawners,
                    startWorldPhaseTime + (worldPhaseTime - startWorldPhaseTime) * startFraction,
                    startWorldPhaseTime + (worldPhaseTime - startWorldPhaseTime) * endFraction,
                  );
                  if (!relicCollision) return null;
                  const spawnerIndex = state.spawners.indexOf(relicCollision.spawner);
                  return {
                    id: `relic:${spawnerIndex}:${relicCollision.specialType}`,
                    kind: 'relic',
                    t: relicCollision.t,
                    x: startX + (endX - startX) * relicCollision.t,
                    y: startY + (endY - startY) * relicCollision.t,
                    normals: [{ nx: relicCollision.nx, ny: relicCollision.ny }],
                  };
                },
              );
              advanced.lastWorldPhaseTime = worldPhaseTime;
              pending.preview = advanced;

              if (Math.random() > 0.3) {
                const colorDef = PLAYER_COLORS[advanced.colorIdx] || PLAYER_COLORS[0];
                state.trails.push({
                  x: advanced.x,
                  y: advanced.y,
                  age: 0,
                  color: advanced.isNeutral ? '#aaaaaa' : colorDef.n,
                  radius: advanced.radius * 0.6,
                });
              }
            }
          }

          // Smooth client-side coordinates interpolation for remote players
          for (const pid in state.multiplayerPlayers) {
            const pData = state.multiplayerPlayers[pid];
            if (pData && pData.targetX !== undefined && pData.targetY !== undefined) {
              const lerpFactor = Math.min(1.0, 15 * dt);
              pData.x += (pData.targetX - pData.x) * lerpFactor;
              pData.y += (pData.targetY - pData.y) * lerpFactor;
            }
          }

          // Client-side physics projection for smooth 60fps entity rendering between host updates
          if (mpRef.current.roomId) {
            // 1. Move Enemies towards closest alive player
            for (const enemy of state.enemies) {
              let targetX = state.player.x;
              let targetY = state.player.y;
              let minTargetDistSq = (state.player.x - enemy.x) ** 2 + (state.player.y - enemy.y) ** 2;

              for (const pid in state.multiplayerPlayers) {
                const mpPlayer = state.multiplayerPlayers[pid];
                if (mpPlayer && !mpPlayer.isDead) {
                  const dSq = (mpPlayer.x - enemy.x) ** 2 + (mpPlayer.y - enemy.y) ** 2;
                  if (dSq < minTargetDistSq) {
                    minTargetDistSq = dSq;
                    targetX = mpPlayer.x;
                    targetY = mpPlayer.y;
                  }
                }
              }

              const dx = targetX - enemy.x;
              const dy = targetY - enemy.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 0) {
                enemy.x += (dx / dist) * enemy.speed * dt;
                enemy.y += (dy / dist) * enemy.speed * dt;
              }
            }

            // 2. Move Bouncers with boundaries bouncing
            for (const b of state.bouncers) {
              b.x += b.dx * b.speed * dt;
              b.y += b.dy * b.speed * dt;

              if (b.x < b.radius) { b.x = b.radius; b.dx *= -1; }
              if (b.x > MAP_WIDTH - b.radius) { b.x = MAP_WIDTH - b.radius; b.dx *= -1; }
              if (b.y < b.radius) { b.y = b.radius; b.dy *= -1; }
              if (b.y > MAP_HEIGHT - b.radius) { b.y = MAP_HEIGHT - b.radius; b.dy *= -1; }
            }

            // 3. Draw trails from authoritative buffered bullet positions.
            for (const bullet of state.bullets) {
              if (Math.random() > 0.3) {
                let trailColor = '#ff0066';
                if (bullet.isNeutral) {
                  trailColor = '#aaaaaa';
                } else if (bullet.isPlayer) {
                  const pDef = PLAYER_COLORS[bullet.colorIdx !== undefined ? bullet.colorIdx : 0] || PLAYER_COLORS[0];
                  trailColor = pDef.n;
                }
                state.trails.push({
                  x: bullet.x, y: bullet.y, age: 0,
                  color: trailColor,
                  radius: bullet.radius * 0.6
                });
              }
            }
          }
        }

        // 1. Update Player Movement
        const pBeforeX = state.player.x;
        const pBeforeY = state.player.y;
        if (STATUS === 'PLAYING') {
          if (state.player.dash.active && currentTime >= state.player.dash.endTime) {
            state.player.dash.active = false;
          }

          let moveX = 0;
          let moveY = 0;
          const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
          if (!isLocalMenuOpen) {
            if (state.keys.w) moveY -= 1;
            if (state.keys.s) moveY += 1;
            if (state.keys.a) moveX -= 1;
            if (state.keys.d) moveX += 1;

            if (state.touches.left.active) {
              moveX += state.touches.left.dirX;
              moveY += state.touches.left.dirY;
            }
          }

          const length = Math.sqrt(moveX * moveX + moveY * moveY);
          if (length > 0) {
            if (length > 1) {
              moveX /= length;
              moveY /= length;
            } else if (!state.touches.left.active) {
              moveX /= length;
              moveY /= length;
            }
          }

          const pDef = PLAYER_COLORS[playerProfileRef.current.colorIdx] || PLAYER_COLORS[0];
          const playerKb = Math.sqrt((state.player.kbvx || 0) ** 2 + (state.player.kbvy || 0) ** 2);
          if (playerKb > 150) {
            // Flying away / high knockback - spawn powerful super trails every frame
            state.trails.push({
              x: state.player.x,
              y: state.player.y,
              age: 0,
              color: pDef.n,
              radius: state.player.radius * 0.8,
              isSuperStrong: true
            });
          } else if (length > 0 && Math.random() > 0.5) {
            // Normal movement trail
            state.trails.push({
              x: state.player.x,
              y: state.player.y,
              age: 0,
              color: pDef.n,
              radius: state.player.radius * 0.4
            });
          }

          state.player.vx = moveX;
          state.player.vy = moveY;

          const kbvx = state.player.kbvx || 0;
          const kbvy = state.player.kbvy || 0;
          state.player.x += (state.player.vx * PLAYER_SPEED + kbvx) * dt;
          state.player.y += (state.player.vy * PLAYER_SPEED + kbvy) * dt;

          state.player.kbvx = kbvx * Math.exp(-8 * dt);
          state.player.kbvy = kbvy * Math.exp(-8 * dt);
          if (Math.abs(state.player.kbvx) < 1) state.player.kbvx = 0;
          if (Math.abs(state.player.kbvy) < 1) state.player.kbvy = 0;
        }

        // Apply zone shockwave knockback to local player
        const localOwnerId = mpRef.current.roomId ? socketRef.current?.id : 'local';
        if (!state.player.processedZoneKbs) {
           state.player.processedZoneKbs = [];
        }
        for (const zone of state.zones) {
           if (zone.ownerId !== localOwnerId) {
              if (!state.player.processedZoneKbs.includes(zone.spawnTime)) {
                 const dx = state.player.x - zone.x;
                 const dy = state.player.y - zone.y;
                 const distSq = dx * dx + dy * dy;
                 if (distSq < zone.outerRadius * zone.outerRadius) {
                    const dist = Math.sqrt(distSq);
                    if (dist > 0) {
                       state.player.kbvx = (dx / dist) * 2000;
                       state.player.kbvy = (dy / dist) * 2000;
                    }
                    state.player.processedZoneKbs.push(zone.spawnTime);
                 }
              }
           }
        }
        if (state.player.processedZoneKbs.length > 20) {
           const now = performance.now();
           state.player.processedZoneKbs = state.player.processedZoneKbs.filter((t: number) => now - t < 10000);
        }

        // Handle Build Mode (trailing blocks)
        if (state.player.build.active && !(mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current))) {
          if (currentTime > state.player.build.endTime) {
             state.player.build.active = false;
          } else {
             const gridX = Math.round(state.player.x / 40) * 40;
             const gridY = Math.round(state.player.y / 40) * 40;
             if (gridX !== state.player.build.lastBlockX || gridY !== state.player.build.lastBlockY) {
                state.player.build.lastBlockX = gridX;
                state.player.build.lastBlockY = gridY;
                const cIdx = playerProfileRef.current.colorIdx;
                tryPlaceBuildBlock(currentTime, gridX, gridY, cIdx);
             }
          }
        }

        // Core Player Wall Collisions & Clamping (Run locally on BOTH Client and Host to prevent wall-phasing)
        const playerResolved = mpRef.current.roomId
          ? sweptMultiplayerPlayerResolve(pBeforeX, pBeforeY, state.player.x, state.player.y, state.player.radius, activeWalls)
          : resolveWallCollisions(state.player.x, state.player.y, state.player.radius, activeWalls, pBeforeX, pBeforeY);
        state.player.x = playerResolved.x;
        state.player.y = playerResolved.y;

        for (const n of playerResolved.normals) {
          const dotVel = state.player.vx * n.nx + state.player.vy * n.ny;
          if (dotVel < 0) {
            state.player.vx -= dotVel * n.nx;
            state.player.vy -= dotVel * n.ny;
          }
          const dotKb = state.player.kbvx * n.nx + state.player.kbvy * n.ny;
          if (dotKb < 0) {
            state.player.kbvx -= dotKb * n.nx;
            state.player.kbvy -= dotKb * n.ny;
          }
        }

        // Local player instant death trigger checks (runs in ALL modes: Solo, Host, and Client)
        if (uiRef.current.status === 'PLAYING' && (!mpRef.current.roomId || mpRef.current.isHost)) {
          const localColorIdx = playerProfileRef.current.colorIdx;
          const localColor = PLAYER_COLORS[localColorIdx]?.n || '#00f0ff';

          // 1. Collide with Enemies (state.enemies)
          if (!state.player.dash.active && !isOpeningProtectionActiveLocal(currentTime)) {
            for (const enemy of state.enemies) {
              const dx = state.player.x - enemy.x;
              const dy = state.player.y - enemy.y;
              if (dx * dx + dy * dy < (state.player.radius + enemy.radius) ** 2) {
                triggerEndPresentation({
                  outcome: 'defeat',
                  causeCode: 'enemy_contact',
                  label: 'ENEMY CONTACT',
                  impactPos: { x: enemy.x, y: enemy.y },
                  markerColor: '#ff003c',
                  startTimestamp: performance.now(),
                });
                setUiState(prev => {
                  uiRef.current = { ...prev, status: 'GAME_OVER' };
                  return uiRef.current;
                });
                break;
              }
            }
          }

          // 2. Collide with Bouncers (state.bouncers)
          if (uiRef.current.status === 'PLAYING' && !state.player.dash.active && !isOpeningProtectionActiveLocal(currentTime)) {
            for (const b of state.bouncers) {
              const pdx = state.player.x - b.x;
              const pdy = state.player.y - b.y;
              if (pdx * pdx + pdy * pdy < (state.player.radius + b.radius) ** 2) {
                triggerEndPresentation({
                  outcome: 'defeat',
                  causeCode: 'bouncer_collision',
                  label: 'BOUNCER COLLISION',
                  impactPos: { x: b.x, y: b.y },
                  markerColor: '#ff003c',
                  startTimestamp: performance.now(),
                });
                setUiState(prev => {
                  uiRef.current = { ...prev, status: 'GAME_OVER' };
                  return uiRef.current;
                });
                break;
              }
            }
          }

          // 3. Collide with Spawner Orbiting Special Obstacles (Shield, Kinetic, Singularity, Magma gates, Crystal)
          if (uiRef.current.status === 'PLAYING' && !state.player.dash.active && !isOpeningProtectionActiveLocal(currentTime)) {
            for (const spawner of state.spawners) {
              if (spawner.specialType) {
                const collision = getBulletRelicCollision(state.player.x, state.player.y, state.player.radius, spawner, worldPhaseTime);
                if (collision) {
                  const impactX = state.player.x - collision.nx * state.player.radius;
                  const impactY = state.player.y - collision.ny * state.player.radius;
                  triggerEndPresentation({
                    outcome: 'defeat',
                    causeCode: 'relic_collision',
                    label: 'RELIC COLLISION',
                    impactPos: { x: impactX, y: impactY },
                    markerColor: '#ff003c',
                    startTimestamp: performance.now(),
                  });
                  setUiState(prev => {
                    uiRef.current = { ...prev, status: 'GAME_OVER' };
                    return uiRef.current;
                  });
                  break;
                }
              }
            }
          }

          // 4. Collide with Enemy / Neutral / Player Bullets
          if (uiRef.current.status === 'PLAYING' && !isOpeningProtectionActiveLocal(currentTime)) {
            for (const bullet of state.bullets) {
              let bulletColor = '#ff0066';
              if (bullet.isNeutral) {
                bulletColor = '#aaaaaa';
              } else if (bullet.isPlayer) {
                const pDef = PLAYER_COLORS[bullet.colorIdx !== undefined ? bullet.colorIdx : 0] || PLAYER_COLORS[0];
                bulletColor = pDef.n;
              }

              if (bulletColor !== localColor) {
                const dx = state.player.x - bullet.x;
                const dy = state.player.y - bullet.y;
                if (!state.player.dash.active && dx * dx + dy * dy < (state.player.radius + bullet.radius * 0.5) ** 2) {
                  let label = 'HOSTILE FIRE';
                  let causeCode = 'hostile_fire';
                  if (bullet.isNeutral) {
                    label = 'NEUTRAL RICOCHET';
                    causeCode = 'neutral_ricochet';
                  } else if (bullet.isPlayer) {
                    causeCode = 'player_shot';
                    const attackerName = resolvePlayerName(bullet.ownerId);
                    label = attackerName ? `SHOT BY ${attackerName}` : 'SHOT BY RIVAL PLAYER';
                  }

                  triggerEndPresentation({
                    outcome: 'defeat',
                    causeCode,
                    label,
                    impactPos: { x: bullet.x, y: bullet.y },
                    markerColor: '#ff003c',
                    startTimestamp: performance.now(),
                  });

                  setUiState(prev => {
                    uiRef.current = { ...prev, status: 'GAME_OVER' };
                    return uiRef.current;
                  });
                  break;
                }
              }
            }
          }
        }

        // Host ONLY logic from here down
        if (!mpRef.current.roomId || mpRef.current.isHost) {

          // Block Physics (Player / Enemies vs Blocks)
          for (let b = state.blocks.length - 1; b >= 0; b--) {
            const block = state.blocks[b];
            let destroyed = false;

            // Player touching block
            if (STATUS === 'PLAYING') {
              const gridX = Math.round(state.player.x / 40) * 40;
              const gridY = Math.round(state.player.y / 40) * 40;
              const isStandingOn = (block.x === gridX && block.y === gridY);

              if (state.player.build.active) {
                // When build mode is active:
                // - If standing on empty tile: place one of that player's blocks (handled by tryPlaceBuildBlock).
                // - If standing on another player's block: replace it (handled by tryPlaceBuildBlock).
                // - If standing on one of their own blocks: do nothing.
                // We do not destroy any blocks via physical overlap when build mode is active.
              } else {
                // When build mode is inactive:
                // - If the player is standing on any block, remove that block.
                // - If the player is standing on an empty tile, do nothing.
                if (isStandingOn) {
                  destroyed = true;
                }
              }
            }

            // Enemies touching block
            if (!destroyed) {
              for (let e = 0; e < state.enemies.length; e++) {
                const enemy = state.enemies[e];
                const edx = Math.abs(enemy.x - block.x);
                const edy = Math.abs(enemy.y - block.y);
                if (edx < block.size / 2 + enemy.radius && edy < block.size / 2 + enemy.radius) {
                  destroyed = true;
                  break;
                }
              }
            }

            if (destroyed) {
              const pDef = PLAYER_COLORS[block.colorIdx !== undefined ? block.colorIdx : 0] || PLAYER_COLORS[0];
              spawnParticles(block.x, block.y, pDef.n, 20);
              state.blocks.splice(b, 1);
            }
          }

        // 2. Spawn Enemies
        if (state.spawners.length > 0) {
          // Emit ambient floating relic particles (only for spawners with active obstacles)
          for (const spawner of state.spawners) {
            if (spawner.specialType && Math.random() < 0.15) {
              let pColor = '#ff00ff';
              let vx = (Math.random() - 0.5) * 50;
              let vy = (Math.random() - 0.5) * 50;
              let maxLife = Math.random() * 1.5 + 0.5;
              let radius = Math.random() * 2 + 1;

              if (spawner.specialType === 'shield') {
                pColor = '#00f0ff';
                const angle = Math.random() * Math.PI * 2;
                vx = Math.cos(angle) * 30;
                vy = Math.sin(angle) * 30;
              } else if (spawner.specialType === 'kinetic') {
                pColor = '#ffcc00';
                const angle = Math.random() * Math.PI * 2;
                vx = Math.cos(angle) * 120;
                vy = Math.sin(angle) * 120;
              } else if (spawner.specialType === 'singularity') {
                pColor = '#b500ff';
                const angle = Math.random() * Math.PI * 2;
                const spawnRadius = 80 + Math.random() * 20;
                const px = spawner.x + Math.cos(angle) * spawnRadius;
                const py = spawner.y + Math.sin(angle) * spawnRadius;
                state.particles.push({
                  x: px,
                  y: py,
                  vx: -Math.cos(angle) * 60,
                  vy: -Math.sin(angle) * 60,
                  life: 0,
                  maxLife: 1.2,
                  color: pColor,
                  radius: Math.random() * 2.5 + 0.5
                });
                continue;
              } else if (spawner.specialType === 'magma_gates') {
                pColor = '#ff5500';
                vy = -Math.random() * 40 - 20;
                vx = (Math.random() - 0.5) * 20;
              } else if (spawner.specialType === 'crystal') {
                pColor = '#00ffaa';
                vx = (Math.random() - 0.5) * 15;
                vy = (Math.random() - 0.5) * 15;
                radius = Math.random() * 3 + 1.5;
              } else {
                continue; // Do not emit for default or unknown spawner types
              }

              state.particles.push({
                x: spawner.x + (Math.random() - 0.5) * 50,
                y: spawner.y + (Math.random() - 0.5) * 50,
                vx,
                vy,
                life: 0,
                maxLife,
                color: pColor,
                radius
              });
            }
          }


          const mapDef = MAPS[uiRef.current.mapId] || MAPS.medium;
          const initialSpawners = mapDef.spawners.length;

          // Tutorial opening enemy
          if (state.tutorial.active && !state.tutorial.enemySpawned && state.tutorial.spawnerIndex !== null && !mpRef.current.roomId) {
            state.tutorial.timer += dt * 1000;
            if (state.tutorial.timer > 1500) {
              const tutSpawnerDef = mapDef.spawners[state.tutorial.spawnerIndex];
              const tutSpawner = state.spawners.find(s => s.x === tutSpawnerDef.x && s.y === tutSpawnerDef.y);
              if (tutSpawner) {
                let foundSpawn = false;
                let spawnX = 0;
                let spawnY = 0;

                const isPosBlocked = (tx: number, ty: number) => {
                  // check walls
                  for (const wall of activeWalls) {
                    if (tx > wall.x - ENEMY_RADIUS && tx < wall.x + wall.w + ENEMY_RADIUS &&
                        ty > wall.y - ENEMY_RADIUS && ty < wall.y + wall.h + ENEMY_RADIUS) {
                      return true;
                    }
                  }
                  // check other spawners
                  for (const sp of state.spawners) {
                    const dx = tx - sp.x;
                    const dy = ty - sp.y;
                    if (Math.sqrt(dx*dx + dy*dy) < (sp.radius + ENEMY_RADIUS + 5)) {
                      return true;
                    }
                  }
                  // check arena boundary
                  const border = ENEMY_RADIUS + 10;
                  if (tx < border || tx > MAP_WIDTH - border || ty < border || ty > MAP_HEIGHT - border) {
                    return true;
                  }
                  return false;
                };

                // 1. Retry with up to 100 random angles/distances
                for (let i = 0; i < 100; i++) {
                  const angle = Math.random() * Math.PI * 2;
                  const spawnDist = tutSpawner.radius + ENEMY_RADIUS + 10 + Math.random() * 80;
                  const tx = tutSpawner.x + Math.cos(angle) * spawnDist;
                  const ty = tutSpawner.y + Math.sin(angle) * spawnDist;
                  if (!isPosBlocked(tx, ty)) {
                    spawnX = tx;
                    spawnY = ty;
                    foundSpawn = true;
                    break;
                  }
                }

                // 2. If random attempts fail, perform a deterministic grid search around that spawner to guarantee the enemy is successfully created.
                if (!foundSpawn) {
                  const step = 10;
                  const maxSearchDist = tutSpawner.radius + ENEMY_RADIUS + 150;
                  outerLoop:
                  for (let d = tutSpawner.radius + ENEMY_RADIUS + 10; d <= maxSearchDist; d += step) {
                    for (let angleDeg = 0; angleDeg < 360; angleDeg += 10) {
                      const angle = (angleDeg * Math.PI) / 180;
                      const tx = tutSpawner.x + Math.cos(angle) * d;
                      const ty = tutSpawner.y + Math.sin(angle) * d;
                      if (!isPosBlocked(tx, ty)) {
                        spawnX = tx;
                        spawnY = ty;
                        foundSpawn = true;
                        break outerLoop;
                      }
                    }
                  }
                }

                if (foundSpawn) {
                  state.enemies.push({
                    id: 'e_' + state.nextEntityId++,
                    x: spawnX, y: spawnY,
                    radius: ENEMY_RADIUS,
                    lastShoot: currentTime,
                    speed: ENEMY_SPEED
                  });
                  spawnParticles(tutSpawner.x, tutSpawner.y, state.hardMode ? '#ff3300' : '#ff00ff', 10);
                  state.tutorial.enemySpawned = true;
                } else {
                  // Throttle retry to 250ms from now
                  state.tutorial.timer = 1250;
                }
              } else {
                // Spawner does not exist, deactivate tutorial to avoid infinite checks
                state.tutorial.active = false;
              }
            }
          }

          let effectiveRate = state.enemySpawnRate;
          if (state.hardMode) {
            // Hard Mode: Total spawn rate does not diminish when spawners are destroyed.
            // Spawning interval remains constant relative to initial (distributes across survivors).
            effectiveRate = state.enemySpawnRate;
          } else {
            // Normal Mode: Spawning slows down as spawners are destroyed
            const currentSpawnersCount = Math.max(1, state.spawners.length);
            effectiveRate = state.enemySpawnRate * (initialSpawners / currentSpawnersCount);
          }

          if (currentTime - state.lastEnemySpawn > effectiveRate) {
            state.lastEnemySpawn = currentTime;
            state.enemySpawnRate = Math.max(800, state.enemySpawnRate * 0.95); // Speeds up slightly over time

            const spawner = state.spawners[Math.floor(Math.random() * state.spawners.length)];
            const angle = Math.random() * Math.PI * 2;
            const spawnDist = spawner.radius + ENEMY_RADIUS + 10;
            const spawnX = spawner.x + Math.cos(angle) * spawnDist;
            const spawnY = spawner.y + Math.sin(angle) * spawnDist;

            state.enemies.push({
              id: 'e_' + state.nextEntityId++,
              x: spawnX,
              y: spawnY,
              radius: ENEMY_RADIUS,
              speed: ENEMY_SPEED + Math.random() * 20,
              lastShoot: currentTime + Math.random() * 1000,
            });
          }
        }

        const isAuthoritativeMultiplayerSimulation =
          Boolean(mpRef.current.roomId && mpRef.current.isHost);

        // 3. Update Enemies
        for (let i = state.enemies.length - 1; i >= 0; i--) {
          const enemy = state.enemies[i];

          // Move towards closest alive player
          let targetX = state.player.x;
          let targetY = state.player.y;
          let minTargetDistSq = Infinity;

          if (STATUS === 'PLAYING') {
            minTargetDistSq = (state.player.x - enemy.x) ** 2 + (state.player.y - enemy.y) ** 2;
          }

          for (const pid in state.multiplayerPlayers) {
            const mpPlayer = state.multiplayerPlayers[pid];
            if (mpPlayer && !mpPlayer.isDead) {
              const dSq = (mpPlayer.x - enemy.x) ** 2 + (mpPlayer.y - enemy.y) ** 2;
              if (dSq < minTargetDistSq) {
                minTargetDistSq = dSq;
                targetX = mpPlayer.x;
                targetY = mpPlayer.y;
              }
            }
          }

          const dx = targetX - enemy.x;
          const dy = targetY - enemy.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Apply zone shockwave knockback to enemy
          if (!enemy.processedZoneKbs) {
            enemy.processedZoneKbs = [];
          }
          for (const zone of state.zones) {
            const zdx = enemy.x - zone.x;
            const zdy = enemy.y - zone.y;
            const distSq = zdx * zdx + zdy * zdy;
            if (distSq < zone.outerRadius * zone.outerRadius) {
              const zdist = Math.sqrt(distSq);
              if (zdist > 0) {
                if (!enemy.processedZoneKbs.includes(zone.spawnTime)) {
                  // 1. Initial shockwave blast hit (INSTANT, no delay!)
                  enemy.kbvx = (zdx / zdist) * 2000;
                  enemy.kbvy = (zdy / zdist) * 2000;
                  enemy.processedZoneKbs.push(zone.spawnTime);
                } else {
                  // 2. Continuous wind/repellent force to keep them out
                  enemy.kbvx += (zdx / zdist) * 3000 * dt;
                  enemy.kbvy += (zdy / zdist) * 3000 * dt;
                }
              }
            }
          }
          if (enemy.processedZoneKbs.length > 20) {
            enemy.processedZoneKbs = enemy.processedZoneKbs.filter((t: number) => currentTime - t < 10000);
          }

          let moveX = 0;
          let moveY = 0;
          if (dist > 0) {
            moveX = (dx / dist) * enemy.speed;
            moveY = (dy / dist) * enemy.speed;
          }

          const kbvx = enemy.kbvx || 0;
          const kbvy = enemy.kbvy || 0;
          const enemyBeforeX = enemy.x;
          const enemyBeforeY = enemy.y;
          enemy.x += (moveX + kbvx) * dt;
          enemy.y += (moveY + kbvy) * dt;

          enemy.kbvx = kbvx * Math.exp(-8 * dt);
          enemy.kbvy = kbvy * Math.exp(-8 * dt);
          if (Math.abs(enemy.kbvx) < 1) enemy.kbvx = 0;
          if (Math.abs(enemy.kbvy) < 1) enemy.kbvy = 0;

          // Enemy Wall Collisions
          let enemyResolved;
          if (isAuthoritativeMultiplayerSimulation) {
            enemyResolved = sweptMultiplayerPlayerResolve(
              enemyBeforeX,
              enemyBeforeY,
              enemy.x,
              enemy.y,
              enemy.radius,
              activeWalls
            );
            if (enemyResolved.collided || enemyResolved.clamped) {
              state.forceBroadcast = true;
            }
          } else {
            enemyResolved = resolveWallCollisions(enemy.x, enemy.y, enemy.radius, activeWalls, enemyBeforeX, enemyBeforeY);
          }
          enemy.x = enemyResolved.x;
          enemy.y = enemyResolved.y;

          let skipKnockbackProjection = false;

          // B2: Host-side enemy contact collision checks against living remote players
          if (isAuthoritativeMultiplayerSimulation) {
            const hostId = socketRef.current?.id;
            const hostMatchPlayer = hostId ? state.matchPlayers[hostId] : null;

            const hits: { pid: string; t: number; impactX: number; impactY: number; isHost: boolean }[] = [];

            // Host candidate
            const isHostCandidateEligible = !!hostId && 
              !!hostMatchPlayer && 
              !hostMatchPlayer.isDead && 
              !hostMatchPlayer.isDisconnected && 
              uiRef.current.status === 'PLAYING' && 
              !state.player.dash.active && 
              !isOpeningProtectionActiveForHost(currentTime);

            if (isHostCandidateEligible) {
              const relStartX = enemyBeforeX - pBeforeX;
              const relStartY = enemyBeforeY - pBeforeY;
              const relEndX = enemy.x - state.player.x;
              const relEndY = enemy.y - state.player.y;
              const combRadius = enemy.radius + state.player.radius;

              const sweepResult = segmentVersusCircle(
                relStartX,
                relStartY,
                relEndX,
                relEndY,
                0,
                0,
                combRadius
              );

              if (sweepResult !== null) {
                const impactX = enemyBeforeX + sweepResult.t * (enemy.x - enemyBeforeX);
                const impactY = enemyBeforeY + sweepResult.t * (enemy.y - enemyBeforeY);
                hits.push({
                  pid: hostId!,
                  t: sweepResult.t,
                  impactX,
                  impactY,
                  isHost: true
                });
              }
            }

            // Remote candidates
            for (const pid in state.multiplayerPlayers) {
              const mpPlayer = state.multiplayerPlayers[pid];
              const mPlayer = state.matchPlayers[pid];

              const isRemoteEligible = !!mpPlayer && 
                !!mPlayer && 
                !mpPlayer.isDead && 
                !mPlayer.isDead && 
                !mPlayer.isDisconnected && 
                !mpPlayer.isDash && 
                !isOpeningProtectionActiveForHost(currentTime);

              if (isRemoteEligible) {
                const sweepResult = segmentVersusCircle(
                  enemyBeforeX,
                  enemyBeforeY,
                  enemy.x,
                  enemy.y,
                  mpPlayer.x,
                  mpPlayer.y,
                  enemy.radius + mpPlayer.radius
                );

                if (sweepResult !== null) {
                  const impactX = enemyBeforeX + sweepResult.t * (enemy.x - enemyBeforeX);
                  const impactY = enemyBeforeY + sweepResult.t * (enemy.y - enemyBeforeY);
                  hits.push({
                    pid,
                    t: sweepResult.t,
                    impactX,
                    impactY,
                    isHost: false
                  });
                }
              }
            }

            if (hits.length > 0) {
              hits.sort((a, b) => {
                if (Math.abs(a.t - b.t) > 1e-9) {
                  return a.t - b.t;
                }
                return a.pid.localeCompare(b.pid);
              });

              const winner = hits[0];
              const playerContactFirst = winner.t < 1 - 1e-6 && enemyResolved.normals.length > 0;

              if (enemyResolved.normals.length > 0) {
                if (playerContactFirst) {
                  enemy.x = winner.impactX;
                  enemy.y = winner.impactY;
                  skipKnockbackProjection = true;
                } else {
                  enemy.x = enemyResolved.x;
                  enemy.y = enemyResolved.y;
                }
              } else {
                enemy.x = winner.impactX;
                enemy.y = winner.impactY;
              }

              state.forceBroadcast = true;

              if (winner.isHost) {
                if (uiRef.current.status === 'PLAYING') {
                  triggerEndPresentation({
                    outcome: 'defeat',
                    causeCode: 'enemy_contact',
                    label: 'ENEMY CONTACT',
                    impactPos: { x: enemy.x, y: enemy.y },
                    markerColor: '#ff003c',
                    startTimestamp: performance.now(),
                  });
                  setUiState(prev => {
                    uiRef.current = { ...prev, status: 'GAME_OVER' };
                    return uiRef.current;
                  });
                }
              } else {
                eliminateRemotePlayerRef.current?.(winner.pid, { x: enemy.x, y: enemy.y }, currentTime);
              }
            }
          }

          if (!skipKnockbackProjection) {
            for (const n of enemyResolved.normals) {
              const dotKb = enemy.kbvx * n.nx + enemy.kbvy * n.ny;
              if (dotKb < 0) {
                enemy.kbvx -= dotKb * n.nx;
                enemy.kbvy -= dotKb * n.ny;
              }
            }
          }

          // Enemy Shooting
          // Only shoot if roughly in line of sight (simple range check for now)
          if (dist < 1000 && currentTime - enemy.lastShoot > ENEMY_FIRE_RATE) {
            enemy.lastShoot = currentTime;
            const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.2; // Slight inaccuracy
            const dirX = Math.cos(angle);
            const dirY = Math.sin(angle);
            state.bullets.push({
              id: 'be_' + state.nextEntityId++,
              x: enemy.x,
              y: enemy.y,
              dx: Math.cos(angle) * BULLET_SPEED,
              dy: Math.sin(angle) * BULLET_SPEED,
              radius: BULLET_RADIUS,
              isPlayer: false,
              bounceCount: 0,
              spawnTime: currentTime,
              isNeutral: false,
            });
          }
        }

        // Bouncer Capacity increase
        state.bouncerCapacity += dt * 0.05; // 1 every 20s

        // Update Bouncers
        for (let i = state.bouncers.length - 1; i >= 0; i--) {
          const b = state.bouncers[i];

          if (currentTime - b.lastDirChange > 3000) {
            if (Math.random() < 0.1) {
              b.lastDirChange = currentTime;
              let targetX = -1;
              let targetY = -1;
              let minDist = Infinity;

              let activePlayerX = state.player.x;
              let activePlayerY = state.player.y;
              let distToPlayer = Infinity;

              if (STATUS === 'PLAYING') {
                distToPlayer = Math.sqrt((state.player.x - b.x)**2 + (state.player.y - b.y)**2);
              }

              for (const pid in state.multiplayerPlayers) {
                const mpPlayer = state.multiplayerPlayers[pid];
                if (mpPlayer && !mpPlayer.isDead) {
                  const d = Math.sqrt((mpPlayer.x - b.x)**2 + (mpPlayer.y - b.y)**2);
                  if (d < distToPlayer) {
                    distToPlayer = d;
                    activePlayerX = mpPlayer.x;
                    activePlayerY = mpPlayer.y;
                  }
                }
              }

              if (distToPlayer < 600 && Math.random() < 0.2) {
                minDist = distToPlayer;
                targetX = activePlayerX;
                targetY = activePlayerY;
              }

              for (const block of state.blocks) {
                const dist = Math.sqrt((block.x - b.x)**2 + (block.y - b.y)**2);
                if (dist < 600 && dist < minDist && Math.random() < 0.2) {
                  minDist = dist;
                  targetX = block.x;
                  targetY = block.y;
                }
              }

              if (targetX !== -1) {
                const angle = Math.atan2(targetY - b.y, targetX - b.x);
                b.dx = Math.cos(angle);
                b.dy = Math.sin(angle);
              } else {
                const angle = Math.random() * Math.PI * 2;
                b.dx = Math.cos(angle);
                b.dy = Math.sin(angle);
              }
            }
          }

          // Apply zone shockwave knockback to bouncer
          if (!b.processedZoneKbs) {
            b.processedZoneKbs = [];
          }
          for (const zone of state.zones) {
            const zdx = b.x - zone.x;
            const zdy = b.y - zone.y;
            const distSq = zdx * zdx + zdy * zdy;
            if (distSq < zone.outerRadius * zone.outerRadius) {
              const zdist = Math.sqrt(distSq);
              if (zdist > 0) {
                if (!b.processedZoneKbs.includes(zone.spawnTime)) {
                  // 1. Initial shockwave blast hit (INSTANT, no delay!)
                  b.kbvx = (zdx / zdist) * 2000;
                  b.kbvy = (zdy / zdist) * 2000;
                  b.processedZoneKbs.push(zone.spawnTime);
                } else {
                  // 2. Continuous wind/repellent force to keep them out
                  b.kbvx += (zdx / zdist) * 3000 * dt;
                  b.kbvy += (zdy / zdist) * 3000 * dt;
                }
              }
            }
          }
          if (b.processedZoneKbs.length > 20) {
            b.processedZoneKbs = b.processedZoneKbs.filter((t: number) => currentTime - t < 10000);
          }

          const kbvx = b.kbvx || 0;
          const kbvy = b.kbvy || 0;
          const bBeforeX = b.x;
          const bBeforeY = b.y;

          let boundaryCollided = false;

          let savedDx = b.dx;
          let savedDy = b.dy;
          let savedKbvx = 0;
          let savedKbvy = 0;
          let hasStaticResponse = false;

          if (isAuthoritativeMultiplayerSimulation) {
            // Save b.dx and b.dy before any boundary reflection
            savedDx = b.dx;
            savedDy = b.dy;

            // Calculate bouncer's intended endpoint
            let intendedX = bBeforeX + (b.dx * b.speed + kbvx) * dt;
            let intendedY = bBeforeY + (b.dy * b.speed + kbvy) * dt;

            // Preserve existing world-boundary safety checks. Do not allow outside MAP_WIDTH/MAP_HEIGHT.
            if (intendedX < b.radius) { intendedX = b.radius; b.dx *= -1; boundaryCollided = true; }
            if (intendedX > MAP_WIDTH - b.radius) { intendedX = MAP_WIDTH - b.radius; b.dx *= -1; boundaryCollided = true; }
            if (intendedY < b.radius) { intendedY = b.radius; b.dy *= -1; boundaryCollided = true; }
            if (intendedY > MAP_HEIGHT - b.radius) { intendedY = MAP_HEIGHT - b.radius; b.dy *= -1; boundaryCollided = true; }

            // Sweep static walls
            const wallResolved = sweptMultiplayerPlayerResolve(
              bBeforeX,
              bBeforeY,
              intendedX,
              intendedY,
              b.radius,
              activeWalls
            );

            // Sweep Build blocks only along the wall-reachable segment
            const blockResolved = sweptBuildBlockCollision(
              bBeforeX,
              bBeforeY,
              wallResolved.x,
              wallResolved.y,
              b.radius,
              state.blocks,
              []
            );

            // Select static collision winner
            let finalX = wallResolved.x;
            let finalY = wallResolved.y;
            let winningNormals = wallResolved.normals;
            let isCollision = wallResolved.collided;
            let isClamped = wallResolved.clamped;

            if (blockResolved !== null) {
              finalX = blockResolved.x;
              finalY = blockResolved.y;
              winningNormals = [{ nx: blockResolved.nx, ny: blockResolved.ny }];
              isCollision = true;
            }

            b.x = finalX;
            b.y = finalY;

            b.kbvx = kbvx * Math.exp(-8 * dt);
            b.kbvy = kbvy * Math.exp(-8 * dt);
            if (Math.abs(b.kbvx) < 1) b.kbvx = 0;
            if (Math.abs(b.kbvy) < 1) b.kbvy = 0;

            // Save decayed/thresholded knockback values immediately before static wall/Build response is applied
            savedKbvx = b.kbvx;
            savedKbvy = b.kbvy;

            hasStaticResponse = boundaryCollided || (winningNormals.length > 0);

            if (isCollision || isClamped || boundaryCollided) {
              state.forceBroadcast = true;
            }

            for (const n of winningNormals) {
              const dot = b.dx * n.nx + b.dy * n.ny;
              if (dot < 0) {
                b.dx = b.dx - 2 * dot * n.nx;
                b.dy = b.dy - 2 * dot * n.ny;
              }
              const dotKb = b.kbvx * n.nx + b.kbvy * n.ny;
              if (dotKb < 0) {
                b.kbvx -= dotKb * n.nx;
                b.kbvy -= dotKb * n.ny;
              }
            }
          } else {
            // SINGLE-PLAYER EXACTLY
            b.x += (b.dx * b.speed + kbvx) * dt;
            b.y += (b.dy * b.speed + kbvy) * dt;

            b.kbvx = kbvx * Math.exp(-8 * dt);
            b.kbvy = kbvy * Math.exp(-8 * dt);
            if (Math.abs(b.kbvx) < 1) b.kbvx = 0;
            if (Math.abs(b.kbvy) < 1) b.kbvy = 0;

            if (b.x < b.radius) { b.x = b.radius; b.dx *= -1; }
            if (b.x > MAP_WIDTH - b.radius) { b.x = MAP_WIDTH - b.radius; b.dx *= -1; }
            if (b.y < b.radius) { b.y = b.radius; b.dy *= -1; }
            if (b.y > MAP_HEIGHT - b.radius) { b.y = MAP_HEIGHT - b.radius; b.dy *= -1; }

            // Collision with Walls
            const bResolved = resolveWallCollisions(b.x, b.y, b.radius, activeWalls, bBeforeX, bBeforeY);
            b.x = bResolved.x;
            b.y = bResolved.y;

            for (const n of bResolved.normals) {
              const dot = b.dx * n.nx + b.dy * n.ny;
              if (dot < 0) {
                b.dx = b.dx - 2 * dot * n.nx;
                b.dy = b.dy - 2 * dot * n.ny;
              }
              const dotKb = b.kbvx * n.nx + b.kbvy * n.ny;
              if (dotKb < 0) {
                b.kbvx -= dotKb * n.nx;
                b.kbvy -= dotKb * n.ny;
              }
            }

            // Collision with Blocks
            for (let blk = state.blocks.length - 1; blk >= 0; blk--) {
              const block = state.blocks[blk];
              const closestX = clamp(b.x, block.x - block.size/2, block.x + block.size/2);
              const closestY = clamp(b.y, block.y - block.size/2, block.y + block.size/2);
              const dstX = b.x - closestX;
              const dstY = b.y - closestY;
              if (dstX * dstX + dstY * dstY < b.radius * b.radius) {
                  // Just bounce, block is unbreakable
                  if (Math.abs(b.x - closestX) >= Math.abs(b.y - closestY)) b.dx *= -1;
                  else b.dy *= -1;
              }
            }
          }

          // B3: Host-side bouncer contact collision checks against living remote players
          if (isAuthoritativeMultiplayerSimulation) {
            const hostId = socketRef.current?.id;
            const hostMatchPlayer = hostId ? state.matchPlayers[hostId] : null;

            const hits: { pid: string; t: number; impactX: number; impactY: number; isHost: boolean; isDash: boolean }[] = [];

            // Host candidate
            const isHostCandidateEligible = !!hostId && 
              !!hostMatchPlayer && 
              !hostMatchPlayer.isDead && 
              !hostMatchPlayer.isDisconnected && 
              uiRef.current.status === 'PLAYING' && 
              !isOpeningProtectionActiveForHost(currentTime);

            if (isHostCandidateEligible) {
              const relStartX = bBeforeX - pBeforeX;
              const relStartY = bBeforeY - pBeforeY;
              const relEndX = b.x - state.player.x;
              const relEndY = b.y - state.player.y;
              const combRadius = b.radius + state.player.radius;

              const sweepResult = segmentVersusCircle(
                relStartX,
                relStartY,
                relEndX,
                relEndY,
                0,
                0,
                combRadius
              );

              if (sweepResult !== null) {
                const impactX = bBeforeX + sweepResult.t * (b.x - bBeforeX);
                const impactY = bBeforeY + sweepResult.t * (b.y - bBeforeY);
                hits.push({
                  pid: hostId!,
                  t: sweepResult.t,
                  impactX,
                  impactY,
                  isHost: true,
                  isDash: state.player.dash.active
                });
              }
            }

            // Remote candidates
            for (const pid in state.multiplayerPlayers) {
              const mpPlayer = state.multiplayerPlayers[pid];
              const mPlayer = state.matchPlayers[pid];

              const isRemoteEligible = !!mpPlayer && 
                !!mPlayer && 
                !mpPlayer.isDead && 
                !mPlayer.isDead && 
                !mPlayer.isDisconnected && 
                !isOpeningProtectionActiveForHost(currentTime);

              if (isRemoteEligible) {
                const sweepResult = segmentVersusCircle(
                  bBeforeX,
                  bBeforeY,
                  b.x,
                  b.y,
                  mpPlayer.x,
                  mpPlayer.y,
                  b.radius + mpPlayer.radius
                );

                if (sweepResult !== null) {
                  const impactX = bBeforeX + sweepResult.t * (b.x - bBeforeX);
                  const impactY = bBeforeY + sweepResult.t * (b.y - bBeforeY);
                  hits.push({
                    pid,
                    t: sweepResult.t,
                    impactX,
                    impactY,
                    isHost: false,
                    isDash: mpPlayer.isDash
                  });
                }
              }
            }

            if (hits.length > 0) {
              hits.sort((a, b) => {
                if (Math.abs(a.t - b.t) > 1e-9) {
                  return a.t - b.t;
                }
                return a.pid.localeCompare(b.pid);
              });

              const winner = hits[0];
              const playerContactFirst = winner.t < 1 - 1e-6 && hasStaticResponse;

              if (playerContactFirst) {
                b.dx = savedDx;
                b.dy = savedDy;
                b.kbvx = savedKbvx;
                b.kbvy = savedKbvy;
              }

              b.x = winner.impactX;
              b.y = winner.impactY;
              state.forceBroadcast = true;

              if (winner.isDash) {
                if (winner.isHost) {
                  spawnParticles(winner.impactX, winner.impactY, '#ff3333', 30);
                  b.size = 0;
                  b.dx *= -1;
                  b.dy *= -1;
                } else {
                  b.dx *= -1;
                  b.dy *= -1;
                }
              } else {
                if (winner.isHost) {
                  if (uiRef.current.status === 'PLAYING') {
                    triggerEndPresentation({
                      outcome: 'defeat',
                      causeCode: 'bouncer_collision',
                      label: 'BOUNCER COLLISION',
                      impactPos: { x: winner.impactX, y: winner.impactY },
                      markerColor: '#ff003c',
                      startTimestamp: performance.now(),
                    });
                    setUiState(prev => {
                      uiRef.current = { ...prev, status: 'GAME_OVER' };
                      return uiRef.current;
                    });
                  }
                } else {
                  eliminateRemotePlayerRef.current?.(winner.pid, { x: winner.impactX, y: winner.impactY }, currentTime);
                }
              }
            }
          }

          // Collision with Player
          if (!isAuthoritativeMultiplayerSimulation && uiRef.current.status === 'PLAYING') {
            const pdx = state.player.x - b.x;
            const pdy = state.player.y - b.y;
            if (pdx * pdx + pdy * pdy < (state.player.radius + b.radius) ** 2) {
              if (state.player.dash.active) {
                // Destroy bouncer if player is dashing
                 spawnParticles(b.x, b.y, '#ff3333', 30);
                 b.size = 0; // mark for logic below or just bounce?
                 // Wait, let's just bounce
                 b.dx *= -1;
                 b.dy *= -1;
              } else if (!isOpeningProtectionActiveForHost(currentTime)) {
                const localColorIdx = playerProfileRef.current.colorIdx;
                const localColor = PLAYER_COLORS[localColorIdx]?.n || '#00f0ff';
                triggerEndPresentation({
                  outcome: 'defeat',
                  causeCode: 'bouncer_collision',
                  label: 'BOUNCER COLLISION',
                  impactPos: { x: b.x, y: b.y },
                  markerColor: '#ff003c',
                  startTimestamp: performance.now(),
                });
                setUiState(prev => {
                  uiRef.current = { ...prev, status: 'GAME_OVER' };
                  return uiRef.current;
                });
              }
            }
          }

          // Multiply logic
          if (b.size === 1) {
            const currentBouncerValue = state.bouncers.reduce((sum, b) => sum + b.size, 0);
            if (currentBouncerValue < state.bouncerCapacity && currentTime - b.lastMultiply > 5000) {
              b.lastMultiply = currentTime;
              const angle = Math.random() * Math.PI * 2;
              state.bouncers.push({
                id: 'b_' + state.nextEntityId++,
                x: b.x, y: b.y, dx: Math.cos(angle), dy: Math.sin(angle),
                size: 1, radius: 24, speed: ENEMY_SPEED + Math.random() * 20, lastDirChange: currentTime, lastMultiply: currentTime
              });
            }
          }
        }

        // B4: Host-side Orbiting relic obstacles checks against living remote players
        if (mpRef.current.roomId && mpRef.current.isHost) {
          for (const spawner of state.spawners) {
            if (spawner.specialType) {
              for (const pid in state.multiplayerPlayers) {
                const mpPlayer = state.multiplayerPlayers[pid];
                if (mpPlayer && !mpPlayer.isDead) {
                  const isProtected = mpPlayer.isDash || isOpeningProtectionActiveForHost(currentTime);
                  if (!isProtected) {
                    const collision = getBulletRelicCollision(mpPlayer.x, mpPlayer.y, mpPlayer.radius, spawner, worldPhaseTime);
                    if (collision) {
                      eliminateRemotePlayerRef.current?.(pid, { x: mpPlayer.x, y: mpPlayer.y }, currentTime);
                    }
                  }
                }
              }
            }
          }
        }
        } // End of Host ONLY logic (part 1)

        // 4. Handle Tools & Shooting
        let isShooting = false;
        let shootDirX = 0;
        let shootDirY = 0;
        const activeTool = uiRef.current.activeTool;

        if (uiRef.current.deviceType === 'desktop') {
          isShooting = state.mouse.down;
          const worldMouseX = state.mouse.x + state.camera.x;
          const worldMouseY = state.mouse.y + state.camera.y;
          shootDirX = worldMouseX - state.player.x;
          shootDirY = worldMouseY - state.player.y;
        } else {
          // Mobile mapping
          if (state.touches.right.active && currentTime - state.touches.right.startTime > 100) {
            const deadzone = 0.2;
            if (Math.abs(state.touches.right.dirX) > deadzone || Math.abs(state.touches.right.dirY) > deadzone) {
              isShooting = true;
              shootDirX = state.touches.right.dirX;
              shootDirY = state.touches.right.dirY;
            }
          }
        }

        const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
        if (isShooting && !isOpeningProtectionActiveLocal(currentTime) && !isLocalMenuOpen && currentTime - state.player.lastShoot > FIRE_RATE) {
          const isGuest = !!(mpRef.current.roomId && !mpRef.current.isHost);
          let clientShotId: string | undefined = undefined;
          let localBulletId = '';
          let canShoot = false;

          if (isGuest) {
            const socket = socketRef.current;
            const activeRoundId = activeMultiplayerRoundIdRef.current;
            const hasRoom = typeof mpRef.current.roomId === 'string' && mpRef.current.roomId.length > 0;
            const hasSocket = !!(socket && socket.connected && typeof socket.id === 'string' && socket.id.length > 0);
            const hasValidRound = typeof activeRoundId === 'number' && activeRoundId > 0 && Number.isInteger(activeRoundId);

            if (hasRoom && hasSocket && hasValidRound && socket) {
              const seq = clientShotSeqRef.current + 1;
              const candidateShotId = `${socket.id}:${activeRoundId}:${seq}`;
              if (candidateShotId.length >= 1 && candidateShotId.length <= 96 && /^[a-zA-Z0-9_\-:]+$/.test(candidateShotId)) {
                clientShotSeqRef.current = seq;
                clientShotId = candidateShotId;
                localBulletId = `local_${clientShotId}`;
                state.player.lastShoot = currentTime;
                canShoot = true;

                pendingGuestShotsRef.current.set(clientShotId, {
                  clientShotId,
                  localBulletId,
                  authoritativeBulletId: null,
                  roundId: activeRoundId,
                  spawnTime: currentTime,
                  status: 'pending',
                  authoritativeSeen: false,
                });
              }
            }
          } else {
            state.player.lastShoot = currentTime;
            if (mpRef.current.roomId && mpRef.current.isHost) {
              const myId = socketRef.current?.id;
              if (myId) {
                const auth = getOrInitializeAuthority(myId);
                auth.lastShootAt = currentTime;
              }
            }
            localBulletId = 'bh_' + state.nextEntityId++;
            canShoot = true;
          }

          if (canShoot) {
            let bvx = 0;
            let bvy = 0;
            const shootLen = Math.sqrt(shootDirX * shootDirX + shootDirY * shootDirY);

            if (shootLen > 0) {
              bvx = (shootDirX / shootLen) * BULLET_SPEED;
              bvy = (shootDirY / shootLen) * BULLET_SPEED;
            }

            const localAllowedKeys: string[] = [];
            if (state.player.recentBlocks) {
              for (const rb of state.player.recentBlocks) {
                const blockObj = state.blocks.find(b => b.x === rb.x && b.y === rb.y);
                if (blockObj) {
                  const comp = getConnectedComponent(blockObj, state.blocks.filter(b => b.colorIdx === blockObj.colorIdx));
                  for (const cb of comp) {
                    const cbKey = `${cb.x}_${cb.y}`;
                    if (!localAllowedKeys.includes(cbKey)) {
                      localAllowedKeys.push(cbKey);
                    }
                  }
                }
              }
            }

            if (isGuest && clientShotId) {
              const pending = pendingGuestShotsRef.current.get(clientShotId);
              if (pending) {
                pending.preview = {
                  x: state.player.x,
                  y: state.player.y,
                  dx: bvx,
                  dy: bvy,
                  radius: BULLET_RADIUS,
                  colorIdx: playerProfileRef.current.colorIdx,
                  allowedBlockKeys: [...localAllowedKeys],
                  spawnTime: currentTime,
                  lastUpdateTime: currentTime,
                  isNeutral: false,
                  bounceCount: 0,
                  lastWorldPhaseTime: worldPhaseTime,
                };
              }
            }

            // Only the host/single-player path creates gameplay bullets. A
            // multiplayer guest sends responsive input and keeps a cosmetic
            // local visual while the host owns the authoritative bullet.
            if (!isGuest) {
              state.bullets.push({
                id: localBulletId,
                clientShotId,
                x: state.player.x,
                y: state.player.y,
                dx: bvx,
                dy: bvy,
                radius: BULLET_RADIUS,
                isPlayer: true,
                bounceCount: 0,
                spawnTime: currentTime,
                isNeutral: false,
                ownerId: socketRef.current?.id || 'local',
                colorIdx: playerProfileRef.current.colorIdx,
                allowedBlockKeys: localAllowedKeys,
                leftBlockKeys: []
              });
            }

            // In multiplayer client mode, also notify the host to create the authoritative bullet
            if (isGuest && clientShotId) {
              const anchor = hostClockAnchorRef.current;
              const estimatedHostShotTime = anchor &&
                anchor.roomId === mpRef.current.roomId &&
                anchor.roundId === activeMultiplayerRoundIdRef.current
                  ? anchor.hostTimeAtAnchor + (currentTime - anchor.localTimeAtAnchor)
                  : undefined;
              socketRef.current?.emit('client_action', mpRef.current.roomId, {
                roundId: activeMultiplayerRoundIdRef.current,
                type: 'shoot',
                clientShotId,
                x: state.player.x,
                y: state.player.y,
                dx: bvx,
                dy: bvy,
                colorIdx: playerProfileRef.current.colorIdx,
                ...(estimatedHostShotTime !== undefined ? { shotHostTime: estimatedHostShotTime } : {})
              });
            }
          }
        }

        // Host ONLY logic (part 2)
        if (!mpRef.current.roomId || mpRef.current.isHost) {

        // 4.5. Zone Effects
        for (let z = state.zones.length - 1; z >= 0; z--) {
          const zone = state.zones[z];
          if (currentTime - zone.spawnTime > zone.duration) {
            state.zones.splice(z, 1);
            continue;
          }

          if (zone.type === 'repel') {
             // Zone follows owner
             let ownerTarget = null;
             if (zone.ownerId === 'local' || (mpRef.current.roomId && socketRef.current?.id && zone.ownerId === socketRef.current.id)) {
                 ownerTarget = state.player;
             } else if (state.multiplayerPlayers[zone.ownerId]) {
                 ownerTarget = state.multiplayerPlayers[zone.ownerId];
             }
             if (ownerTarget) {
                 zone.x = ownerTarget.x;
                 zone.y = ownerTarget.y;
             }

             // Repel bullets
             const newBullets: any[] = [];
             for (const bullet of state.bullets) {
                 // Ignore bullets of the same color that have not bounced off a wall yet
                 if (bullet.colorIdx === zone.colorIdx && bullet.isPlayer && !bullet.isNeutral) {
                     continue;
                 }

                 const dx = bullet.x - zone.x;
                 const dy = bullet.y - zone.y;
                 if (dx * dx + dy * dy <= zone.outerRadius * zone.outerRadius) {
                     const dist = Math.sqrt(dx * dx + dy * dy);
                     if (dist > 0) {
                         const nx = dx / dist;
                         const ny = dy / dist;
                         const dot = bullet.dx * nx + bullet.dy * ny;
                         if (dot < 0) { // Moving inward
                             const origDx = bullet.dx;
                             const origDy = bullet.dy;
                             const speed = Math.sqrt(origDx * origDx + origDy * origDy);

                             // 1. Mirrored bullet (modify existing)
                             bullet.dx -= 2 * dot * nx;
                             bullet.dy -= 2 * dot * ny;
                             bullet.bounceCount++;
                             bullet.isNeutral = false;
                             bullet.isPlayer = true;
                             bullet.ownerId = zone.ownerId;
                             bullet.colorIdx = zone.colorIdx;

                             if (!bullet.repelMultiplied) {
                                 bullet.repelMultiplied = true;

                                 // 2. Reversed bullet (directly back where it came from)
                                 newBullets.push({
                                     id: Math.random().toString(36).substring(2, 9),
                                     x: bullet.x,
                                     y: bullet.y,
                                     dx: -origDx,
                                     dy: -origDy,
                                     radius: bullet.radius,
                                     isPlayer: true,
                                     ownerId: zone.ownerId,
                                     bounceCount: bullet.bounceCount,
                                     isNeutral: false,
                                     colorIdx: zone.colorIdx,
                                     spawnTime: bullet.spawnTime || performance.now(),
                                     repelMultiplied: true
                                 });

                                 // 3. Away bullet (shot directly away from player)
                                 newBullets.push({
                                     id: Math.random().toString(36).substring(2, 9),
                                     x: bullet.x,
                                     y: bullet.y,
                                     dx: nx * speed,
                                     dy: ny * speed,
                                     radius: bullet.radius,
                                     isPlayer: true,
                                     ownerId: zone.ownerId,
                                     bounceCount: bullet.bounceCount,
                                     isNeutral: false,
                                     colorIdx: zone.colorIdx,
                                     spawnTime: bullet.spawnTime || performance.now(),
                                     repelMultiplied: true
                                 });
                             }
                         }
                     }
                 }
             }
             if (newBullets.length > 0) {
                 state.bullets.push(...newBullets);
             }
          }

          // Continuous pushes for enemies and bouncers have been replaced with smooth decaying knockback shockwaves in their updates.
        }

        // 5. Update Bullets & Collisions
        if (mpRef.current.roomId && mpRef.current.isHost) {
          hostBulletSimulationTickRef.current += 1;
        }
        for (let i = state.bullets.length - 1; i >= 0; i--) {
          const bullet = state.bullets[i];
          const isAuthoritativeMultiplayerBullet =
            Boolean(mpRef.current.roomId && mpRef.current.isHost);
          const requestedCatchUpFromTime = (bullet as any).multiplayerCatchUpFromTime;
          const hasMultiplayerCatchUp = isAuthoritativeMultiplayerBullet &&
            typeof requestedCatchUpFromTime === 'number' &&
            Number.isFinite(requestedCatchUpFromTime) &&
            requestedCatchUpFromTime < currentTime;
          const bulletStepStartTime = hasMultiplayerCatchUp
            ? Math.max(0, bullet.spawnTime, requestedCatchUpFromTime)
            : Math.max(0, currentTime - dt * 1000);
          const bulletStepDurationMs = Math.max(0, currentTime - bulletStepStartTime);

          if (mpRef.current.roomId && mpRef.current.isHost && bullet.id) {
            const currentAuthoritativeState = toAuthoritativeBulletState(bullet);
            const previousAuthoritativeState = knownHostBulletStatesRef.current.get(String(bullet.id));
            if (currentAuthoritativeState && !previousAuthoritativeState) {
              queueAuthoritativeBulletEvent('spawn', bullet, bulletStepStartTime);
            } else if (currentAuthoritativeState && previousAuthoritativeState) {
              const transformed =
                currentAuthoritativeState.dx !== previousAuthoritativeState.dx ||
                currentAuthoritativeState.dy !== previousAuthoritativeState.dy ||
                currentAuthoritativeState.isNeutral !== previousAuthoritativeState.isNeutral ||
                currentAuthoritativeState.isPlayer !== previousAuthoritativeState.isPlayer ||
                currentAuthoritativeState.ownerId !== previousAuthoritativeState.ownerId ||
                currentAuthoritativeState.colorIdx !== previousAuthoritativeState.colorIdx ||
                currentAuthoritativeState.repelMultiplied !== previousAuthoritativeState.repelMultiplied;
              if (transformed) {
                queueAuthoritativeBulletEvent('transform', bullet, bulletStepStartTime, 'ability');
              }
            }

          }

          const sweepWasNeutral = !!bullet.isNeutral;
          const sweepWasPlayer = !!bullet.isPlayer;
          const sweepColorIdx = bullet.colorIdx !== undefined ? bullet.colorIdx : 0;

          // Initialize connected-area tracking arrays
          if (!bullet.allowedBlockKeys) {
            bullet.allowedBlockKeys = [];
          }
          if (!bullet.leftBlockKeys) {
            bullet.leftBlockKeys = [];
          }

          // Dynamic tracking of connected area for the bullet
          // 1. If it's a freshly initialized bullet, automatically register connected area it is currently spawned in
          const isFreshBullet = bullet.allowedBlockKeys.length === 0 && bullet.leftBlockKeys.length === 0;

          for (const block of state.blocks) {
            const halfSize = block.size / 2;
            const closestX = Math.max(block.x - halfSize, Math.min(bullet.x, block.x + halfSize));
            const closestY = Math.max(block.y - halfSize, Math.min(bullet.y, block.y + halfSize));
            const bdx = bullet.x - closestX;
            const bdy = bullet.y - closestY;

            if (bdx * bdx + bdy * bdy < bullet.radius * bullet.radius && block.colorIdx === bullet.colorIdx) {
              const key = `${block.x}_${block.y}`;
              const isNewBlock = (currentTime - block.createdAt < 300);
              const isAlreadyAllowed = bullet.allowedBlockKeys.includes(key);

              if (isFreshBullet || isNewBlock || isAlreadyAllowed) {
                // If a new block was placed, clear it from leftBlockKeys just in case
                if (isNewBlock) {
                  const leftIdx = bullet.leftBlockKeys.indexOf(key);
                  if (leftIdx !== -1) {
                    bullet.leftBlockKeys.splice(leftIdx, 1);
                  }
                }

                const comp = getConnectedComponent(block, state.blocks.filter(b => b.colorIdx === block.colorIdx));
                for (const cb of comp) {
                  const cbKey = `${cb.x}_${cb.y}`;

                  // Make sure to remove any newly connected block keys from leftBlockKeys
                  if (isNewBlock) {
                    const cbLeftIdx = bullet.leftBlockKeys.indexOf(cbKey);
                    if (cbLeftIdx !== -1) {
                      bullet.leftBlockKeys.splice(cbLeftIdx, 1);
                    }
                  }

                  if (!bullet.leftBlockKeys.includes(cbKey) && !bullet.allowedBlockKeys.includes(cbKey)) {
                    bullet.allowedBlockKeys.push(cbKey);
                  }
                }
              }
            }
          }

          // 2. Check if the bullet is overlapping with any block in allowedBlockKeys
          let overlappingWithAllowed = false;
          for (const block of state.blocks) {
            const key = `${block.x}_${block.y}`;
            if (bullet.allowedBlockKeys.includes(key)) {
              const halfSize = block.size / 2;
              const closestX = Math.max(block.x - halfSize, Math.min(bullet.x, block.x + halfSize));
              const closestY = Math.max(block.y - halfSize, Math.min(bullet.y, block.y + halfSize));
              const bdx = bullet.x - closestX;
              const bdy = bullet.y - closestY;
              if (bdx * bdx + bdy * bdy < bullet.radius * bullet.radius) {
                overlappingWithAllowed = true;
                break;
              }
            }
          }

          // 3. Transition to leftBlockKeys if we completely exited the allowed block(s)
          if (bullet.allowedBlockKeys.length > 0 && !overlappingWithAllowed) {
            for (const key of bullet.allowedBlockKeys) {
              if (!bullet.leftBlockKeys.includes(key)) {
                bullet.leftBlockKeys.push(key);
              }
            }
            bullet.allowedBlockKeys = [];
          }

          let speedMultiplier = 1;
          const timeAlive = currentTime - bullet.spawnTime;

          // Initial speed burst to avoid player running into their own bullets
          if (bullet.isPlayer && timeAlive < 250) {
            speedMultiplier = 3.5;
          }

          const bulletTravelSeconds = hasMultiplayerCatchUp && bullet.isPlayer
            ? getPlayerBulletTravelSecondsBetween(
                bullet.spawnTime,
                bulletStepStartTime,
                currentTime,
              )
            : speedMultiplier * dt;

          const bulletBeforeX = bullet.x;
          const bulletBeforeY = bullet.y;

          const targetX = bulletBeforeX + bullet.dx * bulletTravelSeconds;
          const targetY = bulletBeforeY + bullet.dy * bulletTravelSeconds;

          let normalsToProcess: { nx: number; ny: number }[] = [];
          let trailX = bullet.x;
          let trailY = bullet.y;
          let authoritativeTargetHit: {
            type: 'bouncer' | 'enemy' | 'spawner' | 'player';
            id: string;
            index: number;
            isHost?: boolean;
          } | null = null;
          let authoritativeImpactTime = currentTime;

          if (isAuthoritativeMultiplayerBullet) {
            const startPhaseTime = Math.max(0, worldPhaseTime - bulletStepDurationMs);
            const allowedBuildKeys = new Set(bullet.allowedBlockKeys || []);
            const surfaces: AxisAlignedSurface[] = [
              ...activeWalls.map((wall, index) => ({
                id: `wall:${index}`,
                kind: 'wall' as const,
                x: wall.x,
                y: wall.y,
                w: wall.w,
                h: wall.h,
                data: { wall, index },
              })),
              ...state.blocks.flatMap((block, index) => {
                if (allowedBuildKeys.has(`${block.x}_${block.y}`)) return [];
                return [{
                  id: `build:${index}:${block.x}:${block.y}`,
                  kind: 'build' as const,
                  x: block.x - block.size / 2,
                  y: block.y - block.size / 2,
                  w: block.size,
                  h: block.size,
                  data: { block, index },
                }];
              }),
            ];

            const motionTrace = traceReflectedBulletMotion({
              x: bulletBeforeX,
              y: bulletBeforeY,
              dx: bullet.dx,
              dy: bullet.dy,
              durationSeconds: bulletTravelSeconds,
              radius: bullet.radius,
              surfaces,
              dynamicSurface: (startX, startY, endX, endY, startFraction, endFraction): SurfaceHit | null => {
                const relicCollision = sweptMultiplayerBulletRelicCollision(
                  startX,
                  startY,
                  endX,
                  endY,
                  bullet.radius,
                  state.spawners,
                  startPhaseTime + (worldPhaseTime - startPhaseTime) * startFraction,
                  startPhaseTime + (worldPhaseTime - startPhaseTime) * endFraction,
                );
                if (!relicCollision) return null;
                const spawnerIndex = state.spawners.indexOf(relicCollision.spawner);
                return {
                  id: `relic:${spawnerIndex}:${relicCollision.specialType}`,
                  kind: 'relic',
                  t: relicCollision.t,
                  x: startX + (endX - startX) * relicCollision.t,
                  y: startY + (endY - startY) * relicCollision.t,
                  normals: [{ nx: relicCollision.nx, ny: relicCollision.ny }],
                  data: {
                    spawner: relicCollision.spawner,
                    index: spawnerIndex,
                    specialType: relicCollision.specialType,
                  },
                };
              },
            });

            const neutralAtSegment = (segmentIndex: number) => {
              let neutral = sweepWasNeutral;
              for (let segment = 0; segment < segmentIndex; segment += 1) {
                const collision = motionTrace.segments[segment]?.collision;
                if (collision?.kind === 'wall' || collision?.kind === 'build') neutral = true;
              }
              return neutral;
            };

            const targetHit = findEarliestCircleTargetHit(
              motionTrace.segments,
              (_segment, segmentIndex) => {
                const targets: Array<{
                  id: string;
                  x: number;
                  y: number;
                  radius: number;
                  priority: number;
                  data: { type: 'bouncer' | 'enemy' | 'spawner' | 'player'; id: string; index: number; isHost?: boolean };
                }> = [];
                const segmentNeutral = neutralAtSegment(segmentIndex);
                const segmentColor = segmentNeutral
                  ? '#aaaaaa'
                  : (sweepWasPlayer ? (PLAYER_COLORS[sweepColorIdx] || PLAYER_COLORS[0]).n : '#ff0066');

                if (sweepWasPlayer || segmentNeutral) {
                  state.bouncers.forEach((bouncer, index) => targets.push({
                    id: `bouncer:${bouncer.id ?? index}`,
                    x: bouncer.x,
                    y: bouncer.y,
                    radius: bouncer.radius + bullet.radius,
                    priority: 0,
                    data: { type: 'bouncer', id: String(bouncer.id ?? index), index },
                  }));
                }

                if (segmentColor !== '#ff0066') {
                  state.enemies.forEach((enemy, index) => targets.push({
                    id: `enemy:${enemy.id ?? index}`,
                    x: enemy.x,
                    y: enemy.y,
                    radius: enemy.radius + bullet.radius,
                    priority: 1,
                    data: { type: 'enemy', id: String(enemy.id ?? index), index },
                  }));
                }

                if (sweepWasPlayer && !segmentNeutral) {
                  state.spawners.forEach((spawner, index) => targets.push({
                    id: `spawner:${index}`,
                    x: spawner.x,
                    y: spawner.y,
                    radius: spawner.radius + bullet.radius,
                    priority: 2,
                    data: { type: 'spawner', id: String(index), index },
                  }));
                }

                const hostId = socketRef.current?.id;
                const hostMatchPlayer = hostId && state.matchPlayers ? state.matchPlayers[hostId] : null;
                const hostColor = (PLAYER_COLORS[playerProfileRef.current.colorIdx] || PLAYER_COLORS[0]).n;
                const hostAlive = STATUS === 'PLAYING' && !!hostId && !!hostMatchPlayer &&
                  !hostMatchPlayer.isDead && !hostMatchPlayer.isDisconnected;
                if (hostAlive && hostId && segmentColor !== hostColor &&
                    !state.player.dash.active && !isOpeningProtectionActiveForHost(currentTime)) {
                  targets.push({
                    id: `player:${hostId}`,
                    x: state.player.x,
                    y: state.player.y,
                    radius: state.player.radius + bullet.radius * 0.5,
                    priority: 3,
                    data: { type: 'player', id: hostId, index: -1, isHost: true },
                  });
                }

                Object.keys(state.multiplayerPlayers).sort().forEach((playerId, index) => {
                  const remote = state.multiplayerPlayers[playerId];
                  const matchPlayer = state.matchPlayers?.[playerId];
                  if (!remote || remote.isDead || !matchPlayer || matchPlayer.isDead || matchPlayer.isDisconnected) return;
                  const remoteColor = (PLAYER_COLORS[remote.colorIdx ?? 0] || PLAYER_COLORS[0]).n;
                  if (segmentColor === remoteColor || remote.isDash || isOpeningProtectionActiveForHost(currentTime)) return;
                  targets.push({
                    id: `player:${playerId}`,
                    x: remote.x,
                    y: remote.y,
                    radius: remote.radius + bullet.radius * 0.5,
                    priority: 3,
                    data: { type: 'player', id: playerId, index, isHost: false },
                  });
                });
                return targets;
              },
            );

            const collisionSegmentLimit = targetHit ? targetHit.segmentIndex : motionTrace.segments.length;
            for (let segmentIndex = 0; segmentIndex < collisionSegmentLimit; segmentIndex += 1) {
              const segment = motionTrace.segments[segmentIndex];
              const collision = segment.collision;
              if (!collision) continue;
              const nextSegment = motionTrace.segments[segmentIndex + 1];
              bullet.x = collision.x;
              bullet.y = collision.y;
              bullet.dx = nextSegment?.dx ?? motionTrace.dx;
              bullet.dy = nextSegment?.dy ?? motionTrace.dy;
              bullet.bounceCount += 1;
              if (collision.kind === 'wall' || collision.kind === 'build') bullet.isNeutral = true;

              let particleColor = bullet.isNeutral ? '#aaaaaa' : '#00ccff';
              let particleCount = 5;
              if (collision.kind === 'build') {
                const block = (collision.data as any)?.block;
                particleColor = (PLAYER_COLORS[block?.colorIdx ?? 0] || PLAYER_COLORS[0]).n;
              } else if (collision.kind === 'relic') {
                const specialType = (collision.data as any)?.specialType;
                particleCount = 8;
                if (specialType === 'shield') particleColor = '#00f0ff';
                else if (specialType === 'kinetic') particleColor = '#ffcc00';
                else if (specialType === 'singularity') particleColor = '#b500ff';
                else if (specialType === 'magma_gates') particleColor = '#ff5500';
                else if (specialType === 'crystal') particleColor = '#00ffaa';
              }
              spawnParticles(collision.x, collision.y, particleColor, particleCount);
              const collisionTime = hasMultiplayerCatchUp && bullet.isPlayer
                ? getPlayerBulletTimeAtTravelFraction(
                    bullet.spawnTime,
                    bulletStepStartTime,
                    currentTime,
                    segment.endFraction,
                  )
                : bulletStepStartTime + segment.endFraction * bulletStepDurationMs;
              queueAuthoritativeBulletEvent('bounce', bullet, collisionTime, collision.kind);
            }

            if (targetHit) {
              bullet.x = targetHit.x;
              bullet.y = targetHit.y;
              bullet.dx = motionTrace.segments[targetHit.segmentIndex].dx;
              bullet.dy = motionTrace.segments[targetHit.segmentIndex].dy;
              authoritativeTargetHit = targetHit.target.data;
              authoritativeImpactTime = hasMultiplayerCatchUp && bullet.isPlayer
                ? getPlayerBulletTimeAtTravelFraction(
                    bullet.spawnTime,
                    bulletStepStartTime,
                    currentTime,
                    targetHit.stepFraction,
                  )
                : bulletStepStartTime + targetHit.stepFraction * bulletStepDurationMs;
            } else {
              bullet.x = motionTrace.x;
              bullet.y = motionTrace.y;
              bullet.dx = motionTrace.dx;
              bullet.dy = motionTrace.dy;
            }
            trailX = bullet.x;
            trailY = bullet.y;
            normalsToProcess = [];
            if (hasMultiplayerCatchUp) {
              delete (bullet as any).multiplayerCatchUpFromTime;
            }
          } else {
            // Outside authoritative multiplayer: direct movement and direct resolveWallCollisions
            bullet.x = targetX;
            bullet.y = targetY;
            trailX = targetX;
            trailY = targetY;
            const bulletResolved = resolveWallCollisions(bullet.x, bullet.y, bullet.radius, activeWalls, bulletBeforeX, bulletBeforeY);
            bullet.x = bulletResolved.x;
            bullet.y = bulletResolved.y;
            normalsToProcess = bulletResolved.normals;
          }

          // Keep trail creation at the bullet’s final resolved position for MP, but original direct endpoint for SP.
          if (Math.random() > 0.3) {
            let trailColor = '#ff0066';
            if (bullet.isNeutral) {
              trailColor = '#aaaaaa';
            } else if (bullet.isPlayer) {
              const pDef = PLAYER_COLORS[bullet.colorIdx !== undefined ? bullet.colorIdx : 0] || PLAYER_COLORS[0];
              trailColor = pDef.n;
            }
            state.trails.push({
              x: trailX, y: trailY, age: 0,
              color: trailColor,
              radius: bullet.radius * 0.6
            });
          }

          let collidedWithWall = false;
          for (const n of normalsToProcess) {
            const dot = bullet.dx * n.nx + bullet.dy * n.ny;
            if (dot < 0) {
              bullet.dx = bullet.dx - 2 * dot * n.nx;
              bullet.dy = bullet.dy - 2 * dot * n.ny;
              bullet.bounceCount++;
              bullet.isNeutral = true;
              collidedWithWall = true;
              const pColor = bullet.isNeutral ? '#aaaaaa' : (!bullet.isPlayer ? '#ff0066' : '#00ccff');
              spawnParticles(bullet.x, bullet.y, pColor, 5);
            }
          }

          if (collidedWithWall && isAuthoritativeMultiplayerBullet) {
            state.forceBroadcast = true;
          }

          // Special Relic Collisions
          if (!isAuthoritativeMultiplayerBullet) {
            for (const spawner of state.spawners) {
              if (spawner.specialType) {
                const collision = getBulletRelicCollision(bullet.x, bullet.y, bullet.radius, spawner, worldPhaseTime);
                if (collision) {
                  const { nx, ny, overlap } = collision;
                  bullet.x += nx * overlap;
                  bullet.y += ny * overlap;

                  const dot = bullet.dx * nx + bullet.dy * ny;
                  if (dot < 0) {
                    bullet.dx = bullet.dx - 2 * dot * nx;
                    bullet.dy = bullet.dy - 2 * dot * ny;
                    bullet.bounceCount++;

                    let pColor = '#aaaaaa';
                    if (spawner.specialType === 'shield') pColor = '#00f0ff';
                    else if (spawner.specialType === 'kinetic') pColor = '#ffcc00';
                    else if (spawner.specialType === 'singularity') pColor = '#b500ff';
                    else if (spawner.specialType === 'magma_gates') pColor = '#ff5500';
                    else if (spawner.specialType === 'crystal') pColor = '#00ffaa';

                    spawnParticles(bullet.x, bullet.y, pColor, 8);
                  }
                }
              }
            }
          }

          let bulletDestroyed = false;

          if (bulletDestroyed) {
             state.bullets.splice(i, 1);
             continue;
          }

          // Block Collisions
          if (!bulletDestroyed && !isAuthoritativeMultiplayerBullet) {
             for (let b = state.blocks.length - 1; b >= 0; b--) {
               const block = state.blocks[b];

               // Skip collision if this block is currently part of the allowed connected area
               const blockKey = `${block.x}_${block.y}`;
               if (bullet.allowedBlockKeys && bullet.allowedBlockKeys.includes(blockKey)) {
                 continue;
               }

               const halfSize = block.size / 2;
               const closestX = Math.max(block.x - halfSize, Math.min(bullet.x, block.x + halfSize));
               const closestY = Math.max(block.y - halfSize, Math.min(bullet.y, block.y + halfSize));
               const bdx = bullet.x - closestX;
               const bdy = bullet.y - closestY;

               if (bdx * bdx + bdy * bdy < bullet.radius * bullet.radius) {
                 // Block is unbreakable, bounce bullets
                 bullet.bounceCount++;
                 bullet.isNeutral = true;
                 const pDef = PLAYER_COLORS[block.colorIdx !== undefined ? block.colorIdx : 0] || PLAYER_COLORS[0];
                 spawnParticles(closestX, closestY, pDef.n, 5);

                 const currentDist = Math.sqrt(bdx * bdx + bdy * bdy);
                 const pushDist = (bullet.radius - currentDist) + 1;

                 if (Math.abs(bullet.x - block.x) >= Math.abs(bullet.y - block.y)) {
                   bullet.dx *= -1;
                   bullet.x += bdx === 0 ? (bullet.dx > 0 ? pushDist : -pushDist) : (bdx / Math.abs(bdx)) * pushDist;
                 } else {
                   bullet.dy *= -1;
                   bullet.y += bdy === 0 ? (bullet.dy > 0 ? pushDist : -pushDist) : (bdy / Math.abs(bdy)) * pushDist;
                 }
               }
             }
          }

          // Check hit Bouncers
          if (!bulletDestroyed && (bullet.isPlayer || bullet.isNeutral)) {
            for (let b = state.bouncers.length - 1; b >= 0; b--) {
              const bouncer = state.bouncers[b];
              const dx = bouncer.x - bullet.x;
              const dy = bouncer.y - bullet.y;
              const hitThisBouncer = isAuthoritativeMultiplayerBullet
                ? authoritativeTargetHit?.type === 'bouncer' && authoritativeTargetHit.index === b
                : dx * dx + dy * dy < (bouncer.radius + bullet.radius) ** 2;
              if (hitThisBouncer) {
                spawnParticles(bouncer.x, bouncer.y, '#ff3333', 20);
                bulletDestroyed = true;
                state.bouncers.splice(b, 1);

                let nextSize = 0;
                let nextRadius = 0;
                let nextSpeed = 0;
                if (bouncer.size === 1) {
                  nextSize = 0.5;
                  nextRadius = 20;
                  nextSpeed = ENEMY_SPEED + Math.random() * 20;
                } else if (bouncer.size === 0.5) {
                  nextSize = 0.25;
                  nextRadius = 16;
                  nextSpeed = ENEMY_SPEED + Math.random() * 20;
                }

                if (nextSize > 0) {
                  const baseAngle = Math.atan2(bouncer.dy, bouncer.dx);
                  state.bouncers.push({
                    id: 'b_' + state.nextEntityId++,
                    x: bouncer.x, y: bouncer.y,
                    dx: Math.cos(baseAngle + 0.5), dy: Math.sin(baseAngle + 0.5),
                    size: nextSize, radius: nextRadius, speed: nextSpeed,
                    lastDirChange: currentTime, lastMultiply: currentTime
                  });
                  state.bouncers.push({
                    id: 'b_' + state.nextEntityId++,
                    x: bouncer.x, y: bouncer.y,
                    dx: Math.cos(baseAngle - 0.5), dy: Math.sin(baseAngle - 0.5),
                    size: nextSize, radius: nextRadius, speed: nextSpeed,
                    lastDirChange: currentTime, lastMultiply: currentTime
                  });
                } else {
                  state.shockwaves.push({ x: bouncer.x, y: bouncer.y, color: '#ff3333', maxRadius: 100, age: 0, maxAge: 0.3, thickness: 10 });
                  let pts = 0;
                  if (bullet.isPlayer && !bullet.isNeutral) pts = 250;

                  if (pts > 0) {
                    const bOwner = bullet.ownerId || 'local';
                    const hostId = socketRef.current?.id || 'local';
                    if (bOwner === hostId || bOwner === 'local') {
                      setUiState(prev => {
                         const newScore = prev.score + pts;
                         uiRef.current = { ...prev, score: newScore };
                         return uiRef.current;
                      });
                    } else if (state.multiplayerPlayers[bOwner]) {
                      state.multiplayerPlayers[bOwner].score = (state.multiplayerPlayers[bOwner].score || 0) + pts;
                    }
                  }
                }
                break;
              }
            }
          }

          // Compute bullet color for dynamic friendly-fire / PvP logic
          let bulletColor = '#ff0066'; // Default red for NPC bouncers/bullets
          if (bullet.isNeutral) {
            bulletColor = '#aaaaaa';
          } else if (bullet.isPlayer) {
            const pDef = PLAYER_COLORS[bullet.colorIdx !== undefined ? bullet.colorIdx : 0] || PLAYER_COLORS[0];
            bulletColor = pDef.n;
          }

          // Check hit Enemies (NPCs - Red)
          if (!bulletDestroyed && bulletColor !== '#ff0066') {
            for (let e = state.enemies.length - 1; e >= 0; e--) {
              const enemy = state.enemies[e];
              const dx = enemy.x - bullet.x;
              const dy = enemy.y - bullet.y;
              const hitThisEnemy = isAuthoritativeMultiplayerBullet
                ? authoritativeTargetHit?.type === 'enemy' && authoritativeTargetHit.index === e
                : dx * dx + dy * dy < (enemy.radius + bullet.radius) ** 2;
              if (hitThisEnemy) {
                // Kill enemy
                spawnParticles(enemy.x, enemy.y, '#ff3333', 30);
                state.shockwaves.push({ x: enemy.x, y: enemy.y, color: '#ff3333', maxRadius: 80, age: 0, maxAge: 0.25, thickness: 8 });
                state.shake = 10;
                state.enemies.splice(e, 1);
                bulletDestroyed = true;
                let pts = 0;
                if (bullet.isPlayer && !bullet.isNeutral) {
                  pts = 100;
                }

                if (pts > 0) {
                  const bOwner = bullet.ownerId || 'local';
                  const hostId = socketRef.current?.id || 'local';
                  if (bOwner === hostId || bOwner === 'local') {
                    setUiState(prev => {
                      const newScore = prev.score + pts;
                      let newBlocks = prev.blocks;
                      while (newScore >= state.nextBlockScore) {
                        newBlocks++;
                        state.nextBlockScore += 100;
                      }
                      uiRef.current = { ...prev, score: newScore, blocks: newBlocks };
                      return uiRef.current;
                    });
                  } else if (state.multiplayerPlayers[bOwner]) {
                    state.multiplayerPlayers[bOwner].score = (state.multiplayerPlayers[bOwner].score || 0) + pts;
                  }
                }
                break;
              }
            }
          }

          // Check hit Spawners (Stationary targets - hit by any player bullet)
          if (!bulletDestroyed && bullet.isPlayer && !bullet.isNeutral) {
            for (let s = state.spawners.length - 1; s >= 0; s--) {
              const spawner = state.spawners[s];
              const dx = spawner.x - bullet.x;
              const dy = spawner.y - bullet.y;
              const hitThisSpawner = isAuthoritativeMultiplayerBullet
                ? authoritativeTargetHit?.type === 'spawner' && authoritativeTargetHit.index === s
                : dx * dx + dy * dy < (spawner.radius + bullet.radius) ** 2;
              if (hitThisSpawner) {
                if (state.gameMode !== 'impossible') {
                  spawner.hp -= 20; // 5 hits to destroy (100 HP)
                }
                spawnParticles(bullet.x, bullet.y, '#ffffff', 10);
                bulletDestroyed = true;

                if (state.gameMode !== 'impossible' && spawner.hp <= 0) {
                  const destroyedSpawner = { x: spawner.x, y: spawner.y, radius: spawner.radius };
                  const spawnerColor = state.hardMode ? '#ff3300' : '#ff00ff';
                  spawnParticles(spawner.x, spawner.y, spawnerColor, 100);
                  state.shockwaves.push({ x: spawner.x, y: spawner.y, color: spawnerColor, maxRadius: 200, age: 0, maxAge: 0.5, thickness: 20 });
                  state.shake = 30;
                  state.spawners.splice(s, 1);
                  if (state.tutorial.active) {
                    state.tutorial.active = false;
                  }
                  triggerSpawnerPulse();
                  handleSpawnerDestroyed(destroyedSpawner);
                  // Force a broadcast immediately of the updated state
                  state.forceBroadcast = true;

                  let pts = 0;
                  if (bullet.isPlayer && !bullet.isNeutral) pts = 1000;

                  const bOwner = bullet.ownerId || 'local';
                  const hostId = socketRef.current?.id || 'local';

                  const isSinglePlayerVictory = state.spawners.length === 0 && !mpRef.current.roomId;
                  if (isSinglePlayerVictory) {
                    triggerEndPresentation({
                      outcome: 'victory',
                      causeCode: 'spawner_destroyed',
                      label: 'ALL SPAWNERS DESTROYED',
                      impactPos: { x: spawner.x, y: spawner.y },
                      markerColor: '#00f0ff',
                      startTimestamp: performance.now(),
                    });
                  }

                  if (bOwner === hostId || bOwner === 'local') {
                    setUiState(prev => {
                      const newScore = prev.score + pts;
                      let newBlocks = prev.blocks + 3; // Bonus blocks
                      uiRef.current = { ...prev, score: newScore, blocks: newBlocks, spawnersLeft: state.spawners.length };
                      if (isSinglePlayerVictory) {
                        uiRef.current.status = 'VICTORY';
                      }
                      return uiRef.current;
                    });
                  } else {
                    if (state.multiplayerPlayers[bOwner]) {
                      state.multiplayerPlayers[bOwner].score = (state.multiplayerPlayers[bOwner].score || 0) + pts;
                    }
                    setUiState(prev => {
                      uiRef.current = { ...prev, spawnersLeft: state.spawners.length };
                      if (isSinglePlayerVictory) {
                        uiRef.current.status = 'VICTORY';
                      }
                      return uiRef.current;
                    });
                  }
                }
                break;
              }
            }
          }

          // Check hit Player/Remote Players
          if (!bulletDestroyed) {
            if (isAuthoritativeMultiplayerBullet) {
              if (authoritativeTargetHit?.type === 'player') {
                bulletDestroyed = true;
                state.forceBroadcast = true;

                if (authoritativeTargetHit.isHost) {
                  let label = 'HOSTILE FIRE';
                  let causeCode = 'hostile_fire';
                  if (bullet.isNeutral) {
                    label = 'NEUTRAL RICOCHET';
                    causeCode = 'neutral_ricochet';
                  } else if (bullet.isPlayer) {
                    causeCode = 'player_shot';
                    const attackerName = resolvePlayerName(bullet.ownerId);
                    label = attackerName ? `SHOT BY ${attackerName}` : 'SHOT BY RIVAL PLAYER';
                  }

                  triggerEndPresentation({
                    outcome: 'defeat',
                    causeCode,
                    label,
                    impactPos: { x: bullet.x, y: bullet.y },
                    markerColor: '#ff003c',
                    startTimestamp: performance.now(),
                  });

                  setUiState(prev => {
                    uiRef.current = { ...prev, status: 'GAME_OVER' };
                    return uiRef.current;
                  });
                } else {
                  eliminateRemotePlayerRef.current?.(
                    authoritativeTargetHit.id,
                    { x: bullet.x, y: bullet.y },
                    currentTime,
                  );
                }
              }
            } else {
              // Single-player behavior: Keep the existing single-player host-local endpoint collision code exactly as it was.
              const hostColorIdx = playerProfileRef.current.colorIdx;
              const hostColor = PLAYER_COLORS[hostColorIdx]?.n || '#00f0ff';

              if (bulletColor !== hostColor) {
                const dx = state.player.x - bullet.x;
                const dy = state.player.y - bullet.y;
                const isProtected = state.player.dash.active || isOpeningProtectionActiveForHost(currentTime);
                if (!isProtected && dx * dx + dy * dy < (state.player.radius + bullet.radius * 0.5) ** 2) {
                  let label = 'HOSTILE FIRE';
                  let causeCode = 'hostile_fire';
                  if (bullet.isNeutral) {
                    label = 'NEUTRAL RICOCHET';
                    causeCode = 'neutral_ricochet';
                  } else if (bullet.isPlayer) {
                    causeCode = 'player_shot';
                    const attackerName = resolvePlayerName(bullet.ownerId);
                    label = attackerName ? `SHOT BY ${attackerName}` : 'SHOT BY RIVAL PLAYER';
                  }

                  triggerEndPresentation({
                    outcome: 'defeat',
                    causeCode,
                    label,
                    impactPos: { x: bullet.x, y: bullet.y },
                    markerColor: '#ff003c',
                    startTimestamp: performance.now(),
                  });

                  setUiState(prev => {
                    uiRef.current = { ...prev, status: 'GAME_OVER' };
                    return uiRef.current;
                  });
                  bulletDestroyed = true;
                }
              }
            }
          }

          if (bulletDestroyed) {
             if (isAuthoritativeMultiplayerBullet) {
               queueAuthoritativeBulletEvent(
                 'hit',
                 bullet,
                 authoritativeImpactTime,
                 authoritativeTargetHit?.type ?? 'collision',
               );
               if (bullet.id) knownHostBulletStatesRef.current.delete(String(bullet.id));
             }
             state.bullets.splice(i, 1);
          }
        }

        } // End of Host ONLY logic
      } // End of shouldRunUpdates (particles, trails, shockwaves, floating text always update)

      if (STATUS !== 'PAUSED') {
        // Update Particles
        for (let i = state.particles.length - 1; i >= 0; i--) {
          const p = state.particles[i];
          p.life += dt;
          if (p.life >= p.maxLife) {
            state.particles.splice(i, 1);
            continue;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.95;
          p.vy *= 0.95;
        }

        // Update Trails
        for (let i = state.trails.length - 1; i >= 0; i--) {
          const t = state.trails[i];
          t.age += dt;
          const maxAge = t.isSuperStrong ? 0.7 : 0.4;
          if (t.age >= maxAge) {
            state.trails.splice(i, 1);
          }
        }

        // Update Shockwaves
        for (let i = state.shockwaves.length - 1; i >= 0; i--) {
          const s = state.shockwaves[i];
          s.age += dt;
          if (s.age >= s.maxAge) {
            state.shockwaves.splice(i, 1);
          }
        }

        // Update Floating Texts
        if (state.floatingTexts) {
          for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
            const ft = state.floatingTexts[i];
            ft.age += dt;
            ft.y += ft.vy * dt;
            if (ft.age >= ft.maxAge) {
              state.floatingTexts.splice(i, 1);
            }
          }
        }
      }

      // Host evaluates match state
      if (mpRef.current.isConnected && mpRef.current.roomId && mpRef.current.isHost) {
        evaluateMatchState(currentTime);
        if (state.matchPhase === 'FINISHED' && uiRef.current.status === 'PLAYING') {
          triggerMultiplayerMatchConclusion(state.winnerId);
          setUiState(prev => ({ ...prev, status: 'GAME_OVER' }));
        }
      }

      // Host broadcasts state
      if (mpRef.current.isConnected && mpRef.current.roomId && mpRef.current.isHost && (STATUS === 'PLAYING' || STATUS === 'GAME_OVER')) {
          if (currentTime - state.lastBroadcastTime > 50 || state.forceBroadcast) {
              const bulletEvents = pendingHostBulletEventsRef.current.splice(0);
              const criticalSnapshot = state.forceBroadcast || bulletEvents.length > 0;
              state.lastBroadcastTime = currentTime;
              state.forceBroadcast = false;
              const hostWorldPhaseTime = getMultiplayerWorldPhaseTime(currentTime);
              socketRef.current?.emit('host_game_state', mpRef.current.roomId, {
                criticalSnapshot,
                roundId: activeMultiplayerRoundIdRef.current,
                hostId: socketRef.current?.id,
                hostPlayer: { ...state.player, isDead: STATUS === 'GAME_OVER', name: playerProfileRef.current.name, colorIdx: playerProfileRef.current.colorIdx, score: uiRef.current.score },
                multiplayerPlayers: state.multiplayerPlayers,
                matchPhase: state.matchPhase,
                finalRunnerId: state.finalRunnerId,
                finalRunDeadline: state.finalRunDeadline,
                openingProtectionDeadline: state.openingProtectionDeadline,
                deadline: state.finalRunDeadline,
                winnerId: state.winnerId,
                finalWinner: state.winnerId,
                matchPlayers: state.matchPlayers,
                 playerActionAuthority: state.playerActionAuthority,
                blocks: state.blocks,
                bullets: state.bullets,
                bulletEvents,
                bulletEventSequence: hostBulletEventSequenceRef.current,
                bulletSimulationTick: hostBulletSimulationTickRef.current,
                enemies: state.enemies,
                spawners: state.spawners,
                bouncers: state.bouncers,
                zones: state.zones,
                particles: [],
                trails: [],
                shockwaves: [],
                score: uiRef.current.score,
                spawnersLeft: state.spawners.length,
                blocksLeft: uiRef.current.blocks,
                cameraZ: state.camera.z,
                hostTime: currentTime,
                worldPhaseTime: hostWorldPhaseTime
              });
          }
      }

      // --- RENDERING --- (Always render, even if GAME_OVER)

      // Update Camera based on player (or keep it still if dead)
      if (STATUS !== 'PAUSED') {
        state.shake = Math.max(0, state.shake - dt * 60);
        const shakeX = (Math.random() - 0.5) * state.shake;
        const shakeY = (Math.random() - 0.5) * state.shake;

        state.camera.x = state.player.x - state.camera.width / 2 + shakeX;
        state.camera.y = state.player.y - state.camera.height / 2 + shakeY;
        state.camera.x = clamp(state.camera.x, 0, Math.max(0, MAP_WIDTH - state.camera.width));
        state.camera.y = clamp(state.camera.y, 0, Math.max(0, MAP_HEIGHT - state.camera.height));
      }

      // Clear background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(-state.camera.x, -state.camera.y);

      // Draw Grid
      const GRID_SIZE = 100;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;

      const startX = Math.floor(state.camera.x / GRID_SIZE) * GRID_SIZE;
      const endX = startX + state.camera.width + GRID_SIZE;
      const startY = Math.floor(state.camera.y / GRID_SIZE) * GRID_SIZE;
      const endY = startY + state.camera.height + GRID_SIZE;

      ctx.beginPath();
      for (let x = startX; x <= endX; x += GRID_SIZE) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y <= endY; y += GRID_SIZE) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();

      // Draw Walls
      ctx.fillStyle = '#050508';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      for (const wall of activeWalls) {
        if (
          wall.x + wall.w < state.camera.x ||
          wall.x > state.camera.x + state.camera.width ||
          wall.y + wall.h < state.camera.y ||
          wall.y > state.camera.y + state.camera.height
        ) continue;

        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

        ctx.save();
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8;
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
        ctx.restore();
      }

      // Draw Spawners
      for (const spawner of state.spawners) {
        if (
          spawner.x + spawner.radius < state.camera.x ||
          spawner.x - spawner.radius > state.camera.x + state.camera.width ||
          spawner.y + spawner.radius < state.camera.y ||
          spawner.y - spawner.radius > state.camera.y + state.camera.height
        ) continue;

        // Draw Special Relic effects next to spawners
        if (spawner.specialType === 'shield') {
          ctx.save();
          ctx.translate(spawner.x, spawner.y);
          ctx.rotate(-worldPhaseTime * 0.001);
          ctx.strokeStyle = '#00f0ff';
          ctx.shadowColor = '#00f0ff';
          ctx.shadowBlur = 15;
          ctx.lineWidth = 2;
          for (let i = 0; i < 5; i++) {
            const angle = (i * Math.PI * 2) / 5;
            const nx = Math.cos(angle) * 95;
            const ny = Math.sin(angle) * 95;
            ctx.fillStyle = '#051d2e';
            ctx.beginPath();
            ctx.arc(nx, ny, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(nx, ny, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else if (spawner.specialType === 'kinetic') {
          ctx.save();
          ctx.translate(spawner.x, spawner.y);
          ctx.rotate(worldPhaseTime * 0.0015);
          ctx.strokeStyle = '#ffcc00';
          ctx.shadowColor = '#ffcc00';
          ctx.shadowBlur = 15;
          ctx.lineWidth = 2.5;
          for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * 50, Math.sin(angle) * 50);
            ctx.lineTo(Math.cos(angle + 0.2) * 85, Math.sin(angle + 0.2) * 85);
            ctx.lineTo(Math.cos(angle) * 95, Math.sin(angle) * 95);
            ctx.lineTo(Math.cos(angle - 0.2) * 85, Math.sin(angle - 0.2) * 85);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255, 204, 0, 0.15)';
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        } else if (spawner.specialType === 'singularity') {
          ctx.save();
          ctx.translate(spawner.x, spawner.y);
          ctx.rotate(worldPhaseTime * 0.002);
          for (let arm = 0; arm < 3; arm++) {
            const startA = (arm * Math.PI * 2) / 3;
            ctx.beginPath();
            ctx.strokeStyle = '#b500ff';
            ctx.shadowColor = '#b500ff';
            ctx.shadowBlur = 10;
            ctx.lineWidth = 3;
            for (let r = 35; r < 90; r += 5) {
              const theta = startA + (r - 35) * 0.05;
              const rx = Math.cos(theta) * r;
              const ry = Math.sin(theta) * r;
              if (r === 35) ctx.moveTo(rx, ry);
              else ctx.lineTo(rx, ry);
            }
            ctx.stroke();
          }
          ctx.fillStyle = '#05000a';
          ctx.strokeStyle = '#e100ff';
          ctx.lineWidth = 2;
          ctx.shadowColor = '#e100ff';
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.arc(0, 0, 20 + Math.sin(worldPhaseTime * 0.01) * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else if (spawner.specialType === 'magma_gates') {
          ctx.save();
          ctx.translate(spawner.x, spawner.y);

          const orbitAngle = worldPhaseTime * 0.0008;
          ctx.rotate(orbitAngle);

          const rects = [
            { angle: 0.2, distance: 75, w: 22, h: 45 },
            { angle: 1.2, distance: 95, w: 35, h: 20 },
            { angle: 2.2, distance: 80, w: 18, h: 32 },
            { angle: 3.3, distance: 100, w: 40, h: 15 },
            { angle: 4.4, distance: 70, w: 25, h: 38 },
            { angle: 5.5, distance: 90, w: 20, h: 28 },
          ];

          for (const r of rects) {
            ctx.save();
            const cx = Math.cos(r.angle) * r.distance;
            const cy = Math.sin(r.angle) * r.distance;
            ctx.translate(cx, cy);

            // Draw translucent orange glowing rectangle with parallel orientation
            ctx.fillStyle = 'rgba(255, 85, 0, 0.18)';
            ctx.strokeStyle = '#ff5500';
            ctx.shadowColor = '#ff5500';
            ctx.shadowBlur = 10;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(-r.w / 2, -r.h / 2, r.w, r.h);
            ctx.fill();
            ctx.stroke();

            ctx.restore();
          }
          ctx.restore();
        } else if (spawner.specialType === 'crystal') {
          ctx.save();
          ctx.translate(spawner.x, spawner.y);
          ctx.rotate(worldPhaseTime * 0.0006);
          ctx.strokeStyle = '#00ffaa';
          ctx.shadowColor = '#00ffaa';
          ctx.shadowBlur = 15;
          ctx.lineWidth = 2;
          for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            ctx.beginPath();
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            ctx.moveTo(cos * 45, sin * 45);
            ctx.lineTo(Math.cos(angle - 0.1) * 70, Math.sin(angle - 0.1) * 70);
            ctx.lineTo(cos * 85, sin * 85);
            ctx.lineTo(Math.cos(angle + 0.1) * 70, Math.sin(angle + 0.1) * 70);
            ctx.closePath();
            ctx.fillStyle = 'rgba(0, 255, 170, 0.12)';
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = '#011c14';
          ctx.beginPath();
          ctx.arc(0, 0, 22, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        const initialSpawners = (MAPS[uiRef.current.mapId] || MAPS.medium).spawners.length;
        const spawnerSpeedScale = state.hardMode ? (initialSpawners / state.spawners.length) : 1;

        ctx.save();

        // Outer glow/pulse gets faster in Hard Mode as remaining spawners decrease
        const pulse = Math.sin(worldPhaseTime / (200 / spawnerSpeedScale)) * 5;
        const glowColor = state.hardMode ? '#ff3300' : '#ff00ff';
        const fillGlow = state.hardMode ? 'rgba(255, 51, 0, 0.15)' : 'rgba(255, 0, 255, 0.15)';
        ctx.fillStyle = fillGlow;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(spawner.x, spawner.y, spawner.radius * 1.8 + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Hexagon shape
        const isImpossibleMode = state.gameMode === 'impossible';
        ctx.shadowBlur = 10;
        ctx.fillStyle = isImpossibleMode ? 'rgba(226, 232, 240, 0.14)' : (state.hardMode ? '#2a0500' : '#1a001a');
        ctx.strokeStyle = isImpossibleMode ? '#E5E7EB' : glowColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const hexRot = worldPhaseTime / (1500 / spawnerSpeedScale);
        for (let i = 0; i < 6; i++) {
          const hexAngle = (i * Math.PI) / 3 + hexRot;
          const px = spawner.x + Math.cos(hexAngle) * spawner.radius;
          const py = spawner.y + Math.sin(hexAngle) * spawner.radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner core
        const corePulse = Math.sin(worldPhaseTime / (150 / spawnerSpeedScale)) * 3;
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(spawner.x, spawner.y, spawner.radius * 0.4 + corePulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        if (state.gameMode !== 'impossible') {
          // Draw HP bar
          const hpPercent = Math.max(0, spawner.hp / spawner.maxHp);
          const barW = 60;
          const barH = 6;
          const barX = spawner.x - barW / 2;
          const barY = spawner.y - spawner.radius - 20;

          // Background
          ctx.fillStyle = 'rgba(255, 0, 80, 0.2)';
          ctx.fillRect(barX, barY, barW, barH);

          // Fill
          ctx.fillStyle = '#ff0050';
          ctx.save();
          ctx.shadowColor = '#ff0050';
          ctx.shadowBlur = 5;
          ctx.fillRect(barX, barY, barW * hpPercent, barH);
          ctx.restore();

          // Border
          ctx.strokeStyle = state.hardMode ? '#ff3300' : '#ff00ff';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barW, barH);
        }
      }

      // Draw Bouncers
      for (const b of state.bouncers) {
        if (
          b.x + b.radius < state.camera.x ||
          b.x - b.radius > state.camera.x + state.camera.width ||
          b.y + b.radius < state.camera.y ||
          b.y - b.radius > state.camera.y + state.camera.height
        ) continue;

        // Draw trail for bouncer
        if (uiRef.current.status === 'PLAYING') {
          const bkb = Math.sqrt((b.kbvx || 0)**2 + (b.kbvy || 0)**2);
          if (bkb > 150) {
            state.trails.push({
              x: b.x, y: b.y, age: 0,
              color: '#ff3333',
              radius: b.radius * 0.8,
              isSuperStrong: true
            });
          } else if (Math.random() > 0.7) {
            state.trails.push({
              x: b.x, y: b.y, age: 0,
              color: '#ff3333',
              radius: b.radius * 0.4
            });
          }
        }

        ctx.save();
        ctx.translate(b.x, b.y);

        ctx.fillStyle = 'rgba(255, 50, 50, 0.2)';
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        const rot = currentTime / 500;
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + rot;
          const r = b.radius;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
      }

      // Draw Enemies
      for (const enemy of state.enemies) {
        if (
          enemy.x + enemy.radius < state.camera.x ||
          enemy.x - enemy.radius > state.camera.x + state.camera.width ||
          enemy.y + enemy.radius < state.camera.y ||
          enemy.y - enemy.radius > state.camera.y + state.camera.height
        ) continue;

        // Draw trail for enemy
        if (uiRef.current.status === 'PLAYING') {
          const ekb = Math.sqrt((enemy.kbvx || 0)**2 + (enemy.kbvy || 0)**2);
          if (ekb > 150) {
            state.trails.push({
              x: enemy.x, y: enemy.y, age: 0,
              color: '#ff3333',
              radius: enemy.radius * 0.8,
              isSuperStrong: true
            });
          } else if (Math.random() > 0.6) {
            state.trails.push({
              x: enemy.x, y: enemy.y, age: 0,
              color: '#ff3333',
              radius: enemy.radius * 0.4
            });
          }
        }

        // Draw gun/eye aim direction
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const aimAngle = Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x);
        ctx.moveTo(enemy.x, enemy.y);
        ctx.lineTo(enemy.x + Math.cos(aimAngle) * 20, enemy.y + Math.sin(aimAngle) * 20);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 50, 50, 0.2)';
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
        ctx.fill();

        // Face outline
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw Trails
      for (const t of state.trails) {
        if (
          t.x + t.radius < state.camera.x ||
          t.x - t.radius > state.camera.x + state.camera.width ||
          t.y + t.radius < state.camera.y ||
          t.y - t.radius > state.camera.y + state.camera.height
        ) continue;

        const maxAge = t.isSuperStrong ? 0.7 : 0.4;
        const progress = t.age / maxAge;
        if (progress >= 1) continue;

        const alpha = 1 - progress;
        ctx.save();
        if (t.isSuperStrong) {
          // Draw an extra vibrant neon glowing tail circle
          ctx.fillStyle = t.color;
          ctx.shadowColor = t.color;
          ctx.shadowBlur = 15;
          ctx.globalAlpha = alpha * 0.85; // highly opaque

          ctx.beginPath();
          ctx.arc(t.x, t.y, t.radius * (1 - progress * 0.5), 0, Math.PI * 2); // shrink slower
          ctx.fill();

          // Outer white core ring for extra dynamic energy emphasis
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 * alpha;
          ctx.beginPath();
          ctx.arc(t.x, t.y, t.radius * (1 - progress * 0.5), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = t.color;
          ctx.globalAlpha = alpha * 0.5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, t.radius * alpha, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1.0;

      // Draw Zones
      for (const zone of state.zones) {
        if (
          zone.x + zone.outerRadius < state.camera.x ||
          zone.x - zone.outerRadius > state.camera.x + state.camera.width ||
          zone.y + zone.outerRadius < state.camera.y ||
          zone.y - zone.outerRadius > state.camera.y + state.camera.height
        ) continue;

        const pDef = PLAYER_COLORS[zone.colorIdx !== undefined ? zone.colorIdx : 0] || PLAYER_COLORS[0];
        const age = currentTime - zone.spawnTime;
        const progress = Math.min(1, age / 300);
        const pulse = 1 + Math.sin(age * 0.005) * 0.05;

        // Let the inner ring be a scaling fraction of the outer ring so it is fully visible and beautiful
        const outerCurrent = zone.outerRadius * Math.sin(progress * Math.PI / 2) * pulse;
        const innerCurrent = outerCurrent * 0.25;

        // Alpha fades out near the end of duration
        const remaining = zone.duration - age;
        const alpha = remaining < 500 ? Math.max(0, remaining / 500) : 1;

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.translate(zone.x, zone.y);

        const oR = Math.max(0.1, outerCurrent);
        const iR = Math.max(0.1, innerCurrent);

        // 1. Beautiful Semi-Transparent Backdrop Area with a tinted glass visual feel
        ctx.save();
        ctx.globalAlpha = alpha * 0.12; // 12% opacity backdrop in the player's custom neon color
        ctx.fillStyle = pDef.n;
        ctx.beginPath();
        ctx.arc(0, 0, oR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Faint radar scanning ring lines to enrich the backdrop
        ctx.save();
        ctx.globalAlpha = alpha * 0.05;
        ctx.strokeStyle = pDef.n;
        ctx.lineWidth = 1;
        for (let r = 0; r < 1; r += 0.2) {
          ctx.beginPath();
          ctx.arc(0, 0, oR * r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

        // 1.1 Soft Magical Spell Field (Radial gradient glow that fills the spell area)
        const zoneGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, oR);
        zoneGrad.addColorStop(0, pDef.g || 'rgba(181, 0, 255, 0.22)');
        zoneGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.03)');
        zoneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = zoneGrad;
        ctx.beginPath();
        ctx.arc(0, 0, oR, 0, Math.PI * 2);
        ctx.fill();

        // 2. High-Contrast Runic Borders
        // Solid outer ring boundary
        ctx.beginPath();
        ctx.arc(0, 0, oR, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = pDef.n;
        ctx.stroke();

        // Delicate, nested inner circle
        ctx.beginPath();
        ctx.arc(0, 0, oR * 0.9, 0, Math.PI * 2);
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = pDef.n;
        ctx.stroke();

        // 3. Elegant Rotating Inner Magic Star/Sigil
        ctx.save();
        ctx.rotate(age * 0.0003); // Slow, magical rotation
        ctx.strokeStyle = pDef.n;
        ctx.lineWidth = 0.75;
        ctx.globalAlpha = alpha * 0.25;

        // Draw an elegant overlapping double-square star (8-pointed magic seal)
        const sealRadius = oR * 0.85;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI) / 2;
          const sX = Math.cos(angle) * sealRadius;
          const sY = Math.sin(angle) * sealRadius;
          if (i === 0) ctx.moveTo(sX, sY);
          else ctx.lineTo(sX, sY);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI) / 2 + Math.PI / 4;
          const sX = Math.cos(angle) * sealRadius;
          const sY = Math.sin(angle) * sealRadius;
          if (i === 0) ctx.moveTo(sX, sY);
          else ctx.lineTo(sX, sY);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // 4. Clean Concentric Ring details
        ctx.beginPath();
        ctx.arc(0, 0, iR, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = pDef.n;
        ctx.stroke();

        // 5. Initial Expanding Shockwave Blast (Only shown at the beginning of the cast, fades quickly)
        if (progress < 1) {
          const waveRadius = oR * progress;
          ctx.beginPath();
          ctx.arc(0, 0, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = pDef.n;
          ctx.lineWidth = 3 * (1 - progress);
          ctx.save();
          ctx.globalAlpha = alpha * (1 - progress) * 0.8;
          ctx.stroke();
          ctx.restore();
        }

        ctx.restore();

        // 6. Ethereal Rising Magic Sparks (Slow drifting particles rising upward, like an aura/fire)
        if (STATUS === 'PLAYING' && Math.random() < 0.22) {
          const pAngle = Math.random() * Math.PI * 2;
          const pDist = Math.random() * oR;
          const pX = zone.x + Math.cos(pAngle) * pDist;
          const pY = zone.y + Math.sin(pAngle) * pDist;
          state.particles.push({
            x: pX,
            y: pY,
            vx: (Math.random() - 0.5) * 30, // slow horizontal drift
            vy: -Math.random() * 40 - 20,   // elegant rising vertical motion
            life: 0,
            maxLife: Math.random() * 1.0 + 0.5,
            color: pDef.n,
            radius: Math.random() * 1.8 + 0.8
          });
        }
      }

      // Draw Blocks
      for (const block of state.blocks) {
        if (
          block.x + block.size / 2 < state.camera.x ||
          block.x - block.size / 2 > state.camera.x + state.camera.width ||
          block.y + block.size / 2 < state.camera.y ||
          block.y - block.size / 2 > state.camera.y + state.camera.height
        ) continue;

        const ageMs = currentTime - (block.createdAt || currentTime);
        const spawnDuration = 300;
        let scale = 1;

        if (ageMs < spawnDuration) {
           const progress = ageMs / spawnDuration;
           scale = Math.sin(progress * Math.PI / 2); // Ease out
        }

        const currentSize = block.size * scale;

        ctx.save();
        ctx.translate(block.x, block.y);
        if (ageMs < spawnDuration) {
          ctx.rotate((1 - scale) * Math.PI); // Spin animation
        }

        const pDef = PLAYER_COLORS[block.colorIdx !== undefined ? block.colorIdx : 0] || PLAYER_COLORS[0];
        const blockColor = pDef.n;
        const blockGlow = pDef.g || 'rgba(255, 204, 0, 0.2)';

        ctx.fillStyle = blockGlow;
        ctx.shadowColor = blockColor;
        ctx.shadowBlur = 10;
        ctx.fillRect(-currentSize / 2, -currentSize / 2, currentSize, currentSize);
        ctx.strokeStyle = blockColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(-currentSize / 2, -currentSize / 2, currentSize, currentSize);
        ctx.restore();
      }

      // Draw Bullets
      for (const bullet of state.bullets) {
        if (
          bullet.x + bullet.radius < state.camera.x ||
          bullet.x - bullet.radius > state.camera.x + state.camera.width ||
          bullet.y + bullet.radius < state.camera.y ||
          bullet.y - bullet.radius > state.camera.y + state.camera.height
        ) continue;

        let color = '#ff0066';
        let glow = 'rgba(255, 0, 100, 0.3)';

        if (bullet.isNeutral) {
          color = '#aaaaaa';
          glow = 'rgba(170, 170, 170, 0.3)';
        } else if (bullet.isPlayer) {
          const pDef = PLAYER_COLORS[bullet.colorIdx !== undefined ? bullet.colorIdx : 0] || PLAYER_COLORS[0];
          color = pDef.n;
          glow = pDef.g || 'rgba(0, 204, 255, 0.3)';
        }

        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // The shooter's bullet is one continuous local visual. It is never moved
      // to a delayed network coordinate and remains outside state.bullets, so
      // it cannot affect authoritative gameplay.
      if (mpRef.current.roomId && !mpRef.current.isHost) {
        for (const pending of pendingGuestShotsRef.current.values()) {
          const preview = pending.preview;
          if (!preview) continue;
          const alpha = getGuestShotVisualAlpha(preview, currentTime);
          if (alpha <= 0) continue;
          const colorDef = PLAYER_COLORS[preview.colorIdx] || PLAYER_COLORS[0];
          const previewColor = preview.isNeutral ? '#aaaaaa' : colorDef.n;
          const previewGlow = preview.isNeutral ? 'rgba(170, 170, 170, 0.3)' : colorDef.g;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = previewGlow;
          ctx.beginPath();
          ctx.arc(preview.x, preview.y, preview.radius * 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = previewColor;
          ctx.beginPath();
          ctx.arc(preview.x, preview.y, preview.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw Particles
      for (const p of state.particles) {
        if (
          p.x + p.radius < state.camera.x ||
          p.x - p.radius > state.camera.x + state.camera.width ||
          p.y + p.radius < state.camera.y ||
          p.y - p.radius > state.camera.y + state.camera.height
        ) continue;
        const alpha = 1 - (p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      // Draw Shockwaves
      for (const s of state.shockwaves) {
        if (
          s.x + s.maxRadius < state.camera.x ||
          s.x - s.maxRadius > state.camera.x + state.camera.width ||
          s.y + s.maxRadius < state.camera.y ||
          s.y - s.maxRadius > state.camera.y + state.camera.height
        ) continue;

        const progress = s.age / s.maxAge;
        const currentRadius = Math.max(0.1, s.maxRadius * Math.sin(progress * Math.PI / 2)); // Ease out
        const alpha = Math.max(0, 1 - progress);

        ctx.beginPath();
        ctx.arc(s.x, s.y, currentRadius, 0, Math.PI * 2);
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = s.thickness * (1 - progress);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // Draw Multiplayer Players
      for (const tId in state.multiplayerPlayers) {
         const pData = state.multiplayerPlayers[tId];
         if (pData.isDead) continue;
         const pDef = PLAYER_COLORS[pData.colorIdx] || PLAYER_COLORS[0];
         const pColor = pDef.n;
         const pGlow = pDef.g;
         const pName = pData.name || 'PLAYER';

         if (pData.isDash) {
           ctx.fillStyle = pGlow;
           ctx.beginPath();
           ctx.arc(pData.x, pData.y, pData.radius * 3.75, 0, Math.PI * 2);
           ctx.fill();
           ctx.strokeStyle = pColor;
           ctx.lineWidth = 2;
           ctx.stroke();
         } else {
           ctx.fillStyle = pGlow;
           ctx.beginPath();
           ctx.arc(pData.x, pData.y, pData.radius * 2, 0, Math.PI * 2);
           ctx.fill();
         }

         ctx.fillStyle = pColor;
         ctx.beginPath();
         ctx.arc(pData.x, pData.y, pData.radius, 0, Math.PI * 2);
         ctx.fill();

         ctx.strokeStyle = '#000';
         ctx.lineWidth = 2;
         ctx.stroke();

         ctx.fillStyle = '#ffffff';
         ctx.font = '10px "Space Grotesk", sans-serif';
         ctx.textAlign = 'center';
         ctx.fillText(pName, pData.x, pData.y - pData.radius - 8);

         if (isOpeningProtectionActiveLocal(currentTime)) {
           ctx.save();
           ctx.beginPath();
           const shieldRadius = pData.radius + 8 + Math.sin(currentTime * 0.008) * 2;
           ctx.arc(pData.x, pData.y, shieldRadius, 0, Math.PI * 2);
           ctx.strokeStyle = pColor;
           ctx.lineWidth = 2;
           ctx.globalAlpha = 0.6 + 0.2 * Math.sin(currentTime * 0.01);
           ctx.stroke();
           ctx.restore();
         }
      }

      // Draw Player
      if (uiRef.current.status !== 'GAME_OVER') {
        const localId = socketRef.current?.id || 'local';
        const pDef = PLAYER_COLORS[playerProfileRef.current.colorIdx] || PLAYER_COLORS[0];
        const pColor = pDef.n;
        const pGlow = pDef.g;
        const pName = playerProfileRef.current.name || 'PLAYER';

        const worldMouseX = state.mouse.x + state.camera.x;
        const worldMouseY = state.mouse.y + state.camera.y;

        ctx.strokeStyle = pGlow;
        ctx.lineWidth = 2;

        let aimX = worldMouseX;
        let aimY = worldMouseY;
        let shouldDrawAimLine = true;

        if (uiRef.current.deviceType === 'mobile') {
          if (state.touches.right.aimLength > 0.01 && (state.touches.right.dirX !== 0 || state.touches.right.dirY !== 0)) {
            aimX = state.player.x + state.touches.right.dirX * 100 * state.touches.right.aimLength;
            aimY = state.player.y + state.touches.right.dirY * 100 * state.touches.right.aimLength;
            shouldDrawAimLine = true;
          } else {
            shouldDrawAimLine = false;
          }
        } else {
          // Desktop touches could theoretically trigger this, so we leave it identical
          if (state.touches.right.active) {
            aimX = state.player.x + state.touches.right.dirX * 100;
            aimY = state.player.y + state.touches.right.dirY * 100;
          }
        }

        if (shouldDrawAimLine) {
          ctx.beginPath();
          ctx.moveTo(state.player.x, state.player.y);
          ctx.lineTo(aimX, aimY);
          ctx.stroke();
        }

        if (state.player.dash.active) {
          // Draw shield
          ctx.beginPath();
          ctx.arc(state.player.x, state.player.y, state.player.dash.shieldRadius, 0, Math.PI * 2);
          ctx.fillStyle = pGlow;
          ctx.fill();
          ctx.strokeStyle = pColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = pGlow;
          ctx.beginPath();
          ctx.arc(state.player.x, state.player.y, state.player.radius * 2, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isOpeningProtectionActiveLocal(currentTime)) {
          ctx.save();
          ctx.beginPath();
          const shieldRadius = state.player.radius + 8 + Math.sin(currentTime * 0.008) * 2;
          ctx.arc(state.player.x, state.player.y, shieldRadius, 0, Math.PI * 2);
          ctx.strokeStyle = pColor;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.6 + 0.2 * Math.sin(currentTime * 0.01);
          ctx.stroke();
          ctx.restore();
        }

        ctx.fillStyle = pColor;
        ctx.beginPath();
        ctx.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (mpRef.current.roomId) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '10px "Space Grotesk", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(pName, state.player.x, state.player.y - state.player.radius - 8);
        }
      } else {
        // Local player is eliminated and invisible (burst into particles)
      }

      // Draw Floating Texts/Callsigns in World space
      if (state.floatingTexts && state.floatingTexts.length > 0) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const ft of state.floatingTexts) {
          if (
            ft.x + 200 < state.camera.x || ft.x - 200 > state.camera.x + state.camera.width ||
            ft.y + 100 < state.camera.y || ft.y - 100 > state.camera.y + state.camera.height
          ) continue;

          const progress = ft.age / ft.maxAge;
          const alpha = progress < 0.15
            ? progress / 0.15
            : Math.max(0, 1 - (progress - 0.15) / 0.85); // Elegant quick fade-in, slow fade-out

          ctx.save();
          ctx.globalAlpha = alpha;

          // Compute sizing
          ctx.font = '900 11px "Space Grotesk", sans-serif';
          const cleanText = ft.text.toUpperCase();
          const textWidth = ctx.measureText(cleanText).width;
          const padX = 14;
          const padY = 6;
          const panelW = textWidth + padX * 2;
          const panelH = 14 + padY * 2;

          // Rounded holographic terminal capsule block
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(10, 0, 0, 0.85)';
          ctx.strokeStyle = ft.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(ft.x - panelW / 2, ft.y - panelH / 2, panelW, panelH, 6);
          ctx.fill();
          ctx.stroke();

          // High-contrast outer neon glow
          ctx.shadowColor = ft.color;
          ctx.shadowBlur = 10;

          // Glowing text
          ctx.fillStyle = '#ffffff';
          ctx.fillText(cleanText, ft.x, ft.y);

          ctx.restore();
        }
        ctx.globalAlpha = 1.0;
      }

      ctx.restore(); // Reset transform to draw fixed UI

      const drawObjectiveTag = (
        text: string,
        worldTargetX: number | null,
        worldTargetY: number | null,
        targetRadius: number,
        showPointer: boolean,
        alpha: number
      ) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '500 18px "JetBrains Mono", monospace';
        const textW = ctx.measureText(text).width;
        const padX = 14;
        const h = 36;
        const w = textW + padX * 2;

        const glowPulse = Math.sin(worldPhaseTime * Math.PI * 2 / 2200) * 0.5 + 0.5;
        const accentColor = state.hardMode ? '#ff3300' : '#D946EF';

        let tagX = canvas.width / 2;
        let tagY = 100 + h / 2;

        if (showPointer && worldTargetX !== null && worldTargetY !== null) {
            const screenX = worldTargetX - state.camera.x;
            const screenY = worldTargetY - state.camera.y;

            const trScreen = targetRadius + 40; // extra padding for HP bar/relic

            tagX = screenX;
            tagY = screenY - trScreen - h/2 - 10;
        }

        ctx.translate(tagX, tagY);

        ctx.beginPath();
        const chamfer = 6;
        ctx.moveTo(-w/2 + chamfer, -h/2);
        ctx.lineTo(w/2 - chamfer, -h/2);
        ctx.lineTo(w/2, -h/2 + chamfer);
        ctx.lineTo(w/2, h/2 - chamfer);
        ctx.lineTo(w/2 - chamfer, h/2);
        ctx.lineTo(-w/2 + chamfer, h/2);
        ctx.lineTo(-w/2, h/2 - chamfer);
        ctx.lineTo(-w/2, -h/2 + chamfer);
        ctx.closePath();

        ctx.fillStyle = 'rgba(8, 10, 18, 0.88)';
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = accentColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 3.2 + glowPulse * 4.8;
        ctx.stroke();

        if (showPointer && worldTargetX !== null && worldTargetY !== null) {
            ctx.beginPath();
            const ptrSize = 6;
            ctx.moveTo(-ptrSize, h/2);
            ctx.lineTo(ptrSize, h/2);
            ctx.lineTo(0, h/2 + ptrSize);
            ctx.closePath();
            ctx.fillStyle = accentColor;
            ctx.fill();
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#F3E8FF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1);

        ctx.restore();
      };

      if (uiRef.current.status === 'PLAYING' && presentationStageRef.current === 'idle' && state.tutorial.active && state.tutorial.spawnerIndex !== null) {
        const mapDef = MAPS[uiRef.current.mapId] || MAPS.medium;
        const tutDef = mapDef.spawners[state.tutorial.spawnerIndex];
        const spawner = state.spawners.find(s => s.x === tutDef.x && s.y === tutDef.y);

        if (spawner) {
            drawObjectiveTag("DESTROY SPAWNER", spawner.x, spawner.y, spawner.radius, true, 1.0);
        }
      }





      // Draw off-screen indicators for other players in multiplayer
      if (uiRef.current.status === 'PLAYING' && mpRef.current.roomId) {
        const localId = socketRef.current?.id || 'local';

        for (const tId in state.multiplayerPlayers) {
          if (tId === localId) continue;
          const pData = state.multiplayerPlayers[tId];
          if (!pData || pData.isDead) continue;

          const screenOtherX = pData.x - state.camera.x;
          const screenOtherY = pData.y - state.camera.y;

          // Check if player is off-screen (with a small margin to transition smoothly)
          const margin = 20;
          const isOffScreen =
            screenOtherX < -margin ||
            screenOtherX > canvas.width + margin ||
            screenOtherY < -margin ||
            screenOtherY > canvas.height + margin;

          if (isOffScreen) {
            const { x: ix, y: iy, angle } = calculateEdgePointerPosition(
              screenOtherX,
              screenOtherY,
              canvas.width,
              canvas.height,
              pointerSafeRectRef.current
            );

            const pDef = PLAYER_COLORS[pData.colorIdx] || PLAYER_COLORS[0];
            const pColor = pDef.n;
            const pGlow = pDef.g;

            // Draw polished offscreen pointing triangle
            ctx.save();
            ctx.translate(ix, iy);
            ctx.rotate(angle);

            // Sci-fi neon glow
            ctx.shadowColor = pGlow;
            ctx.shadowBlur = 8;
            ctx.fillStyle = pColor;

            const size = 12;
            ctx.beginPath();
            ctx.moveTo(size, 0); // pointing towards player
            ctx.lineTo(-size / 2, -size / 1.5);
            ctx.lineTo(-size / 2, size / 1.5);
            ctx.closePath();
            ctx.fill();

            // Outline so it pops clearly
            ctx.strokeStyle = '#020205';
            ctx.lineWidth = 2;
            ctx.shadowBlur = 0;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Draw closest spawner direction indicator if no living spawners are visible (Normal mode only)
      const isNormalMode = state.gameMode ? state.gameMode === 'normal' : !uiRef.current.hardMode;
      if (uiRef.current.status === 'PLAYING') {
        if (!isNormalMode) {
          spawnerPointerAnimRef.current = null;
        } else {
          const livingSpawners = state.spawners.filter(s => s.hp === undefined || s.hp > 0);
          const canvasW = canvas.width;
          const canvasH = canvas.height;

          if (livingSpawners.length === 0) {
            spawnerPointerAnimRef.current = null;
          } else {
            const isAnyVisible = livingSpawners.some(s => isSpawnerVisible(s, state.camera, canvasW, canvasH));
            if (isAnyVisible) {
              spawnerPointerAnimRef.current = null;
            } else {
              const spawnerColor = state.hardMode ? '#ff3300' : '#ff00ff';
              const anim = spawnerPointerAnimRef.current;
              const now = currentTime;

              let drawX: number | null = null;
              let drawY: number | null = null;
              let drawAngle: number | null = null;

              if (anim) {
                const elapsed = now - anim.startTime;
                if (elapsed < anim.duration) {
                  const t = Math.max(0, Math.min(1, elapsed / anim.duration));
                  const p = 1 - (1 - t) * (1 - t);

                  const targetSpawner = livingSpawners.find(
                    s => Math.abs(s.x - anim.targetWorldX) < 5 && Math.abs(s.y - anim.targetWorldY) < 5
                  ) || getClosestSpawner(livingSpawners, state.player);

                  if (targetSpawner) {
                    const startScreenX = anim.startWorldX - state.camera.x;
                    const startScreenY = anim.startWorldY - state.camera.y;

                    const targetScreenX = targetSpawner.x - state.camera.x;
                    const targetScreenY = targetSpawner.y - state.camera.y;

                    const edgePos = calculateEdgePointerPosition(
                      targetScreenX,
                      targetScreenY,
                      canvasW,
                      canvasH,
                      pointerSafeRectRef.current
                    );

                    drawX = startScreenX + (edgePos.x - startScreenX) * p;
                    drawY = startScreenY + (edgePos.y - startScreenY) * p;

                    const dx = targetScreenX - drawX;
                    const dy = targetScreenY - drawY;
                    drawAngle = Math.atan2(dy, dx);
                  } else {
                    spawnerPointerAnimRef.current = null;
                  }
                } else {
                  spawnerPointerAnimRef.current = null;
                }
              }

              if (drawX === null || drawY === null || drawAngle === null) {
                const closest = getClosestSpawner(livingSpawners, state.player);
                if (closest) {
                  const targetScreenX = closest.x - state.camera.x;
                  const targetScreenY = closest.y - state.camera.y;
                  const edgePos = calculateEdgePointerPosition(
                    targetScreenX,
                    targetScreenY,
                    canvasW,
                    canvasH,
                    pointerSafeRectRef.current
                  );
                  drawX = edgePos.x;
                  drawY = edgePos.y;
                  drawAngle = edgePos.angle;
                }
              }

              if (drawX !== null && drawY !== null && drawAngle !== null) {
                ctx.save();
                ctx.translate(drawX, drawY);
                ctx.rotate(drawAngle);

                ctx.shadowColor = spawnerColor;
                ctx.shadowBlur = 8;
                ctx.fillStyle = spawnerColor;

                const size = 12;
                ctx.beginPath();
                ctx.moveTo(size, 0);
                ctx.lineTo(-size / 2, -size / 1.5);
                ctx.lineTo(-size / 2, size / 1.5);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#020205';
                ctx.lineWidth = 2;
                ctx.shadowBlur = 0;
                ctx.stroke();
                ctx.restore();
              }
            }
          }
        }
      }

      // Draw UI over canvas (Joysticks)
      if (uiRef.current.status === 'PLAYING' && uiRef.current.deviceType === 'mobile') {
        const joyOffset = Math.min(160, Math.max(85, Math.floor(canvas.height * 0.22)));
        const leftJoyX = Math.min(80, Math.floor(canvas.width * 0.18));
        const leftJoyY = canvas.height - joyOffset;
        const rightJoyX = canvas.width - leftJoyX;
        const rightJoyY = canvas.height - joyOffset;

        const drawJoystick = (baseX: number, baseY: number, touchState: typeof state.touches.left, colorStr: string) => {
          ctx.save();

          // Base circle
          ctx.strokeStyle = touchState.active ? colorStr : 'rgba(255, 255, 255, 0.1)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(baseX, baseY, 40, 0, Math.PI * 2);
          ctx.stroke();

          // Highlight/glow
          if (touchState.active) {
            ctx.shadowColor = colorStr;
            ctx.shadowBlur = 10;
          }

          // Inner knob
          ctx.fillStyle = touchState.active ? colorStr : 'rgba(255, 255, 255, 0.2)';
          ctx.beginPath();
          if (touchState.active) {
            ctx.arc(touchState.currentX, touchState.currentY, 20, 0, Math.PI * 2);
          } else {
            ctx.arc(baseX, baseY, 20, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
        };

        drawJoystick(leftJoyX, leftJoyY, state.touches.left, '#00ccff');
        drawJoystick(rightJoyX, rightJoyY, state.touches.right, '#ff0066');
      }

      // Update cooldown UI
      if (STATUS !== 'PAUSED') {
        let specialCooldown = 0;
        let buildCooldown = 0;
        const now = currentTime;

        const isGuestMode = mpRef.current.roomId && !mpRef.current.isHost;
        if (isGuestMode) {
          const socketId = socketRef.current?.id;
          const auth = socketId ? state.playerActionAuthority?.[socketId] : null;
          if (auth) {
            if (state.player.dash.active) {
              specialCooldown = Math.max(0, Math.ceil((auth.specialActiveUntil - now) / 1000));
            } else {
              specialCooldown = Math.max(0, Math.ceil((auth.specialReadyAt - now) / 1000));
            }

            if (state.player.build.active) {
              buildCooldown = Math.max(0, Math.ceil((auth.buildActiveUntil - now) / 1000));
            } else {
              buildCooldown = Math.max(0, Math.ceil((auth.buildReadyAt - now) / 1000));
            }
          } else {
            specialCooldown = 0;
            buildCooldown = 0;
          }
        } else {
          if (state.player.dash.active) {
             specialCooldown = Math.max(0, Math.ceil((state.player.dash.endTime - now) / 1000));
          } else if (state.player.dash.endTime > 0) {
             specialCooldown = Math.max(0, Math.ceil((DASH_COOLDOWN - (now - state.player.dash.endTime)) / 1000));
          } else {
             specialCooldown = Math.max(0, Math.ceil((DASH_COOLDOWN - (now - state.player.dash.lastTime)) / 1000));
          }

          if (state.player.build.active) {
             buildCooldown = Math.max(0, Math.ceil((state.player.build.endTime - now) / 1000));
          } else if (state.player.build.endTime > 0) {
             buildCooldown = Math.max(0, Math.ceil((BUILD_COOLDOWN - (now - state.player.build.endTime)) / 1000));
          }
        }

        if (uiRef.current.buttonCounters.special !== specialCooldown || uiRef.current.buttonCounters.build !== buildCooldown) {
           setUiState(prev => {
             uiRef.current = { ...prev, buttonCounters: { special: specialCooldown, build: buildCooldown } };
             return uiRef.current;
           });
        }
      }

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', handleResize);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);

      if (canvas) {
        canvas.removeEventListener('contextmenu', handleContextMenu);
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('touchstart', handleTouchStart);
      }
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
      window.removeEventListener('pagehide', handleBlurOrHide);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // The multiplayer lobby was originally composed at a 650 px logical height
  // and displayed at roughly 85% on the reference iPhone layout. Keep that
  // exact displayed size on every supported aspect ratio; compensate the
  // unscaled width so the card still fills the available mobile width.
  const lobbyMenuScale = 0.85;
  const lobbyMenuWidthPercent = 100 / lobbyMenuScale;
  const lobbyMenuMaxWidth = 448 / lobbyMenuScale;
  const mapScale = Math.max(0.75, Math.min(1.1, Math.min(containerSize.width / 920, containerSize.height / 650)));

  const isAnyMapSelectorOpen =
    (uiState.status === 'MENU' && isMapSelectOpen) ||
    (uiState.status === 'LOBBY' && isMpMapSelectOpen);

  return (
    <div ref={wrapperRef} className="w-full h-full relative overflow-hidden bg-[#050508] font-mono select-none">
      {!isAnyMapSelectorOpen && (
        <div className="absolute inset-0 pointer-events-none z-[60] opacity-[0.1]" style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 4px)`
        }} />
      )}
      <div className="absolute inset-0 pointer-events-none z-[60] shadow-[inset_0_0_150px_rgba(0,0,0,0.9)]" />

      <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair touch-none mix-blend-screen" />

      {/* Absolute HUD Layers */}
      <AnimatePresence>
        {uiState.status === 'MENU' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm z-[50] pointer-events-auto"
          >
            <AnimatePresence mode="wait">
              {!isMapSelectOpen ? (
                <motion.div
                  key="main-menu"
                  initial={{ opacity: 0, scale: 0.96, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -15 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="max-w-md w-full max-h-[90vh] bg-[#0d0f1b]/95 border-2 border-[#00f0ff] p-4 sm:p-6 shadow-[10px_10px_0_#00f0ff] flex flex-col justify-center text-center overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                >
                  <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-white mb-2 sm:mb-3 tracking-tighter shrink-0 leading-none" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                    RICOCHET <br/> <span className="text-[#00f0ff]">ARENA</span>
                  </h1>
                  <p className="text-[#00f0ff]/80 font-mono mb-3 sm:mb-6 whitespace-pre-wrap leading-snug sm:leading-relaxed text-[9px] sm:text-xs uppercase tracking-widest border-t border-b border-[#00f0ff]/30 py-2 sm:py-3 shrink-0">
                    Bullets bounce endlessly.{"\n"}Dodge the chaos you and the enemies create.
                    {"\n\n"}
                    Desktop: WASD + Mouse.{"\n"}Mobile: Dual Joysticks.
                  </p>

                  <div className="flex gap-2 mb-3 items-stretch shrink-0">
                    <button
                      onClick={() => setIsMapSelectOpen(true)}
                      className="flex-1 py-2 sm:py-3 bg-transparent text-[#00f0ff] border-2 border-[#00f0ff]/50 hover:bg-[#00f0ff]/10 hover:border-[#00f0ff] font-bold tracking-[0.2em] transition-all duration-200 uppercase text-[10px] sm:text-xs"
                    >
                      CHANGE MAP: {MAPS[uiState.mapId]?.name || 'UNKNOWN'}
                    </button>
                    <button
                      onClick={() => setUiState(prev => {
                        const nextHard = !prev.hardMode;
                        const nextGameMode: GameMode = nextHard ? 'hard' : 'normal';
                        return {
                          ...prev,
                          hardMode: nextHard,
                          gameMode: nextGameMode,
                        };
                      })}
                      className={`flex items-center justify-center gap-1.5 py-2 sm:py-3 px-3 sm:px-4 border-2 font-bold tracking-[0.1em] transition-all duration-200 uppercase text-[10px] sm:text-xs cursor-pointer select-none
                        ${uiState.hardMode
                          ? 'bg-[#ff3300]/10 text-[#ff3300] border-[#ff3300] shadow-[0_0_10px_rgba(255,51,0,0.2)]'
                          : 'bg-transparent text-[#00ffff]/60 border-[#00ffff]/20 hover:border-[#00ffff]/40 hover:text-[#00ffff]'
                        }`}
                    >
                      <div className={`w-3.5 h-3.5 border flex items-center justify-center text-[9px] font-black rounded-sm
                        ${uiState.hardMode
                          ? 'border-[#ff3300] bg-[#ff3300] text-black'
                          : 'border-[#00ffff]/40 bg-transparent'
                        }`}
                      >
                        {uiState.hardMode && "✓"}
                      </div>
                      <span>HARD</span>
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      const selectedMode: GameMode = uiState.hardMode ? 'hard' : 'normal';
                      startFreshSinglePlayerRun(uiState.mapId, selectedMode);
                    }}
                    className="w-full py-3 sm:py-4 bg-[#00f0ff] hover:bg-white text-black border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-base sm:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] shrink-0"
                  >
                    ENTER ARENA
                  </button>

                  <div className="flex gap-2 mt-3 items-stretch shrink-0">
                    <button
                      onClick={() => {
                        setMpError(null);
                        setMpState(prev => ({ ...prev, joinCode: '', error: '' }));
                        setUiState(prev => ({ ...prev, status: 'LOBBY' }));
                      }}
                      className="flex-1 py-2.5 sm:py-3 bg-[#0d0f1b] text-[#ffcc00] border-2 border-[#ffcc00]/60 hover:bg-[#ffcc00]/10 hover:border-[#ffcc00] font-black tracking-[0.15em] transition-all duration-200 uppercase text-[10px] sm:text-xs flex items-center justify-center shadow-[3px_3px_0_rgba(255,204,0,0.3)] hover:shadow-[3px_3px_0_rgba(255,204,0,0.6)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                    >
                      MULTIPLAYER
                    </button>
                    <button
                      onClick={() => {
                        setLoadError(null);
                        fileInputRef.current?.click();
                      }}
                      className="flex-1 py-2.5 sm:py-3 bg-[#0d0f1b] text-[#b500ff] border-2 border-[#b500ff]/60 hover:bg-[#b500ff]/10 hover:border-[#b500ff] font-black tracking-[0.15em] transition-all duration-200 uppercase text-[10px] sm:text-xs flex items-center justify-center shadow-[3px_3px_0_rgba(181,0,255,0.3)] hover:shadow-[3px_3px_0_rgba(181,0,255,0.6)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                    >
                      LOAD MATCH
                    </button>
                  </div>
                  {loadError && (
                    <div role="alert" className="mt-2 text-center text-[#ff003c] text-xs font-mono font-bold tracking-wider uppercase">
                      {loadError}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="map-select"
                  initial={{ opacity: 0, scale: 0.96, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -15 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="relative w-full max-w-4xl max-h-[90dvh] flex flex-col bg-[#0d0f1b]/95 border-2 border-[#00f0ff] shadow-[0_0_30px_rgba(0,240,255,0.15)] ring-1 ring-black pointer-events-auto overflow-hidden"
                >
                  {/* Header */}
                  <div className="shrink-0 p-3 md:p-5 flex justify-between items-center border-b border-[#00f0ff]/30 bg-gradient-to-b from-[#00f0ff]/10 to-transparent">
                    <h2 className="text-2xl md:text-4xl font-black text-white tracking-tighter leading-none" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                      SELECT <span className="text-[#00f0ff]">ARENA</span>
                    </h2>
                    <button
                      onClick={() => setIsMapSelectOpen(false)}
                      className="text-[#00f0ff]/80 hover:text-[#00f0ff] font-bold tracking-[0.2em] uppercase text-xs md:text-sm border border-[#00f0ff]/30 hover:border-[#00f0ff]/80 px-3 py-1.5 md:px-4 md:py-2 bg-[#00f0ff]/10 transition-colors"
                    >
                      CLOSE [X]
                    </button>
                  </div>

                  {/* Content Body */}
                  <div className="flex-1 min-h-[0] flex flex-col md:flex-row p-3 md:p-5 gap-3 md:gap-5 overflow-hidden">

                    {/* Map List Area */}
                    <div className="flex-1 flex flex-col min-h-0 border border-[#00f0ff]/30 bg-black/40 overflow-hidden">
                      <div
                        ref={mapListRef}
                        className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                      >
                        {Object.entries(MAPS)
                          .sort((a, b) => {
                            const difficultyRank: Record<string, number> = {
                              'EASY': 1,
                              'MEDIUM': 2,
                              'HARD': 3,
                              'EXPERT': 4
                            };
                            const rankA = difficultyRank[a[1].difficulty] || 99;
                            const rankB = difficultyRank[b[1].difficulty] || 99;
                            if (rankA !== rankB) {
                              return rankA - rankB;
                            }
                            return a[1].name.localeCompare(b[1].name);
                          })
                          .map(([id, mapDef]) => (
                          <button
                            key={id}
                            data-map-id={id}
                            onClick={() => setUiState(prev => ({...prev, mapId: id}))}
                            className={`flex flex-col items-center justify-center p-2 md:p-3 font-bold uppercase transition-all border-2
                              ${uiState.mapId === id
                                 ? 'bg-[#00f0ff] text-black border-[#00f0ff] shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                                 : 'bg-[#0d0f1b] text-[#00f0ff]/60 border-[#00f0ff]/30 hover:border-[#00f0ff]/80 hover:text-[#00f0ff] hover:bg-[#00f0ff]/5'
                              }`}
                          >
                            <div className="text-[10px] sm:text-xs md:text-sm tracking-[0.1em] text-center leading-tight">{mapDef.name}</div>
                            <div className={`text-[8px] sm:text-[9px] md:text-[10px] mt-1 tracking-widest ${
                              uiState.mapId === id
                                ? 'text-black/80'
                                : mapDef.difficulty === 'EASY' ? 'text-green-400' :
                                  mapDef.difficulty === 'MEDIUM' ? 'text-yellow-400' :
                                  mapDef.difficulty === 'HARD' ? 'text-red-400' :
                                  'text-purple-400'
                            }`}>
                               {mapDef.difficulty}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Map Preview Area */}
                    <div className="w-full md:w-80 lg:w-[22rem] shrink-0 flex flex-col min-h-[240px] md:min-h-0 border border-[#00f0ff]/30 bg-black/40 p-3 overflow-hidden">
                      {(() => {
                          const selMap = MAPS[uiState.mapId] || MAPS.medium;
                          return (
                            <div className="flex flex-col h-full overflow-hidden">
                               <h3 className="text-base md:text-lg lg:text-xl font-black text-white uppercase tracking-wider mb-1 mt-1 shrink-0 px-1">{selMap.name}</h3>
                               <div className={`text-[10px] md:text-xs font-bold mb-2 shrink-0 px-1 ${
                                 selMap.difficulty === 'EASY' ? 'text-green-400' :
                                 selMap.difficulty === 'MEDIUM' ? 'text-yellow-400' :
                                 selMap.difficulty === 'HARD' ? 'text-red-400' :
                                 'text-[#b500ff]'
                               }`}>{selMap.difficulty}</div>
                               <p className="text-[#00f0ff]/80 font-mono text-[9px] md:text-[10px] leading-relaxed mb-3 shrink-0 text-left line-clamp-3 px-1">
                                 {selMap.description}
                               </p>

                               {/* Responsive map container */}
                               <div className="flex-1 w-full min-h-[120px] flex items-center justify-center p-1 md:p-2 relative overflow-hidden shrink mt-1 mb-1">
                                 <svg
                                   viewBox="0 0 3000 3000"
                                   className="w-full h-full aspect-square max-w-[130px] max-h-[130px] sm:max-w-[145px] sm:max-h-[145px] md:max-w-[220px] md:max-h-[220px]"
                                   preserveAspectRatio="xMidYMid meet"
                                 >
                                   {/* Base Map Square Background & Outer Border inside the coordinate system */}
                                    <rect width="3000" height="3000" fill="#050508" stroke="rgba(0, 240, 255, 0.4)" strokeWidth="15" />

                                    {/* Grid lines inside preview */}
                                   <defs>
                                     <pattern id="preview-grid" width="150" height="150" patternUnits="userSpaceOnUse">
                                       <path d="M 150 0 L 0 0 0 150" fill="none" stroke="rgba(0, 240, 255, 0.05)" strokeWidth="4" />
                                     </pattern>
                                   </defs>
                                   <rect width="3000" height="3000" fill="url(#preview-grid)" />

                                   {/* Render Walls */}
                                   {selMap.walls.map((w, i) => (
                                     <rect
                                       key={`wall-${i}`}
                                       x={w.x}
                                       y={w.y}
                                       width={w.w}
                                       height={w.h}
                                       fill="rgba(0, 240, 255, 0.25)"
                                       stroke="#00f0ff"
                                       strokeWidth="15"
                                     />
                                   ))}

                                   {/* Render Spawners */}
                                   {selMap.spawners.map((s, i) => (
                                     <circle
                                       key={`spawner-${i}`}
                                       cx={s.x}
                                       cy={s.y}
                                       r={s.radius}
                                       fill="#ff00ff"
                                       stroke="rgba(255, 255, 255, 0.5)"
                                       strokeWidth="8"
                                     />
                                   ))}

                                   {/* Render Spawn Point */}
                                   {selMap.spawnPoint && (
                                     <g transform={`translate(${selMap.spawnPoint.x}, ${selMap.spawnPoint.y})`} pointerEvents="none" aria-hidden="true">
                                       <circle r={70} fill="rgba(255, 204, 0, 0.10)" stroke="#FFCC00" strokeWidth={18} />
                                       <circle r={18} fill="#FFCC00" />
                                       <line x1={0} y1={-110} x2={0} y2={-80} stroke="#FFCC00" strokeWidth={18} />
                                       <line x1={0} y1={80} x2={0} y2={110} stroke="#FFCC00" strokeWidth={18} />
                                       <line x1={-110} y1={0} x2={-80} y2={0} stroke="#FFCC00" strokeWidth={18} />
                                       <line x1={80} y1={0} x2={110} y2={0} stroke="#FFCC00" strokeWidth={18} />
                                       <text
                                         x={100}
                                         y={-80}
                                         fill="#FFCC00"
                                         fontSize={120}
                                         fontFamily="monospace"
                                         fontWeight="bold"
                                         stroke="#080A12"
                                         strokeWidth={30}
                                         paintOrder="stroke"
                                         strokeLinejoin="round"
                                         style={{ letterSpacing: '0.1em', filter: 'drop-shadow(0px 2px 2px rgba(255, 204, 0, 0.35))' }}
                                       >
                                         START
                                       </text>
                                     </g>
                                   )}
                                 </svg>
                               </div>
                            </div>
                          )
                       })()}
                    </div>

                  </div>

                  {/* Footer / Action */}
                  <div className="shrink-0 p-3 md:p-4 border-t border-[#00f0ff]/30 bg-[#0d0f1b] backdrop-blur-sm flex gap-3">
                    <button
                      onClick={() => {
                        const selectedMode: GameMode = uiState.hardMode ? 'hard' : 'normal';
                        startFreshSinglePlayerRun(uiState.mapId, selectedMode);
                      }}
                      className="flex-1 py-3 md:py-4 bg-[#00f0ff]/20 hover:bg-[#00f0ff]/40 text-[#00f0ff] border border-[#00f0ff]/50 font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm md:text-base lg:text-lg cursor-pointer"
                    >
                      ENTER ARENA
                    </button>
                    <button
                      onClick={() => {
                        const keys = Object.keys(MAPS);
                        if (keys.length > 0) {
                          const randomKey = keys[Math.floor(Math.random() * keys.length)];
                          selectAndScrollToMap(randomKey);
                        }
                      }}
                      className="flex-none aspect-square py-3 md:py-4 px-3 md:px-4 flex items-center justify-center bg-[#00f0ff]/20 hover:bg-[#00f0ff]/40 text-[#00f0ff] border border-[#00f0ff]/50 transition-all duration-200 cursor-pointer"
                      title="Select Random Map"
                    >
                      <Shuffle className="w-5 h-5 md:w-6 md:h-6" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {uiState.status === 'LOBBY' && (
          <motion.div
            key="lobby-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`absolute inset-0 ${isMpMapSelectOpen ? 'z-[50]' : 'z-[70]'} flex flex-col items-center justify-center p-4 sm:p-8 bg-[#050508]/80 backdrop-blur-md pointer-events-auto`}
          >
            <AnimatePresence mode="wait">
              {isMpMapSelectOpen ? (
                <motion.div
                  key="mp-map-select-screen"
                  initial={{ opacity: 0, scale: 0.96, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -15 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="relative w-full max-w-4xl max-h-[90dvh] flex flex-col bg-[#0d0f1b]/95 border-2 border-[#ffcc00] shadow-[0_0_30px_rgba(255,204,0,0.2)] ring-1 ring-black pointer-events-auto overflow-hidden z-[80]"
                >
                  {/* Header */}
                  <div className="shrink-0 p-3 md:p-5 flex justify-between items-center border-b border-[#ffcc00]/30 bg-gradient-to-b from-[#ffcc00]/10 to-transparent">
                    <h2 className="text-2xl md:text-4xl font-black text-white tracking-tighter leading-none" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                      SELECT <span className="text-[#ffcc00]">MULTIPLAYER MAP</span>
                    </h2>
                    <div className="flex items-center gap-2">
                      {isMatchSettingsUpdatePending && (
                        <span className="text-[#ffcc00] animate-pulse font-mono font-extrabold text-xs tracking-widest uppercase">
                          SYNCING...
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Content Body */}
                  <div className="flex-1 min-h-[0] flex flex-col md:flex-row p-3 md:p-5 gap-3 md:gap-5 overflow-hidden">

                    {/* Map List Area */}
                    <div className="flex-1 flex flex-col min-h-0 border border-[#ffcc00]/30 bg-black/40 overflow-hidden">
                      <div
                        ref={mpMapListRef}
                        className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                      >
                        {Object.entries(MAPS)
                          .sort((a, b) => {
                            const difficultyRank: Record<string, number> = {
                              'EASY': 1,
                              'MEDIUM': 2,
                              'HARD': 3,
                              'EXPERT': 4
                            };
                            const rankA = difficultyRank[a[1].difficulty] || 99;
                            const rankB = difficultyRank[b[1].difficulty] || 99;
                            if (rankA !== rankB) {
                              return rankA - rankB;
                            }
                            return a[1].name.localeCompare(b[1].name);
                          })
                          .map(([id, mapDef]) => {
                            const isSelected = pendingLobbyMapId === id;
                            const isDisabled = isMatchSettingsUpdatePending;
                            return (
                              <button
                                key={id}
                                data-mp-map-id={id}
                                disabled={isDisabled}
                                onClick={() => {
                                  if (isDisabled) return;
                                  setPendingLobbyMapId(id);
                                }}
                                className={`flex flex-col items-center justify-center p-2 md:p-3 font-bold uppercase transition-all border-2 select-none ${
                                  isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                                } ${
                                  isSelected
                                     ? 'bg-[#ffcc00] text-black border-[#ffcc00] shadow-[0_0_15px_rgba(255,204,0,0.35)] font-black'
                                     : 'bg-[#0d0f1b] text-[#ffcc00]/70 border-[#ffcc00]/30 hover:border-[#ffcc00]/80 hover:text-[#ffcc00] hover:bg-[#ffcc00]/10'
                                }`}
                              >
                                <div className="text-[10px] sm:text-xs md:text-sm tracking-[0.1em] text-center leading-tight">{mapDef.name}</div>
                                <div className={`text-[8px] sm:text-[9px] md:text-[10px] mt-1 tracking-widest ${
                                  isSelected
                                    ? 'text-black/80 font-bold'
                                    : mapDef.difficulty === 'EASY' ? 'text-green-400' :
                                      mapDef.difficulty === 'MEDIUM' ? 'text-yellow-400' :
                                      mapDef.difficulty === 'HARD' ? 'text-red-400' :
                                      'text-purple-400'
                                }`}>
                                   {mapDef.difficulty}
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    </div>

                    {/* Map Preview Area */}
                    <div className="w-full md:w-80 lg:w-[22rem] shrink-0 flex flex-col min-h-[240px] md:min-h-0 border border-[#ffcc00]/30 bg-black/40 p-3 overflow-hidden">
                      {(() => {
                          const selMap = MAPS[pendingLobbyMapId] || MAPS.medium;
                          return (
                            <div className="flex flex-col h-full overflow-hidden">
                               <h3 className="text-base md:text-lg lg:text-xl font-black text-white uppercase tracking-wider mb-1 mt-1 shrink-0 px-1">{selMap.name}</h3>
                               <div className={`text-[10px] md:text-xs font-bold mb-2 shrink-0 px-1 ${
                                 selMap.difficulty === 'EASY' ? 'text-green-400' :
                                 selMap.difficulty === 'MEDIUM' ? 'text-yellow-400' :
                                 selMap.difficulty === 'HARD' ? 'text-red-400' :
                                 'text-[#b500ff]'
                               }`}>{selMap.difficulty}</div>
                               <p className="text-[#ffcc00]/80 font-mono text-[9px] md:text-[10px] leading-relaxed mb-3 shrink-0 text-left line-clamp-3 px-1">
                                 {selMap.description}
                               </p>

                               {/* Responsive map container */}
                               <div className="flex-1 w-full min-h-[120px] flex items-center justify-center p-1 md:p-2 relative overflow-hidden shrink mt-1 mb-1">
                                 <svg
                                   viewBox="0 0 3000 3000"
                                   className="w-full h-full aspect-square max-w-[130px] max-h-[130px] sm:max-w-[145px] sm:max-h-[145px] md:max-w-[220px] md:max-h-[220px]"
                                   preserveAspectRatio="xMidYMid meet"
                                 >
                                   {/* Base Map Square Background & Outer Border */}
                                    <rect width="3000" height="3000" fill="#050508" stroke="rgba(255, 204, 0, 0.4)" strokeWidth="15" />

                                    {/* Grid lines inside preview */}
                                   <defs>
                                     <pattern id="mp-preview-grid" width="150" height="150" patternUnits="userSpaceOnUse">
                                       <path d="M 150 0 L 0 0 0 150" fill="none" stroke="rgba(255, 204, 0, 0.08)" strokeWidth="4" />
                                     </pattern>
                                   </defs>
                                   <rect width="3000" height="3000" fill="url(#mp-preview-grid)" />

                                   {/* Render Walls */}
                                   {selMap.walls.map((w, i) => (
                                     <rect
                                       key={`wall-${i}`}
                                       x={w.x}
                                       y={w.y}
                                       width={w.w}
                                       height={w.h}
                                       fill="rgba(0, 240, 255, 0.25)"
                                       stroke="#00f0ff"
                                       strokeWidth="15"
                                     />
                                   ))}

                                   {/* Render Spawners */}
                                   {selMap.spawners.map((s, i) => (
                                     <circle
                                       key={`spawner-${i}`}
                                       cx={s.x}
                                       cy={s.y}
                                       r={s.radius}
                                       fill="#ff00ff"
                                       stroke="rgba(255, 255, 255, 0.5)"
                                       strokeWidth="8"
                                     />
                                   ))}

                                   {/* Render Spawn Point */}
                                   {selMap.spawnPoint && (
                                     <g transform={`translate(${selMap.spawnPoint.x}, ${selMap.spawnPoint.y})`} pointerEvents="none" aria-hidden="true">
                                       <circle r={70} fill="rgba(255, 204, 0, 0.10)" stroke="#FFCC00" strokeWidth={18} />
                                       <circle r={18} fill="#FFCC00" />
                                       <line x1={0} y1={-110} x2={0} y2={-80} stroke="#FFCC00" strokeWidth={18} />
                                       <line x1={0} y1={80} x2={0} y2={110} stroke="#FFCC00" strokeWidth={18} />
                                       <line x1={-110} y1={0} x2={-80} y2={0} stroke="#FFCC00" strokeWidth={18} />
                                       <line x1={80} y1={0} x2={110} y2={0} stroke="#FFCC00" strokeWidth={18} />
                                       <text
                                         x={100}
                                         y={-80}
                                         fill="#FFCC00"
                                         fontSize={120}
                                         fontFamily="monospace"
                                         fontWeight="bold"
                                         stroke="#080A12"
                                         strokeWidth={30}
                                         paintOrder="stroke"
                                         strokeLinejoin="round"
                                         style={{ letterSpacing: '0.1em', filter: 'drop-shadow(0px 2px 2px rgba(255, 204, 0, 0.35))' }}
                                       >
                                         START
                                       </text>
                                     </g>
                                   )}
                                 </svg>
                               </div>
                            </div>
                          )
                       })()}
                    </div>

                  </div>

                  {mpError && (
                    <div className="text-[#FF005C] font-mono text-xs sm:text-sm font-bold text-center px-4 py-1.5 uppercase border-t border-[#FF005C]/30 bg-[#FF005C]/10">
                      {mpError}
                    </div>
                  )}

                  {/* Footer / Action */}
                  <div className="shrink-0 p-3 md:p-4 border-t border-[#ffcc00]/30 bg-[#0d0f1b] backdrop-blur-sm flex gap-3">
                    <button
                      disabled={!mpState.isHost || isMatchSettingsUpdatePending}
                      onClick={handleConfirmMpMap}
                      className={`flex-1 py-3 md:py-4 border font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm md:text-base lg:text-lg select-none ${
                        isMatchSettingsUpdatePending
                          ? 'bg-[#ffcc00]/20 text-[#ffcc00]/50 border-[#ffcc00]/30 cursor-not-allowed'
                          : 'bg-[#ffcc00] hover:bg-white text-black border-[#ffcc00] cursor-pointer shadow-[0_0_15px_rgba(255,204,0,0.3)]'
                      }`}
                    >
                      {isMatchSettingsUpdatePending ? 'SYNCING...' : 'CONFIRM SELECTION'}
                    </button>
                    <button
                      disabled={!mpState.isHost || isMatchSettingsUpdatePending}
                      onClick={handleRandomMpMap}
                      className={`flex-none aspect-square py-3 md:py-4 px-3 md:px-4 flex items-center justify-center border transition-all duration-200 select-none ${
                        !mpState.isHost || isMatchSettingsUpdatePending
                          ? 'bg-[#ffcc00]/10 border-[#ffcc00]/30 text-[#ffcc00]/40 cursor-not-allowed'
                          : 'bg-[#ffcc00]/20 hover:bg-[#ffcc00]/40 text-[#ffcc00] border-[#ffcc00] cursor-pointer shadow-[0_0_10px_rgba(255,204,0,0.2)]'
                      }`}
                      title="Select Random Map"
                    >
                      <Shuffle className="w-5 h-5 md:w-6 md:h-6" />
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="lobby-box"
                  initial={{ scale: 0.9 * lobbyMenuScale, y: 20 }}
                  animate={{ scale: lobbyMenuScale, y: 0 }}
                  exit={{ scale: 0.9 * lobbyMenuScale, y: 20 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={`flex-none flex flex-col border-2 border-[#ffcc00] bg-[#0d0f1b]/95 p-3 shadow-[10px_10px_0_#ffcc00] pointer-events-auto items-center relative z-10 origin-center overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${
                    mpState.roomId ? 'h-[650px]' : 'max-h-[650px]'
                  }`}
                  style={{
                    width: `${lobbyMenuWidthPercent}%`,
                    maxWidth: `${lobbyMenuMaxWidth}px`,
                  }}
                >
              <h2 className="text-3xl font-black text-white tracking-widest" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>MULTIPLAYER</h2>

              <div className="w-full border-t border-b border-[#ffcc00]/30 py-2.5 text-center my-4">
                <p className="text-[#ffcc00]/80 font-mono text-[9px] uppercase tracking-widest leading-relaxed">
                  {mpState.roomId ? "CO-OP / VERSUS LOBBY" : "HOST OR JOIN AN ONLINE MATCH"}
                </p>
              </div>

              {mpState.roomId ? (
                <>
                  {/* Lobby Segmented Controls / Tabs */}
                  <div className="flex w-full border border-white/10 mb-5 relative bg-black/40">
                    <button
                      onClick={() => setActiveLobbyTab('invite')}
                      className={`flex-1 py-2 text-[10px] font-black tracking-widest text-center transition-all cursor-pointer ${
                        activeLobbyTab === 'invite'
                          ? 'bg-[#ffcc00] text-black font-black'
                          : 'text-[#ffcc00]/60 hover:text-white hover:bg-[#ffcc00]/10'
                      }`}
                    >
                      INVITE ROOM
                    </button>
                    <button
                      onClick={() => setActiveLobbyTab('players')}
                      className={`flex-1 py-2 text-[10px] font-black tracking-widest text-center transition-all cursor-pointer ${
                        activeLobbyTab === 'players'
                          ? 'bg-[#ffcc00] text-black font-black'
                          : 'text-[#ffcc00]/60 hover:text-white hover:bg-[#ffcc00]/10'
                      }`}
                    >
                      PLAYERS
                    </button>
                    <button
                      onClick={() => setActiveLobbyTab('match')}
                      className={`flex-1 py-2 text-[10px] font-black tracking-widest text-center transition-all cursor-pointer ${
                        activeLobbyTab === 'match'
                          ? 'bg-[#ffcc00] text-black font-black'
                          : 'text-[#ffcc00]/60 hover:text-white hover:bg-[#ffcc00]/10'
                      }`}
                    >
                      MATCH
                    </button>
                  </div>

                  <div className="w-full h-[345px] min-h-[345px] flex flex-col mb-3 shrink-0 overflow-hidden">
                    {activeLobbyTab === 'invite' ? (
                      <div className="w-full h-full flex flex-col justify-between">
                        <div>
                          <p className="text-[#ffcc00]/70 font-bold tracking-[0.2em] text-[10px] mb-1 uppercase w-full text-left">
                            {mpState.isHost ? "YOUR ROOM CODE" : "JOINED ROOM"}
                          </p>

                          {/* Code at the top with a copy button */}
                          <div className="flex w-full mb-3">
                            <div className="text-3xl text-white font-mono font-bold tracking-widest py-2 px-5 bg-black border border-r-0 border-white/10 text-center uppercase flex-1">
                              {mpState.roomId}
                            </div>
                            <button
                              onClick={handleCopyCode}
                              className="px-4 bg-white/5 border border-white/10 hover:bg-[#ffcc00]/15 hover:border-[#ffcc00]/50 transition-all flex items-center justify-center cursor-pointer"
                              title="Copy room code"
                            >
                              {copyFeedback ? <Check className="w-5 h-5 text-[#ffcc00]" /> : <Copy className="w-5 h-5 text-white/50" />}
                            </button>
                          </div>

                          {/* URL with its copy button */}
                          <p className="text-[#ffcc00]/70 font-bold tracking-[0.15em] text-[10px] uppercase w-full text-left mb-1">
                            INVITE URL
                          </p>
                          <div className="flex w-full mb-3">
                            <div className="text-[10px] text-white/75 font-mono py-1.5 px-3 bg-black border border-r-0 border-white/10 text-left overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex-1 flex items-center">
                              {`${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${mpState.roomId}`}
                            </div>
                            <button
                              onClick={handleCopyInviteLink}
                              className="px-3 bg-white/5 border border-white/10 hover:bg-[#ffcc00]/15 hover:border-[#ffcc00]/50 transition-all flex items-center justify-center cursor-pointer"
                              title="Copy invite link"
                            >
                              {copyLinkFeedback ? <Check className="w-3.5 h-3.5 text-[#ffcc00]" /> : <Copy className="w-3.5 h-3.5 text-white/50" />}
                            </button>
                          </div>
                        </div>

                        {/* Centered larger QR Code card with cleaner neutral border */}
                        <div className="w-full flex flex-col items-center p-3 bg-black/40 border border-white/10 shadow-[inset_0_0_12px_rgba(255,204,0,0.02)]">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${mpState.roomId}`)}`}
                            alt="Room QR Code"
                            className="w-28 h-28 p-1.5 bg-white mb-2 shadow-[0_0_15px_rgba(255,204,0,0.15)] shrink-0"
                            referrerPolicy="no-referrer"
                          />

                          <button
                            onClick={downloadQrCode}
                            className="w-full py-1.5 bg-white/5 hover:bg-[#ffcc00]/15 text-white/50 hover:text-[#ffcc00] border border-white/10 hover:border-[#ffcc00]/50 font-sans font-black text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>DOWNLOAD QR CODE</span>
                          </button>
                        </div>
                      </div>
                    ) : activeLobbyTab === 'players' ? (
                      <div className="w-full h-full flex flex-col justify-start">
                        {/* Profiling setup */}
                        <p className="text-[#ffcc00]/70 font-bold tracking-[0.15em] text-[10px] uppercase w-full text-left mb-1 text-xs">
                          CALLSIGN
                        </p>
                        <input
                          type="text"
                          maxLength={12}
                          value={isEditingCallsign ? callsignDraft : playerProfile.name}
                          onFocus={startCallsignEditing}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase().slice(0, 12);
                            setCallsignDraft(val);
                          }}
                          onBlur={commitCallsignDraft}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitCallsignDraft();
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              cancelCallsignEditing();
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-full bg-black border border-white/10 text-white font-mono px-3 py-1.5 text-xs uppercase focus:outline-none focus:border-[#ffcc00]/50 mb-3"
                        />

                        <p className="text-[#ffcc00]/70 font-bold tracking-[0.15em] text-[10px] uppercase w-full text-left mb-1 text-xs">
                          HUE
                        </p>
                        <div className="flex justify-between gap-1 w-full mb-3.5">
                          {PLAYER_COLORS.map((color, idx) => {
                            const isTaken = (Object.values(lobbyPlayers) as { colorIdx: number }[]).map(p => p.colorIdx).includes(idx);
                            return (
                              <button
                                key={idx}
                                disabled={isTaken && playerProfile.colorIdx !== idx}
                                onClick={() => {
                                  if (!isTaken || playerProfile.colorIdx === idx) {
                                    updateProfile(playerProfile.name, idx);
                                  }
                                }}
                                title={isTaken && playerProfile.colorIdx !== idx ? `${color.name} (TAKEN)` : color.name}
                                className={`flex-1 h-5 rounded-none border transition-all relative overflow-hidden ${
                                  playerProfile.colorIdx === idx
                                    ? 'scale-105 border-white shadow-[0_0_8px_rgba(0,255,136,0.4)] z-10 cursor-default'
                                    : isTaken
                                      ? 'border-white/5 opacity-15 cursor-not-allowed grayscale'
                                      : 'border-white/10 opacity-50 hover:opacity-100 cursor-pointer'
                                }`}
                                style={{ backgroundColor: color.n }}
                              >
                                {isTaken && playerProfile.colorIdx !== idx && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="w-full h-[1px] bg-red-500/80 rotate-45 transform scale-x-125" />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* Active Lobby Members */}
                        <p className="text-[#ffcc00]/70 font-bold tracking-[0.15em] text-[10px] uppercase w-full text-left mb-1 text-xs">
                          LOBBY MEMBERS ({Object.keys(lobbyPlayers).length + 1})
                        </p>
                        <div className="w-full flex-1 min-h-0 overflow-y-auto border border-white/10 bg-black/40 p-1.5 space-y-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                          {/* Local player */}
                          <div className="flex items-center justify-between py-1 px-1.5 bg-[#ffcc00]/5 border-l-2 border-[#ffcc00]">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <div className="w-2.5 h-2.5 border border-white/15 shrink-0" style={{ backgroundColor: PLAYER_COLORS[playerProfile.colorIdx]?.n }} />
                              <span className="text-[10px] font-mono text-white/90 font-black tracking-wider uppercase truncate">
                                {playerProfile.name || 'ANONYMOUS'}
                              </span>
                              <span className="text-[8px] font-mono text-[#ffcc00] font-extrabold tracking-widest shrink-0 bg-[#ffcc00]/15 px-1 py-0.5 rounded-sm">YOU</span>
                            </div>
                            <span className="text-[8px] font-mono font-bold text-white/50 tracking-widest shrink-0 ml-1">
                              {mpState.isHost ? 'HOST' : 'CLIENT'}
                            </span>
                          </div>

                          {/* Remote players */}
                          {(Object.entries(lobbyPlayers) as [string, { name: string, colorIdx: number, isHost: boolean }][]).map(([id, player]) => (
                            <div key={id} className="flex items-center justify-between py-1 px-1.5 bg-black/30 border-l-2 border-white/10">
                              <div className="flex items-center gap-1.5 overflow-hidden">
                                <div className="w-2.5 h-2.5 border border-white/10 shrink-0" style={{ backgroundColor: PLAYER_COLORS[player.colorIdx]?.n }} />
                                <span className="text-[10px] font-mono text-white/80 tracking-wider uppercase truncate">
                                  {player.name || 'CONNECTING...'}
                                </span>
                              </div>
                              <span className="text-[8px] font-mono font-bold text-white/40 tracking-widest shrink-0 ml-1">
                                {player.isHost ? 'HOST' : 'CLIENT'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const currentMap = MAPS[lobbyMatchSettings.mapId] || MAPS.medium;
                        const gameModesList: { id: GameMode; name: string; label: string }[] = [
                          { id: 'normal', name: 'NORMAL', label: 'STANDARD' },
                          { id: 'hard', name: 'HARD', label: 'FAST SPAWNS' },
                          { id: 'impossible', name: 'IMPOSSIBLE', label: 'OVERCLOCKED' },
                        ];

                        return (
                          <div className="w-full h-full grid grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-y-auto pr-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                            {/* Top Header Row inside MATCH tab */}
                            <div className="flex items-center justify-between w-full mb-1.5 shrink-0">
                              <span className="text-[#ffcc00]/80 font-mono font-bold tracking-[0.15em] text-[10px] uppercase">
                                MATCH CONFIG
                              </span>
                              <div className="flex items-center gap-1.5">
                                {isMatchSettingsUpdatePending && (
                                  <span className="text-[#ffcc00] animate-pulse font-mono font-extrabold text-[9px] tracking-widest uppercase">
                                    SYNCING...
                                  </span>
                                )}
                                {!mpState.isHost && (
                                  <span className="text-[#ffcc00]/80 border border-[#ffcc00]/40 bg-[#ffcc00]/10 px-1.5 py-0.5 font-mono text-[8px] font-black tracking-widest uppercase rounded-sm">
                                    HOST CONTROLLED
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Map Preview Card */}
                            <div className="w-full h-full min-h-0 bg-black/40 border border-white/10 p-3 grid grid-cols-[128px_minmax(0,1fr)] sm:grid-cols-[144px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 overflow-hidden">
                              <div className="contents">
                                {/* Miniature SVG Preview */}
                                <div className="w-full aspect-square self-center border border-[#ffcc00]/30 bg-[#050508] relative overflow-hidden flex items-center justify-center shadow-[inset_0_0_8px_rgba(255,204,0,0.1)]">
                                  <svg
                                    viewBox="0 0 3000 3000"
                                    className="w-full h-full aspect-square"
                                    preserveAspectRatio="xMidYMid meet"
                                  >
                                    <rect width="3000" height="3000" fill="#050508" stroke="rgba(255, 204, 0, 0.4)" strokeWidth="15" />
                                    <defs>
                                      <pattern id="match-tab-preview-grid" width="300" height="300" patternUnits="userSpaceOnUse">
                                        <path d="M 300 0 L 0 0 0 300" fill="none" stroke="rgba(255, 204, 0, 0.08)" strokeWidth="8" />
                                      </pattern>
                                    </defs>
                                    <rect width="3000" height="3000" fill="url(#match-tab-preview-grid)" />

                                    {/* Walls */}
                                    {currentMap.walls.map((w, i) => (
                                      <rect
                                        key={`wall-${i}`}
                                        x={w.x}
                                        y={w.y}
                                        width={w.w}
                                        height={w.h}
                                        fill="rgba(255, 204, 0, 0.25)"
                                        stroke="#ffcc00"
                                        strokeWidth="15"
                                      />
                                    ))}

                                    {/* Spawners */}
                                    {currentMap.spawners.map((s, i) => (
                                      <circle
                                        key={`spawner-${i}`}
                                        cx={s.x}
                                        cy={s.y}
                                        r={s.radius}
                                        fill="#ff00ff"
                                        stroke="rgba(255, 255, 255, 0.5)"
                                        strokeWidth="8"
                                      />
                                    ))}

                                    {/* Spawn Point */}
                                    {currentMap.spawnPoint && (
                                      <g transform={`translate(${currentMap.spawnPoint.x}, ${currentMap.spawnPoint.y})`} pointerEvents="none" aria-hidden="true">
                                        <circle r={70} fill="rgba(255, 204, 0, 0.15)" stroke="#FFCC00" strokeWidth={18} />
                                        <circle r={18} fill="#FFCC00" />
                                      </g>
                                    )}
                                  </svg>
                                </div>

                                {/* Map info */}
                                <div className="col-start-2 row-start-1 min-w-0 self-stretch flex flex-col justify-center text-left overflow-hidden">
                                  <div className="flex items-center justify-between gap-1 mb-0.5">
                                    <span className="text-white font-mono font-black text-xs truncate uppercase tracking-wider">
                                      {currentMap.name}
                                    </span>
                                    <span className={`text-[9px] font-mono font-black tracking-widest shrink-0 uppercase px-1 py-0.5 bg-black/50 border border-white/10 ${
                                      currentMap.difficulty === 'EASY' ? 'text-green-400' :
                                      currentMap.difficulty === 'MEDIUM' ? 'text-yellow-400' :
                                      currentMap.difficulty === 'HARD' ? 'text-red-400' :
                                      'text-purple-400'
                                    }`}>
                                      {currentMap.difficulty}
                                    </span>
                                  </div>
                                  <p className="text-[#ffcc00]/70 font-mono text-[9px] leading-snug line-clamp-3 text-left">
                                    {currentMap.description}
                                  </p>
                                </div>
                              </div>

                              {/* Change Map Button */}
                              <button
                                disabled={!mpState.isHost || isMatchSettingsUpdatePending}
                                onClick={handleOpenMpMapSelector}
                                className={`col-span-2 row-start-2 justify-self-center w-[240px] sm:w-[260px] max-w-full py-1.5 border font-mono font-bold text-[9px] sm:text-[10px] tracking-widest uppercase text-center select-none transition-all ${
                                  mpState.isHost && !isMatchSettingsUpdatePending
                                    ? 'bg-[#ffcc00]/20 border-[#ffcc00] text-[#ffcc00] hover:bg-[#ffcc00]/30 hover:shadow-[0_0_10px_rgba(255,204,0,0.3)] cursor-pointer font-black'
                                    : 'bg-[#ffcc00]/10 border-[#ffcc00]/20 text-[#ffcc00]/40 cursor-not-allowed opacity-60 font-bold'
                                }`}
                                title={!mpState.isHost ? 'Host controlled' : isMatchSettingsUpdatePending ? 'Syncing...' : 'Change Map'}
                              >
                                CHANGE MAP
                              </button>
                            </div>

                            {/* Game Mode Selection */}
                            <div className="w-full flex flex-col mt-2 shrink-0">
                              <p className="text-[#ffcc00]/80 font-mono font-bold tracking-[0.15em] text-[10px] uppercase w-full text-left mb-1.5">
                                GAME MODE
                              </p>

                              <div className="grid grid-cols-3 gap-1.5 w-full">
                                {gameModesList.map((mode) => {
                                  const isSelected = lobbyMatchSettings.gameMode === mode.id;
                                  const isDisabled = !mpState.isHost || isMatchSettingsUpdatePending;

                                  return (
                                    <button
                                      key={mode.id}
                                      disabled={isDisabled}
                                      onClick={() => {
                                        if (!mpState.isHost || isMatchSettingsUpdatePending) return;
                                        requestMatchSettingsUpdate({
                                          mapId: lobbyMatchSettings.mapId,
                                          gameMode: mode.id,
                                        });
                                      }}
                                      className={`flex flex-col items-center justify-center p-2 border font-mono transition-all text-center uppercase relative select-none ${
                                        isSelected
                                          ? mpState.isHost
                                            ? 'bg-[#ffcc00] text-black border-[#ffcc00] font-black shadow-[0_0_12px_rgba(255,204,0,0.35)] cursor-pointer'
                                            : 'bg-[#ffcc00]/30 text-[#ffcc00] border-[#ffcc00] font-black cursor-not-allowed'
                                          : mpState.isHost
                                            ? isMatchSettingsUpdatePending
                                              ? 'bg-black/40 text-white/40 border-white/10 opacity-50 cursor-not-allowed'
                                              : 'bg-black/50 text-[#ffcc00]/70 border-white/15 hover:border-[#ffcc00]/60 hover:text-[#ffcc00] hover:bg-[#ffcc00]/10 cursor-pointer font-bold'
                                            : 'bg-black/30 text-white/30 border-white/10 cursor-not-allowed opacity-40 font-normal'
                                      }`}
                                    >
                                      <span className="text-[10px] sm:text-xs font-black tracking-wider leading-tight">
                                        {mode.name}
                                      </span>
                                      <span className={`text-[7px] sm:text-[8px] mt-1 font-mono tracking-tight leading-none ${
                                        isSelected
                                          ? mpState.isHost ? 'text-black/80 font-bold' : 'text-[#ffcc00]/80 font-bold'
                                          : 'text-white/40'
                                      }`}>
                                        {mode.label}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    )}
                  </div>

                  {mpError && (
                    <div className="text-[#FF005C] font-mono text-xs sm:text-sm font-bold text-center mb-2 uppercase">
                      {mpError}
                    </div>
                  )}

                  {mpState.isHost ? (() => {
                    const lobbyPlayerCount = Object.keys(lobbyPlayers).length + 1;
                    const canStartMatch = lobbyPlayerCount >= 2;
                    const isButtonDisabled = !canStartMatch || multiplayerStartPending;
                    const buttonLabel = multiplayerStartPending
                      ? "STARTING..."
                      : canStartMatch
                      ? "START MATCH"
                      : "WAITING FOR PLAYER";
                    return (
                      <button
                        onClick={handleStartMultiplayerMatch}
                        disabled={isButtonDisabled}
                        className={`w-full py-4 font-black tracking-widest transition-all duration-200 uppercase text-sm mb-2 ${
                          !isButtonDisabled
                            ? 'bg-[#ffcc00] hover:bg-white text-black cursor-pointer shadow-[3px_3px_0_rgba(255,204,0,0.15)] hover:shadow-[5px_5px_0_#fff] active:translate-x-1 active:translate-y-1 active:shadow-none'
                            : 'bg-[#ffcc00]/40 text-black/40 cursor-not-allowed opacity-60'
                        }`}
                      >
                        {buttonLabel}
                      </button>
                    );
                  })() : (
                    <p className="text-[#ffcc00] animate-pulse font-bold tracking-widest text-[11px] py-2 uppercase">
                      WAITING FOR HOST TO START...
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[#ffcc00]/80 font-bold tracking-widest text-xs uppercase mb-2 w-full text-left">JOIN A ROOM</p>
                  <input
                    type="text"
                    value={mpState.joinCode}
                    onChange={(e) => setMpState(prev => ({ ...prev, joinCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }))}
                    maxLength={4}
                    placeholder="ENTER CODE"
                    disabled={pendingRoomRequest !== null || !mpState.isConnected}
                    className="w-full py-3 px-4 bg-black border border-white/10 text-white font-mono tracking-widest text-center text-xl outline-none focus:border-[#ffcc00]/50 mb-4 uppercase placeholder-white/20 disabled:opacity-50"
                  />
                  {mpState.error && <p className="text-red-500 font-bold mb-4 text-xs">{mpState.error}</p>}
                  <button
                    onClick={joinRoom}
                    disabled={pendingRoomRequest !== null || !mpState.isConnected || !/^[A-Z0-9]{4}$/.test(mpState.joinCode.trim().toUpperCase())}
                    className={`w-full py-4 bg-[#ffcc00] hover:bg-white text-black font-black tracking-widest transition-all duration-200 uppercase text-sm cursor-pointer shadow-[3px_3px_0_rgba(255,204,0,0.15)] hover:shadow-[5px_5px_0_#fff] active:translate-x-1 active:translate-y-1 active:shadow-none mb-2 ${
                      pendingRoomRequest !== null || !mpState.isConnected || !/^[A-Z0-9]{4}$/.test(mpState.joinCode.trim().toUpperCase()) ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {pendingRoomRequest === 'join' ? 'JOINING...' : 'JOIN MATCH'}
                  </button>

                  <div className="flex items-center w-full my-3">
                    <div className="flex-1 border-t border-white/10"></div>
                    <span className="px-3 text-white/40 font-mono text-[9px] tracking-widest">OR</span>
                    <div className="flex-1 border-t border-white/10"></div>
                  </div>

                  <button
                    onClick={createRoom}
                    disabled={pendingRoomRequest !== null || !mpState.isConnected}
                    className={`w-full py-4 bg-transparent border-2 border-[#ffcc00]/50 text-[#ffcc00] font-black tracking-widest hover:bg-[#ffcc00]/10 hover:border-[#ffcc00] transition-colors mt-2 cursor-pointer ${
                      pendingRoomRequest !== null || !mpState.isConnected ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {pendingRoomRequest === 'create' ? 'CREATING...' : 'CREATE ROOM'}
                  </button>
                </>
              )}

              <button onClick={() => {
                emitLeaveRoom();
                clearPendingGuestShots(true);
                clearPendingAbilityRequests();
                activeMultiplayerRoundIdRef.current = 0;
                multiplayerStartPendingRef.current = false;
                setMultiplayerStartPending(false);
                cancelPendingMatchSettingsUpdate();
                closeMpMapSelector();
                setMpState(prev => ({ ...prev, roomId: null, isHost: false, joinCode: '', error: '' }));
                setLobbyPlayers({});
                setUiState(prev => ({ ...prev, status: 'MENU' }));
              }} className="mt-6 text-[#ffcc00]/60 hover:text-white uppercase tracking-widest text-xs font-bold transition-colors">
                BACK TO MENU
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    )}
  </AnimatePresence>

      {(uiState.status === 'PLAYING' || uiState.status === 'PAUSED') && (() => {
        const toolsData = {
          special: {
            label: 'SPECIAL',
            usableFill: 'linear-gradient(rgba(139, 92, 246, 0.52), rgba(139, 92, 246, 0.52)), rgba(6, 8, 14, 0.90)',
            usableBorder: '#C4B5FD',
            usableText: '#F5F7FF',
            unusableFill: 'rgba(139, 92, 246, 0.05)',
            unusableBorder: 'rgba(139, 92, 246, 0.42)',
            unusableText: 'rgba(139, 92, 246, 0.52)',
            usableGlow: '0 0 5px rgba(139, 92, 246, 0.24), 0 0 12px rgba(139, 92, 246, 0.08)',
            mobile: 'TAP TO USE',
            desktop: 'KEY "1" TO USE'
          },
          build: {
            label: 'BUILD',
            usableFill: 'linear-gradient(rgba(14, 165, 233, 0.60), rgba(14, 165, 233, 0.60)), rgba(6, 8, 14, 0.90)',
            usableBorder: '#67E8F9',
            usableText: '#F5F7FF',
            unusableFill: 'rgba(14, 165, 233, 0.05)',
            unusableBorder: 'rgba(14, 165, 233, 0.42)',
            unusableText: 'rgba(14, 165, 233, 0.52)',
            usableGlow: '0 0 5px rgba(14, 165, 233, 0.24), 0 0 12px rgba(14, 165, 233, 0.08)',
            mobile: 'TAP TO USE',
            desktop: 'KEY "2" TO USE'
          }
        } as const;
        const activeT = toolsData[uiState.activeTool];

        return (
          <AnimatePresence>
            {!bannerState.show && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeInOut" }}
                className="absolute inset-0 pointer-events-none z-[70]"
              >
                {/* Active-player HUD for FINAL_RUN */}
                {mpState.roomId && currentMatchPhase === 'FINAL_RUN' && (
                  <div ref={hudTopCenterRef} className="absolute top-[116px] sm:top-6 left-1/2 -translate-x-1/2 pointer-events-none z-20">
                    <div className="bg-[#0a0000]/85 border border-[#FFCC00] text-[#FFCC00] shadow-[0_0_12px_rgba(255,204,0,0.35)] px-3 sm:px-4 py-1.5 sm:py-2 rounded-md font-mono font-black text-xs sm:text-sm tracking-widest uppercase flex items-center gap-2 backdrop-blur-sm">
                      <span>FINAL RUN</span>
                      <span className="text-[#FFCC00]/50">//</span>
                      <span className="text-white font-bold">{displayFinalRunSeconds}</span>
                    </div>
                  </div>
                )}

                {/* Active-player HUD for START SHIELD */}
                {mpState.roomId && isOpeningProtectionActiveLocal(performance.now()) && (
                  <div ref={hudTopCenterRef} className="absolute top-[116px] sm:top-6 left-1/2 -translate-x-1/2 pointer-events-none z-20">
                    <div className="bg-[#0a0000]/85 border border-[#00f0ff] text-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.35)] px-3 sm:px-4 py-1.5 sm:py-2 rounded-md font-mono font-black text-xs sm:text-sm tracking-widest uppercase flex items-center gap-2 backdrop-blur-sm">
                      <span>START SHIELD</span>
                      <span className="text-[#00f0ff]/50">//</span>
                      <span className="text-white font-bold">
                        {getRemainingProtectionSeconds(performance.now()) > 0
                          ? `${getRemainingProtectionSeconds(performance.now()).toFixed(1)}s`
                          : 'SYNC'}
                      </span>
                    </div>
                  </div>
                )}

                <div
                  className="absolute top-0 left-0 right-0 p-3 sm:p-6 flex flex-row justify-between items-start pointer-events-none z-10 w-full max-w-7xl mx-auto"
                  style={{
                    paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
                    paddingLeft: 'calc(0.75rem + env(safe-area-inset-left, 0px))',
                    paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
                  }}
                >
                  {/* Left: Score & Spawners / Target Counters */}
                  <div ref={hudTopLeftRef} className="flex items-stretch gap-2 sm:gap-6 ml-0 sm:ml-4">
                    <motion.div
                      animate={flashScore ? {
                        filter: [
                          "brightness(1) drop-shadow(0 0 0px rgba(0, 240, 255, 0))",
                          "brightness(1.8) drop-shadow(0 0 15px rgba(0, 240, 255, 0.95))",
                          "brightness(1) drop-shadow(0 0 0px rgba(0, 240, 255, 0))"
                        ]
                      } : {}}
                      transition={flashScore ? {
                        duration: 0.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                      } : {}}
                      className="flex flex-col items-start justify-center gap-0 sm:gap-1 sm:w-[160px]"
                    >
                       <div className="hidden sm:block text-[11px] text-[#00f0ff] tracking-[0.3em] font-bold whitespace-nowrap">SYSTEM // SCORE</div>
                       <div className="sm:hidden text-[9px] text-[#00f0ff] tracking-widest font-bold whitespace-nowrap">SCORE</div>
                       <div className="text-white font-black text-2xl sm:text-[43px] tracking-tighter drop-shadow-[0_0_15px_rgba(0,240,255,0.8)] leading-none mt-1" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                         {uiState.score.toString().padStart(6, '0')}
                       </div>
                    </motion.div>
                    <motion.div
                      key={pulseSpawnerCounter ? `spawner-pulse-${pulseKey}` : 'spawner-idle'}
                      animate={pulseSpawnerCounter ? {
                        scale: [1, 1.12, 1],
                        filter: [
                          "brightness(1) drop-shadow(0 0 0px rgba(0,0,0,0))",
                          `brightness(1.5) drop-shadow(0 0 20px ${uiState.hardMode ? 'rgba(255,51,0,1)' : 'rgba(255,0,255,1)'})`,
                          "brightness(1) drop-shadow(0 0 0px rgba(0,0,0,0))"
                        ]
                      } : {
                        scale: 1,
                        filter: "brightness(1) drop-shadow(0 0 0px rgba(0,0,0,0))"
                      }}
                      transition={pulseSpawnerCounter ? {
                        duration: 0.8,
                        ease: "easeInOut"
                      } : {}}
                      className={`flex flex-col items-start justify-center gap-0 sm:gap-1 pl-4 sm:pl-6 border-l-2 h-full sm:w-[160px] ${uiState.hardMode ? 'border-[#ff3300]/30' : 'border-[#ff00ff]/30'}`}
                    >
                       <div className={`hidden sm:block text-[11px] tracking-[0.3em] font-bold whitespace-nowrap ${uiState.hardMode ? 'text-[#ff3300]' : 'text-[#ff00ff]'}`}>
                         {mpState.roomId ? 'LEADERBOARD // RANK' : (uiState.hardMode ? 'TARGET // SPAWNERS (HARD)' : 'TARGET // SPAWNERS')}
                       </div>
                       <div className={`sm:hidden text-[9px] tracking-widest font-bold whitespace-nowrap ${uiState.hardMode ? 'text-[#ff3300]' : 'text-[#ff00ff]'}`}>
                         {mpState.roomId ? 'RANK' : (uiState.hardMode ? 'TARGET (HARD)' : 'TARGET')}
                       </div>
                       <div className="text-white font-black text-2xl sm:text-[43px] tracking-tighter leading-none mt-1"
                            style={{
                              fontFamily: 'var(--font-display, Anton, sans-serif)',
                              textShadow: `0 0 15px ${uiState.hardMode ? '#ff3300' : '#ff00ff'}`
                            }}>
                         {mpState.roomId ? `#${getPlayerRank()}` : uiState.spawnersLeft}
                       </div>
                    </motion.div>
                  </div>

                  {/* Right: Pause & Quit buttons */}
                  <div ref={hudTopRightRef} className="flex flex-col sm:flex-row items-end sm:items-center justify-center gap-2 sm:gap-4 pointer-events-auto h-full pr-0 sm:pr-2">
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (mpState.roomId) {
                          setMpMenuOpen(prev => {
                            const next = !prev;
                            mpMenuOpenRef.current = next;
                            if (next) {
                              releaseAllInputs();
                            }
                            return next;
                          });
                          setConfirmResign(false);
                          confirmResignRef.current = false;
                        } else {
                          if (uiRef.current.status === 'PLAYING') {
                            beginSinglePlayerPause();
                          } else if (uiRef.current.status === 'PAUSED') {
                            resumeSinglePlayerFromPause();
                          }
                          setConfirmResign(false);
                        }
                      }}
                      className="w-[84px] sm:w-[144px] h-[34px] sm:h-[48px] border-2 border-[#FBBF24] hover:bg-[#FBBF24] hover:text-black text-[#FBBF24] font-black tracking-[0.15em] sm:tracking-widest text-[9px] sm:text-xs uppercase transition-all duration-200 shadow-[0_0_8px_rgba(251,191,36,0.2)] hover:shadow-[0_0_15px_rgba(251,191,36,0.6)] active:scale-95 flex items-center justify-center -skew-x-12 focus:outline-none"
                    >
                      <span className="skew-x-12 whitespace-nowrap">
                        {mpState.roomId ? (mpMenuOpen ? '▶ RESUME' : '|| MENU') : (uiState.status === 'PAUSED' ? '▶ RESUME' : '|| PAUSE')}
                      </span>
                    </button>

                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (mpState.roomId) {
                          releaseAllInputs();

                          setConfirmResign(true);
                          confirmResignRef.current = true;
                          setMpMenuOpen(false);
                          mpMenuOpenRef.current = false;
                        } else {
                          releaseAllInputs();
                          beginSinglePlayerPause();
                          setConfirmResign(true);
                        }
                      }}
                      className="w-[84px] sm:w-[144px] h-[34px] sm:h-[48px] border-2 border-[#ff003c] hover:bg-[#ff003c] hover:text-white text-[#ff003c] font-black tracking-[0.15em] sm:tracking-widest text-[9px] sm:text-xs uppercase transition-all duration-200 shadow-[0_0_8px_rgba(255,0,60,0.2)] hover:shadow-[0_0_15px_rgba(255,0,60,0.6)] active:scale-95 flex items-center justify-center -skew-x-12"
                    >
                      <span className="skew-x-12 whitespace-nowrap">
                        <span className="inline-block scale-[1.3] -translate-y-[1px] mr-0.5">×</span> QUIT
                      </span>
                    </button>
                  </div>
                </div>

            {uiState.status === 'PAUSED' && !confirmResign && (
              <div
                className="absolute inset-0 bg-black/[0.78] pointer-events-auto z-[70] flex flex-col items-center justify-center backdrop-blur-sm select-none p-4 overflow-y-auto"
              >
                <div className="flex flex-col items-center">
                  <h2
                    className="text-[36px] sm:text-[48px] md:text-[68px] font-black text-[#F5F7FF] uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.28)] leading-none"
                    style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
                  >
                    HALTED
                  </h2>
                  <p className="text-[#F5F7FF]/55 font-mono text-[12px] md:text-[14px] tracking-[0.25em] uppercase mt-2 sm:mt-3">
                    SYSTEM PAUSED
                  </p>
                  <div className="h-6 flex items-center justify-center mt-2" role="status" aria-live="polite" aria-atomic="true">
                    {pauseMenuFeedback && (
                      <p
                        className={`font-mono text-[11px] md:text-[12px] font-bold tracking-widest uppercase transition-opacity duration-300 ${
                          pauseMenuFeedback.type === 'success'
                            ? 'text-[#A5F3FC] drop-shadow-[0_0_4px_rgba(6,182,212,0.25)]'
                            : 'text-[#FF003C] drop-shadow-[0_0_4px_rgba(255,0,60,0.30)]'
                        }`}
                      >
                        {pauseMenuFeedback.text}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 mt-5 sm:mt-11 w-[calc(100vw-48px)] max-w-[280px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      resumeSinglePlayerFromPause();
                    }}
                    className="h-12 w-full bg-[#FBBF24] border-2 border-[#FBBF24] text-[#080A0F] font-mono font-black tracking-widest uppercase text-xs sm:text-sm shadow-[0_0_6px_rgba(251,191,36,0.30),0_0_14px_rgba(251,191,36,0.12)] hover:bg-[#FBBF24]/90 hover:border-[#FBBF24]/90 active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black"
                  >
                    RESUME
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveMatch();
                    }}
                    className="h-12 w-full bg-[rgba(245,247,255,0.035)] border-2 border-[rgba(245,247,255,0.32)] text-[#D5DAE6] font-mono font-black tracking-widest uppercase text-xs sm:text-sm hover:bg-[rgba(251,191,36,0.08)] hover:border-[#FBBF24] hover:text-[#FBBF24] shadow-[0_0_6px_rgba(245,247,255,0.06)] hover:shadow-[0_0_8px_rgba(251,191,36,0.16)] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black"
                  >
                    DOWNLOAD SAVE FILE
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickSave();
                    }}
                    className="h-12 w-full bg-[rgba(245,247,255,0.035)] border-2 border-[rgba(245,247,255,0.32)] text-[#D5DAE6] font-mono font-black tracking-widest uppercase text-xs sm:text-sm hover:bg-[rgba(251,191,36,0.08)] hover:border-[#FBBF24] hover:text-[#FBBF24] shadow-[0_0_6px_rgba(245,247,255,0.06)] hover:shadow-[0_0_8px_rgba(251,191,36,0.16)] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black"
                  >
                    QUICK SAVE
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickLoad();
                    }}
                    disabled={!quickSaveExists}
                    className="h-12 w-full bg-[rgba(245,247,255,0.035)] border-2 border-[rgba(245,247,255,0.32)] text-[#D5DAE6] font-mono font-black tracking-widest uppercase text-xs sm:text-sm hover:bg-[rgba(251,191,36,0.08)] hover:border-[#FBBF24] hover:text-[#FBBF24] shadow-[0_0_6px_rgba(245,247,255,0.06)] hover:shadow-[0_0_8px_rgba(251,191,36,0.16)] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black disabled:bg-[rgba(245,247,255,0.02)] disabled:border-[rgba(245,247,255,0.14)] disabled:text-[rgba(245,247,255,0.25)] disabled:shadow-none disabled:cursor-default disabled:pointer-events-none disabled:active:scale-100"
                  >
                    QUICK LOAD
                  </button>
                </div>
              </div>
            )}

            {mpState.roomId && mpMenuOpen && !confirmResign && (
              <div
                className="absolute inset-0 bg-black/[0.78] pointer-events-auto z-[70] flex flex-col items-center justify-center backdrop-blur-sm select-none p-4 overflow-y-auto"
              >
                <div className="flex flex-col items-center">
                  <h2
                    className="text-[36px] sm:text-[48px] md:text-[68px] font-black text-[#FBBF24] uppercase drop-shadow-[0_0_10px_rgba(251,191,36,0.28)] leading-none"
                    style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
                  >
                    OPTIONS
                  </h2>
                  <p className="text-[#F5F7FF]/55 font-mono text-[12px] md:text-[14px] tracking-[0.25em] uppercase mt-2 sm:mt-3">
                    MATCH ACTIVE
                  </p>
                </div>

                <div className="flex flex-col gap-3 mt-5 sm:mt-11 w-[calc(100vw-48px)] max-w-[280px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMpMenuOpen(false);
                      mpMenuOpenRef.current = false;
                    }}
                    className="h-12 w-full bg-[#FBBF24] border-2 border-[#FBBF24] text-[#080A0F] font-mono font-black tracking-widest uppercase text-xs sm:text-sm shadow-[0_0_6px_rgba(251,191,36,0.30),0_0_14px_rgba(251,191,36,0.12)] hover:bg-[#FBBF24]/90 hover:border-[#FBBF24]/90 active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black"
                  >
                    RESUME
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmResign(true);
                    }}
                    className="h-12 w-full bg-transparent border-2 border-[#FF003C] text-[#FF003C] hover:bg-[#FF003C]/10 font-mono font-black tracking-widest uppercase text-xs sm:text-sm active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FF003C] focus-visible:ring-offset-black"
                  >
                    QUIT TO MENU
                  </button>
                </div>
              </div>
            )}

            {confirmResign && (
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="quit-confirmation-title"
                className="absolute inset-0 bg-black/80 pointer-events-auto z-[70] flex flex-col items-center justify-center backdrop-blur-md p-4 overflow-y-auto"
              >
                <h2
                  id="quit-confirmation-title"
                  className="text-[36px] sm:text-[48px] md:text-[68px] font-black text-[#F5F7FF] uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.28)] leading-none text-center"
                  style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
                >
                  QUIT TO MENU?
                </h2>
                <p className="text-[#FF003C]/75 font-mono text-[11px] md:text-[13px] tracking-[0.2em] uppercase mt-2 sm:mt-3 text-center">
                  {mpState.roomId ? 'YOU WILL LEAVE THE ACTIVE MATCH' : 'CURRENT RUN WILL BE LOST'}
                </p>
                <div className="flex flex-col gap-3 mt-5 sm:mt-11 w-[calc(100vw-48px)] max-w-[280px]">
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmResign(false);
                      confirmResignRef.current = false;

                      if (mpState.roomId) {
                        setMpMenuOpen(false);
                        mpMenuOpenRef.current = false;
                        releaseAllInputs();
                      } else {
                        resumeSinglePlayerFromPause();
                      }
                    }}
                    className="h-12 w-full bg-[#FBBF24] border-2 border-[#FBBF24] text-[#080A0F] font-mono font-black tracking-widest uppercase text-xs sm:text-sm shadow-[0_0_6px_rgba(251,191,36,0.30),0_0_14px_rgba(251,191,36,0.12)] hover:bg-[#FBBF24]/90 hover:border-[#FBBF24]/90 active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black"
                  >
                    KEEP PLAYING
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmResign(false);
                      confirmResignRef.current = false;
                      setMpMenuOpen(false);
                      mpMenuOpenRef.current = false;
                      stateRef.current.shake = 20;
                      emitLeaveRoom();
                      clearPendingGuestShots(true);
                      clearPendingAbilityRequests();
                      activeMultiplayerRoundIdRef.current = 0;
                      multiplayerStartPendingRef.current = false;
                      setMultiplayerStartPending(false);
                      cancelPendingMatchSettingsUpdate();
                      setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                      setUiState(prev => ({ ...prev, status: 'MENU' }));
                    }}
                    className="h-12 w-full bg-transparent border-2 border-[#FF003C] text-[#FF003C] hover:bg-[#FF003C]/10 font-mono font-black tracking-widest uppercase text-xs sm:text-sm active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FF003C] focus-visible:ring-offset-black"
                  >
                    QUIT TO MENU
                  </button>
                </div>
              </div>
            )}

            {uiState.status !== 'PAUSED' && (
              <>
                <div ref={hudBottomLeftRef} className="hidden sm:block absolute bottom-0 left-0 p-8 pointer-events-none z-10">
                   <div className="text-sm text-[#94A3B8] tracking-[0.2em] font-bold font-mono">
                     {uiState.deviceType === 'mobile' ? 'JOYSTICK TO MOVE' : 'WASD TO MOVE'}
                   </div>
                </div>
                <div
                  ref={hudBottomCenterRef}
                  className={`absolute left-1/2 -translate-x-1/2 pointer-events-none z-10 flex gap-[10px] sm:gap-[16px] bottom-3 sm:bottom-6 max-w-[calc(100vw-24px)]`}
                  style={{
                    bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
                  }}
                >
                   {(Object.keys(toolsData) as Array<keyof typeof toolsData>).map((toolKey) => {
                     const tool = toolsData[toolKey];
                     const isProtected = isOpeningProtectionActiveLocal(performance.now());
                     const isGuestMode = Boolean(mpRef.current.roomId && !mpRef.current.isHost);
                     const socketId = socketRef.current?.id;
                     const auth = isGuestMode && socketId ? stateRef.current.playerActionAuthority?.[socketId] : null;
                     const hasValidAuthority = auth &&
                       typeof auth.specialActiveUntil === 'number' && Number.isFinite(auth.specialActiveUntil) &&
                       typeof auth.specialReadyAt === 'number' && Number.isFinite(auth.specialReadyAt) &&
                       typeof auth.buildActiveUntil === 'number' && Number.isFinite(auth.buildActiveUntil) &&
                       typeof auth.buildReadyAt === 'number' && Number.isFinite(auth.buildReadyAt);

                     const isAuthorityUnknown = isGuestMode && !hasValidAuthority;

                     const isReady = !isAuthorityUnknown && !isProtected && uiState.buttonCounters[toolKey as 'special' | 'build'] === 0;
                     const showCooldownNumber = !isAuthorityUnknown && uiState.buttonCounters[toolKey as 'special' | 'build'] > 0;

                     return (
                       <div key={toolKey} className="relative flex flex-col items-center gap-1 sm:gap-1.5">
                         <div className="h-4 sm:h-5 flex items-end">
                           {showCooldownNumber && (
                             <span className="text-[10px] sm:text-xs font-mono font-bold" style={{ color: tool.unusableBorder }}>
                               {uiState.buttonCounters[toolKey as 'special' | 'build']}
                             </span>
                           )}
                         </div>
                         <button
                           id={`tool-btn-${toolKey}`}
                           aria-disabled={!isReady}
                           onPointerDown={(e) => {
                             e.stopPropagation();
                             const isLocalMenuOpen = mpRef.current.roomId && (mpMenuOpenRef.current || confirmResignRef.current);
                             if (!isReady || isLocalMenuOpen) return;
                             const currentTime = performance.now();
                             if (toolKey === 'special') {
                               requestSpecialActivation(currentTime);
                             } else if (toolKey === 'build') {
                               requestBuildActivation(currentTime);
                             }
                           }}
                           className={`pointer-events-auto h-[44px] border-2 font-black tracking-widest uppercase text-[12px] sm:text-[14px] relative overflow-hidden flex justify-center items-center gap-1 sm:gap-2 focus:outline-none ${isReady ? 'hover:brightness-110 active:brightness-90 active:scale-95 cursor-pointer' : 'cursor-default'}`}
                           style={{
                             borderColor: isReady ? tool.usableBorder : tool.unusableBorder,
                             background: isReady ? tool.usableFill : tool.unusableFill,
                             color: isReady ? tool.usableText : tool.unusableText,
                             boxShadow: isReady ? tool.usableGlow : 'none',
                             transition: isReady ? 'all 140ms ease-out' : 'all 100ms ease-in',
                             width: 'min(162px, calc((100vw - 34px) / 2))',
                           }}
                         >
                           {uiState.deviceType === 'desktop' && (
                             <span className="hidden sm:inline-block relative z-10 opacity-70 font-mono">[{toolKey === 'special' ? 1 : 2}]</span>
                           )}
                           <span className="relative z-10">{tool.label}</span>
                         </button>
                       </div>
                     );
                   })}
                </div>

                <div ref={hudBottomRightRef} className="hidden sm:block absolute bottom-0 right-0 p-8 pointer-events-none z-10 text-right">
                   <div className="text-sm text-[#94A3B8] tracking-[0.2em] font-bold font-mono">
                     {uiState.deviceType === 'mobile' ? 'TAP TO SHOOT' : 'MOUSE TO SHOOT'}
                   </div>
                </div>
              </>
            )}
              </motion.div>
            )}
          </AnimatePresence>
        );
      })()}

      {uiState.status === 'VICTORY' && !mpState.roomId && presentationStage === 'results' && (
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
          className="absolute inset-0 bg-[#00f0ff]/90 flex flex-col items-center justify-center p-3 sm:p-6 text-center backdrop-blur-md z-[70] overflow-y-auto"
        >
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: 'easeOut' }}
            className="max-w-xl w-full bg-[#0a0000] border-2 border-[#00f0ff] p-4 sm:p-8 md:p-12 shadow-[10px_10px_0_#00f0ff] max-h-[92vh] overflow-y-auto"
          >
            <motion.h2
              initial={shouldReduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.15, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15, delay: shouldReduceMotion ? 0 : 0.05 }}
              className="text-4xl sm:text-6xl md:text-7xl font-black text-[#00f0ff] mb-2 sm:mb-4 tracking-tighter uppercase"
              style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
            >
              VICTORY
            </motion.h2>

            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.2, delay: shouldReduceMotion ? 0 : 0.15 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 text-xs sm:text-sm font-mono text-[#00f0ff]/80 mb-4 sm:mb-6 md:mb-10 uppercase tracking-widest border-t border-b border-[#00f0ff]/30 py-3 sm:py-6"
            >
              <div>FINAL SCORE: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.score}</span></div>
              <div className="hidden sm:block w-px h-6 bg-[#00f0ff]/30"></div>
              <div>SPAWNERS LEFT: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.spawnersLeft}/{(MAPS[uiState.mapId] || MAPS.medium).spawners.length}</span></div>
            </motion.div>

            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.2, delay: shouldReduceMotion ? 0 : 0.22 }}
              className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center"
            >
              <button
                onClick={() => {
                  startFreshSinglePlayerRun(uiState.mapId, uiState.gameMode);
                }}
                className="flex-1 py-3 sm:py-4 bg-[#00f0ff] hover:bg-white text-black border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
              >
                RETRY ARENA
              </button>
              <button
                onClick={() => {
                  emitLeaveRoom();
                  clearPendingGuestShots(true);
                  clearPendingAbilityRequests();
                  activeMultiplayerRoundIdRef.current = 0;
                  multiplayerStartPendingRef.current = false;
                  setMultiplayerStartPending(false);
                  setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                  setUiState(prev => ({ ...prev, status: 'MENU' }));
                }}
                className="flex-1 py-3 sm:py-4 bg-transparent hover:bg-white/10 text-[#00f0ff] hover:text-white border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_rgba(0,240,255,0.4)] pointer-events-auto"
              >
                MAIN MENU
              </button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {uiState.status === 'GAME_OVER' && !mpState.roomId && presentationStage === 'results' && (
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
          className="absolute inset-0 bg-red-950/90 flex flex-col items-center justify-center p-3 sm:p-6 text-center backdrop-blur-md z-[70] overflow-y-auto"
        >
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: 'easeOut' }}
            className="max-w-xl w-full bg-[#0a0000] border-2 border-[#ff003c] p-4 sm:p-8 md:p-12 shadow-[10px_10px_0_#ff003c] max-h-[92vh] overflow-y-auto"
          >
            <motion.h2
              initial={shouldReduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.15, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15, delay: shouldReduceMotion ? 0 : 0.05 }}
              className="text-4xl sm:text-6xl md:text-7xl font-black text-[#ff003c] mb-2 sm:mb-4 tracking-tighter uppercase"
              style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
            >
              ANNIHILATED
            </motion.h2>

            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.2, delay: shouldReduceMotion ? 0 : 0.15 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 text-xs sm:text-sm font-mono text-red-200/80 mb-4 sm:mb-6 md:mb-10 uppercase tracking-widest border-t border-b border-red-500/30 py-3 sm:py-6"
            >
              <div>FINAL SCORE: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.score}</span></div>
              <div>SPAWNERS LEFT: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.spawnersLeft}/{(MAPS[uiState.mapId] || MAPS.medium).spawners.length}</span></div>
            </motion.div>

            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.2, delay: shouldReduceMotion ? 0 : 0.22 }}
              className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center"
            >
              <button
                onClick={() => {
                  startFreshSinglePlayerRun(uiState.mapId, uiState.gameMode);
                }}
                className="flex-1 py-3 sm:py-4 bg-[#ff003c] hover:bg-white text-black border-2 border-[#ff003c] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
              >
                RETRY ARENA
              </button>
              <button
                onClick={() => {
                  emitLeaveRoom();
                  clearPendingGuestShots(true);
                  clearPendingAbilityRequests();
                  activeMultiplayerRoundIdRef.current = 0;
                  multiplayerStartPendingRef.current = false;
                  setMultiplayerStartPending(false);
                  cancelPendingMatchSettingsUpdate();
                  setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                  setUiState(prev => ({ ...prev, status: 'MENU' }));
                }}
                className="flex-1 py-3 sm:py-4 bg-transparent hover:bg-white/10 text-[#ff003c] hover:text-white border-2 border-[#ff003c] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_rgba(255,0,60,0.4)] pointer-events-auto"
              >
                MAIN MENU
              </button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {mpState.roomId && (uiState.status === 'GAME_OVER' || uiState.status === 'VICTORY') && presentationStage === 'results' && (() => {
        const { list: standings, isWholeGameEnded } = getMultiplayerStandings();
        const myId = socketRef.current?.id || 'local';
        const isZeroScoreTie = isWholeGameEnded && standings.length > 1 && standings.every(player => player.score === 0);
        const isLocalWinner = !isZeroScoreTie && isWholeGameEnded && (stateRef.current.winnerId === myId || (standings.length > 0 && standings[0].id === myId));
        const hasOtherConnectedPlayers = Object.keys(lobbyPlayers).length > 0;

        return (
          <div className="absolute inset-0 bg-[#0a0000]/95 flex flex-col items-center justify-center p-2 sm:p-6 text-center backdrop-blur-md z-[70] overflow-y-auto">
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: 'easeOut' }}
              className={`max-w-xl w-full p-5 sm:p-8 md:p-10 my-auto border-2 ${
                isZeroScoreTie
                  ? 'bg-[#0d0a03] border-[#ffcc00] shadow-[10px_10px_0_#ffcc00]'
                  : isWholeGameEnded && isLocalWinner
                  ? 'bg-[#030d0f] border-[#00f0ff] shadow-[10px_10px_0_#00f0ff]'
                  : 'bg-[#0d0404] border-[#ff005c] shadow-[10px_10px_0_#ff005c]'
              }`}
            >
              <h2
                className={`text-4xl sm:text-5xl md:text-6xl font-black mb-4 sm:mb-6 tracking-tighter uppercase ${
                  isZeroScoreTie
                    ? 'text-[#ffcc00] drop-shadow-[0_0_15px_rgba(255,204,0,0.5)]'
                    : isLocalWinner
                    ? 'text-[#00f0ff] drop-shadow-[0_0_15px_rgba(0,240,255,0.5)]'
                    : 'text-[#ff005c] drop-shadow-[0_0_15px_rgba(255,0,92,0.5)]'
                }`}
                style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
              >
                {isZeroScoreTie ? 'STALEMATE' : isWholeGameEnded ? (isLocalWinner ? 'VICTORY' : 'MATCH LOST') : 'ANNIHILATED'}
              </h2>

              {!isWholeGameEnded && (
                <div className="mb-4 sm:mb-6 flex justify-center">
                  {currentMatchPhase === 'FINAL_RUN' ? (
                    <div className="bg-black/80 border border-[#FFCC00] text-[#FFCC00] shadow-[0_0_12px_rgba(255,204,0,0.3)] px-3 py-1.5 rounded-md font-mono font-black text-xs sm:text-sm tracking-widest uppercase flex items-center gap-2">
                      <span>FINAL RUN</span>
                      <span className="text-[#FFCC00]/50">//</span>
                      <span className="text-white font-bold">{displayFinalRunSeconds}</span>
                    </div>
                  ) : (
                    <span className="font-mono text-[10px] sm:text-xs text-zinc-400 font-bold tracking-[0.2em] uppercase">
                      SPECTATING
                    </span>
                  )}
                </div>
              )}

              <div className="w-full mb-6 sm:mb-8 space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {standings.map((p, idx) => {
                  const isMe = p.id === myId;
                  const colorDef = PLAYER_COLORS[p.colorIdx] || PLAYER_COLORS[0];

                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between py-1.5 px-2.5 sm:py-3 sm:px-4 border transition-all ${
                        isMe
                          ? 'bg-[#ffcc00]/10 border-[#ffcc00] shadow-[0_0_10px_rgba(255,204,0,0.15)]'
                          : 'bg-black/40 border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 overflow-hidden text-left">
                        {/* Rank */}
                        <span className={`text-[12px] font-black font-mono tracking-tighter w-5 ${
                          isZeroScoreTie ? 'text-[#ffcc00]' : idx === 0 ? 'text-[#ffcc00]' : idx === 1 ? 'text-[#00f0ff]' : 'text-white/60'
                        }`}>
                          {isZeroScoreTie ? '—' : `#${idx + 1}`}
                        </span>

                        {/* Player Color Block */}
                        <div className="w-2.5 h-2.5 border border-white/20 shrink-0" style={{ backgroundColor: colorDef.n }} />

                        {/* Player Name */}
                        <span className={`text-xs sm:text-sm font-mono tracking-wide uppercase truncate ${
                          isMe ? 'text-[#ffcc00] font-black' : 'text-white/90'
                        }`}>
                          {p.name} {isMe && <span className="text-[10px] text-[#ffcc00]/70 font-semibold">(YOU)</span>}
                        </span>
                      </div>

                      {/* Score and Alive/Dead Label / Winner Badge */}
                      <div className="flex items-center gap-2 sm:gap-4 font-mono">
                        {!isZeroScoreTie && isWholeGameEnded && p.id === stateRef.current.winnerId ? (
                          <span className="text-[#ffcc00] border-[#ffcc00]/50 bg-[#ffcc00]/15 font-black text-[9px] sm:text-[11px] tracking-widest uppercase px-2 py-0.5 rounded-sm shrink-0 border shadow-[0_0_8px_rgba(255,204,0,0.4)] animate-pulse">
                            WINNER
                          </span>
                        ) : (
                          <span className={`text-[8px] sm:text-[10px] tracking-widest font-extrabold uppercase px-1.5 py-0.5 rounded-sm shrink-0 border ${
                            p.isDead
                              ? 'text-[#ff005c]/70 border-[#ff005c]/10 bg-[#ff005c]/5'
                              : 'text-[#00ff88] border-[#00ff88]/20 bg-[#00ff88]/5 animate-pulse'
                          }`}>
                            {p.isDead ? 'ELIMINATED' : 'ALIVE'}
                          </span>
                        )}

                        <span className="text-white font-bold text-xs sm:text-base tracking-tight">
                          {p.score}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3">
                {mpError && (
                  <div className="text-[#FF005C] font-mono text-xs sm:text-sm font-bold text-center uppercase">
                    {mpError}
                  </div>
                )}
                {confirmLeaveMatches ? (
                  <div className="bg-[#1a050b] p-4 border border-[#ff005c]/20 flex flex-col items-center justify-center gap-3">
                    <p className="text-[10px] sm:text-xs font-mono text-pink-200 uppercase tracking-widest">
                      QUIT TO MAIN MENU? YOU WILL ABANDON THIS ROOM.
                    </p>
                    <div className="flex gap-3 w-full">
                      <button
                        onClick={() => {
                          emitLeaveRoom();
                          clearPendingGuestShots(true);
                          clearPendingAbilityRequests();
                          activeMultiplayerRoundIdRef.current = 0;
                          multiplayerStartPendingRef.current = false;
                          setMultiplayerStartPending(false);
                          cancelPendingMatchSettingsUpdate();
                          setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                          setUiState(prev => ({ ...prev, status: 'MENU' }));
                          setConfirmLeaveMatches(false);
                        }}
                        className="flex-1 py-2 sm:py-3 bg-[#ff005c] hover:bg-white text-black font-black tracking-widest uppercase text-xs sm:text-sm transition-all pointer-events-auto"
                      >
                        CONFIRM QUIT
                      </button>
                      <button
                        onClick={() => setConfirmLeaveMatches(false)}
                        className="flex-1 py-2 sm:py-3 bg-white/5 hover:bg-white/10 text-white font-black tracking-widest uppercase text-xs sm:text-sm border border-white/10 transition-all pointer-events-auto"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
                    {/* Only the Host can restart the match, and only when the whole game ended */}
                    {isWholeGameEnded && mpState.isHost && (
                      <button
                        onClick={handleMultiplayerRestart}
                        disabled={multiplayerStartPending || !hasOtherConnectedPlayers}
                        className={`flex-1 py-3 sm:py-4 font-black tracking-[0.2em] transition-all duration-200 uppercase text-xs sm:text-sm border-2 pointer-events-auto ${
                          !hasOtherConnectedPlayers
                            ? 'bg-[#15161a] text-[#737680] border-[#454852] cursor-not-allowed shadow-none grayscale'
                            : multiplayerStartPending
                            ? 'bg-[#ffcc00]/40 text-black/40 border-[#ffcc00]/40 cursor-not-allowed opacity-60'
                            : 'bg-[#ffcc00] hover:bg-white text-black border-[#ffcc00] active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff]'
                        }`}
                      >
                        {!hasOtherConnectedPlayers ? "NO PLAYERS" : multiplayerStartPending ? "STARTING..." : "RESTART MATCH"}
                      </button>
                    )}

                    {/* All other players can only go to main menu */}
                    {(!isWholeGameEnded || !mpState.isHost) && isWholeGameEnded && (
                      <div className="text-xs font-mono text-zinc-500 uppercase tracking-widest flex items-center justify-center p-2 mb-2 sm:mb-0">
                        WAITING FOR HOST TO RESTART...
                      </div>
                    )}

                    <button
                      onClick={() => setConfirmLeaveMatches(true)}
                      className="flex-1 py-3 sm:py-4 bg-transparent hover:bg-white/10 text-[#ff005c] hover:text-white border-2 border-[#ff005c] font-black tracking-[0.2em] transition-all duration-200 uppercase text-xs sm:text-sm active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_rgba(255,0,92,0.4)] pointer-events-auto"
                    >
                      MAIN MENU
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        );
      })()}

      <AnimatePresence>
        {bannerState.show && bannerState.mode && uiState.status === 'PLAYING' && presentationStage === 'idle' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] sm:w-[480px] z-[70] pointer-events-none select-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: -40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: -40 }}
              transition={{ type: 'spring', stiffness: 120, damping: 14 }}
              className="relative flex flex-col items-center bg-[#0d0f1b]/95 border-2 border-[#00f0ff] p-6 sm:p-8 shadow-[10px_10px_0_rgba(0,240,255,0.4)] text-center max-w-full"
            >
              {/* Scanline background overlay */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%)] bg-[size:100%_4px] pointer-events-none opacity-30" />

              {/* Actual Spawner Design SVG representation */}
              <div className="relative mb-4 flex items-center justify-center z-10 animate-pulse">
                <svg width="64" height="64" viewBox="0 0 64 64" className="drop-shadow-[0_0_12px_var(--glow-color)]" style={{ '--glow-color': uiState.hardMode ? '#ff3300' : '#ff00ff' } as React.CSSProperties}>
                  {/* Outer pulsing ring */}
                  <circle
                    cx="32"
                    cy="32"
                    r="24"
                    fill="none"
                    stroke={uiState.hardMode ? '#ff3300' : '#ff00ff'}
                    strokeWidth="1.5"
                    opacity="0.3"
                  />

                  {/* Hexagon shape (matches live GameCanvas custom rot/shape) */}
                  <polygon
                    points="32,10 51,21 51,43 32,54 13,43 13,21"
                    fill={uiState.hardMode ? '#2a0500' : '#1a001a'}
                    stroke={uiState.hardMode ? '#ff3300' : '#ff00ff'}
                    strokeWidth="3.5"
                  />

                  {/* Connected Inner Core node */}
                  <circle
                    cx="32"
                    cy="32"
                    r="8"
                    fill={uiState.hardMode ? '#ff3300' : '#ff00ff'}
                  />
                </svg>
              </div>

              {/* Header Badge */}
              <div className="text-[10px] tracking-[0.3em] font-mono font-black uppercase mb-2 text-[#00f0ff] z-10">
                ▼ INITIAL OBJECTIVE DETECTED
              </div>

              <div className="w-full h-[1px] bg-[#00f0ff]/30 mb-4 z-10" />

              {/* Title Text */}
              {bannerState.mode === 'single' ? (
                <div className="flex flex-col items-center z-10">
                  <h1 className="text-2xl sm:text-3xl font-black text-white tracking-wide uppercase leading-tight" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)', textShadow: '0 0 15px rgba(0,240,255,0.5)' }}>
                    DESTROY ALL {uiState.spawnersLeft} SPAWNERS TO WIN
                  </h1>
                  <p className="text-[#00f0ff]/80 font-mono text-[10px] sm:text-xs mt-3 tracking-widest uppercase py-2 border-t border-b border-[#00f0ff]/20 w-4/5 mx-auto font-black leading-relaxed">
                    SPAWNERS CREATE THE ENEMIES THAT SHOOT AT THE PLAYER
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center z-10">
                  <h1 className="text-2xl sm:text-3xl font-black text-white tracking-wide uppercase leading-tight" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)', textShadow: '0 0 15px rgba(0,240,255,0.5)' }}>
                    GET THE HIGHEST SCORE TO WIN
                  </h1>
                  <p className="text-[#ffcc00]/85 font-mono text-[10px] sm:text-xs mt-3 tracking-widest uppercase py-2 border-t border-b border-[#ffcc00]/20 w-4/5 mx-auto font-black leading-relaxed">
                    DESTROY SPAWNERS AND DEFEAT OPPONENTS TO EARN POINTS
                  </p>
                </div>
              )}

              {/* Countdown counter */}
              <div className="mt-4 font-black text-2xl sm:text-3xl text-[#00f0ff] z-10 tracking-widest drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                {bannerCountdown}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleLoadMatch} />
    </div>
  );
}

