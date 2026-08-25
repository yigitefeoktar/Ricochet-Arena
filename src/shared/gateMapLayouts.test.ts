import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEW_GATE_MAP_IDS,
  NEW_GATE_MAP_LAYOUTS,
  type GateMapLayout,
} from './gateMapLayouts';
import { getTimedGateStateLimit } from './matchSettings';

const WORLD_SIZE = 3_000;
const PLAYER_RADIUS = 22;

type Rect = { x: number; y: number; w: number; h: number };

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function circleOverlapsRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

function reachableCells(
  map: GateMapLayout,
  closedGates = map.gates,
  startTarget: { x: number; y: number } = map.spawners[0],
): Set<string> {
  const step = 50;
  const min = 75;
  const max = WORLD_SIZE - 75;
  const obstacles: Rect[] = [...map.walls, ...closedGates];
  const key = (x: number, y: number) => `${x},${y}`;
  const isOpen = (x: number, y: number) =>
    obstacles.every(rect => !circleOverlapsRect(x, y, PLAYER_RADIUS, rect));

  const cells: Array<{ x: number; y: number }> = [];
  for (let y = min; y <= max; y += step) {
    for (let x = min; x <= max; x += step) {
      if (isOpen(x, y)) cells.push({ x, y });
    }
  }

  const start = cells
    .filter(cell => Math.hypot(cell.x - startTarget.x, cell.y - startTarget.y) <= 300)
    .sort((a, b) =>
      Math.hypot(a.x - startTarget.x, a.y - startTarget.y) -
      Math.hypot(b.x - startTarget.x, b.y - startTarget.y)
    )[0];
  assert.ok(start, `${map.name} needs an open navigation cell near the requested start`);

  const openKeys = new Set(cells.map(cell => key(cell.x, cell.y)));
  const visited = new Set<string>([key(start.x, start.y)]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nextX = cell.x + dx;
      const nextY = cell.y + dy;
      const nextKey = key(nextX, nextY);
      if (!openKeys.has(nextKey) || visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push({ x: nextX, y: nextY });
    }
  }
  return visited;
}

test('new gate maps have distinct IDs, intended difficulty progression and no relics', () => {
  assert.equal(new Set(NEW_GATE_MAP_IDS).size, 8);
  assert.equal(NEW_GATE_MAP_LAYOUTS.overflow.difficulty, 'MEDIUM');
  for (const mapId of ['containment_breach', 'crossflow', 'conveyor'] as const) {
    assert.equal(NEW_GATE_MAP_LAYOUTS[mapId].difficulty, 'HARD');
  }
  for (const mapId of ['crush_circuit', 'the_press', 'kill_chambers', 'pulse_corridor'] as const) {
    assert.equal(NEW_GATE_MAP_LAYOUTS[mapId].difficulty, 'EXPERT');
  }
  for (const map of Object.values(NEW_GATE_MAP_LAYOUTS)) {
    assert.equal(map.spawners.length, 5, `${map.name} should have five objectives`);
    assert.equal(map.spawners.some(spawner => spawner.specialType), false, `${map.name} must stay separate from relic maps`);
  }
});

test('new gates fit the multiplayer cap and never overlap walls, spawners or each other', () => {
  for (const [mapId, map] of Object.entries(NEW_GATE_MAP_LAYOUTS)) {
    assert.ok(
      map.gates.length >= 3 && map.gates.length <= getTimedGateStateLimit(mapId),
      `${mapId} gate count must fit its network validation budget`,
    );
    assert.equal(new Set(map.gates.map(gate => gate.id)).size, map.gates.length, `${mapId} gate IDs must be unique`);

    for (const gate of map.gates) {
      assert.ok(gate.x >= 50 && gate.y >= 50, `${mapId}/${gate.id} starts outside the arena wall`);
      assert.ok(gate.x + gate.w <= WORLD_SIZE - 50, `${mapId}/${gate.id} exceeds arena width`);
      assert.ok(gate.y + gate.h <= WORLD_SIZE - 50, `${mapId}/${gate.id} exceeds arena height`);
      assert.ok(gate.w > 0 && gate.h > 0, `${mapId}/${gate.id} has positive size`);
      assert.equal(
        gate.orientation === 'horizontal' ? gate.w > gate.h : gate.h > gate.w,
        true,
        `${mapId}/${gate.id} orientation must match its shape`,
      );
      for (const wall of map.walls) {
        assert.equal(rectsOverlap(gate, wall), false, `${mapId}/${gate.id} overlaps a static wall`);
      }
      for (const objective of map.spawners) {
        assert.equal(
          circleOverlapsRect(objective.x, objective.y, objective.radius + 30, gate),
          false,
          `${mapId}/${gate.id} is too close to a spawner`,
        );
      }
    }

    for (let first = 0; first < map.gates.length; first += 1) {
      for (let second = first + 1; second < map.gates.length; second += 1) {
        assert.equal(
          rectsOverlap(map.gates[first], map.gates[second]),
          false,
          `${mapId} gates ${map.gates[first].id} and ${map.gates[second].id} overlap`,
        );
      }
    }

    for (const objective of map.spawners) {
      for (const wall of map.walls) {
        assert.equal(
          circleOverlapsRect(objective.x, objective.y, objective.radius + 30, wall),
          false,
          `${mapId} has a spawner too close to a wall`,
        );
      }
    }
  }
});

