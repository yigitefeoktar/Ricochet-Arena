export interface DensePinballWall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DensePinballSpawner {
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
}

const WORLD_SIZE = 3_000;

const BASE_WALLS: DensePinballWall[] = [
  { x: 0, y: 0, w: WORLD_SIZE, h: 50 },
  { x: 0, y: 0, w: 50, h: WORLD_SIZE },
  { x: WORLD_SIZE - 50, y: 0, w: 50, h: WORLD_SIZE },
  { x: 0, y: WORLD_SIZE - 50, w: WORLD_SIZE, h: 50 },
];

export const DENSE_PINBALL_SPAWNERS: DensePinballSpawner[] = [
  { x: 260, y: 260, radius: 40, hp: 100, maxHp: 100 },
  { x: 2_740, y: 260, radius: 40, hp: 100, maxHp: 100 },
  { x: 1_500, y: 1_500, radius: 40, hp: 100, maxHp: 100 },
  { x: 350, y: 2_430, radius: 40, hp: 100, maxHp: 100 },
  { x: 2_650, y: 2_720, radius: 40, hp: 100, maxHp: 100 },
];

const TUNNEL_WALLS: DensePinballWall[] = [
  // Two cramped, single-ended objective tunnels preserve Pinball's best feature
  // while placing the entrances at different heights and on opposite sides.
  { x: 150, y: 2_320, w: 760, h: 50 },
  { x: 150, y: 2_490, w: 760, h: 50 },
  { x: 2_090, y: 2_610, w: 760, h: 50 },
  { x: 2_090, y: 2_780, w: 760, h: 50 },
];

function overlapsSpawnerClearance(wall: DensePinballWall): boolean {
  return DENSE_PINBALL_SPAWNERS.some(spawner => {
    const padding = spawner.radius + 75;
    const closestX = Math.max(wall.x, Math.min(spawner.x, wall.x + wall.w));
    const closestY = Math.max(wall.y, Math.min(spawner.y, wall.y + wall.h));
    const dx = spawner.x - closestX;
    const dy = spawner.y - closestY;
    return dx * dx + dy * dy < padding * padding;
  });
}

function createBumperField(): DensePinballWall[] {
  const walls: DensePinballWall[] = [];

  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const variant = (row + column) % 3;
      const w = variant === 0 ? 150 : variant === 1 ? 90 : 70;
      const h = variant === 0 ? 70 : variant === 1 ? 90 : 150;
      const wall = {
        x: 300 + column * 335 + (row % 2 === 1 ? 85 : 0),
        y: 440 + row * 340,
        w,
        h,
      };

      if (wall.x + wall.w < WORLD_SIZE - 100 && !overlapsSpawnerClearance(wall)) {
        walls.push(wall);
      }
    }
  }

  return walls;
}

export const DENSE_PINBALL_WALLS: DensePinballWall[] = [
  ...BASE_WALLS,
  ...TUNNEL_WALLS,
  ...createBumperField(),
];

