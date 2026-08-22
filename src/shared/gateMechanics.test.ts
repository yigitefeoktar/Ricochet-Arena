import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceGateState,
  advanceGateStateWithTransitions,
  createInitialGateStates,
  gateHasCollision,
  gateOverlapsCircle,
  gateOverlapsRect,
  gateStatesMatchDefinitions,
  getGateCollisionWalls,
  getGateOpenProgress,
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
  const warning = advanceGateState(initial, 5_000);
  assert.equal(warning.phase, 'warning_open');
  const opening = advanceGateState(warning, 5_750);
  assert.equal(opening.phase, 'opening');
  assert.equal(getGateOpenProgress(opening, 5_900), 0.5);
  const open = advanceGateState(opening, 6_050);
  assert.equal(open.phase, 'open');
});

test('gate closes on schedule even when the doorway would be occupied', () => {
  const warningClose = { id: gate.id, phase: 'warning_close' as const, phaseStartedAt: 1_000 };
  const closing = advanceGateState(warningClose, 1_750);
  assert.equal(closing.phase, 'closing');
  assert.equal(getGateCollisionWalls([gate], [closing]).length, 0);

  const closed = advanceGateState(closing, 2_050);
  assert.equal(closed.phase, 'closed');
  assert.equal(getGateCollisionWalls([gate], [closed]).length, 1);
});

test('a completed close is reported even when a stalled frame advances past closed', () => {
  const warningClose = { id: gate.id, phase: 'warning_close' as const, phaseStartedAt: 1_000 };
  const result = advanceGateStateWithTransitions(warningClose, 6_100);
  assert.equal(result.state.phase, 'warning_open');
  assert.equal(
    result.transitions.some(transition => transition.from === 'closing' && transition.to === 'closed'),
    true,
  );
});

test('gate crush geometry identifies circles and rectangles in the doorway', () => {
  assert.equal(gateOverlapsCircle(gate, { x: 250, y: 90, radius: 16 }), true);
  assert.equal(gateOverlapsCircle(gate, { x: 20, y: 20, radius: 16 }), false);
  assert.equal(gateOverlapsRect(gate, { x: 200, y: 90, w: 50, h: 50 }), true);
  assert.equal(gateOverlapsRect(gate, { x: 20, y: 20, w: 50, h: 50 }), false);
  assert.equal(gateOverlapsCircle(gate, { x: Number.NaN, y: 100, radius: 16 }), false);
  assert.equal(gateOverlapsRect(gate, { x: 200, y: 100, w: -1, h: 50 }), false);
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
