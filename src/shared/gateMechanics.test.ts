import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceGateState,
  createInitialGateStates,
  gateHasCollision,
  gateStatesMatchDefinitions,
  getGateCollisionWalls,
  getGateOpenProgress,
  isGateDoorwayOccupied,
  type GateDefinition,
} from './gateMechanics';
import { traceReflectedBulletMotion } from './multiplayerBulletPhysics';

const gate: GateDefinition = {
  id: 'gate-a',
  x: 100,
  y: 100,
  w: 300,
  h: 50,
  orientation: 'horizontal',
};

test('gate collider exists only while fully closed or warning to open', () => {
  assert.equal(gateHasCollision('closed'), true);
  assert.equal(gateHasCollision('warning_open'), true);
  assert.equal(gateHasCollision('opening'), false);
  assert.equal(gateHasCollision('open'), false);
  assert.equal(gateHasCollision('warning_close'), false);
  assert.equal(gateHasCollision('closing'), false);
});

test('gate follows the intended closed-warning-open cycle', () => {
  const [initial] = createInitialGateStates([gate], 1_000);
  const warning = advanceGateState(initial, 5_000, false);
  assert.equal(warning.phase, 'warning_open');
  const opening = advanceGateState(warning, 5_750, false);
  assert.equal(opening.phase, 'opening');
  assert.equal(getGateOpenProgress(opening, 5_900), 0.5);
  const open = advanceGateState(opening, 6_050, false);
  assert.equal(open.phase, 'open');
});

test('occupied doorway postpones closing without activating a collider', () => {
  const warningClose = { id: gate.id, phase: 'warning_close' as const, phaseStartedAt: 1_000 };
  const held = advanceGateState(warningClose, 1_750, true);
  assert.equal(held.phase, 'warning_close');
  assert.equal(getGateCollisionWalls([gate], [held]).length, 0);

  const closing = advanceGateState(held, 1_750, false);
  assert.equal(closing.phase, 'closing');
  const aborted = advanceGateState(closing, 2_050, true);
  assert.equal(aborted.phase, 'warning_close');
  assert.equal(getGateCollisionWalls([gate], [aborted]).length, 0);
});

test('players, enemies and Build rectangles can hold a doorway open', () => {
  assert.equal(isGateDoorwayOccupied(gate, [{ x: 250, y: 90, radius: 16 }], []), true);
  assert.equal(isGateDoorwayOccupied(gate, [{ x: 20, y: 20, radius: 16 }], []), false);
  assert.equal(isGateDoorwayOccupied(gate, [], [{ x: 200, y: 90, w: 50, h: 50 }]), true);
  assert.equal(isGateDoorwayOccupied(gate, [], [{ x: 20, y: 20, w: 50, h: 50 }]), false);
});

test('network gate states must exactly match the map definitions', () => {
  const states = createInitialGateStates([gate], 100);
  assert.equal(gateStatesMatchDefinitions([gate], states), true);
  assert.equal(gateStatesMatchDefinitions([gate], [{ ...states[0], id: 'other' }]), false);
  assert.equal(gateStatesMatchDefinitions([gate], []), false);
});

test('a closed gate uses the ordinary multiplayer wall bounce path', () => {
  const [closedState] = createInitialGateStates([gate], 0);
  const [closedWall] = getGateCollisionWalls([gate], [closedState]);
  const closedTrace = traceReflectedBulletMotion({
    x: 250,
    y: 20,
    dx: 0,
    dy: 120,
    durationSeconds: 1,
    radius: 5,
    surfaces: [{ id: gate.id, kind: 'wall', ...closedWall }],
  });
  assert.ok(closedTrace.dy < 0);
  assert.equal(closedTrace.collisions[0]?.id, gate.id);

  const openState = { id: gate.id, phase: 'open' as const, phaseStartedAt: 0 };
  assert.equal(getGateCollisionWalls([gate], [openState]).length, 0);
});
