import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OVERDRIVE_TITAN_RELIC_TYPES,
  STANDARD_TITAN_RELIC_TYPES,
  TITAN_ORBIT_RELIC_LAYOUT,
  TITAN_RELIC_TYPES,
  getTitanRelicCarry,
  getTitanRelicCarriedPosition,
  getTitanRelicCarriedPositionWithContact,
  getTitanRelicPrimitives,
  getTitanRelicVisualRadius,
} from './relicGeometry';

test('every titan spawner has a distinct deterministic simple geometry', () => {
  const signatures = new Set<string>();

  for (const specialType of TITAN_RELIC_TYPES) {
    const spawner = { x: 1_500, y: 1_500, specialType };
    const first = getTitanRelicPrimitives(spawner, 4_000);
    const repeated = getTitanRelicPrimitives(spawner, 4_000);

    assert.ok(first.length >= 1 && first.length <= 16);
    assert.deepEqual(first, repeated);
    signatures.add(first.map(primitive => primitive.kind === 'circle'
      ? `circle:${primitive.radius}`
      : `segment:${Math.round(Math.hypot(primitive.bx - primitive.ax, primitive.by - primitive.ay))}:${primitive.radius}`
    ).join('|'));
    assert.ok(getTitanRelicVisualRadius(specialType) >= 500);
  }

  assert.equal(signatures.size, TITAN_RELIC_TYPES.length);
});

test('overdrive titan relics add moving geometry without changing the base identity', () => {
  for (let index = 0; index < STANDARD_TITAN_RELIC_TYPES.length; index += 1) {
    const standardType = STANDARD_TITAN_RELIC_TYPES[index];
    const overdriveType = OVERDRIVE_TITAN_RELIC_TYPES[index];
    const spawner = { x: 1_500, y: 1_500 };
    const standard = getTitanRelicPrimitives({ ...spawner, specialType: standardType }, 2_000);
    const overdrive = getTitanRelicPrimitives({ ...spawner, specialType: overdriveType }, 2_000);

    assert.ok(overdrive.length > standard.length);
    assert.ok(overdrive.length >= 10);
  }
});

test('Titan Tempest relic motion zones cannot overlap each other', () => {
  const layout = [
    { x: 600, y: 600, specialType: 'titan_sweeper_overdrive' },
    { x: 2_400, y: 600, specialType: 'titan_cross_overdrive' },
    { x: 1_500, y: 1_500, specialType: 'titan_gate_overdrive' },
    { x: 600, y: 2_400, specialType: 'titan_moons_overdrive' },
    { x: 2_400, y: 2_400, specialType: 'titan_triangle_overdrive' },
  ];

  for (let firstIndex = 0; firstIndex < layout.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < layout.length; secondIndex += 1) {
      const first = layout[firstIndex];
      const second = layout[secondIndex];
      const centerDistance = Math.hypot(second.x - first.x, second.y - first.y);
      const combinedMotionRadius = getTitanRelicVisualRadius(first.specialType)
        + getTitanRelicVisualRadius(second.specialType);

      assert.ok(centerDistance > combinedMotionRadius + 150);
    }
  }
});

test('Titan Orbit relic motion zones cannot overlap each other or the arena boundary', () => {
  const layout = TITAN_ORBIT_RELIC_LAYOUT;
  const boundaryThickness = 50;
  const arenaSize = 3_000;

  for (const relic of layout) {
    const motionRadius = getTitanRelicVisualRadius(relic.specialType);
    assert.ok(relic.x - motionRadius > boundaryThickness);
    assert.ok(relic.y - motionRadius > boundaryThickness);
    assert.ok(relic.x + motionRadius < arenaSize - boundaryThickness);
    assert.ok(relic.y + motionRadius < arenaSize - boundaryThickness);
  }

  for (let firstIndex = 0; firstIndex < layout.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < layout.length; secondIndex += 1) {
      const first = layout[firstIndex];
      const second = layout[secondIndex];
      const centerDistance = Math.hypot(second.x - first.x, second.y - first.y);
      const combinedMotionRadius = getTitanRelicVisualRadius(first.specialType)
        + getTitanRelicVisualRadius(second.specialType);

      assert.ok(centerDistance > combinedMotionRadius + 30);
    }
  }
});

test('titan relic structures are genuinely massive and rotate without changing shape', () => {
  for (const specialType of TITAN_RELIC_TYPES) {
    const spawner = { x: 1_500, y: 1_500, specialType };
    const first = getTitanRelicPrimitives(spawner, 0);
    const later = getTitanRelicPrimitives(spawner, 1_000);

    assert.notDeepEqual(first, later);
    const furthestExtent = Math.max(...Array.from({ length: 9 }, (_, index) => index * 2_000)
      .flatMap(sampleTime => getTitanRelicPrimitives(spawner, sampleTime))
      .flatMap(primitive => {
        if (primitive.kind === 'circle') {
          return [Math.hypot(primitive.cx - spawner.x, primitive.cy - spawner.y) + primitive.radius];
        }
        return [
          Math.hypot(primitive.ax - spawner.x, primitive.ay - spawner.y) + primitive.radius,
          Math.hypot(primitive.bx - spawner.x, primitive.by - spawner.y) + primitive.radius,
        ];
      }));
    assert.ok(furthestExtent >= 500);
    assert.ok(getTitanRelicVisualRadius(specialType) >= furthestExtent);
  }
});

