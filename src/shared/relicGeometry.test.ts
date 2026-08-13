import assert from 'node:assert/strict';
import test from 'node:test';
import { getColossusBladeSegments } from './relicGeometry';

test('colossus geometry produces three equal colossal blades on a stable orbit', () => {
  const spawner = { x: 1_500, y: 1_500 };
  const blades = getColossusBladeSegments(spawner, 0);

  assert.equal(blades.length, 3);
  for (const blade of blades) {
    const centerX = (blade.ax + blade.bx) / 2;
    const centerY = (blade.ay + blade.by) / 2;
    assert.ok(Math.abs(Math.hypot(centerX - spawner.x, centerY - spawner.y) - 190) < 1e-9);
    assert.ok(Math.abs(Math.hypot(blade.bx - blade.ax, blade.by - blade.ay) - 184) < 1e-9);
    assert.equal(blade.thickness, 16);
  }
});

test('colossus geometry is deterministic and rotates without changing its dimensions', () => {
  const spawner = { x: 560, y: 560 };
  const first = getColossusBladeSegments(spawner, 5_000);
  const repeated = getColossusBladeSegments(spawner, 5_000);
  const later = getColossusBladeSegments(spawner, 6_000);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, later);
  for (let index = 0; index < first.length; index += 1) {
    const firstLength = Math.hypot(first[index].bx - first[index].ax, first[index].by - first[index].ay);
    const laterLength = Math.hypot(later[index].bx - later[index].ax, later[index].by - later[index].ay);
    assert.ok(Math.abs(firstLength - laterLength) < 1e-9);
  }
});
