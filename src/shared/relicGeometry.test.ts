import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OVERDRIVE_TITAN_RELIC_TYPES,
  STANDARD_TITAN_RELIC_TYPES,
  TITAN_RELIC_TYPES,
  getTitanRelicCarry,
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

test('players outside a titan relic receive no carry', () => {
  const spawner = { x: 1_500, y: 1_500, specialType: 'titan_sweeper' };
  assert.equal(getTitanRelicCarry(2_900, 2_900, 20, spawner, 0, 16), null);
});