test('contact with a moving titan relic produces finite carry instead of a lethal result', () => {
  for (const specialType of TITAN_RELIC_TYPES) {
    const spawner = { x: 1_500, y: 1_500, specialType };
    const previousTime = 5_000;
    const currentTime = 5_016;
    const primitive = getTitanRelicPrimitives(spawner, currentTime)[0];
    const playerX = primitive.kind === 'circle' ? primitive.cx : (primitive.ax + primitive.bx) / 2;
    const playerY = primitive.kind === 'circle' ? primitive.cy : (primitive.ay + primitive.by) / 2;
    const carry = getTitanRelicCarry(
      playerX,
      playerY,
      20,
      spawner,
      previousTime,
      currentTime,
    );

    assert.ok(carry);
    assert.ok(Number.isFinite(carry.dx));
    assert.ok(Number.isFinite(carry.dy));
    assert.ok(carry.overlap > 0);
    assert.ok(Math.hypot(carry.dx, carry.dy) > 0);
  }
});

test('the shared titan carry path moves player-sized and enemy-sized circular entities', () => {
  const spawner = { x: 1_500, y: 1_500, specialType: 'titan_moons' };
  const previousTime = 5_000;
  const currentTime = 5_016;
  const moon = getTitanRelicPrimitives(spawner, currentTime)[0];
  assert.equal(moon.kind, 'circle');
  if (moon.kind !== 'circle') return;

  for (const radius of [20, 24]) {
    const entity = { x: moon.cx, y: moon.cy, radius };
    const carried = getTitanRelicCarriedPosition(
      entity,
      [spawner],
      previousTime,
      currentTime,
    );

    assert.equal(carried.contactCount, 1);
    assert.ok(Number.isFinite(carried.x));
    assert.ok(Number.isFinite(carried.y));
    assert.ok(Math.hypot(carried.dx, carried.dy) > 0);
  }
});

test('the shared titan carry path ignores non-titan spawners', () => {
  const entity = { x: 1_500, y: 1_500, radius: 24 };
  assert.deepEqual(
    getTitanRelicCarriedPosition(
      entity,
      [{ x: 1_500, y: 1_500, specialType: 'kinetic' }],
      0,
      16,
    ),
    { x: entity.x, y: entity.y, dx: 0, dy: 0, contactCount: 0 },
  );
});

test('players outside a titan relic receive no carry', () => {
  const spawner = { x: 1_500, y: 1_500, specialType: 'titan_sweeper' };
  assert.equal(getTitanRelicCarry(2_900, 2_900, 20, spawner, 0, 16), null);
});

function simulateLatchedMoonCarry(frameDurationMs: number) {
  const spawner = { x: 1_500, y: 1_500, specialType: 'titan_moons' };
  const firstTime = frameDurationMs;
  const firstMoon = getTitanRelicPrimitives(spawner, firstTime)[0];
  assert.equal(firstMoon.kind, 'circle');
  if (firstMoon.kind !== 'circle') throw new Error('expected moon circle');

  let entity = { x: firstMoon.cx, y: firstMoon.cy, radius: 20 };
  let contact = null;
  let previousTime = 0;
  let contactFrames = 0;

  for (let currentTime = firstTime; currentTime <= 2_000; currentTime += frameDurationMs) {
    const carried = getTitanRelicCarriedPositionWithContact(
      entity,
      [spawner],
      previousTime,
      currentTime,
      contact,
    );
    entity = { x: carried.x, y: carried.y, radius: entity.radius };
    contact = carried.contact;
    if (contact) contactFrames += 1;
    previousTime = currentTime;
  }

  return { entity, contact, contactFrames };
}

test('latched titan contact remains continuous instead of alternating every frame', () => {
  for (const frameDurationMs of [1000 / 30, 1000 / 60, 1000 / 120]) {
    const result = simulateLatchedMoonCarry(frameDurationMs);
    assert.ok(result.contact);
    assert.ok(result.contactFrames >= Math.floor(1_900 / frameDurationMs));
  }
});

test('latched titan carry is effectively frame-rate independent', () => {
  const at30 = simulateLatchedMoonCarry(1000 / 30).entity;
  const at60 = simulateLatchedMoonCarry(1000 / 60).entity;
  const at120 = simulateLatchedMoonCarry(1000 / 120).entity;

  assert.ok(Math.hypot(at30.x - at60.x, at30.y - at60.y) < 8);
  assert.ok(Math.hypot(at60.x - at120.x, at60.y - at120.y) < 8);
});

test('latched contact releases when the entity genuinely moves away', () => {
  const spawner = { x: 1_500, y: 1_500, specialType: 'titan_moons' };
  const moon = getTitanRelicPrimitives(spawner, 16)[0];
  assert.equal(moon.kind, 'circle');
  if (moon.kind !== 'circle') return;

  const acquired = getTitanRelicCarriedPositionWithContact(
    { x: moon.cx, y: moon.cy, radius: 20 },
    [spawner],
    0,
    16,
    null,
  );
  assert.ok(acquired.contact);

  const released = getTitanRelicCarriedPositionWithContact(
    { x: acquired.x + 100, y: acquired.y + 100, radius: 20 },
    [spawner],
    16,
    32,
    acquired.contact,
  );
  assert.equal(released.contact, null);
  assert.equal(released.contactCount, 0);
});
