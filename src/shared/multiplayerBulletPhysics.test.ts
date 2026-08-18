import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findEarliestCircleTargetHit,
  sweepCircleAgainstAabb,
  traceReflectedBulletMotion,
  type AxisAlignedSurface,
} from './multiplayerBulletPhysics';

const wall = (id: string, x: number, y: number, w: number, h: number): AxisAlignedSurface => ({
  id,
  kind: 'wall',
  x,
  y,
  w,
  h,
});

test('circle sweep returns the exact first contact point', () => {
  const hit = sweepCircleAgainstAabb(0, 50, 100, 50, 5, wall('wall', 60, 0, 10, 100));
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 55) < 1e-9);
  assert.equal(hit.y, 50);
  assert.equal(hit.t, 0.55);
  assert.deepEqual(hit.normals, [{ nx: -1, ny: 0 }]);
});

test('a bounce consumes the unused movement and preserves speed', () => {
  const trace = traceReflectedBulletMotion({
    x: 20,
    y: 50,
    dx: 100,
    dy: 0,
    durationSeconds: 1,
    radius: 5,
    surfaces: [wall('wall', 60, 0, 10, 100)],
  });

  assert.equal(trace.collisions.length, 1);
  assert.ok(Math.abs(trace.collisions[0].x - 55) < 1e-6);
  assert.ok(Math.abs(trace.x - (-10)) < 0.01, `unexpected final x ${trace.x}`);
  assert.equal(trace.dx, -100);
  assert.equal(Math.hypot(trace.dx, trace.dy), 100);
});

test('corner collisions reflect both velocity axes deterministically', () => {
  const trace = traceReflectedBulletMotion({
    x: 20,
    y: 20,
    dx: 100,
    dy: 100,
    durationSeconds: 0.5,
    radius: 5,
    surfaces: [wall('corner', 60, 60, 20, 20)],
  });
  assert.equal(trace.collisions.length, 1);
  assert.ok(Math.abs(trace.dx + 100) < 1e-9);
  assert.ok(Math.abs(trace.dy + 100) < 1e-9);
});

test('rounded rectangle corners do not create false square-corner hits', () => {
  const hit = sweepCircleAgainstAabb(0, 0, 55, 55, 5, wall('corner', 60, 60, 20, 20));
  assert.equal(hit, null);
});

test('a target behind a wall is never selected through the wall', () => {
  const trace = traceReflectedBulletMotion({
    x: 20,
    y: 50,
    dx: 200,
    dy: 0,
    durationSeconds: 0.5,
    radius: 5,
    surfaces: [wall('wall', 60, 0, 10, 100)],
  });
  const hit = findEarliestCircleTargetHit(trace.segments, () => [{
    id: 'enemy',
    x: 80,
    y: 50,
    radius: 10,
    priority: 0,
    data: 'enemy',
  }]);
  assert.equal(hit, null);
});

test('circle targets are swept instead of endpoint-tested', () => {
  const trace = traceReflectedBulletMotion({
    x: 0,
    y: 50,
    dx: 1_000,
    dy: 0,
    durationSeconds: 0.1,
    radius: 5,
    surfaces: [],
  });
  const hit = findEarliestCircleTargetHit(trace.segments, () => [{
    id: 'enemy',
    x: 50,
    y: 50,
    radius: 15,
    priority: 0,
    data: 'enemy',
  }]);
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 35) < 1e-6);
});

test('Build surfaces use the same continuous collision path as walls', () => {
  const trace = traceReflectedBulletMotion({
    x: 0,
    y: 50,
    dx: 200,
    dy: 0,
    durationSeconds: 0.5,
    radius: 5,
    surfaces: [{ ...wall('build', 60, 0, 20, 100), kind: 'build' }],
  });
  assert.equal(trace.collisions[0]?.kind, 'build');
  assert.ok(Math.abs(trace.collisions[0].x - 55) < 1e-6);
  assert.equal(trace.dx, -200);
});

test('all relic variants can participate as deterministic swept dynamic surfaces', () => {
  for (const relicType of [
    'shield',
    'kinetic',
    'singularity',
    'magma_gates',
    'crystal',
    'titan_sweeper',
    'titan_cross',
    'titan_moons',
    'titan_gate',
    'titan_triangle',
    'titan_sweeper_overdrive',
    'titan_cross_overdrive',
    'titan_moons_overdrive',
    'titan_gate_overdrive',
    'titan_triangle_overdrive',
  ]) {
    const trace = traceReflectedBulletMotion({
      x: 0,
      y: 50,
      dx: 200,
      dy: 0,
      durationSeconds: 0.5,
      radius: 5,
      surfaces: [],
      dynamicSurface: (startX, startY, endX, endY) => ({
        id: `relic:${relicType}`,
        kind: 'relic',
        t: 0.5,
        x: startX + (endX - startX) * 0.5,
        y: startY + (endY - startY) * 0.5,
        normals: [{ nx: -1, ny: 0 }],
        data: relicType,
      }),
    });
    assert.equal(trace.collisions[0]?.data, relicType);
    assert.equal(trace.dx, -200);
  }
});