test('all objectives remain connected by a player-sized route with every gate closed', () => {
  for (const [mapId, map] of Object.entries(NEW_GATE_MAP_LAYOUTS)) {
    if (mapId === 'containment_breach' || mapId === 'conveyor') continue;
    const visited = reachableCells(map);
    for (const objective of map.spawners) {
      const hasReachableCell = [...visited].some(cellKey => {
        const [x, y] = cellKey.split(',').map(Number);
        return Math.hypot(x - objective.x, y - objective.y) <= 300;
      });
      assert.equal(hasReachableCell, true, `${mapId} strands an objective when every gate is closed`);
    }
  }
});

test('The Conveyor vertical gates span their lanes without bypass gaps', () => {
  const map = NEW_GATE_MAP_LAYOUTS.conveyor;
  const expectedSupports: Rect[] = [
    { x: 2_150, y: 650, w: 50, h: 150 },
    { x: 2_150, y: 1_050, w: 50, h: 150 },
    { x: 650, y: 1_850, w: 50, h: 150 },
    { x: 650, y: 2_250, w: 50, h: 150 },
  ];
  for (const support of expectedSupports) {
    assert.equal(
      map.walls.some(wall => wall.x === support.x && wall.y === support.y && wall.w === support.w && wall.h === support.h),
      true,
      `missing Conveyor gate support at ${support.x},${support.y}`,
    );
  }

  const upperGate = map.gates.find(gate => gate.id === 'conveyor-upper-cut');
  const lowerGate = map.gates.find(gate => gate.id === 'conveyor-lower-cut');
  assert.deepEqual(upperGate && { x: upperGate.x, top: upperGate.y, bottom: upperGate.y + upperGate.h }, { x: 2_150, top: 800, bottom: 1_050 });
  assert.deepEqual(lowerGate && { x: lowerGate.x, top: lowerGate.y, bottom: lowerGate.y + lowerGate.h }, { x: 650, top: 2_000, bottom: 2_250 });
});

test('Pulse Corridor contains twenty phased gate pairs and a permanent wave-shaped route', () => {
  const map = NEW_GATE_MAP_LAYOUTS.pulse_corridor;
  assert.equal(map.gates.length, 40);

  const centers: number[] = [];
  for (let column = 0; column < 20; column += 1) {
    const top = map.gates.find(gate => gate.id === `pulse-${column}-top`);
    const bottom = map.gates.find(gate => gate.id === `pulse-${column}-bottom`);
    assert.ok(top && bottom, `pulse column ${column} needs a top and bottom gate`);
    assert.equal(top.x, bottom.x);
    assert.equal(top.initialDelayMs, column * 160);
    assert.equal(bottom.initialDelayMs, column * 160);
    assert.ok(bottom.y - (top.y + top.h) >= 340, `pulse column ${column} needs a player-safe permanent gap`);
    centers.push((top.y + top.h + bottom.y) / 2);
  }

  assert.ok(Math.max(...centers) - Math.min(...centers) >= 400, 'the corridor opening should visibly undulate');
  for (const objective of map.spawners) {
    assert.ok(objective.y > 1_100 && objective.y < 1_900, 'Pulse Corridor objectives must remain inside its safe wave channel');
  }
});

test('each Containment Breach room has exactly one exit through its matching gate', () => {
  const map = NEW_GATE_MAP_LAYOUTS.containment_breach;
  const exteriorStart = { x: 1_500, y: 2_700 };
  const isSpawnerReachable = (visited: Set<string>, spawnerIndex: number) =>
    [...visited].some(cellKey => {
      const [x, y] = cellKey.split(',').map(Number);
      const spawner = map.spawners[spawnerIndex];
      return Math.hypot(x - spawner.x, y - spawner.y) <= 300;
    });

  const allClosed = reachableCells(map, map.gates, exteriorStart);
  for (let spawnerIndex = 0; spawnerIndex < map.spawners.length; spawnerIndex += 1) {
    assert.equal(isSpawnerReachable(allClosed, spawnerIndex), false, `room ${spawnerIndex} leaks while its gate is closed`);
  }

  for (let openGateIndex = 0; openGateIndex < map.gates.length; openGateIndex += 1) {
    const closedGates = map.gates.filter((_, gateIndex) => gateIndex !== openGateIndex);
    const visited = reachableCells(map, closedGates, exteriorStart);
    for (let spawnerIndex = 0; spawnerIndex < map.spawners.length; spawnerIndex += 1) {
      assert.equal(
        isSpawnerReachable(visited, spawnerIndex),
        spawnerIndex === openGateIndex,
        `opening gate ${map.gates[openGateIndex].id} must expose only its own room`,
      );
    }
  }
});
