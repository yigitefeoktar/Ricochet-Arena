import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

    assert.ok(first.length >= 1 && first.length <= 3);
    assert.deepEqual(first, repeated);
    signatures.add(first.map(primitive => primitive.kind === 'circle'
      ? `circle:${primitive.radius}`
      : `segment:${Math.round(Math.hypot(primitive.bx - primitive.ax, primitive.by - primitive.ay))}:${primitive.radius}`
    ).join('|'));
    assert.ok(getTitanRelicVisualRadius(specialType) >= 560);
  }

  assert.equal(signatures.size, TITAN_RELIC_TYPES.length);
});

test('titan relic structures are genuinely massive and rotate without changing shape', () => {
  for (const specialType of TITAN_RELIC_TYPES) {
    const spawner = { x: 1_500, y: 1_500, specialType };
    const first = getTitanRelicPrimitives(spawner, 0);
    const later = getTitanRelicPrimitives(spawner, 1_000);

    assert.notDeepEqual(first, later);
    const furthestExtent = Math.max(...first.flatMap(primitive => {
      if (primitive.kind === 'circle') {
        return [Math.hypot(primitive.cx - spawner.x, primitive.cy - spawner.y) + primitive.radius];
      }
      return [
        Math.hypot(primitive.ax - spawner.x, primitive.ay - spawner.y) + primitive.radius,
        Math.hypot(primitive.bx - spawner.x, primitive.by - spawner.y) + primitive.radius,
      ];
    }));
    assert.ok(furthestExtent >= 500);
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
