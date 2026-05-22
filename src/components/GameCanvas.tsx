import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

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
const DASH_COOLDOWN = 30000;

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

type MapDefinition = { name: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'; description: string; walls: {x: number, y: number, w: number, h: number}[]; spawners: {x: number, y: number, radius: number, hp: number, maxHp: number}[] };

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
      { x: 1500, y: 1000, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  open_field: {
    name: "Open Field",
    difficulty: "EASY",
    description: "A wide open expanse perfect for learning the ropes. Minimal walls, maximal dodging.",
    walls: [
      ...BASE_WALLS,
      { x: 500, y: 500, w: 100, h: 100 },
      { x: 2400, y: 500, w: 100, h: 100 },
      { x: 500, y: 2400, w: 100, h: 100 },
      { x: 2400, y: 2400, w: 100, h: 100 }
    ],
    spawners: [
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1200, y: 1200, radius: 40, hp: 100, maxHp: 100 },
      { x: 1800, y: 1200, radius: 40, hp: 100, maxHp: 100 },
      { x: 1200, y: 1800, radius: 40, hp: 100, maxHp: 100 },
      { x: 1800, y: 1800, radius: 40, hp: 100, maxHp: 100 }
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
      { x: 1200, y: 0, w: 600, h: 900 },
      { x: 1200, y: 2100, w: 600, h: 900 },
      { x: 0, y: 1200, w: 900, h: 600 },
      { x: 2100, y: 1200, w: 900, h: 600 },
      // Center is open for intersection combat
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
      
      // Outer rim covers
      { x: 500, y: 500, w: 200, h: 200 },
      { x: 2300, y: 500, w: 200, h: 200 },
      { x: 500, y: 2300, w: 200, h: 200 },
      { x: 2300, y: 2300, w: 200, h: 200 },
    ],
    spawners: [
      { x: 400, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 2600, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 400, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 2600, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  the_maze: {
    name: "The Maze",
    difficulty: "HARD",
    description: "Tight corridors and sudden ambushes. Ricochets are extremely deadly here.",
    walls: [
      ...BASE_WALLS,
      // Maze structure
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
      { x: 1500, y: 1000, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  fortress: {
    name: "Fortress",
    difficulty: "HARD",
    description: "Enemies are well-entrenched. Penetrate the outer walls to reach the heavily guarded spawners.",
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
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1200, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1800, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1200, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 1800, radius: 40, hp: 100, maxHp: 100 }
    ]
  },
  choke_points: {
    name: "Choke Points",
    difficulty: "HARD",
    description: "Several narrow pathways restrict movement. Position yourself carefully or be overrun.",
    walls: [
      ...BASE_WALLS,
      { x: 1000, y: 0, w: 100, h: 800 },
      { x: 1000, y: 1000, w: 100, h: 1000 },
      { x: 1000, y: 2200, w: 100, h: 800 },
      
      { x: 1900, y: 0, w: 100, h: 800 },
      { x: 1900, y: 1000, w: 100, h: 1000 },
      { x: 1900, y: 2200, w: 100, h: 800 },

      { x: 0, y: 800, w: 800, h: 100 },
      { x: 1200, y: 800, w: 800, h: 100 },
      { x: 2200, y: 800, w: 800, h: 100 },
      
      { x: 0, y: 1900, w: 800, h: 100 },
      { x: 1200, y: 1900, w: 800, h: 100 },
      { x: 2200, y: 1900, w: 800, h: 100 },
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
    description: "A long winding zig-zag of endless bullets. Very little room for error.",
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
    ]
  },
  pinball: {
    name: "Pinball",
    difficulty: "EXPERT",
    description: "Chaos incarnate. Bullets bounce off a multitude of scattered bumpers in the center.",
    walls: [
      ...BASE_WALLS,
      // Corner guards
      { x: 200, y: 200, w: 400, h: 50 },
      { x: 200, y: 200, w: 50, h: 400 },
      { x: 2400, y: 200, w: 400, h: 50 },
      { x: 2750, y: 200, w: 50, h: 400 },
      { x: 200, y: 2750, w: 400, h: 50 },
      { x: 200, y: 2400, w: 50, h: 400 },
      { x: 2400, y: 2750, w: 400, h: 50 },
      { x: 2750, y: 2400, w: 50, h: 400 },
      
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
      { x: 1500, y: 1500, radius: 40, hp: 100, maxHp: 100 },
      { x: 400, y: 400, radius: 40, hp: 100, maxHp: 100 },
      { x: 2600, y: 400, radius: 40, hp: 100, maxHp: 100 },
      { x: 400, y: 2600, radius: 40, hp: 100, maxHp: 100 },
      { x: 2600, y: 2600, radius: 40, hp: 100, maxHp: 100 }
    ]
  }
};

let activeWalls = MAPS.medium.walls;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(val, max));
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

  const [uiState, setUiState] = useState<{ status: 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY'; score: number; deviceType: 'desktop' | 'mobile'; activeTool: 'weapon' | 'special' | 'build'; blocks: number; spawnersLeft: number; mapId: string; hardMode: boolean }>({ status: 'MENU', score: 0, deviceType: 'desktop', activeTool: 'weapon', blocks: 50, spawnersLeft: 5, mapId: 'medium', hardMode: false });
  const uiRef = useRef(uiState);
  uiRef.current = uiState;

  const isMobileRef = useRef(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [isMapSelectOpen, setIsMapSelectOpen] = useState(false);

  // We use a ref for the entire game state to avoid stale closures
  const initialSpawn = useRef(getSafeSpawn(100)).current;
  const stateRef = useRef({
    player: { x: initialSpawn.x, y: initialSpawn.y, vx: 0, vy: 0, radius: PLAYER_RADIUS, lastShoot: 0, dash: { active: false, targetX: 0, targetY: 0, shieldRadius: 60, lastTime: -DASH_COOLDOWN, wasReady: true } },
    blocks: [] as { x: number; y: number; size: number; createdAt: number }[],
    nextBlockScore: 100,
    bullets: [] as { x: number; y: number; dx: number; dy: number; radius: number, isPlayer: boolean, bounceCount: number, spawnTime: number, isNeutral: boolean }[],
    enemies: [] as { x: number; y: number; radius: number; lastShoot: number, speed: number }[],
    bouncers: [] as { x: number; y: number; dx: number; dy: number; size: number; radius: number; speed: number; lastDirChange: number; lastMultiply: number }[],
    bouncerCapacity: 2,
    spawners: [
      { x: 800, y: 800, radius: 40, hp: 100, maxHp: 100 },
      { x: 2200, y: 800, radius: 40, hp: 100, maxHp: 100 },
      { x: 800, y: 2200, radius: 40, hp: 100, maxHp: 100 },
      { x: 2400, y: 2400, radius: 40, hp: 100, maxHp: 100 },
      { x: 1500, y: 600, radius: 40, hp: 100, maxHp: 100 }
    ],
    keys: { w: false, a: false, s: false, d: false },
    mouse: { x: 0, y: 0, down: false, justDown: false },
    touches: {
      left: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0 },
      right: { active: false, id: -1, startX: 0, startY: 0, currentX: 0, currentY: 0, dirX: 0, dirY: 0, justReleased: false, releaseDx: 0, releaseDy: 0, aimLength: 0, startTime: 0 },
      tap: { active: false, x: 0, y: 0 }
    },
    camera: { x: 0, y: 0, width: 0, height: 0 },
    particles: [] as { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; radius: number }[],
    trails: [] as { x: number; y: number; age: number; color: string; radius: number }[],
    shockwaves: [] as { x: number; y: number; color: string; maxRadius: number; age: number; maxAge: number; thickness: number }[],
    shake: 0,
    lastTime: performance.now(),
    lastEnemySpawn: 0,
    enemySpawnRate: 3000,
    hardMode: false,
  });

  const resetGame = (deviceType?: 'desktop' | 'mobile', mapId?: string) => {
    const dType = deviceType || uiRef.current.deviceType;
    const selectedMapId = mapId || uiRef.current.mapId;
    const isHardMode = uiRef.current.hardMode;
    const mapDef = MAPS[selectedMapId] || MAPS.classic_arena;
    activeWalls = mapDef.walls;
    
    const state = stateRef.current;
    state.hardMode = isHardMode;
    const spawn = getSafeSpawn(100);
    state.player.x = spawn.x;
    state.player.y = spawn.y;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.lastShoot = performance.now();
    state.player.dash = { active: false, targetX: 0, targetY: 0, shieldRadius: 60, lastTime: -DASH_COOLDOWN, wasReady: true };
    state.blocks = [];
    state.nextBlockScore = 100;
    state.bullets = [];
    state.enemies = [];
    state.bouncers = [];
    for (let i = 0; i < 2; i++) {
      const spawn = getSafeSpawn(60);
      const angle = Math.random() * Math.PI * 2;
      state.bouncers.push({ x: spawn.x, y: spawn.y, dx: Math.cos(angle), dy: Math.sin(angle), size: 1, radius: 24, speed: ENEMY_SPEED + Math.random() * 20, lastDirChange: performance.now(), lastMultiply: performance.now() });
    }
    state.bouncerCapacity = 2;
    state.spawners = mapDef.spawners.map((s: any) => ({ ...s }));
    state.particles = [];
    state.trails = [];
    state.shockwaves = [];
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
    
    const newUi = { status: 'PLAYING' as const, score: 0, deviceType: dType, activeTool: 'weapon' as const, blocks: 50, spawnersLeft: state.spawners.length, mapId: selectedMapId, hardMode: isHardMode };
    uiRef.current = newUi;
    setUiState(newUi);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const state = stateRef.current;

    const handleResize = () => {
      canvas.width = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
      state.camera.width = canvas.width;
      state.camera.height = canvas.height;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') state.keys.w = true;
      if (key === 'a') state.keys.a = true;
      if (key === 's') state.keys.s = true;
      if (key === 'd') state.keys.d = true;
      
      if (key === '1') setUiState(prev => ({ ...prev, activeTool: 'weapon' }));
      if (key === '2') setUiState(prev => ({ ...prev, activeTool: 'special' }));
      if (key === '3') setUiState(prev => ({ ...prev, activeTool: 'build' }));
      if (key === 'escape') {
        setUiState(prev => {
           if (prev.status === 'PLAYING') return { ...prev, status: 'PAUSED' };
           if (prev.status === 'PAUSED') return { ...prev, status: 'PLAYING' };
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

    const handleMouseMove = (e: MouseEvent) => {
      if (e.target !== canvas) return;
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = e.clientX - rect.left;
      state.mouse.y = e.clientY - rect.top;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.target !== canvas) return;
      if (uiRef.current.status !== 'PLAYING') return;
      state.mouse.down = true;
      state.mouse.justDown = true;
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.target !== canvas) return;
      state.mouse.down = false;
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
          } else if (uiRef.current.activeTool === 'weapon' && !state.touches.right.active && (x - rightJoyX)**2 + (y - rightJoyY)**2 <= joyRadius**2) {
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
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    let animationFrameId: number;

    const gameLoop = (currentTime: number) => {
      const dt = Math.min((currentTime - state.lastTime) / 1000, 0.1); // cap dt at 100ms to prevent glitches
      state.lastTime = currentTime;

      const STATUS = uiRef.current.status;

      if (STATUS === 'PLAYING') {
        const mouseJustDown = state.mouse.justDown;
        state.mouse.justDown = false;
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
        
        // 1. Update Player Movement
        if (state.player.dash.active) {
            const dx = state.player.dash.targetX - state.player.x;
            const dy = state.player.dash.targetY - state.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const DASH_SPEED = 2000;
            const moveDist = DASH_SPEED * dt;

            if (dist <= moveDist) {
              state.player.x = state.player.dash.targetX;
              state.player.y = state.player.dash.targetY;
              state.player.dash.active = false;
              state.player.vx = 0;
              state.player.vy = 0;
              spawnParticles(state.player.x, state.player.y, '#b500ff', 30);
              state.shockwaves.push({ x: state.player.x, y: state.player.y, color: '#b500ff', maxRadius: 200, age: 0, maxAge: 0.5, thickness: 25 });
              state.shake = 15;
            } else {
              state.player.x += (dx / dist) * moveDist;
              state.player.y += (dy / dist) * moveDist;
              state.player.vx = (dx / dist) * DASH_SPEED;
              state.player.vy = (dy / dist) * DASH_SPEED;
              state.trails.push({
                x: state.player.x, y: state.player.y, age: 0,
                color: '#b500ff', radius: state.player.dash.shieldRadius - 10
              });
            }

            // Dash Collision with Enemies
            const checkRadius = state.player.dash.shieldRadius;
            for (let e = state.enemies.length - 1; e >= 0; e--) {
              const enemy = state.enemies[e];
              const edx = enemy.x - state.player.x;
              const edy = enemy.y - state.player.y;
              if (edx * edx + edy * edy < (checkRadius + enemy.radius) ** 2) {
                spawnParticles(enemy.x, enemy.y, '#ff3333', 30);
                state.shockwaves.push({ x: enemy.x, y: enemy.y, color: '#ff3333', maxRadius: 100, age: 0, maxAge: 0.3, thickness: 10 });
                state.shake = 10;
                state.enemies.splice(e, 1);
                setUiState(prev => {
                  const newScore = prev.score + 150;
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
              }
            }

            // Dash Collision with Bullets
            for (let b = state.bullets.length - 1; b >= 0; b--) {
              const bullet = state.bullets[b];
              const bdx = bullet.x - state.player.x;
              const bdy = bullet.y - state.player.y;
              if (bdx * bdx + bdy * bdy < (checkRadius + bullet.radius) ** 2) {
                spawnParticles(bullet.x, bullet.y, '#ffffff', 10);
                state.bullets.splice(b, 1);
              }
            }
            
            // Dash Collision with Spawners
            for (let s = state.spawners.length - 1; s >= 0; s--) {
              const spawner = state.spawners[s];
              const sdx = spawner.x - state.player.x;
              const sdy = spawner.y - state.player.y;
              if (sdx * sdx + sdy * sdy < (checkRadius + spawner.radius) ** 2) {
                // Dash does continuous damage while overlapping (scaled by dt to ignore framerate dependency)
                spawner.hp -= 1000 * dt;
                spawnParticles(spawner.x, spawner.y, '#ffffff', 2);
                
                if (spawner.hp <= 0) {
                  const spawnerColor = state.hardMode ? '#ff3300' : '#ff00ff';
                  spawnParticles(spawner.x, spawner.y, spawnerColor, 100);
                  state.shockwaves.push({ x: spawner.x, y: spawner.y, color: spawnerColor, maxRadius: 200, age: 0, maxAge: 0.5, thickness: 20 });
                  state.shake = 30;
                  state.spawners.splice(s, 1);
                  
                  setUiState(prev => {
                    const newScore = prev.score + 1000;
                    let newBlocks = prev.blocks + 3; // Bonus blocks
                    uiRef.current = { ...prev, score: newScore, blocks: newBlocks, spawnersLeft: state.spawners.length };
                    // Check win condition
                    if (state.spawners.length === 0) {
                       uiRef.current.status = 'VICTORY';
                    }
                    return uiRef.current;
                  });
                }
              }
            }
        } else {
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

          if (length > 0 && Math.random() > 0.5) {
            state.trails.push({
              x: state.player.x,
              y: state.player.y,
              age: 0,
              color: '#00ccff',
              radius: state.player.radius * 0.4
            });
          }

          state.player.vx = moveX;
          state.player.vy = moveY;

          state.player.x += state.player.vx * PLAYER_SPEED * dt;
          state.player.y += state.player.vy * PLAYER_SPEED * dt;
        }

        // Block Physics (Player / Enemies vs Blocks)
        for (let b = state.blocks.length - 1; b >= 0; b--) {
          const block = state.blocks[b];
          let destroyed = false;

          // Player touching block
          const pRadius = state.player.dash.active ? state.player.dash.shieldRadius : state.player.radius;
          const pdx = Math.abs(state.player.x - block.x);
          const pdy = Math.abs(state.player.y - block.y);
          if (pdx < block.size / 2 + pRadius && pdy < block.size / 2 + pRadius) {
            destroyed = true;
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
            spawnParticles(block.x, block.y, '#ffcc00', 20);
            state.blocks.splice(b, 1);
          }
        }

        // Player Wall Collisions
        for (const wall of activeWalls) {
          const closestX = clamp(state.player.x, wall.x, wall.x + wall.w);
          const closestY = clamp(state.player.y, wall.y, wall.y + wall.h);

          const distX = state.player.x - closestX;
          const distY = state.player.y - closestY;
          const distSq = distX * distX + distY * distY;

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

        // 2. Spawn Enemies
        if (state.spawners.length > 0) {
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
          
          // Move towards player
          const dx = state.player.x - enemy.x;
          const dy = state.player.y - enemy.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist > 0) {
            enemy.x += (dx / dist) * enemy.speed * dt;
            enemy.y += (dy / dist) * enemy.speed * dt;
          }

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
              
              const distToPlayer = Math.sqrt((state.player.x - b.x)**2 + (state.player.y - b.y)**2);
              if (distToPlayer < 600 && Math.random() < 0.2) {
                minDist = distToPlayer;
                targetX = state.player.x;
                targetY = state.player.y;
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
          
          b.x += b.dx * b.speed * dt;
          b.y += b.dy * b.speed * dt;
          
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
                // Destroy block
                spawnParticles(block.x, block.y, '#00ff88', 20);
                state.blocks.splice(blk, 1);
                // Bounce
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
                 spawnParticles(b.x, b.y, '#00ff88', 30);
                 b.size = 0; // mark for logic below or just bounce?
                 // Wait, let's just bounce
                 b.dx *= -1;
                 b.dy *= -1;
              } else {
                spawnParticles(state.player.x, state.player.y, '#00ccff', 50);
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
                x: b.x, y: b.y, dx: Math.cos(angle), dy: Math.sin(angle),
                size: 1, radius: 24, speed: ENEMY_SPEED + Math.random() * 20, lastDirChange: currentTime, lastMultiply: currentTime
              });
            }
          }
        }

        // 4. Handle Tools & Shooting
        let isShooting = false;
        let shootDirX = 0;
        let shootDirY = 0;
        let actionTriggered = false;
        let actionTargetX = 0;
        let actionTargetY = 0;
        const activeTool = uiRef.current.activeTool;

        let mobileTapWorldX: number | undefined = undefined;
        let mobileTapWorldY: number | undefined = undefined;
        if (state.touches.tap.active) {
           mobileTapWorldX = state.touches.tap.x + state.camera.x;
           mobileTapWorldY = state.touches.tap.y + state.camera.y;
           state.touches.tap.active = false;
        }

        if (uiRef.current.deviceType === 'desktop') {
          if (activeTool === 'weapon') {
            isShooting = state.mouse.down;
            const worldMouseX = state.mouse.x + state.camera.x;
            const worldMouseY = state.mouse.y + state.camera.y;
            shootDirX = worldMouseX - state.player.x;
            shootDirY = worldMouseY - state.player.y;
          } else if (mouseJustDown) {
            actionTriggered = true;
            actionTargetX = state.mouse.x + state.camera.x;
            actionTargetY = state.mouse.y + state.camera.y;
          }
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
           
          if (mobileTapWorldX !== undefined) {
             if (activeTool === 'special') {
                actionTriggered = true;
                actionTargetX = mobileTapWorldX;
                actionTargetY = mobileTapWorldY;
             }
             // Build handles its own tap below
          }
        }

        if (activeTool === 'build') {
           const isUsingBuild = (uiRef.current.deviceType === 'desktop' && state.mouse.down) || (uiRef.current.deviceType === 'mobile' && mobileTapWorldX !== undefined);
           if (isUsingBuild) {
              let targetX = 0;
              let targetY = 0;
              const BUILD_RANGE = 300;
              if (uiRef.current.deviceType === 'mobile') {
                 targetX = mobileTapWorldX!;
                 targetY = mobileTapWorldY!;
              } else {
                 targetX = state.mouse.x + state.camera.x;
                 targetY = state.mouse.y + state.camera.y;
              }

              // Apply BUILD_RANGE clamp
              const dx = targetX - state.player.x;
              const dy = targetY - state.player.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > BUILD_RANGE) {
                 targetX = state.player.x + (dx / dist) * BUILD_RANGE;
                 targetY = state.player.y + (dy / dist) * BUILD_RANGE;
              }
              
              // Align to invisible grid (50x50)
              const finalX = Math.floor(targetX / 50) * 50 + 25;
              const finalY = Math.floor(targetY / 50) * 50 + 25;
              
              // Check if a block already exists there
              const existingBlockIndex = state.blocks.findIndex(b => Math.abs(b.x - finalX) < 1 && Math.abs(b.y - finalY) < 1);
              
              // Only place if empty and we have blocks, also prevent placing on top of the player
              const playerDistX = finalX - state.player.x;
              const playerDistY = finalY - state.player.y;
              const distToPlayerSq = playerDistX*playerDistX + playerDistY*playerDistY;
              
              if (existingBlockIndex === -1 && uiRef.current.blocks > 0 && distToPlayerSq > 60*60) {
                setUiState(prev => {
                  uiRef.current = { ...prev, blocks: prev.blocks - 1 };
                  return uiRef.current;
                });
                state.blocks.push({ x: finalX, y: finalY, size: 50, createdAt: performance.now() });
                state.shockwaves.push({ x: finalX, y: finalY, color: '#00ff88', maxRadius: 60, age: 0, maxAge: 0.2, thickness: 10 });
                spawnParticles(finalX, finalY, '#00ff88', 15);
              }
           }
        } else if (actionTriggered && !state.player.dash.active) {
          const ACTION_RADIUS = 300;
          const dx = actionTargetX - state.player.x;
          const dy = actionTargetY - state.player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let finalX = actionTargetX;
          let finalY = actionTargetY;
          if (dist > ACTION_RADIUS) {
            finalX = state.player.x + (dx / dist) * ACTION_RADIUS;
            finalY = state.player.y + (dy / dist) * ACTION_RADIUS;
          }

          if (activeTool === 'special') {
            if (currentTime - state.player.dash.lastTime >= DASH_COOLDOWN) {
              state.player.dash.active = true;
              state.player.dash.targetX = finalX;
              state.player.dash.targetY = finalY;
              state.player.dash.lastTime = currentTime;
              state.shockwaves.push({ x: state.player.x, y: state.player.y, color: '#b500ff', maxRadius: 150, age: 0, maxAge: 0.4, thickness: 20 });
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

          state.bullets.push({
            x: state.player.x,
            y: state.player.y,
            dx: bvx,
            dy: bvy,
            radius: BULLET_RADIUS,
            isPlayer: true,
            bounceCount: 0,
            spawnTime: currentTime,
            isNeutral: false,
          });
        }

        // 5. Update Bullets & Collisions
        for (let i = state.bullets.length - 1; i >= 0; i--) {
          const bullet = state.bullets[i];
          const prevX = bullet.x;
          const prevY = bullet.y;

          let speedMultiplier = 1;
          const timeAlive = currentTime - bullet.spawnTime;
          
          // Initial speed burst to avoid player running into their own bullets
          if (bullet.isPlayer && timeAlive < 250) {
            speedMultiplier = 3.5;
          }

          bullet.x += bullet.dx * speedMultiplier * dt;
          bullet.y += bullet.dy * speedMultiplier * dt;

          if (Math.random() > 0.3) {
            const color = bullet.isNeutral ? '#aaaaaa' : (bullet.isPlayer ? '#00ccff' : '#ff0066');
            state.trails.push({
              x: bullet.x, y: bullet.y, age: 0,
              color: color,
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

          let bulletDestroyed = false;

          // Block Collisions
          if (!bulletDestroyed) {
             for (let b = state.blocks.length - 1; b >= 0; b--) {
               const block = state.blocks[b];
               const halfSize = block.size / 2;
               const closestX = Math.max(block.x - halfSize, Math.min(bullet.x, block.x + halfSize));
               const closestY = Math.max(block.y - halfSize, Math.min(bullet.y, block.y + halfSize));
               const bdx = bullet.x - closestX;
               const bdy = bullet.y - closestY;
               
               if (bdx * bdx + bdy * bdy < bullet.radius * bullet.radius) {
                 if (bullet.isPlayer && !bullet.isNeutral) {
                     // Destroy block by player
                     spawnParticles(block.x, block.y, '#00ff88', 20);
                     state.blocks.splice(b, 1);
                     bulletDestroyed = true;
                     setUiState(prev => {
                        uiRef.current = { ...prev, blocks: prev.blocks + 1 };
                        return uiRef.current;
                     });
                     break;
                 } else {
                     bullet.bounceCount++;
                     bullet.isNeutral = true;
                     spawnParticles(closestX, closestY, '#ffffff', 5);
                     
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
          }

          // Check hit Bouncers
          if (!bulletDestroyed && (bullet.isPlayer || bullet.isNeutral)) {
            for (let b = state.bouncers.length - 1; b >= 0; b--) {
              const bouncer = state.bouncers[b];
              const dx = bouncer.x - bullet.x;
              const dy = bouncer.y - bullet.y;
              if (dx * dx + dy * dy < (bouncer.radius + bullet.radius) ** 2) {
                spawnParticles(bouncer.x, bouncer.y, '#00ff88', 20);
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
                    x: bouncer.x, y: bouncer.y, 
                    dx: Math.cos(baseAngle + 0.5), dy: Math.sin(baseAngle + 0.5),
                    size: nextSize, radius: nextRadius, speed: nextSpeed,
                    lastDirChange: currentTime, lastMultiply: currentTime
                  });
                  state.bouncers.push({
                    x: bouncer.x, y: bouncer.y, 
                    dx: Math.cos(baseAngle - 0.5), dy: Math.sin(baseAngle - 0.5),
                    size: nextSize, radius: nextRadius, speed: nextSpeed,
                    lastDirChange: currentTime, lastMultiply: currentTime
                  });
                } else {
                  state.shockwaves.push({ x: bouncer.x, y: bouncer.y, color: '#00ff88', maxRadius: 100, age: 0, maxAge: 0.3, thickness: 10 });
                  let pts = 0;
                  if (bullet.isPlayer && !bullet.isNeutral) pts = 250;
                  
                  if (pts > 0) {
                    setUiState(prev => {
                       const newScore = prev.score + pts;
                       uiRef.current = { ...prev, score: newScore };
                       return uiRef.current;
                    });
                  }
                }
                break;
              }
            }
          }

          // Check hit Enemies
          if (!bulletDestroyed && (bullet.isPlayer || bullet.isNeutral)) { // Player bullets or neutral neutral bullets can hit enemies
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
                }
                break;
              }
            }
          }

          // Check hit Spawners
          if (!bulletDestroyed && bullet.isPlayer && !bullet.isNeutral) { // Only blue bullets hurt spawners
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
                }
                break;
              }
            }
          }

          // Check hit Player
          if (!bulletDestroyed && (!bullet.isPlayer || bullet.isNeutral)) { // Red bullets or neutral bullets can hit player
            const dx = state.player.x - bullet.x;
            const dy = state.player.y - bullet.y;
            const isProtected = state.player.dash.active;
            if (!isProtected && dx * dx + dy * dy < (state.player.radius + bullet.radius * 0.5) ** 2) {
              // Game Over!
              spawnParticles(state.player.x, state.player.y, '#00ccff', 50);
              state.shake = 20;
              setUiState(prev => {
                uiRef.current = { ...prev, status: 'GAME_OVER' };
                return uiRef.current;
              });
              bulletDestroyed = true;
            }
          }

          if (bulletDestroyed) {
             state.bullets.splice(i, 1);
          }
        }

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
          if (t.age >= 0.4) {
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

        ctx.save();
        ctx.translate(b.x, b.y);

        ctx.fillStyle = 'rgba(0, 255, 136, 0.2)';
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#00ff88';
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
        if (uiRef.current.status === 'PLAYING' && Math.random() > 0.6) {
          state.trails.push({
            x: enemy.x, y: enemy.y, age: 0,
            color: '#ff3333',
            radius: enemy.radius * 0.4
          });
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
        const alpha = 1 - (t.age / 0.4);
        ctx.fillStyle = t.color;
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

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

        ctx.fillStyle = 'rgba(255, 204, 0, 0.2)';
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 10;
        ctx.fillRect(-currentSize / 2, -currentSize / 2, currentSize, currentSize);
        ctx.strokeStyle = '#ffcc00';
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

        const color = bullet.isNeutral ? '#aaaaaa' : (bullet.isPlayer ? '#00ccff' : '#ff0066');
        const glow = bullet.isNeutral ? 'rgba(170, 170, 170, 0.3)' : (bullet.isPlayer ? 'rgba(0, 204, 255, 0.3)' : 'rgba(255, 0, 100, 0.3)');

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
        const currentRadius = s.maxRadius * Math.sin(progress * Math.PI / 2); // Ease out
        const alpha = Math.max(0, 1 - progress);

        ctx.beginPath();
        ctx.arc(s.x, s.y, currentRadius, 0, Math.PI * 2);
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = s.thickness * (1 - progress);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // Draw Player
      if (uiRef.current.status !== 'GAME_OVER') {
        const worldMouseX = state.mouse.x + state.camera.x;
        const worldMouseY = state.mouse.y + state.camera.y;
        
        ctx.strokeStyle = 'rgba(0, 255, 150, 0.3)';
        ctx.lineWidth = 2;
        
        let aimX = worldMouseX;
        let aimY = worldMouseY;
        let shouldDrawAimLine = uiRef.current.activeTool === 'weapon';
        
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
          ctx.fillStyle = 'rgba(181, 0, 255, 0.3)';
          ctx.fill();
          ctx.strokeStyle = '#b500ff';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(0, 255, 150, 0.2)';
          ctx.beginPath();
          ctx.arc(state.player.x, state.player.y, state.player.radius * 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = '#00ff96';
        ctx.beginPath();
        ctx.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // Draw dead player
        ctx.fillStyle = '#555';
        ctx.beginPath();
        ctx.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore(); // Reset transform to draw fixed UI

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
        if (uiRef.current.activeTool === 'weapon') {
           drawJoystick(rightJoyX, rightJoyY, state.touches.right, '#ff0066');
        }
      }

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      
      if (canvas) {
        canvas.removeEventListener('mousemove', handleMouseMove);
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

  return (
    <div ref={wrapperRef} className="w-full h-full relative overflow-hidden bg-[#050508] font-mono select-none">
      <div className="absolute inset-0 pointer-events-none z-50 opacity-[0.1]" style={{
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 4px)`
      }} />
      <div className="absolute inset-0 pointer-events-none z-50 shadow-[inset_0_0_150px_rgba(0,0,0,0.9)]" />
      
      <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair touch-none mix-blend-screen" />
      
      {/* Absolute HUD Layers */}
      <AnimatePresence>
        {uiState.status === 'MENU' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm z-10 pointer-events-auto"
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
                    onTouchStart={() => { isMobileRef.current = true; }}
                    onClick={() => {
                      resetGame(isMobileRef.current ? 'mobile' : 'desktop');
                      isMobileRef.current = false;
                    }}
                    className="w-full py-3 sm:py-4 bg-[#00f0ff] hover:bg-white text-black border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-base sm:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] shrink-0"
                  >
                    ENTER ARENA
                  </button>
                </motion.div>
              ) : (
                <motion.div 
                  key="map-select"
                  initial={{ opacity: 0, scale: 0.96, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -15 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-[#0d0f1b]/95 border-2 border-[#00f0ff] shadow-[0_0_30px_rgba(0,240,255,0.15)] ring-1 ring-black pointer-events-auto overflow-hidden"
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
                      <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {Object.entries(MAPS).map(([id, mapDef]) => (
                          <button
                            key={id}
                            onClick={() => setUiState(prev => ({...prev, mapId: id}))}
                            className={`flex flex-col items-center justify-center p-2 md:p-3 font-bold uppercase transition-all border-2
                              ${uiState.mapId === id 
                                 ? 'bg-[#00f0ff] text-black border-[#00f0ff] shadow-[0_0_15px_rgba(0,240,255,0.3)]' 
                                 : 'bg-[#0d0f1b] text-[#00f0ff]/60 border-[#00f0ff]/30 hover:border-[#00f0ff]/80 hover:text-[#00f0ff] hover:bg-[#00f0ff]/5'
                              }`}
                          >
                            <div className="text-[10px] sm:text-xs md:text-sm tracking-[0.1em] text-center leading-tight">{mapDef.name}</div>
                            <div className={`text-[8px] sm:text-[9px] md:text-[10px] mt-1 tracking-widest ${uiState.mapId === id ? 'text-black/80' : 'text-[#ff00a0]/60'}`}>
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
                                 </svg>
                               </div>
                            </div>
                          )
                       })()}
                    </div>

                  </div>

                  {/* Footer / Action */}
                  <div className="shrink-0 p-3 md:p-4 border-t border-[#00f0ff]/30 bg-[#0d0f1b] backdrop-blur-sm">
                    <button 
                      onClick={() => setIsMapSelectOpen(false)}
                      className="w-full py-3 md:py-4 bg-[#00f0ff]/20 hover:bg-[#00f0ff]/40 text-[#00f0ff] border border-[#00f0ff]/50 font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm md:text-base lg:text-lg cursor-pointer"
                    >
                      CONFIRM SELECTION
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {(uiState.status === 'PLAYING' || uiState.status === 'PAUSED') && (() => {
        const toolsData = {
          weapon: { label: 'WEAPON', color: '#ff0066', mobile: 'JOYSTICK TO SHOOT', desktop: 'MOUSE TO SHOOT' },
          special: { label: 'SPECIAL', color: '#b500ff', mobile: 'TAP TO DASH', desktop: 'MOUSE TO USE SPECIAL' },
          build: { label: 'BUILD', color: '#ffcc00', mobile: 'TAP TO BUILD', desktop: 'MOUSE TO BUILD' }
        } as const;
        const activeT = toolsData[uiState.activeTool];

        return (
          <>
            <div className="absolute top-0 left-0 right-0 p-4 sm:p-6 flex flex-col sm:flex-row justify-start sm:justify-between items-start pointer-events-none z-10 w-full max-w-7xl mx-auto gap-4 sm:gap-0">
              <div className="flex items-stretch gap-2 sm:gap-4">
                <div className="flex flex-col justify-around py-1 pr-2 sm:pr-4 border-r-2 border-[#00f0ff]/30 pointer-events-auto h-full">
                  <button
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setUiState(prev => ({ ...prev, status: prev.status === 'PAUSED' ? 'PLAYING' : 'PAUSED' }));
                      setConfirmResign(false);
                    }}
                    className="text-[#00f0ff]/60 font-bold tracking-[0.1em] sm:tracking-[0.2em] text-[10px] sm:text-[10px] uppercase transition-all duration-200 hover:text-[#00f0ff] hover:drop-shadow-[0_0_5px_rgba(0,240,255,0.8)] active:scale-95 text-left sm:text-right whitespace-nowrap"
                  >
                    {uiState.status === 'PAUSED' ? '▶ RES' : '॥ PAUSE'}
                  </button>
                  <button
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setConfirmResign(true);
                    }}
                    className="text-[#ff003c]/60 font-bold tracking-[0.1em] sm:tracking-[0.2em] text-[10px] sm:text-[10px] uppercase transition-all duration-200 hover:text-[#ff003c] hover:drop-shadow-[0_0_5px_rgba(255,0,60,0.8)] active:scale-95 text-left sm:text-right whitespace-nowrap mt-1"
                  >
                    ⨯ QUIT
                  </button>
                </div>
                <div className="flex flex-col items-start justify-center gap-0 sm:gap-1">
                   <div className="hidden sm:block text-xs text-[#00f0ff] tracking-[0.3em] font-bold whitespace-nowrap">SYSTEM // SCORE</div>
                   <div className="sm:hidden text-[9px] text-[#00f0ff] tracking-widest font-bold whitespace-nowrap">SCORE</div>
                   <div className="text-white font-black text-2xl sm:text-5xl tracking-tighter drop-shadow-[0_0_15px_rgba(0,240,255,0.8)] leading-none mt-1" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                     {uiState.score.toString().padStart(6, '0')}
                   </div>
                </div>
                <div className={`flex flex-col items-start justify-center gap-0 sm:gap-1 pl-2 sm:pl-4 border-l-2 h-full ${uiState.hardMode ? 'border-[#ff3300]/30' : 'border-[#ff00ff]/30'}`}>
                   <div className={`hidden sm:block text-xs tracking-[0.3em] font-bold whitespace-nowrap ${uiState.hardMode ? 'text-[#ff3300]' : 'text-[#ff00ff]'}`}>
                     {uiState.hardMode ? 'TARGET // SPAWNERS (HARD)' : 'TARGET // SPAWNERS'}
                   </div>
                   <div className={`sm:hidden text-[9px] tracking-widest font-bold whitespace-nowrap ${uiState.hardMode ? 'text-[#ff3300]' : 'text-[#ff00ff]'}`}>
                     {uiState.hardMode ? 'TARGET (HARD)' : 'TARGET'}
                   </div>
                   <div className="text-white font-black text-2xl sm:text-5xl tracking-tighter leading-none mt-1" 
                        style={{ 
                          fontFamily: 'var(--font-display, Anton, sans-serif)',
                          textShadow: `0 0 15px ${uiState.hardMode ? '#ff3300' : '#ff00ff'}`
                        }}>
                     {uiState.spawnersLeft}
                   </div>
                </div>
              </div>
               <div className="flex items-stretch gap-2 sm:gap-8">
                <div className="flex flex-col items-start sm:items-end justify-center gap-1 h-full">
                   <div className="hidden sm:block text-xs text-[#b500ff] tracking-[0.3em] font-bold whitespace-nowrap">DASH STATUS</div>
                   <div className="sm:hidden text-[9px] text-[#b500ff] tracking-widest font-bold whitespace-nowrap">DASH</div>
                   <div className="scale-100 origin-left sm:origin-right mt-1">
                     <DashStatus stateRef={stateRef} />
                   </div>
                </div>
                <div className="flex flex-col items-start sm:items-end justify-center gap-1 pl-2 sm:pl-4 border-l-2 border-[#ffcc00]/30 h-full">
                   <div className="hidden sm:block text-xs text-[#ffcc00] tracking-[0.3em] font-bold whitespace-nowrap">AVAILABLE BLOCKS</div>
                   <div className="sm:hidden text-[9px] text-[#ffcc00] tracking-widest font-bold whitespace-nowrap">BLOCKS</div>
                   <div className="text-white font-black text-2xl sm:text-4xl tracking-tighter drop-shadow-[0_0_10px_rgba(255,204,0,0.8)] leading-none mt-1" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                     x{uiState.blocks}
                   </div>
                </div>
              </div>
            </div>

            {uiState.status === 'PAUSED' && !confirmResign && (
              <div className="absolute inset-0 bg-black/50 pointer-events-none z-10 flex items-center justify-center backdrop-blur-sm">
                 <h2 className="text-5xl sm:text-6xl md:text-7xl font-black text-white/50 tracking-tighter" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>HALTED</h2>
              </div>
            )}

            {confirmResign && (
              <div className="absolute inset-0 bg-black/80 pointer-events-auto z-50 flex flex-col items-center justify-center backdrop-blur-md">
                 <h2 className="text-4xl sm:text-6xl md:text-7xl font-black text-[#ff003c] tracking-tighter drop-shadow-[0_0_15px_rgba(255,0,60,0.8)] mb-8 text-center px-4" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>
                   CONFIRM RESIGNATION?
                 </h2>
                 <div className="flex gap-4 sm:gap-8 flex-col sm:flex-row">
                   <button
                     onPointerDown={(e) => {
                       e.stopPropagation();
                       setConfirmResign(false);
                       stateRef.current.shake = 20;
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

            <div className="hidden sm:block absolute bottom-0 left-0 p-8 pointer-events-none z-10">
               <div className="text-sm text-[#00ccff] tracking-[0.2em] font-bold font-mono drop-shadow-[0_0_8px_rgba(0,204,255,0.8)]">
                 {uiState.deviceType === 'mobile' ? 'JOYSTICK TO MOVE' : 'WASD TO MOVE'}
               </div>
            </div>

            <div className={`absolute left-1/2 -translate-x-1/2 pointer-events-none z-10 flex gap-1 sm:gap-4 bottom-4 sm:bottom-6`}>
               {(Object.keys(toolsData) as Array<keyof typeof toolsData>).map((toolKey) => {
                 const tool = toolsData[toolKey];
                 const isActive = uiState.activeTool === toolKey;
                 return (
                   <button
                     key={toolKey}
                     id={`tool-btn-${toolKey}`}
                     onPointerDown={(e) => {
                       e.stopPropagation();
                       setUiState(prev => ({ ...prev, activeTool: toolKey }));
                     }}
                     className="pointer-events-auto w-16 sm:w-36 py-1 sm:py-2 border-2 font-black tracking-widest uppercase transition-all duration-200 text-[9px] sm:text-sm active:scale-95 relative overflow-hidden flex justify-center items-center gap-1 sm:gap-2"
                     style={{
                       borderColor: tool.color,
                       backgroundColor: isActive ? tool.color : 'transparent',
                       color: isActive ? '#000' : tool.color,
                       boxShadow: isActive ? `0 0 15px ${tool.color}` : 'none'
                     }}
                   >
                     {uiState.deviceType === 'desktop' && (
                       <span className="hidden sm:inline-block relative z-10 opacity-50 font-mono">[{toolKey === 'weapon' ? 1 : toolKey === 'special' ? 2 : 3}]</span>
                     )}
                     <span className="relative z-10">{tool.label}</span>
                   </button>
                 );
               })}
            </div>
            
            <div className="hidden sm:block absolute bottom-0 right-0 p-8 pointer-events-none z-10 text-right">
               <div 
                 className="text-sm tracking-[0.2em] font-bold font-mono transition-all duration-300"
                 style={{ color: activeT.color, textShadow: `0 0 8px ${activeT.color}` }}
               >
                 {uiState.deviceType === 'mobile' ? activeT.mobile : activeT.desktop}
               </div>
            </div>
          </>
        );
      })()}

      {uiState.status === 'VICTORY' && (
        <div className="absolute inset-0 bg-[#00f0ff]/90 flex flex-col items-center justify-center p-4 sm:p-6 text-center backdrop-blur-md z-20">
          <div className="max-w-xl w-full bg-[#0a0000] border-2 border-[#00f0ff] p-6 sm:p-8 md:p-12 shadow-[10px_10px_0_#00f0ff]">
            <h2 className="text-5xl sm:text-6xl md:text-7xl font-black text-[#00f0ff] mb-2 sm:mb-4 tracking-tighter" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>VICTORY</h2>
            <div className="text-xs sm:text-sm font-mono text-[#00f0ff]/80 mb-6 md:mb-10 uppercase tracking-widest border-t border-b border-[#00f0ff]/30 py-4 sm:py-6">
              FINAL SCORE: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.score}</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <button 
                onTouchStart={() => { isMobileRef.current = true; }}
                onClick={() => {
                  resetGame(isMobileRef.current ? 'mobile' : 'desktop');
                  isMobileRef.current = false;
                }}
                className="flex-1 py-3 sm:py-4 bg-[#00f0ff] hover:bg-white text-black border-2 border-[#00f0ff] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
              >
                RE-ENTER ARENA
              </button>
              <button 
                onClick={() => {
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

      {uiState.status === 'GAME_OVER' && (
        <div className="absolute inset-0 bg-red-950/90 flex flex-col items-center justify-center p-4 sm:p-6 text-center backdrop-blur-md z-20">
          <div className="max-w-xl w-full bg-[#0a0000] border-2 border-[#ff003c] p-6 sm:p-8 md:p-12 shadow-[10px_10px_0_#ff003c]">
            <h2 className="text-5xl sm:text-6xl md:text-7xl font-black text-[#ff003c] mb-2 sm:mb-4 tracking-tighter" style={{ fontFamily: 'var(--font-display, Anton, sans-serif)' }}>ANNIHILATED</h2>
            <div className="text-xs sm:text-sm font-mono text-red-200/80 mb-6 md:mb-10 uppercase tracking-widest border-t border-b border-red-500/30 py-4 sm:py-6">
              FINAL SCORE: <span className="text-white font-bold text-xl sm:text-2xl ml-2">{uiState.score}</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <button 
                onTouchStart={() => { isMobileRef.current = true; }}
                onClick={() => {
                  resetGame(isMobileRef.current ? 'mobile' : 'desktop');
                  isMobileRef.current = false;
                }}
                className="flex-1 py-3 sm:py-4 bg-[#ff003c] hover:bg-white text-black border-2 border-[#ff003c] font-black tracking-[0.2em] transition-all duration-200 uppercase text-sm sm:text-base md:text-lg active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[5px_5px_0_#fff] pointer-events-auto"
              >
                RE-ENTER ARENA
              </button>
              <button 
                onClick={() => {
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
    </div>
  );
}

