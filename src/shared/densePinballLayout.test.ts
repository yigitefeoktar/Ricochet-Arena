import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENSE_PINBALL_SPAWNERS,
  DENSE_PINBALL_WALLS,
  type DensePinballWall,
} from './densePinballLayout';

const WORLD_SIZE = 3_000;
const PLAYER_RADIUS = 20;
const GRID_STEP = 20;

function circleOverlapsWall(x: number, y: number, radius: number, wall: DensePinballWall): boolean {
  const closestX = Math.max(wall.x, Math.min(x, wall.x + wall.w));
  const closestY = Math.max(wall.y, Math.min(y, wall.y + wall.h));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

function isWalkable(x: number, y: number): boolean {
  return !DENSE_PINBALL_WALLS.some(wall => circleOverlapsWall(x, y, PLAYER_RADIUS, wall));
}

test('Shrapnel Grid is substantially denser than Pinball and uses five ordinary objectives', () => {
  assert.ok(DENSE_PINBALL_WALLS.length >= 48, 'expected a genuinely dense bumper field');
  assert.equal(DENSE_PINBALL_SPAWNERS.length, 5);
  for (const spawner of DENSE_PINBALL_SPAWNERS) {
    assert.deepEqual(Object.keys(spawner).sort(), ['hp', 'maxHp', 'radius', 'x', 'y']);
  }
});

test('Shrapnel Grid walls stay inside the arena and leave every objective clear', () => {
  for (const wall of DENSE_PINBALL_WALLS) {
    assert.ok(wall.x >= 0 && wall.y >= 0);
    assert.ok(wall.x + wall.w <= WORLD_SIZE && wall.y + wall.h <= WORLD_SIZE);
  }

  for (const spawner of DENSE_PINBALL_SPAWNERS) {
    assert.equal(
      DENSE_PINBALL_WALLS.some(wall => circleOverlapsWall(spawner.x, spawner.y, spawner.radius + 20, wall)),
      false,
      `objective at ${spawner.x},${spawner.y} must have safe clearance`,
    );
  }
});

test('a player-sized route connects every Shrapnel Grid objective', () => {
  const width = Math.floor(WORLD_SIZE / GRID_STEP) + 1;
  const key = (x: number, y: number) => y * width + x;
  const start = {
    x: Math.round(DENSE_PINBALL_SPAWNERS[0].x / GRID_STEP),
    y: Math.round(DENSE_PINBALL_SPAWNERS[0].y / GRID_STEP),
  };
  const queue = [start];
  const visited = new Set([key(start.x, start.y)]);

  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = cell.x + dx;
      const nextY = cell.y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= width) continue;
      const nextKey = key(nextX, nextY);
      if (visited.has(nextKey)) continue;
      if (!isWalkable(nextX * GRID_STEP, nextY * GRID_STEP)) continue;
      visited.add(nextKey);
      queue.push({ x: nextX, y: nextY });
    }
  }

  for (const spawner of DENSE_PINBALL_SPAWNERS) {
    const spawnerKey = key(
      Math.round(spawner.x / GRID_STEP),
      Math.round(spawner.y / GRID_STEP),
    );
    assert.equal(visited.has(spawnerKey), true, `objective at ${spawner.x},${spawner.y} must remain reachable`);
  }
});