test('a titan surface overtaking a bullet depenetrates it without changing speed', () => {
  const trace = traceReflectedBulletMotion({
    x: 10,
    y: 50,
    dx: -200,
    dy: 0,
    durationSeconds: 0.05,
    radius: 5,
    surfaces: [],
    dynamicSurface: (startX, startY) => ({
      id: 'relic:0:moon-0',
      kind: 'relic',
      t: 0,
      x: startX,
      y: startY,
      separationX: 4,
      separationY: 50,
      forceResolve: true,
      normals: [{ nx: -1, ny: 0 }],
    }),
  });

  assert.equal(trace.collisions.length, 1);
  assert.ok(trace.x < 4, `bullet did not escape the relic: ${trace.x}`);
  assert.equal(Math.hypot(trace.dx, trace.dy), 200);
  assert.equal(trace.exhaustedCollisionBudget, false);
});

test('ordinary dynamic surfaces retain their previous outward-motion behavior', () => {
  const trace = traceReflectedBulletMotion({
    x: 10,
    y: 50,
    dx: -200,
    dy: 0,
    durationSeconds: 0.05,
    radius: 5,
    surfaces: [],
    dynamicSurface: (startX, startY) => ({
      id: 'relic:shield',
      kind: 'relic',
      t: 0,
      x: startX,
      y: startY,
      normals: [{ nx: -1, ny: 0 }],
    }),
  });

  assert.equal(trace.collisions.length, 0);
  assert.equal(trace.x, 0);
  assert.equal(trace.dx, -200);
});

test('30, 60, 120 FPS and irregular schedules produce the same trajectory', () => {
  const surfaces = [
    wall('left', 0, 0, 20, 600),
    wall('right', 980, 0, 20, 600),
    wall('top', 0, 0, 1_000, 20),
    wall('bottom', 0, 580, 1_000, 20),
  ];
  const simulate = (schedule: number[]) => {
    let state = { x: 200, y: 200, dx: 317, dy: 173 };
    for (const durationSeconds of schedule) {
      const trace = traceReflectedBulletMotion({ ...state, durationSeconds, radius: 5, surfaces });
      state = { x: trace.x, y: trace.y, dx: trace.dx, dy: trace.dy };
    }
    return state;
  };
  const seconds = 6;
  const at30 = simulate(Array.from({ length: seconds * 30 }, () => 1 / 30));
  const at60 = simulate(Array.from({ length: seconds * 60 }, () => 1 / 60));
  const at120 = simulate(Array.from({ length: seconds * 120 }, () => 1 / 120));
  const irregularDurations: number[] = [];
  let remaining = seconds;
  let index = 0;
  while (remaining > 1e-9) {
    const next = Math.min(remaining, [0.009, 0.027, 0.014, 0.021][index++ % 4]);
    irregularDurations.push(next);
    remaining -= next;
  }
  const irregular = simulate(irregularDurations);
  for (const result of [at60, at120, irregular]) {
    assert.ok(Math.hypot(result.x - at30.x, result.y - at30.y) < 0.02);
    assert.ok(Math.hypot(result.dx - at30.dx, result.dy - at30.dy) < 1e-6);
  }
});

test('10,000 deterministic randomized steps stay finite and preserve speed', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const arena = [
    wall('top', 0, 0, 1_000, 20),
    wall('left', 0, 0, 20, 1_000),
    wall('right', 980, 0, 20, 1_000),
    wall('bottom', 0, 980, 1_000, 20),
    wall('middle', 470, 250, 60, 500),
  ];

  for (let index = 0; index < 10_000; index += 1) {
    const angle = random() * Math.PI * 2;
    const speed = 120 + random() * 480;
    const trace = traceReflectedBulletMotion({
      x: 40 + random() * 400,
      y: 40 + random() * 920,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      durationSeconds: [1 / 30, 1 / 60, 1 / 120, 0.011, 0.027][index % 5],
      radius: 5,
      surfaces: arena,
    });
    assert.ok(Number.isFinite(trace.x) && Number.isFinite(trace.y));
    assert.ok(Number.isFinite(trace.dx) && Number.isFinite(trace.dy));
    assert.ok(Math.abs(Math.hypot(trace.dx, trace.dy) - speed) < 1e-6);
  }
});
