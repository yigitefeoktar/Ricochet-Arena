import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { Copy, Check, Play, X, Shuffle } from 'lucide-react';

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

function getSafeSpawn(minDistToWalls = 50) {
  let spawnX = 500;
  let spawnY = 500;
  let validSpawn = false;
  let attempts = 0;
  while (!validSpawn && attempts < 100) {
    spawnX = 100 + Math.random() * (MAP_WIDTH - 200);
    spawnY = 100 + Math.random() * (MAP_HEIGHT - 200);
    let inWall = false;
    for (const wall of activeWalls) {
      if (spawnX > wall.x - minDistToWalls && spawnX < wall.x + wall.w + minDistToWalls &&
          spawnY > wall.y - minDistToWalls && spawnY < wall.y + wall.h + minDistToWalls) {
        inWall = true;
        break;
      }
    }
    if (!inWall) validSpawn = true;
    attempts++;
  }
  return { x: spawnX, y: spawnY };
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
  
  for (const wall of activeWalls) {
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
    for (const wall of activeWalls) {
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

function getPlayerSpawn(mapDef: MapDefinition): { x: number; y: number } {
  if (mapDef.spawnPoint) {
    if (isValidPlayerSpawnPos(mapDef.spawnPoint.x, mapDef.spawnPoint.y, null, mapDef)) {
      return mapDef.spawnPoint;
    }
    // @ts-ignore
    if (import.meta.env.DEV) console.warn("Fallback: Configured spawnPoint is invalid for map:", mapDef.name);
    return getValidatedFallbackSpawn(mapDef);
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
        return { x: px, y: py };
      }
    }
    
    // deterministic sweep if random fails
    for (let dist = 220; dist <= 320; dist += 20) {
      for (let a = 0; a < 360; a += 15) {
        const angle = a * Math.PI / 180;
        const px = spawner.x + Math.cos(angle) * dist;
        const py = spawner.y + Math.sin(angle) * dist;
        if (isValidPlayerSpawnPos(px, py, spawner, mapDef)) {
          return { x: px, y: py };
        }
      }
    }
  }

  return getValidatedFallbackSpawn(mapDef);
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

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapListRef = useRef<HTMLDivElement>(null);

  const PLAYER_COLORS = [
    { n: '#00f0ff', g: 'rgba(0, 240, 255, 0.4)', name: 'CYAN' },
    { n: '#00ff88', g: 'rgba(0, 255, 136, 0.4)', name: 'GREEN' },
    { n: '#ffcc00', g: 'rgba(255, 204, 0, 0.4)', name: 'YELLOW' },
    { n: '#b500ff', g: 'rgba(181, 0, 255, 0.4)', name: 'PURPLE' },
    { n: '#ff6600', g: 'rgba(255, 102, 0, 0.4)', name: 'ORANGE' }
  ];

  const [playerProfile, setPlayerProfile] = useState<{name: string, colorIdx: number}>({ name: 'PLAYER', colorIdx: 0 });
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyLinkFeedback, setCopyLinkFeedback] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [activeLobbyTab, setActiveLobbyTab] = useState<'invite' | 'players'>('invite');
  const [lobbyPlayers, setLobbyPlayers] = useState<Record<string, { name: string, colorIdx: number, isHost: boolean }>>({});

  const [uiState, setUiState] = useState<{ status: 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY' | 'LOBBY'; score: number; deviceType: 'desktop' | 'mobile'; activeTool: 'weapon' | 'special' | 'build'; blocks: number; spawnersLeft: number; mapId: string; hardMode: boolean; buttonCounters: { special: number; build: number } }>({ status: 'MENU', score: 0, deviceType: 'desktop', activeTool: 'special', blocks: 50, spawnersLeft: 5, mapId: 'medium', hardMode: false, buttonCounters: { special: 0, build: 0 } });
  const uiRef = useRef(uiState);
  uiRef.current = uiState;
  
  const playerProfileRef = useRef(playerProfile);
  playerProfileRef.current = playerProfile;

  const [mpState, setMpState] = useState<{ isConnected: boolean, roomId: string | null, isHost: boolean, joinCode: string, error: string }>({ isConnected: false, roomId: null, isHost: false, joinCode: '', error: '' });
  const mpRef = useRef(mpState);
  mpRef.current = mpState;
  const socketRef = useRef<Socket | null>(null);
  const lastReceivedGameStateTimeRef = useRef<number>(0);
  const triggerEliminationRef = useRef<((x: number, y: number, colorIdx: number, label: string) => void) | null>(null);
  const bannerShowingRef = useRef(false);

  const isMobileRef = useRef(typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent));
  const [confirmResign, setConfirmResign] = useState(false);
  const confirmResignRef = useRef(confirmResign);
  confirmResignRef.current = confirmResign;
  const [isMapSelectOpen, setIsMapSelectOpen] = useState(false);
  const [mpTick, setMpTick] = useState(0);
  const [confirmLeaveMatches, setConfirmLeaveMatches] = useState(false);

  const [bannerState, setBannerState] = useState<{ show: boolean; isLeaving: boolean; mode: 'single' | 'multi' | null }>({
    show: false,
    isLeaving: false,
    mode: null,
  });
  const [bannerCountdown, setBannerCountdown] = useState(3);
  const [flashSpawner, setFlashSpawner] = useState(false);
  const [flashScore, setFlashScore] = useState(false);

  useEffect(() => {
    if (uiState.status === 'PLAYING') {
      const mode = mpState.roomId ? 'multi' : 'single';
      
      // Easy toggle switch for the objective banner pop-up. Change to true to re-enable!
      const enableObjectiveBanner = false;

      if (!enableObjectiveBanner) {
        setBannerState({ show: false, isLeaving: false, mode: null });
        bannerShowingRef.current = false;
        setFlashSpawner(false);
        setFlashScore(false);
        return;
      }

      setBannerState({ show: true, isLeaving: false, mode });
      bannerShowingRef.current = true;
      setBannerCountdown(3);
      setFlashSpawner(false);
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
          setFlashSpawner(true);
          setTimeout(() => setFlashSpawner(false), 2000);
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
      setFlashSpawner(false);
      setFlashScore(false);
    }
  }, [uiState.status, mpState.roomId]);

  const getMultiplayerStandings = () => {
    const list = [];
    const myId = socketRef.current?.id || 'local';

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

    list.sort((a, b) => b.score - a.score);
    const isWholeGameEnded = list.every(p => p.isDead);
    return { list, isWholeGameEnded };
  };

  const getPlayerRank = () => {
    const { list } = getMultiplayerStandings();
    const myId = socketRef.current?.id || 'local';
    const idx = list.findIndex(p => p.id === myId);
    return idx === -1 ? 1 : idx + 1;
  };

  const handleMultiplayerRestart = () => {
    socketRef.current?.emit('start_game', mpRef.current.roomId, {
      mapId: uiState.mapId,
      hardMode: true
    });
    resetGame(isMobileRef.current ? 'mobile' : 'desktop', uiState.mapId, uiState.hardMode);
    setUiState(prev => ({ ...prev, status: 'PLAYING' }));
  };

  // We use a ref for the entire game state to avoid stale closures
  const initialSpawn = useRef({ x: 500, y: 500 }).current;
  const stateRef = useRef({
    player: { x: initialSpawn.x, y: initialSpawn.y, vx: 0, vy: 0, kbvx: 0, kbvy: 0, processedZoneKbs: [] as number[], radius: PLAYER_RADIUS, lastShoot: 0, dash: { active: false, endTime: 0, targetX: 0, targetY: 0, shieldRadius: 60, lastTime: performance.now() - DASH_COOLDOWN, wasReady: true }, build: { active: false, endTime: 0, lastBlockX: 0, lastBlockY: 0, lastTime: performance.now() - BUILD_COOLDOWN }, recentBlocks: [] as { key: string, x: number, y: number, timestamp: number }[] },
    multiplayerPlayers: {} as Record<string, { x: number, y: number, radius: number, isDash: boolean, name?: string, colorIdx?: number, isDead?: boolean, kbvx?: number, kbvy?: number, recentBlocks?: { key: string, x: number, y: number, timestamp: number }[] }>,
    blocks: [] as { x: number; y: number; size: number; createdAt: number, colorIdx?: number }[],
    nextBlockScore: 100,
    bullets: [] as { id?: string; x: number; y: number; dx: number; dy: number; radius: number, isPlayer: boolean, bounceCount: number, spawnTime: number, isNeutral: boolean, ownerId?: string, colorIdx?: number, targetX?: number, targetY?: number, repelMultiplied?: boolean, allowedBlockKeys?: string[], leftBlockKeys?: string[] }[],
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
    hardMode: false,
  });

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
    if (mpRef.current.roomId) {
      socketRef.current?.emit('update_profile', mpRef.current.roomId, {
        name,
        colorIdx
      });
      socketRef.current?.emit('client_action', mpRef.current.roomId, {
        type: 'lobby_update',
        name,
        colorIdx,
        isHost: mpRef.current.isHost
      });
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

  const handleSaveMatch = () => {
    setUiState(prev => ({ ...prev, status: 'PAUSED' }));
    const saveData = {
        ui: uiRef.current,
        state: stateRef.current
    };
    const blob = new Blob([JSON.stringify(saveData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ricochet_save_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const handleLoadMatch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data && data.ui && data.state) {
            setUiState({ ...data.ui, status: 'PAUSED' });
            stateRef.current = data.state;
        }
      } catch (err) {
        alert("Failed to load save file. Corrupt or wrong format.");
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  const createRoom = () => {
    socketRef.current?.emit('create_room', { name: playerProfileRef.current.name }, (res: any) => {
       if (res.roomId) {
           setMpState(prev => ({ ...prev, roomId: res.roomId, isHost: true }));
           setActiveLobbyTab('invite');
           setUiState(prev => ({ ...prev, status: 'LOBBY' }));
       }
    });
  };

  const joinRoom = () => {
    if (!mpRef.current.joinCode) {
      setMpState(prev => ({ ...prev, error: 'Enter a valid code!' }));
      return;
    }
    const cleanRoom = mpRef.current.joinCode.toUpperCase();
    socketRef.current?.emit('join_room', cleanRoom, { name: playerProfileRef.current.name }, (res: any) => {
       if (res.success) {
           setMpState(prev => ({ ...prev, roomId: cleanRoom, isHost: false, error: '' }));
           setActiveLobbyTab('players');
           setUiState(prev => ({ ...prev, status: 'LOBBY' }));

           if (res.colorIdx !== undefined) {
             setPlayerProfile(prev => ({ ...prev, colorIdx: res.colorIdx }));
           }

           // Inform existing players of our profile and ask for theirs
           setTimeout(() => {
             socketRef.current?.emit('client_action', cleanRoom, {
               type: 'lobby_update',
               name: playerProfileRef.current.name,
               colorIdx: res.colorIdx !== undefined ? res.colorIdx : playerProfileRef.current.colorIdx,
               isHost: false
             });
             socketRef.current?.emit('client_action', cleanRoom, {
               type: 'lobby_request_sync'
             });
           }, 200);
       } else {
           setMpState(prev => ({ ...prev, error: res.error || 'Failed to join' }));
       }
    });
  };

  const resetGame = (deviceType?: 'desktop' | 'mobile', mapId?: string, hardMode?: boolean) => {
    const dType = deviceType || uiRef.current.deviceType;
    const selectedMapId = mapId || uiRef.current.mapId;
    const isMultiplayer = !!mpRef.current.roomId;
    const isHardMode = isMultiplayer ? true : (hardMode !== undefined ? hardMode : uiRef.current.hardMode);
    const mapDef = MAPS[selectedMapId] || MAPS.classic_arena;
    activeWalls = mapDef.walls;
    
    const state = stateRef.current;
    state.hardMode = isHardMode;
    state.nextEntityId = 1;
    const spawn = isMultiplayer ? getSafeSpawn(100) : getPlayerSpawn(mapDef);
    state.player.x = spawn.x;
    state.player.y = spawn.y;
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
    for (let i = 0; i < 2; i++) {
      const spawn = getSafeSpawn(60);
      const angle = Math.random() * Math.PI * 2;
      state.bouncers.push({ id: 'b_' + state.nextEntityId++, x: spawn.x, y: spawn.y, dx: Math.cos(angle), dy: Math.sin(angle), size: 1, radius: 24, speed: ENEMY_SPEED + Math.random() * 20, lastDirChange: performance.now(), lastMultiply: performance.now() });
    }
    state.bouncerCapacity = 2;
    state.spawners = mapDef.spawners.map((s: any) => ({ ...s }));
    state.particles = [];
    state.trails = [];
    state.shockwaves = [];
    state.floatingTexts = [];
    state.shake = 0;
    state.lastTime = performance.now();
    state.lastEnemySpawn = performance.now();
    state.enemySpawnRate = 3000;
    state.keys = { w: false, a: false, s: false, d: false };
    state.mouse.down = false;
    state.mouse.justDown = false;
    state.touches.left.active = false;
    state.touches.right.active = false;
    state.touches.tap.active = false;
    
    const uiHardMode = isMultiplayer ? uiRef.current.hardMode : isHardMode;
    const newUi = { status: 'PLAYING' as const, score: 0, deviceType: dType, activeTool: 'special' as const, blocks: 50, spawnersLeft: state.spawners.length, mapId: selectedMapId, hardMode: uiHardMode, buttonCounters: { special: 0, build: 0 } };
    uiRef.current = newUi;
    setUiState(newUi);
  };

  const tryPlaceBuildBlock = useCallback((currentTime: number, gridX: number, gridY: number, cIdx: number) => {
     try {
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
               if (socketRef.current && mpRef.current.roomId && !mpRef.current.isHost) {
                  socketRef.current.emit('client_action', mpRef.current.roomId, { type: 'build_remove', x: gridX, y: gridY });
               }
            }
         }
         
         s.blocks.push({ x: gridX, y: gridY, size: 40, createdAt: currentTime, colorIdx: cIdx });
         if (socketRef.current && mpRef.current.roomId && !mpRef.current.isHost) {
            socketRef.current.emit('client_action', mpRef.current.roomId, { type: 'build', x: gridX, y: gridY, colorIdx: cIdx });
         }
     } catch(e) {
         console.error("Error in tryPlaceBuildBlock:", e);
     }
  }, []);

  const applySpecialAbility = useCallback((x: number, y: number, colorIdx: number, ownerId: string) => {
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

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

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
      setMpState(prev => ({ ...prev, isConnected: true }));
    });

    socket.on('player_joined', (id) => {
      stateRef.current.multiplayerPlayers[id] = { x: stateRef.current.player.x, y: stateRef.current.player.y, radius: PLAYER_RADIUS, isDash: false };
      
      setLobbyPlayers(prev => ({
        ...prev,
        [id]: { name: 'CONNECTING...', colorIdx: 0, isHost: false }
      }));

      socketRef.current?.emit('client_action', mpRef.current.roomId, {
        type: 'lobby_update',
        name: playerProfileRef.current.name,
        colorIdx: playerProfileRef.current.colorIdx,
        isHost: mpRef.current.isHost
      });
    });

    socket.on('player_left', (id) => {
      delete stateRef.current.multiplayerPlayers[id];
      setLobbyPlayers(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    socket.on('lobby_players', (playersList: any[]) => {
      const otherPlayers: Record<string, { name: string, colorIdx: number, isHost: boolean }> = {};
      playersList.forEach((p) => {
        if (p.id === socket.id) {
          // Sync our local profile if changed/assigned by server
          setPlayerProfile(prev => {
            const currentName = prev.name.trim().toUpperCase();
            const shouldUpdateName = !currentName || currentName === 'PLAYER' || currentName === 'HOST';
            return {
              ...prev,
              name: shouldUpdateName ? p.name : prev.name,
              colorIdx: p.colorIdx
            };
          });
          // Also set our local host status directly from server-authoritative list!
          const hostAssigned = p.isHost;
          if (mpRef.current.isHost !== hostAssigned) {
            setMpState(prev => ({ ...prev, isHost: hostAssigned }));
            mpRef.current.isHost = hostAssigned;
          }
        } else {
          otherPlayers[p.id] = {
            name: p.name,
            colorIdx: p.colorIdx,
            isHost: p.isHost
          };
        }
      });
      setLobbyPlayers(otherPlayers);
    });

    socket.on('start_game', (config) => {
      lastReceivedGameStateTimeRef.current = performance.now();
      if (!mpRef.current.isHost) {
        const mapId = config?.mapId || 'medium';
        const hardMode = !!config?.hardMode;
        resetGame(isMobileRef.current ? 'mobile' : 'desktop', mapId, hardMode);
        // setUiState is mostly handled by resetGame, but let's ensure it's PLAYING
        setUiState(prev => ({ ...prev, status: 'PLAYING', mapId, hardMode: prev.hardMode }));
      }
    });

    socket.on('game_state', (state) => {
      lastReceivedGameStateTimeRef.current = performance.now();
      if (!mpRef.current.isHost) {
        // Delta tracking for client-side visual particle effects on death
        const prevEnemies = stateRef.current.enemies || [];
        const prevSpawners = stateRef.current.spawners || [];
        const prevBlocks = stateRef.current.blocks || [];

        stateRef.current.blocks = state.blocks;
        stateRef.current.spawners = state.spawners;

        // Compare and spawn particles local to the client
        const newEnemies = state.enemies || [];
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
            }
          }
        }

        const newBlocks = state.blocks || [];
        if (prevBlocks.length > newBlocks.length) {
          for (const oldBlock of prevBlocks) {
            const stillAlive = newBlocks.some((b: any) => Math.abs(b.x - oldBlock.x) < 5 && Math.abs(b.y - oldBlock.y) < 5);
            if (!stillAlive) {
              spawnParticlesDirect(oldBlock.x, oldBlock.y, '#ffcc00', 15);
            }
          }
        }

        // Client-side smooth coordinates interpolation
        const receivedPlayers = { ...state.multiplayerPlayers, [state.hostId]: state.hostPlayer };
        delete receivedPlayers[socket.id];
        
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

        // Direct dead-reckoned synchronization for enemies, bouncers, and bullets
        stateRef.current.enemies = state.enemies || [];
        stateRef.current.bouncers = state.bouncers || [];
        stateRef.current.zones = state.zones || [];

        // High-fidelity synchronized & reconciled bullet tracking
        const now = performance.now();
        const hostTime = state.hostTime || now;
        const myId = socket.id || socketRef.current?.id || 'local';
        const prevBullets = stateRef.current.bullets || [];

        // Track which local bullets successfully matched an incoming packet
        const matchedLocalIds = new Set<string>();

        const incomingBullets = (state.bullets || []).map((ib: any) => {
          // Calculate the relative age of the bullet on the host
          const age = Math.max(0, hostTime - ib.spawnTime);
          // Map to local timeline so that timeAlive aligns perfectly with local performance.now()
          const mappedSpawnTime = now - age;

          // Reconcile client's own local pre-spawns, or any already active/predicted bullet, to prevent snapping or micro-jitters
          const matchedLocal = prevBullets.find((pb: any) => 
            pb.id && (
              (pb.id === ib.id && Math.sqrt((pb.x - ib.x) ** 2 + (pb.y - ib.y) ** 2) < 150) ||
              (ib.ownerId === myId && pb.id.toString().startsWith('local_') &&
               Math.abs(pb.dx - ib.dx) < 1 &&
               Math.abs(pb.dy - ib.dy) < 1 &&
               Math.sqrt((pb.x - ib.x) ** 2 + (pb.y - ib.y) ** 2) < 250)
            )
          );

          if (matchedLocal && matchedLocal.id) {
            matchedLocalIds.add(matchedLocal.id);
            return {
              ...ib,
              x: matchedLocal.x,
              y: matchedLocal.y,
              spawnTime: matchedLocal.spawnTime
            };
          }

          return {
            ...ib,
            spawnTime: mappedSpawnTime
          };
        });

        // Retain fresh unmatched local-only bullets so they fly smoothly until acknowledged
        const unmatchedLocals = prevBullets.filter((pb: any) => 
          pb.id && pb.id.toString().startsWith('local_') && 
          (now - pb.spawnTime < 500) &&
          !matchedLocalIds.has(pb.id)
        );

        stateRef.current.bullets = [...incomingBullets, ...unmatchedLocals];
        
        if (uiRef.current.status === 'PLAYING') {
          const myId = socketRef.current?.id;
          const targetScore = (myId && state.multiplayerPlayers[myId] !== undefined)
            ? (state.multiplayerPlayers[myId].score || 0)
            : uiRef.current.score;

          if (state.spawnersLeft === 0) {
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
      }
    });

    socket.on('client_input', (clientId, input) => {
      if (mpRef.current.isHost) {
        const prev = stateRef.current.multiplayerPlayers[clientId];
        if (prev && !prev.isDead && input.isDead) {
          triggerEliminationRef.current?.(input.x, input.y, input.colorIdx !== undefined ? input.colorIdx : 0, input.name || 'PLAYER');
        }
        const mergedInput = { ...input };
        if (prev && prev.score > (input.score || 0)) {
          mergedInput.score = prev.score;
        }
        stateRef.current.multiplayerPlayers[clientId] = mergedInput;
        setMpTick(t => t + 1);
      }
    });

    socket.on('client_action', (clientId, action) => {
       if (action.type === 'lobby_update') {
         setLobbyPlayers(prev => ({
           ...prev,
           [clientId]: {
             name: action.name,
             colorIdx: action.colorIdx,
             isHost: action.isHost || false
           }
         }));
       } else if (action.type === 'lobby_request_sync') {
         socketRef.current?.emit('client_action', mpRef.current.roomId, {
           type: 'lobby_update',
           name: playerProfileRef.current.name,
           colorIdx: playerProfileRef.current.colorIdx,
           isHost: mpRef.current.isHost
         });
       } else if (mpRef.current.isHost) {
         if (action.type === 'shoot') {
              const clientAllowedKeys: string[] = [];
              const clientPlayer = stateRef.current.multiplayerPlayers[clientId];
              if (clientPlayer && clientPlayer.recentBlocks) {
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

              stateRef.current.bullets.push({
                id: 'bl_' + stateRef.current.nextEntityId++,
                x: action.x,
                y: action.y,
                dx: action.dx,
                dy: action.dy,
                radius: BULLET_RADIUS,
                isPlayer: true,
                bounceCount: 0,
                spawnTime: performance.now(),
                isNeutral: false,
                ownerId: clientId,
                colorIdx: action.colorIdx,
                allowedBlockKeys: clientAllowedKeys,
                leftBlockKeys: []
              });
         } else if (action.type === 'special') {
             applySpecialAbility(action.x, action.y, action.colorIdx, clientId);
         } else if (action.type === 'build') {
             stateRef.current.blocks.push({
                 x: action.x,
                 y: action.y,
                 size: 40,
                 createdAt: performance.now(),
                 colorIdx: action.colorIdx
             });
             if (mpRef.current.isHost) {
                 for (let i = stateRef.current.bullets.length - 1; i >= 0; i--) {
                    const b = stateRef.current.bullets[i];
                    if (b.x > action.x - 20 && b.x < action.x + 20 && b.y > action.y - 20 && b.y < action.y + 20) {
                       stateRef.current.bullets.splice(i, 1);
                    }
                 }
             }
         } else if (action.type === 'build_remove') {
             const idx = stateRef.current.blocks.findIndex(b => b.x === action.x && b.y === action.y);
             if (idx !== -1) {
                 stateRef.current.blocks.splice(idx, 1);
             }
         }
       }
    });

    return () => {

      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (mpState.isConnected) {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room') || params.get('join');
      if (roomParam) {
        const cleanRoom = roomParam.trim().toUpperCase();
        
        // Show status LOBBY immediately and set state to show join attempt
        setUiState(prev => ({ ...prev, status: 'LOBBY' }));
        setMpState(prev => ({ 
          ...prev, 
          joinCode: cleanRoom, 
          error: 'Autoconnecting to room...' 
        }));

        // Clean up URL query parameters so manual refresh doesn't force re-joining
        if (window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Emit room join to server
        socketRef.current?.emit('join_room', cleanRoom, { name: playerProfileRef.current.name }, (res: any) => {
          if (res.success) {
            setMpState(prev => ({ ...prev, roomId: cleanRoom, joinCode: cleanRoom, isHost: false, error: '' }));
            setActiveLobbyTab('players');

            if (res.colorIdx !== undefined) {
              setPlayerProfile(prev => ({ ...prev, colorIdx: res.colorIdx }));
            }

            // Inform existing players of our profile and ask for theirs
            setTimeout(() => {
              socketRef.current?.emit('client_action', cleanRoom, {
                type: 'lobby_update',
                name: playerProfileRef.current.name,
                colorIdx: res.colorIdx !== undefined ? res.colorIdx : playerProfileRef.current.colorIdx,
                isHost: false
              });
              socketRef.current?.emit('client_action', cleanRoom, {
                type: 'lobby_request_sync'
              });
            }, 300);
          } else {
            setMpState(prev => ({ ...prev, joinCode: cleanRoom, error: res.error || 'Failed to auto-join room' }));
          }
        });
      }
    }
  }, [mpState.isConnected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const state = stateRef.current;

    const handleResize = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w;
      canvas.height = h;
      state.camera.width = w;
      state.camera.height = h;
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

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') state.keys.w = true;
      if (key === 'a') state.keys.a = true;
      if (key === 's') state.keys.s = true;
      if (key === 'd') state.keys.d = true;
      
      const currentTime = performance.now();
      
      if (key === '1') {
         if (uiRef.current.status === 'PLAYING') {
            const dash = stateRef.current.player.dash;
            const endTime = dash.endTime || 0;
            if (!dash.active && (endTime === 0 || currentTime - endTime >= DASH_COOLDOWN)) {
               dash.active = true;
               dash.endTime = currentTime + 6000;
               dash.lastTime = currentTime;
               
               const isHostMode = !mpRef.current.roomId || mpRef.current.isHost;
               const finalX = stateRef.current.player.x;
               const finalY = stateRef.current.player.y;
               
               if (isHostMode) {
                 const cIdx = playerProfileRef.current.colorIdx;
                 applySpecialAbility(finalX, finalY, cIdx, 'local');
               } else {
                 socketRef.current?.emit('client_action', mpRef.current.roomId, { type: 'special', x: finalX, y: finalY, colorIdx: playerProfileRef.current.colorIdx });
                 applySpecialAbility(finalX, finalY, playerProfileRef.current.colorIdx, socketRef.current?.id || 'local');
               }
            }
         }
      }
      if (key === '2') {
         if (!stateRef.current.player.build.active && (stateRef.current.player.build.endTime === 0 || currentTime - stateRef.current.player.build.endTime >= BUILD_COOLDOWN)) {
            stateRef.current.player.build.active = true;
            stateRef.current.player.build.endTime = currentTime + 8000;
            stateRef.current.player.build.lastTime = currentTime;
            const gridX = Math.round(stateRef.current.player.x / 40) * 40;
            const gridY = Math.round(stateRef.current.player.y / 40) * 40;
            stateRef.current.player.build.lastBlockX = gridX;
            stateRef.current.player.build.lastBlockY = gridY;
            const cIdx = playerProfileRef.current.colorIdx;
            tryPlaceBuildBlock(currentTime, gridX, gridY, cIdx);
         }
      }
      if (key === 'escape') {
        if (uiRef.current.status === 'PAUSED' && confirmResignRef.current) return;
        setUiState(prev => {
           let newStatus = prev.status;
           if (prev.status === 'PLAYING') newStatus = 'PAUSED';
           else if (prev.status === 'PAUSED') newStatus = 'PLAYING';
           
           if (newStatus !== prev.status) {
             uiRef.current = { ...prev, status: newStatus };
             return uiRef.current;
           }
           return prev;
        });
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
      if (e.target !== canvas) return;
      if (uiRef.current.status !== 'PLAYING') return;
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
      if (uiRef.current.status !== 'PLAYING') return; // let normal touches pass
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const isMobile = uiRef.current.deviceType === 'mobile';
      
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;
        
        if (isMobile) {
          const leftJoyX = 80;
          const leftJoyY = canvas.height - 160;
          const rightJoyX = canvas.width - 80;
          const rightJoyY = canvas.height - 160;
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
      e.preventDefault();
      const isMobile = uiRef.current.deviceType === 'mobile';
      const rect = canvas.getBoundingClientRect();
      const maxDist = 40;
      const leftJoyX = 80;
      const leftJoyY = canvas.height - 160;
      const rightJoyX = canvas.width - 80;
      const rightJoyY = canvas.height - 160;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;
        
        if (state.touches.left.active && t.identifier === state.touches.left.id) {
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
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (uiRef.current.status !== 'PLAYING') return;
      e.preventDefault();
      const isMobile = uiRef.current.deviceType === 'mobile';
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (state.touches.left.active && t.identifier === state.touches.left.id) {
          state.touches.left.active = false;
          if (isMobile) {
            state.touches.left.currentX = state.touches.left.startX;
            state.touches.left.currentY = state.touches.left.startY;
          }
        }
        if (state.touches.right.active && t.identifier === state.touches.right.id) {
          state.touches.right.justReleased = true;
          state.touches.right.releaseDx = state.touches.right.currentX - state.touches.right.startX;
          state.touches.right.releaseDy = state.touches.right.currentY - state.touches.right.startY;
          state.touches.right.active = false;
          if (isMobile) {
            state.touches.right.currentX = state.touches.right.startX;
            state.touches.right.currentY = state.touches.right.startY;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    const triggerEliminationAnimation = (x: number, y: number, colorIdx: number, label: string) => {
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
      if (!stateRef.current.floatingTexts) {
        stateRef.current.floatingTexts = [];
      }
      stateRef.current.floatingTexts.push({
        x,
        y: y - 10,
        text: label.toUpperCase(),
        age: 0,
        maxAge: 1.5,
        color: pColor,
        vy: -45
      });
    };
    triggerEliminationRef.current = triggerEliminationAnimation;

    let animationFrameId: number;
    let lastStatus = uiRef.current.status;

    const gameLoop = (currentTime: number) => {
      const dt = Math.min((currentTime - state.lastTime) / 1000, 0.1); // cap dt at 100ms to prevent glitches
      state.lastTime = currentTime;

      const STATUS = uiRef.current.status;
      if (lastStatus === 'PLAYING' && STATUS === 'GAME_OVER') {
        const myColorIdx = playerProfileRef.current.colorIdx;
        const myName = playerProfileRef.current.name || 'YOU';
        triggerEliminationAnimation(state.player.x, state.player.y, myColorIdx, `${myName} ELIMINATED`);
      }
      lastStatus = STATUS;
      const shouldRunUpdates = (STATUS === 'PLAYING' && !bannerShowingRef.current) || (STATUS === 'GAME_OVER' && mpRef.current.isConnected && mpRef.current.roomId && mpRef.current.isHost);

      // Auto Host-Migration claiming protocol
      if (
        mpRef.current.isConnected &&
        mpRef.current.roomId &&
        !mpRef.current.isHost &&
        (STATUS === 'PLAYING' || STATUS === 'GAME_OVER')
      ) {
        if (currentTime - lastReceivedGameStateTimeRef.current > 1500) {
          lastReceivedGameStateTimeRef.current = currentTime; // throttle requests
          console.log("No update from host received, claiming host status.");
          socketRef.current?.emit('claim_host', mpRef.current.roomId);
        }
      }

      // Direct high-performance input/status sync (runs even when client status is GAME_OVER)
      if (currentTime - state.lastBroadcastTime > 16 && mpRef.current.isConnected && mpRef.current.roomId && !mpRef.current.isHost && (STATUS === 'PLAYING' || STATUS === 'GAME_OVER')) {
        state.lastBroadcastTime = currentTime;
        socketRef.current?.emit('client_input', mpRef.current.roomId, {
          x: state.player.x,
          y: state.player.y,
          radius: state.player.radius,
          isDash: state.player.dash.active,
          isDead: STATUS === 'GAME_OVER',
          name: playerProfileRef.current.name,
          colorIdx: playerProfileRef.current.colorIdx,
          score: uiRef.current.score
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

        // Smooth client-side coordinates interpolation for remote players
        if (!mpRef.current.isHost) {
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

            // 3. Move Bullets and spawn local visual trails
            for (const bullet of state.bullets) {
              let speedMultiplier = 1;
              const timeAlive = currentTime - bullet.spawnTime;
              if (bullet.isPlayer && timeAlive < 250) {
                speedMultiplier = 3.5;
              }
              bullet.x += bullet.dx * speedMultiplier * dt;
              bullet.y += bullet.dy * speedMultiplier * dt;

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
        if (STATUS === 'PLAYING') {
          if (state.player.dash.active && currentTime >= state.player.dash.endTime) {
            state.player.dash.active = false;
          }

          let moveX = 0;
          let moveY = 0;
          if (state.keys.w) moveY -= 1;
          if (state.keys.s) moveY += 1;
          if (state.keys.a) moveX -= 1;
          if (state.keys.d) moveX += 1;

          if (state.touches.left.active) {
            moveX += state.touches.left.dirX;
            moveY += state.touches.left.dirY;
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
        const myId = mpRef.current.roomId ? socketRef.current?.id : 'local';
        if (!state.player.processedZoneKbs) {
           state.player.processedZoneKbs = [];
        }
        for (const zone of state.zones) {
           if (zone.ownerId !== myId && zone.ownerId !== 'local') {
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
        if (state.player.build.active) {
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
        for (const wall of activeWalls) {
          const closestX = clamp(state.player.x, wall.x, wall.x + wall.w);
          const closestY = clamp(state.player.y, wall.y, wall.y + wall.h);

          const distX = state.player.x - closestX;
          const distY = state.player.y - closestY;
          const distXSquare = distX * distX;
          const distYSquare = distY * distY;
          const distSq = distXSquare + distYSquare;

          if (distSq < state.player.radius * state.player.radius) {
            const dist = Math.sqrt(distSq);
            if (dist > 0) {
              const overlap = state.player.radius - dist;
              state.player.x += (distX / dist) * overlap;
              state.player.y += (distY / dist) * overlap;
            }
          }
        }

        state.player.x = clamp(state.player.x, state.player.radius, MAP_WIDTH - state.player.radius);
        state.player.y = clamp(state.player.y, state.player.radius, MAP_HEIGHT - state.player.radius);

        // Local player instant death trigger checks (runs in ALL modes: Solo, Host, and Client)
        if (uiRef.current.status === 'PLAYING') {
          const localColorIdx = playerProfileRef.current.colorIdx;
          const localColor = PLAYER_COLORS[localColorIdx]?.n || '#00f0ff';

          // 1. Collide with Enemies (state.enemies)
          if (!state.player.dash.active) {
            for (const enemy of state.enemies) {
              const dx = state.player.x - enemy.x;
              const dy = state.player.y - enemy.y;
              if (dx * dx + dy * dy < (state.player.radius + enemy.radius) ** 2) {
                spawnParticles(state.player.x, state.player.y, localColor, 50);
                state.shake = 20;
                setUiState(prev => {
                  uiRef.current = { ...prev, status: 'GAME_OVER' };
                  return uiRef.current;
                });
                break;
              }
            }
          }

          // 2. Collide with Bouncers (state.bouncers)
          if (uiRef.current.status === 'PLAYING' && !state.player.dash.active) {
            for (const b of state.bouncers) {
              const pdx = state.player.x - b.x;
              const pdy = state.player.y - b.y;
              if (pdx * pdx + pdy * pdy < (state.player.radius + b.radius) ** 2) {
                spawnParticles(state.player.x, state.player.y, localColor, 50);
                state.shake = 20;
                setUiState(prev => {
                  uiRef.current = { ...prev, status: 'GAME_OVER' };
                  return uiRef.current;
                });
                break;
              }
            }
          }

          // 3. Collide with Spawner Orbiting Special Obstacles (Shield, Kinetic, Singularity, Magma gates, Crystal)
          if (uiRef.current.status === 'PLAYING' && !state.player.dash.active) {
            for (const spawner of state.spawners) {
              if (spawner.specialType) {
                const collision = getBulletRelicCollision(state.player.x, state.player.y, state.player.radius, spawner, currentTime);
                if (collision) {
                  spawnParticles(state.player.x, state.player.y, localColor, 50);
                  state.shake = 20;
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
          if (uiRef.current.status === 'PLAYING') {
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
                  spawnParticles(state.player.x, state.player.y, localColor, 50);
                  state.shake = 20;
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
          
          let effectiveRate = state.enemySpawnRate;
          if (state.hardMode) {
            // Hard Mode: Total spawn rate does not diminish when spawners are destroyed.
            // Spawning interval remains constant relative to initial (distributes across survivors).
            effectiveRate = state.enemySpawnRate;
          } else {
            // Normal Mode: Spawning slows down as spawners are destroyed
            effectiveRate = state.enemySpawnRate * (initialSpawners / state.spawners.length);
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
            const nowTime = performance.now();
            enemy.processedZoneKbs = enemy.processedZoneKbs.filter((t: number) => nowTime - t < 10000);
          }

          let moveX = 0;
          let moveY = 0;
          if (dist > 0) {
            moveX = (dx / dist) * enemy.speed;
            moveY = (dy / dist) * enemy.speed;
          }

          const kbvx = enemy.kbvx || 0;
          const kbvy = enemy.kbvy || 0;
          enemy.x += (moveX + kbvx) * dt;
          enemy.y += (moveY + kbvy) * dt;

          enemy.kbvx = kbvx * Math.exp(-8 * dt);
          enemy.kbvy = kbvy * Math.exp(-8 * dt);
          if (Math.abs(enemy.kbvx) < 1) enemy.kbvx = 0;
          if (Math.abs(enemy.kbvy) < 1) enemy.kbvy = 0;

          // Enemy Wall Collisions
          for (const wall of activeWalls) {
            const closestX = clamp(enemy.x, wall.x, wall.x + wall.w);
            const closestY = clamp(enemy.y, wall.y, wall.y + wall.h);

            const vDistX = enemy.x - closestX;
            const vDistY = enemy.y - closestY;
            const distSq = vDistX * vDistX + vDistY * vDistY;

            if (distSq < enemy.radius * enemy.radius) {
              const cDist = Math.sqrt(distSq);
              if (cDist > 0) {
                const overlap = enemy.radius - cDist;
                enemy.x += (vDistX / cDist) * overlap;
                enemy.y += (vDistY / cDist) * overlap;
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
            const nowTime = performance.now();
            b.processedZoneKbs = b.processedZoneKbs.filter((t: number) => nowTime - t < 10000);
          }

          const kbvx = b.kbvx || 0;
          const kbvy = b.kbvy || 0;
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
          for (const wall of activeWalls) {
            const closestX = clamp(b.x, wall.x, wall.x + wall.w);
            const closestY = clamp(b.y, wall.y, wall.y + wall.h);
            const distX = b.x - closestX;
            const distY = b.y - closestY;
            const dist = Math.sqrt(distX * distX + distY * distY);
            if (dist < b.radius) {
              if (Math.abs(b.x - closestX) >= Math.abs(b.y - closestY)) {
                  b.dx *= -1;
              } else {
                  b.dy *= -1;
              }
              const overlap = b.radius - dist;
              if (dist > 0) {
                  b.x += (distX / dist) * overlap;
                  b.y += (distY / dist) * overlap;
              }
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

          // Collision with Player
          if (uiRef.current.status === 'PLAYING') {
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
              } else {
                const localColorIdx = playerProfileRef.current.colorIdx;
                const localColor = PLAYER_COLORS[localColorIdx]?.n || '#00f0ff';
                spawnParticles(state.player.x, state.player.y, localColor, 50);
                state.shake = 20;
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

        if (isShooting && currentTime - state.player.lastShoot > FIRE_RATE) {
          state.player.lastShoot = currentTime;
          
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

          // Spawn bullet locally first for immediate visual feedback
          state.bullets.push({
            id: mpRef.current.roomId && !mpRef.current.isHost ? 'local_' + Math.random() : 'bh_' + state.nextEntityId++,
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

          // In multiplayer client mode, also notify the host to create the authoritative bullet
          if (mpRef.current.roomId && !mpRef.current.isHost) {
            socketRef.current?.emit('client_action', mpRef.current.roomId, { type: 'shoot', x: state.player.x, y: state.player.y, dx: bvx, dy: bvy, colorIdx: playerProfileRef.current.colorIdx });
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
             if (zone.ownerId === 'local') {
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
        for (let i = state.bullets.length - 1; i >= 0; i--) {
          const bullet = state.bullets[i];
          const prevX = bullet.x;
          const prevY = bullet.y;

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

          bullet.x += bullet.dx * speedMultiplier * dt;
          bullet.y += bullet.dy * speedMultiplier * dt;

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

          // Wall Collisions
          for (const wall of activeWalls) {
            const closestX = clamp(bullet.x, wall.x, wall.x + wall.w);
            const closestY = clamp(bullet.y, wall.y, wall.y + wall.h);

            const distX = bullet.x - closestX;
            const distY = bullet.y - closestY;
            const distSq = distX * distX + distY * distY;

            if (distSq < bullet.radius * bullet.radius) {
              const dist = Math.sqrt(distSq);
              if (dist > 0) {
                const overlap = bullet.radius - dist;
                const nx = distX / dist;
                const ny = distY / dist;

                bullet.x += nx * overlap;
                bullet.y += ny * overlap;

                const dot = bullet.dx * nx + bullet.dy * ny;
                bullet.dx = bullet.dx - 2 * dot * nx;
                bullet.dy = bullet.dy - 2 * dot * ny;
                bullet.bounceCount++;
                bullet.isNeutral = true;
                const pColor = bullet.isNeutral ? '#aaaaaa' : (!bullet.isPlayer ? '#ff0066' : '#00ccff');
                spawnParticles(bullet.x, bullet.y, pColor, 5);
              } else {
                bullet.dx *= -1;
                bullet.dy *= -1;
                bullet.bounceCount++;
                bullet.isNeutral = true;
                const pColor = bullet.isNeutral ? '#aaaaaa' : (!bullet.isPlayer ? '#ff0066' : '#00ccff');
                spawnParticles(bullet.x, bullet.y, pColor, 5);
              }
            }
          }

          // Special Relic Collisions
          for (const spawner of state.spawners) {
            if (spawner.specialType) {
              const collision = getBulletRelicCollision(bullet.x, bullet.y, bullet.radius, spawner, currentTime);
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

          let bulletDestroyed = false;

          if (bulletDestroyed) {
             state.bullets.splice(i, 1);
             continue;
          }

          // Block Collisions
          if (!bulletDestroyed) {
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
              if (dx * dx + dy * dy < (bouncer.radius + bullet.radius) ** 2) {
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
              if (dx * dx + dy * dy < (enemy.radius + bullet.radius) ** 2) {
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
                      let gainedBlocks = false;
                      while (newScore >= state.nextBlockScore) {
                        newBlocks++;
                        state.nextBlockScore += 100;
                        gainedBlocks = true;
                      }
                      if (gainedBlocks) {
                        const buildBtn = document.getElementById('tool-btn-build');
                        if (buildBtn) {
                          buildBtn.animate([
                            { transform: 'scale(1)', boxShadow: '0 0 0px #ffcc00' },
                            { transform: 'scale(1.1)', boxShadow: '0 0 30px #ffcc00' },
                            { transform: 'scale(1)', boxShadow: '0 0 0px #ffcc00' }
                          ], { duration: 400, easing: 'ease-out' });
                        }
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
              if (dx * dx + dy * dy < (spawner.radius + bullet.radius) ** 2) {
                spawner.hp -= 20; // 5 hits to destroy (100 HP)
                spawnParticles(bullet.x, bullet.y, '#ffffff', 10);
                bulletDestroyed = true;
                
                if (spawner.hp <= 0) {
                  const spawnerColor = state.hardMode ? '#ff3300' : '#ff00ff';
                  spawnParticles(spawner.x, spawner.y, spawnerColor, 100);
                  state.shockwaves.push({ x: spawner.x, y: spawner.y, color: spawnerColor, maxRadius: 200, age: 0, maxAge: 0.5, thickness: 20 });
                  state.shake = 30;
                  state.spawners.splice(s, 1);
                  let pts = 0;
                  if (bullet.isPlayer && !bullet.isNeutral) pts = 1000;
                  
                  const bOwner = bullet.ownerId || 'local';
                  const hostId = socketRef.current?.id || 'local';
                  if (bOwner === hostId || bOwner === 'local') {
                    setUiState(prev => {
                      const newScore = prev.score + pts;
                      let newBlocks = prev.blocks + 3; // Bonus blocks
                      uiRef.current = { ...prev, score: newScore, blocks: newBlocks, spawnersLeft: state.spawners.length };
                      // Check win condition
                      if (state.spawners.length === 0) {
                         uiRef.current.status = 'VICTORY';
                      }
                      return uiRef.current;
                    });
                  } else if (state.multiplayerPlayers[bOwner]) {
                    state.multiplayerPlayers[bOwner].score = (state.multiplayerPlayers[bOwner].score || 0) + pts;
                    if (state.spawners.length === 0) {
                      uiRef.current.status = 'VICTORY';
                      setUiState(prev => ({ ...prev, status: 'VICTORY', spawnersLeft: 0 }));
                    }
                  }
                }
                break;
              }
            }
          }

          // Check hit Player (host local player avatar)
          if (!bulletDestroyed) {
            const hostColorIdx = playerProfileRef.current.colorIdx;
            const hostColor = PLAYER_COLORS[hostColorIdx]?.n || '#00f0ff';

            if (bulletColor !== hostColor) {
              const dx = state.player.x - bullet.x;
              const dy = state.player.y - bullet.y;
              const isProtected = state.player.dash.active;
              if (!isProtected && dx * dx + dy * dy < (state.player.radius + bullet.radius * 0.5) ** 2) {
                // Game Over!
                spawnParticles(state.player.x, state.player.y, hostColor, 50);
                state.shake = 20;
                setUiState(prev => {
                  uiRef.current = { ...prev, status: 'GAME_OVER' };
                  return uiRef.current;
                });
                bulletDestroyed = true;
              }
            }
          }

          // Check hit Remote Players (multiplayer players tracked by host)
          if (!bulletDestroyed) {
            for (const pid in state.multiplayerPlayers) {
              const mpPlayer = state.multiplayerPlayers[pid];
              if (mpPlayer && !mpPlayer.isDead) {
                const mpColorIdx = mpPlayer.colorIdx;
                const mpColor = PLAYER_COLORS[mpColorIdx]?.n || '#00f0ff';

                if (bulletColor !== mpColor) {
                  const dx = mpPlayer.x - bullet.x;
                  const dy = mpPlayer.y - bullet.y;
                  const isProtected = mpPlayer.isDash;
                  if (!isProtected && dx * dx + dy * dy < (mpPlayer.radius + bullet.radius * 0.5) ** 2) {
                    // Explode bullet on hit, remote player triggers death locally based on color sync
                    spawnParticles(mpPlayer.x, mpPlayer.y, mpColor, 50);
                    bulletDestroyed = true;
                    break;
                  }
                }
              }
            }
          }

          if (bulletDestroyed) {
             state.bullets.splice(i, 1);
          }
        }

        } // End of Host ONLY logic
      } // End of shouldRunUpdates (particles, trails, shockwaves, floating text always update)

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

      // Host broadcasts state
      if (mpRef.current.isConnected && mpRef.current.roomId && mpRef.current.isHost && (STATUS === 'PLAYING' || STATUS === 'GAME_OVER')) {
          if (currentTime - state.lastBroadcastTime > 50) {
              state.lastBroadcastTime = currentTime;
              socketRef.current?.emit('host_game_state', mpRef.current.roomId, {
                hostId: socketRef.current?.id,
                hostPlayer: { ...state.player, isDead: STATUS === 'GAME_OVER', name: playerProfileRef.current.name, colorIdx: playerProfileRef.current.colorIdx, score: uiRef.current.score },
                multiplayerPlayers: state.multiplayerPlayers,
                blocks: state.blocks,
                bullets: state.bullets,
                enemies: state.enemies,
                spawners: state.spawners,
                bouncers: state.bouncers,
                zones: state.zones,
                particles: [],
                trails: [],
                shockwaves: [],
                score: uiRef.current.score,
                spawnersLeft: uiRef.current.spawnersLeft,
                blocksLeft: uiRef.current.blocks,
                cameraZ: state.camera.z,
                hostTime: currentTime
              });
          }
      }

      // --- RENDERING --- (Always render, even if GAME_OVER)
      
      // Update Camera based on player (or keep it still if dead)
      state.shake = Math.max(0, state.shake - dt * 60);
      const shakeX = (Math.random() - 0.5) * state.shake;
      const shakeY = (Math.random() - 0.5) * state.shake;

      state.camera.x = state.player.x - state.camera.width / 2 + shakeX;
      state.camera.y = state.player.y - state.camera.height / 2 + shakeY;
      state.camera.x = clamp(state.camera.x, 0, Math.max(0, MAP_WIDTH - state.camera.width));
      state.camera.y = clamp(state.camera.y, 0, Math.max(0, MAP_HEIGHT - state.camera.height));

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
          ctx.rotate(-currentTime * 0.001);
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
          ctx.rotate(currentTime * 0.0015);
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
          ctx.rotate(currentTime * 0.002);
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
          ctx.arc(0, 0, 20 + Math.sin(currentTime * 0.01) * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else if (spawner.specialType === 'magma_gates') {
          ctx.save();
          ctx.translate(spawner.x, spawner.y);

          const orbitAngle = currentTime * 0.0008;
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
          ctx.rotate(currentTime * 0.0006);
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
        const pulse = Math.sin(currentTime / (200 / spawnerSpeedScale)) * 5;
        const glowColor = state.hardMode ? '#ff3300' : '#ff00ff';
        const fillGlow = state.hardMode ? 'rgba(255, 51, 0, 0.15)' : 'rgba(255, 0, 255, 0.15)';
        ctx.fillStyle = fillGlow;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(spawner.x, spawner.y, spawner.radius * 1.8 + pulse, 0, Math.PI * 2);
        ctx.fill();
        
        // Hexagon shape
        ctx.shadowBlur = 10;
        ctx.fillStyle = state.hardMode ? '#2a0500' : '#1a001a';
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const hexRot = currentTime / (1500 / spawnerSpeedScale);
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
        const corePulse = Math.sin(currentTime / (150 / spawnerSpeedScale)) * 3;
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(spawner.x, spawner.y, spawner.radius * 0.4 + corePulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

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
        const age = performance.now() - zone.spawnTime;
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

        const ageMs = performance.now() - (block.createdAt || performance.now());
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

      // Draw off-screen indicators for other players in multiplayer
      if (uiRef.current.status === 'PLAYING' && mpRef.current.roomId) {
        const localId = socketRef.current?.id || 'local';
        const isMobile = uiRef.current.deviceType === 'mobile';
        
        // Invisible screen-area box: adjusted to be larger while avoiding overlapping UI elements
        const boxMarginLeft = isMobile ? 45 : 35;
        const boxMarginRight = isMobile ? 45 : 35;
        const boxMarginTop = 85; 
        const boxMarginBottom = isMobile ? 135 : 45; 

        const boxX1 = boxMarginLeft;
        const boxY1 = boxMarginTop;
        const boxX2 = canvas.width - boxMarginRight;
        const boxY2 = canvas.height - boxMarginBottom;

        // Anchor point is the absolute center of the viewport/player screen
        const anchorX = canvas.width / 2;
        const anchorY = canvas.height / 2;

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
            const dx = screenOtherX - anchorX;
            const dy = screenOtherY - anchorY;
            const angle = Math.atan2(dy, dx);

            let ix = screenOtherX;
            let iy = screenOtherY;

            if (dx !== 0 || dy !== 0) {
              let tMin = Infinity;

              // Left boundary
              if (dx < 0) {
                const t = (boxX1 - anchorX) / dx;
                if (t >= 0 && t < tMin) tMin = t;
              }
              // Right boundary
              if (dx > 0) {
                const t = (boxX2 - anchorX) / dx;
                if (t >= 0 && t < tMin) tMin = t;
              }
              // Top boundary
              if (dy < 0) {
                const t = (boxY1 - anchorY) / dy;
                if (t >= 0 && t < tMin) tMin = t;
              }
              // Bottom boundary
              if (dy > 0) {
                const t = (boxY2 - anchorY) / dy;
                if (t >= 0 && t < tMin) tMin = t;
              }

              if (tMin !== Infinity) {
                ix = anchorX + dx * tMin;
                iy = anchorY + dy * tMin;
              }
            }

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

      // Draw UI over canvas (Joysticks)
      if (uiRef.current.status === 'PLAYING' && uiRef.current.deviceType === 'mobile') {
        const leftJoyX = 80;
        const leftJoyY = canvas.height - 160;
        const rightJoyX = canvas.width - 80;
        const rightJoyY = canvas.height - 160;
        
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
      let specialCooldown = 0;
      const now = performance.now();
      if (state.player.dash.active) {
         specialCooldown = Math.max(0, Math.ceil((state.player.dash.endTime - now) / 1000));
      } else if (state.player.dash.endTime > 0) {
         specialCooldown = Math.max(0, Math.ceil((DASH_COOLDOWN - (now - state.player.dash.endTime)) / 1000));
      } else {
         specialCooldown = Math.max(0, Math.ceil((DASH_COOLDOWN - (now - state.player.dash.lastTime)) / 1000));
      }
      
      let buildCooldown = 0;
      if (state.player.build.active) {
         buildCooldown = Math.max(0, Math.ceil((state.player.build.endTime - now) / 1000));
      } else if (state.player.build.endTime > 0) {
         buildCooldown = Math.max(0, Math.ceil((BUILD_COOLDOWN - (now - state.player.build.endTime)) / 1000));
      }

      if (uiRef.current.buttonCounters.special !== specialCooldown || uiRef.current.buttonCounters.build !== buildCooldown) {
         setUiState(prev => {
           uiRef.current = { ...prev, buttonCounters: { special: specialCooldown, build: buildCooldown } };
           return uiRef.current;
         });
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
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);
      }
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const menuScale = Math.max(0.45, Math.min(1.4, Math.min(containerSize.width / 460, containerSize.height / 710)));
  const mapScale = Math.max(0.45, Math.min(1.15, Math.min(containerSize.width / 950, containerSize.height / 710)));

  return (
    <div ref={wrapperRef} className="w-full h-full relative overflow-hidden bg-[#050508] font-mono select-none">
      <div className="absolute inset-0 pointer-events-none z-[60] opacity-[0.1]" style={{
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 4px)`
      }} />
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
            className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm z-[70] pointer-events-auto"
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
                      onClick={() => setUiState(prev => ({ ...prev, hardMode: !prev.hardMode }))}
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
                      resetGame(isMobileRef.current ? 'mobile' : 'desktop');
                    }}
                    className="w-full py-3 sm:py-4 bg-[#00f0ff] hover:bg-white text-black border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-base sm:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] shrink-0"
                  >
                    ENTER ARENA
                  </button>

                  <div className="flex gap-2 mt-3 items-stretch shrink-0">
                    <button 
                      onClick={() => setUiState(prev => ({ ...prev, status: 'LOBBY' }))}
                      className="flex-1 py-2.5 sm:py-3 bg-[#0d0f1b] text-[#ffcc00] border-2 border-[#ffcc00]/60 hover:bg-[#ffcc00]/10 hover:border-[#ffcc00] font-black tracking-[0.15em] transition-all duration-200 uppercase text-[10px] sm:text-xs flex items-center justify-center shadow-[3px_3px_0_rgba(255,204,0,0.3)] hover:shadow-[3px_3px_0_rgba(255,204,0,0.6)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                    >
                      MULTIPLAYER
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 py-2.5 sm:py-3 bg-[#0d0f1b] text-[#b500ff] border-2 border-[#b500ff]/60 hover:bg-[#b500ff]/10 hover:border-[#b500ff] font-black tracking-[0.15em] transition-all duration-200 uppercase text-[10px] sm:text-xs flex items-center justify-center shadow-[3px_3px_0_rgba(181,0,255,0.3)] hover:shadow-[3px_3px_0_rgba(181,0,255,0.6)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                    >
                      LOAD MATCH
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="map-select"
                  initial={{ opacity: 0, scale: 0.96, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -15 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-[#0d0f1b]/95 border-2 border-[#00f0ff] shadow-[0_0_30px_rgba(0,240,255,0.15)] ring-1 ring-black pointer-events-auto overflow-hidden"
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
                        resetGame(isMobileRef.current ? 'mobile' : 'desktop', uiState.mapId, uiState.hardMode);
                        setIsMapSelectOpen(false);
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
            className="absolute inset-0 z-[70] flex flex-col items-center justify-center p-4 sm:p-8 bg-[#050508]/80 backdrop-blur-md pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.9 * menuScale, y: 20 }}
              animate={{ scale: menuScale, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md flex flex-col border-2 border-[#ffcc00] bg-[#0d0f1b]/95 p-4 sm:p-6 shadow-[10px_10px_0_#ffcc00] pointer-events-auto items-center relative z-10 origin-center"
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
                  </div>

                  <div className="w-full h-[345px] flex flex-col mb-5">
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
                            className="w-full py-1.5 bg-[#ffcc00]/10 hover:bg-[#ffcc00]/25 text-[#ffcc00] border border-[#ffcc00]/30 hover:border-[#ffcc00] font-sans font-black text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer"
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
                    ) : (
                      <div className="w-full h-full flex flex-col justify-start">
                        {/* Profiling setup */}
                        <p className="text-[#ffcc00]/70 font-bold tracking-[0.15em] text-[10px] uppercase w-full text-left mb-1 text-xs">
                          CALLSIGN
                        </p>
                        <input 
                          type="text" 
                          maxLength={12}
                          value={playerProfile.name}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            updateProfile(val, playerProfile.colorIdx);
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
                    )}
                  </div>

                  {mpState.isHost ? (
                    <button
                      onClick={() => {
                         socketRef.current?.emit('start_game', mpState.roomId, {
                           mapId: uiState.mapId,
                           hardMode: true
                         });
                         resetGame(isMobileRef.current ? 'mobile' : 'desktop', uiState.mapId, uiState.hardMode);
                         setUiState(prev => ({ ...prev, status: 'PLAYING' }));
                      }}
                      className="w-full py-4 bg-[#ffcc00] hover:bg-white text-black font-black tracking-widest transition-all duration-200 uppercase text-sm cursor-pointer shadow-[3px_3px_0_rgba(255,204,0,0.15)] hover:shadow-[5px_5px_0_#fff] active:translate-x-1 active:translate-y-1 active:shadow-none mb-2"
                    >
                      START MATCH
                    </button>
                  ) : (
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
                    onChange={(e) => setMpState(prev => ({ ...prev, joinCode: e.target.value.toUpperCase() }))}
                    placeholder="ENTER CODE"
                    className="w-full py-3 px-4 bg-black border border-white/10 text-white font-mono tracking-widest text-center text-xl outline-none focus:border-[#ffcc00]/50 mb-4 uppercase placeholder-white/20"
                  />
                  {mpState.error && <p className="text-red-500 font-bold mb-4 text-xs">{mpState.error}</p>}
                  <button
                    onClick={joinRoom}
                    className="w-full py-4 bg-[#ffcc00] hover:bg-white text-black font-black tracking-widest transition-all duration-200 uppercase text-sm cursor-pointer shadow-[3px_3px_0_rgba(255,204,0,0.15)] hover:shadow-[5px_5px_0_#fff] active:translate-x-1 active:translate-y-1 active:shadow-none mb-2"
                  >
                    JOIN MATCH
                  </button>

                  <div className="flex items-center w-full my-3">
                    <div className="flex-1 border-t border-white/10"></div>
                    <span className="px-3 text-white/40 font-mono text-[9px] tracking-widest">OR</span>
                    <div className="flex-1 border-t border-white/10"></div>
                  </div>

                  <button
                    onClick={createRoom}
                    className="w-full py-4 bg-transparent border-2 border-[#ffcc00]/50 text-[#ffcc00] font-black tracking-widest hover:bg-[#ffcc00]/10 hover:border-[#ffcc00] transition-colors mt-2 cursor-pointer"
                  >
                    CREATE ROOM
                  </button>
                </>
              )}
              
              <button onClick={() => {
                if (mpState.roomId) socketRef.current?.emit('leave_room', mpState.roomId);
                setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                setLobbyPlayers({});
                setUiState(prev => ({ ...prev, status: 'MENU' }));
              }} className="mt-6 text-[#ffcc00]/60 hover:text-white uppercase tracking-widest text-xs font-bold transition-colors">
                BACK TO MENU
              </button>
            </motion.div>
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
                <div className="absolute top-0 left-0 right-0 p-4 sm:p-6 flex flex-row justify-between items-start pointer-events-none z-10 w-full max-w-7xl mx-auto">
                  {/* Left: Score & Spawners / Target Counters */}
                  <div className="flex items-stretch gap-4 sm:gap-6 ml-4 sm:ml-8">
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
                      animate={flashSpawner ? {
                        filter: [
                          "brightness(1) drop-shadow(0 0 0px rgba(0,0,0,0))",
                          `brightness(1.8) drop-shadow(0 0 15px ${uiState.hardMode ? 'rgba(255,51,0,0.95)' : 'rgba(255,0,255,0.95)'})`,
                          "brightness(1) drop-shadow(0 0 0px rgba(0,0,0,0))"
                        ]
                      } : {}}
                      transition={flashSpawner ? {
                        duration: 0.5,
                        repeat: Infinity,
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
                  <div className="flex flex-col sm:flex-row items-end sm:items-center justify-center gap-3 sm:gap-4 pointer-events-auto h-full pr-2">
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setUiState(prev => {
                          const newStatus = prev.status === 'PAUSED' ? 'PLAYING' : 'PAUSED';
                          uiRef.current = { ...prev, status: newStatus };
                          return uiRef.current;
                        });
                        setConfirmResign(false);
                      }}
                      className="w-[84px] sm:w-[144px] h-[34px] sm:h-[48px] border-2 border-[#FBBF24] hover:bg-[#FBBF24] hover:text-black text-[#FBBF24] font-black tracking-[0.15em] sm:tracking-widest text-[9px] sm:text-xs uppercase transition-all duration-200 shadow-[0_0_8px_rgba(251,191,36,0.2)] hover:shadow-[0_0_15px_rgba(251,191,36,0.6)] active:scale-95 flex items-center justify-center -skew-x-12 focus:outline-none"
                    >
                      <span className="skew-x-12 whitespace-nowrap">
                        {uiState.status === 'PAUSED' ? '▶ RESUME' : '|| PAUSE'}
                      </span>
                    </button>
                    
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setUiState(prev => {
                          uiRef.current = { ...prev, status: 'PAUSED' };
                          return uiRef.current;
                        });
                        setConfirmResign(true);
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
                className="absolute inset-0 bg-black/[0.78] pointer-events-auto z-[70] flex flex-col items-center justify-center backdrop-blur-sm select-none"
              >
                <div className="flex flex-col items-center">
                  <h2 
                    className="text-[48px] md:text-[68px] font-black text-[#F5F7FF] uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.28)] leading-none"
                    style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}
                  >
                    HALTED
                  </h2>
                  <p className="text-[#F5F7FF]/55 font-mono text-[12px] md:text-[14px] tracking-[0.25em] uppercase mt-3">
                    SYSTEM PAUSED
                  </p>
                </div>
                
                <div className="flex flex-col gap-3 mt-11 w-[calc(100vw-48px)] max-w-[280px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setUiState(prev => {
                        uiRef.current = { ...prev, status: 'PLAYING' };
                        return uiRef.current;
                      });
                    }}
                    className="h-12 w-full bg-[#FBBF24] border-2 border-[#FBBF24] text-[#080A0F] font-mono font-black tracking-widest uppercase text-xs sm:text-sm shadow-[0_0_6px_rgba(251,191,36,0.30),0_0_14px_rgba(251,191,36,0.12)] hover:bg-[#FBBF24]/90 hover:border-[#FBBF24]/90 active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FBBF24] focus-visible:ring-offset-black"
                  >
                    RESUME
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveMatch();
                    }}
                    className="h-12 w-full bg-[#8B5CF6]/[0.12] border-2 border-[#8B5CF6] text-[#C4B5FD] hover:bg-[#8B5CF6]/20 font-mono font-black tracking-widest uppercase text-xs sm:text-sm shadow-[0_0_8px_rgba(139,92,246,0.15)] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#8B5CF6] focus-visible:ring-offset-black"
                  >
                    DOWNLOAD SAVE FILE
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
              <div className="absolute inset-0 bg-black/80 pointer-events-auto z-[70] flex flex-col items-center justify-center backdrop-blur-md">
                 <h2 className="text-4xl sm:text-6xl md:text-7xl font-black text-[#ff003c] tracking-tighter drop-shadow-[0_0_15px_rgba(255,0,60,0.8)] mb-8 text-center px-4" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                   CONFIRM RESIGNATION?
                 </h2>
                 <div className="flex gap-4 sm:gap-8 flex-col sm:flex-row">
                   <button
                     onPointerDown={(e) => {
                       e.stopPropagation();
                       setConfirmResign(false);
                       stateRef.current.shake = 20;
                       if (mpState.roomId) socketRef.current?.emit('leave_room', mpState.roomId);
                       setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                       setUiState(prev => ({ ...prev, status: 'GAME_OVER' }));
                     }}
                     className="px-8 py-4 bg-[#0a0000] border-2 border-[#ff003c] text-[#ff003c] font-black tracking-[0.2em] text-xl sm:text-2xl uppercase transition-all duration-200 hover:bg-[#ff003c] hover:text-white hover:shadow-[0_0_30px_rgba(255,0,60,0.8)] active:scale-95"
                   >
                     ACTUALIZE
                   </button>
                   <button
                     onPointerDown={(e) => {
                      e.stopPropagation();
                      setConfirmResign(false);
                    }}
                     className="px-8 py-4 bg-[#0a0000] border-2 border-[#00f0ff] text-[#00f0ff] font-black tracking-[0.2em] text-xl sm:text-2xl uppercase transition-all duration-200 hover:bg-[#00f0ff] hover:text-black hover:shadow-[0_0_30px_rgba(0,240,255,0.8)] active:scale-95"
                   >
                     DECLINE
                   </button>
                 </div>
              </div>
            )}

            {uiState.status !== 'PAUSED' && (
              <>
                <div className="hidden sm:block absolute bottom-0 left-0 p-8 pointer-events-none z-10">
                   <div className="text-sm text-[#94A3B8] tracking-[0.2em] font-bold font-mono">
                     {uiState.deviceType === 'mobile' ? 'JOYSTICK TO MOVE' : 'WASD TO MOVE'}
                   </div>
                </div>
                <div className={`absolute left-1/2 -translate-x-1/2 pointer-events-none z-10 flex gap-[14px] sm:gap-[16px] bottom-4 sm:bottom-6`}>
                   {(Object.keys(toolsData) as Array<keyof typeof toolsData>).map((toolKey) => {
                     const tool = toolsData[toolKey];
                     const isReady = uiState.buttonCounters[toolKey as 'special' | 'build'] === 0;
                     return (
                       <div key={toolKey} className="relative flex flex-col items-center gap-1 sm:gap-1.5">
                         <div className="h-4 sm:h-5 flex items-end">
                           {uiState.buttonCounters[toolKey as 'special' | 'build'] > 0 && (
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
                             if (!isReady) return;
                             const currentTime = performance.now();
                             if (toolKey === 'special') {
                               if (!stateRef.current.player.dash.active && (stateRef.current.player.dash.endTime === 0 || currentTime - stateRef.current.player.dash.endTime >= DASH_COOLDOWN)) {
                                  stateRef.current.player.dash.active = true;
                                  stateRef.current.player.dash.endTime = currentTime + 6000;
                                  stateRef.current.player.dash.lastTime = currentTime;
                                  const isHostMode = !mpRef.current.roomId || mpRef.current.isHost;
                                  
                                  const finalX = stateRef.current.player.x;
                                  const finalY = stateRef.current.player.y;
                                  if (isHostMode) {
                                    const cIdx = playerProfileRef.current.colorIdx;
                                    applySpecialAbility(finalX, finalY, cIdx, 'local');
                                  } else {
                                    socketRef.current?.emit('client_action', mpRef.current.roomId, { type: 'special', x: finalX, y: finalY, colorIdx: playerProfileRef.current.colorIdx });
                                    applySpecialAbility(finalX, finalY, playerProfileRef.current.colorIdx, socketRef.current?.id || 'local');
                                  }
                               }
                             } else if (toolKey === 'build') {
                               if (!stateRef.current.player.build.active && (stateRef.current.player.build.endTime === 0 || currentTime - stateRef.current.player.build.endTime >= BUILD_COOLDOWN)) {
                                 stateRef.current.player.build.active = true;
                                 stateRef.current.player.build.endTime = currentTime + 8000;
                                 stateRef.current.player.build.lastTime = currentTime;
                                 const gridX = Math.round(stateRef.current.player.x / 40) * 40;
                                 const gridY = Math.round(stateRef.current.player.y / 40) * 40;
                                 stateRef.current.player.build.lastBlockX = gridX;
                                 stateRef.current.player.build.lastBlockY = gridY;
                                 const cIdx = playerProfileRef.current.colorIdx;
                                 tryPlaceBuildBlock(currentTime, gridX, gridY, cIdx);
                               }
                             }
                           }}
                           className={`pointer-events-auto w-[162px] h-[44px] border-2 font-black tracking-widest uppercase text-[13px] sm:text-[14px] relative overflow-hidden flex justify-center items-center gap-1 sm:gap-2 focus:outline-none ${isReady ? 'hover:brightness-110 active:brightness-90 active:scale-95 cursor-pointer' : 'cursor-default'}`}
                           style={{
                             borderColor: isReady ? tool.usableBorder : tool.unusableBorder,
                             background: isReady ? tool.usableFill : tool.unusableFill,
                             color: isReady ? tool.usableText : tool.unusableText,
                             boxShadow: isReady ? tool.usableGlow : 'none',
                             transition: isReady ? 'all 140ms ease-out' : 'all 100ms ease-in'
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
                
                <div className="hidden sm:block absolute bottom-0 right-0 p-8 pointer-events-none z-10 text-right">
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

      {uiState.status === 'VICTORY' && !mpState.roomId && (
        <div className="absolute inset-0 bg-[#00f0ff]/90 flex flex-col items-center justify-center p-4 sm:p-6 text-center backdrop-blur-md z-[70]">
          <div className="max-w-xl w-full bg-[#0a0000] border-2 border-[#00f0ff] p-6 sm:p-8 md:p-12 shadow-[10px_10px_0_#00f0ff]">
            <h2 className="text-5xl sm:text-6xl md:text-7xl font-black text-[#00f0ff] mb-2 sm:mb-4 tracking-tighter" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>VICTORY</h2>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-xs sm:text-sm font-mono text-[#00f0ff]/80 mb-6 md:mb-10 uppercase tracking-widest border-t border-b border-[#00f0ff]/30 py-4 sm:py-6">
              <div>FINAL SCORE: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.score}</span></div>
              <div className="hidden sm:block w-px h-6 bg-[#00f0ff]/30"></div>
              <div>SPAWNERS LEFT: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.spawnersLeft}/{(MAPS[uiState.mapId] || MAPS.medium).spawners.length}</span></div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <button 
                onClick={() => {
                  resetGame(isMobileRef.current ? 'mobile' : 'desktop');
                }}
                className="flex-1 py-3 sm:py-4 bg-[#00f0ff] hover:bg-white text-black border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
              >
                RE-ENTER ARENA
              </button>
              <button 
                onClick={() => {
                  if (mpState.roomId) socketRef.current?.emit('leave_room', mpState.roomId);
                  setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                  setUiState(prev => ({ ...prev, status: 'MENU' }));
                }}
                className="flex-1 py-3 sm:py-4 bg-transparent hover:bg-white/10 text-[#00f0ff] hover:text-white border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_rgba(0,240,255,0.4)] pointer-events-auto"
              >
                MAIN MENU
              </button>
            </div>
          </div>
        </div>
      )}

      {uiState.status === 'GAME_OVER' && !mpState.roomId && (
        <div className="absolute inset-0 bg-red-950/90 flex flex-col items-center justify-center p-4 sm:p-6 text-center backdrop-blur-md z-[70]">
          <div className="max-w-xl w-full bg-[#0a0000] border-2 border-[#ff003c] p-6 sm:p-8 md:p-12 shadow-[10px_10px_0_#ff003c]">
            <h2 className="text-5xl sm:text-6xl md:text-7xl font-black text-[#ff003c] mb-2 sm:mb-4 tracking-tighter" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>ANNIHILATED</h2>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-xs sm:text-sm font-mono text-red-200/80 mb-6 md:mb-10 uppercase tracking-widest border-t border-b border-red-500/30 py-4 sm:py-6">
              <div>FINAL SCORE: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.score}</span></div>
              <div>SPAWNERS LEFT: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.spawnersLeft}/{(MAPS[uiState.mapId] || MAPS.medium).spawners.length}</span></div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <button 
                onClick={() => {
                  resetGame(isMobileRef.current ? 'mobile' : 'desktop');
                }}
                className="flex-1 py-3 sm:py-4 bg-[#ff003c] hover:bg-white text-black border-2 border-[#ff003c] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
              >
                RE-ENTER ARENA
              </button>
              <button 
                onClick={() => {
                  if (mpState.roomId) socketRef.current?.emit('leave_room', mpState.roomId);
                  setMpState(prev => ({ ...prev, roomId: null, isHost: false, error: '' }));
                  setUiState(prev => ({ ...prev, status: 'MENU' }));
                }}
                className="flex-1 py-3 sm:py-4 bg-transparent hover:bg-white/10 text-[#ff003c] hover:text-white border-2 border-[#ff003c] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_rgba(255,0,60,0.4)] pointer-events-auto"
              >
                MAIN MENU
              </button>
            </div>
          </div>
        </div>
      )}

      {mpState.roomId && (uiState.status === 'GAME_OVER' || uiState.status === 'VICTORY') && (() => {
        const { list: standings, isWholeGameEnded } = getMultiplayerStandings();
        const myName = playerProfileRef.current.name || 'YOU';
        const myId = socketRef.current?.id || 'local';

        return (
          <div className="absolute inset-0 bg-[#0a0000]/95 flex flex-col items-center justify-center p-2 sm:p-6 text-center backdrop-blur-md z-[70] overflow-y-auto">
            <div className="max-w-xl w-full bg-[#0d0404] border-2 border-[#ff005c] p-5 sm:p-8 md:p-10 shadow-[10px_10px_0_#ff005c] my-auto">
              
              {/* GOAL display */}
              <div className="text-[10px] font-mono text-[#ffcc00] tracking-[0.2em] uppercase mb-1 font-bold">
                GOAL: GET THE HIGHEST SCORE BEFORE YOU DIE
              </div>

              {/* Title based on state */}
              {isWholeGameEnded ? (
                <h2 className="text-4xl sm:text-5xl md:text-6xl font-black text-[#ffcc00] mb-2 tracking-tighter uppercase drop-shadow-[0_0_15px_rgba(255,204,0,0.5)]" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                  MATCH CONCLUDED
                </h2>
              ) : (
                <h2 className="text-4xl sm:text-5xl md:text-6xl font-black text-[#ff005c] mb-2 tracking-tighter uppercase drop-shadow-[0_0_15px_rgba(255,0,92,0.5)]" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                  ANNIHILATED
                </h2>
              )}

              {/* Subtitle explanation */}
              <p className="text-[10px] sm:text-xs font-mono text-zinc-400 tracking-wider uppercase mb-6 sm:mb-8 border-b border-white/5 pb-4">
                {isWholeGameEnded 
                  ? "ALL PLAYERS HAVE FALLEN // FINAL STANDINGS" 
                  : "YOU WERE ELIMINATED // SPECTATING LIVE MATCH..."
                }
              </p>

              {/* Leaderboard Table */}
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
                          idx === 0 ? 'text-[#ffcc00]' : idx === 1 ? 'text-[#00f0ff]' : 'text-white/60'
                        }`}>
                          #{idx + 1}
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

                      {/* Score and Alive/Dead Label */}
                      <div className="flex items-center gap-2 sm:gap-4 font-mono">
                        <span className={`text-[8px] sm:text-[10px] tracking-widest font-extrabold uppercase px-1.5 py-0.5 rounded-sm shrink-0 border ${
                          p.isDead 
                            ? 'text-[#ff005c]/70 border-[#ff005c]/10 bg-[#ff005c]/5' 
                            : 'text-[#00ff88] border-[#00ff88]/20 bg-[#00ff88]/5 animate-pulse'
                        }`}>
                          {p.isDead ? 'ELIMINATED' : 'ALIVE'}
                        </span>
                        
                        <span className="text-white font-bold text-xs sm:text-base tracking-tight">
                          {p.score}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                {confirmLeaveMatches ? (
                  <div className="bg-[#1a050b] p-4 border border-[#ff005c]/20 flex flex-col items-center justify-center gap-3">
                    <p className="text-[10px] sm:text-xs font-mono text-pink-200 uppercase tracking-widest">
                      QUIT TO MAIN MENU? YOU WILL ABANDON THIS ROOM.
                    </p>
                    <div className="flex gap-3 w-full">
                      <button 
                        onClick={() => {
                          if (mpState.roomId) socketRef.current?.emit('leave_room', mpState.roomId);
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
                        className="flex-1 py-3 sm:py-4 bg-[#ffcc00] hover:bg-white text-black border-2 border-[#ffcc00] font-black tracking-[0.2em] transition-all duration-200 uppercase text-xs sm:text-sm active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
                      >
                        RESTART MATCH
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

            </div>
          </div>
        );
      })()}

      <AnimatePresence>
        {bannerState.show && bannerState.mode && (
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

