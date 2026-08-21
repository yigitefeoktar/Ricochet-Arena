export type GateOrientation = 'horizontal' | 'vertical';

export type GatePhase =
  | 'closed'
  | 'warning_open'
  | 'opening'
  | 'open'
  | 'warning_close'
  | 'closing';

export interface GateDefinition {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: GateOrientation;
  initialDelayMs?: number;
}

export interface GateRuntimeState {
  id: string;
  phase: GatePhase;
  phaseStartedAt: number;
}

export interface GateCircleOccupant {
  x: number;
  y: number;
  radius: number;
}

export interface GateRectOccupant {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const GATE_TIMINGS_MS = {
  closed: 4_000,
  warning_open: 750,
  opening: 300,
  open: 3_000,
  warning_close: 750,
  closing: 300,
} as const;

export const GATE_PHASES: readonly GatePhase[] = [
  'closed',
  'warning_open',
  'opening',
  'open',
  'warning_close',
  'closing',
];

export function isGatePhase(value: unknown): value is GatePhase {
  return typeof value === 'string' &&
    (GATE_PHASES as readonly string[]).includes(value);
}

export function createInitialGateStates(
  definitions: readonly GateDefinition[],
  now: number,
): GateRuntimeState[] {
  return definitions.map(definition => ({
    id: definition.id,
    phase: 'closed',
    phaseStartedAt: now + Math.max(0, definition.initialDelayMs ?? 0),
  }));
}

export function gateHasCollision(phase: GatePhase): boolean {
  return phase === 'closed' || phase === 'warning_open';
}

export function getGateOpenProgress(
  state: GateRuntimeState,
  now: number,
): number {
  if (state.phase === 'open' || state.phase === 'warning_close') return 1;
  if (state.phase === 'closed' || state.phase === 'warning_open') return 0;

  const duration = GATE_TIMINGS_MS[state.phase];
  const progress = Math.max(0, Math.min(1, (now - state.phaseStartedAt) / duration));
  return state.phase === 'opening' ? progress : 1 - progress;
}

export function isGateDoorwayOccupied(
  gate: GateDefinition,
  circles: readonly GateCircleOccupant[],
  rects: readonly GateRectOccupant[],
  padding = 8,
): boolean {
  const left = gate.x - padding;
  const top = gate.y - padding;
  const right = gate.x + gate.w + padding;
  const bottom = gate.y + gate.h + padding;

  for (const circle of circles) {
    if (!circle || !Number.isFinite(circle.x) || !Number.isFinite(circle.y) || !Number.isFinite(circle.radius)) continue;
    const closestX = Math.max(left, Math.min(circle.x, right));
    const closestY = Math.max(top, Math.min(circle.y, bottom));
    const dx = circle.x - closestX;
    const dy = circle.y - closestY;
    if (dx * dx + dy * dy <= circle.radius * circle.radius) return true;
  }

  for (const rect of rects) {
    if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) continue;
    if (
      rect.x < right &&
      rect.x + rect.w > left &&
      rect.y < bottom &&
      rect.y + rect.h > top
    ) {
      return true;
    }
  }

  return false;
}

function nextPhase(phase: GatePhase): GatePhase {
  switch (phase) {
    case 'closed': return 'warning_open';
    case 'warning_open': return 'opening';
    case 'opening': return 'open';
    case 'open': return 'warning_close';
    case 'warning_close': return 'closing';
    case 'closing': return 'closed';
  }
}

export function advanceGateState(
  state: GateRuntimeState,
  now: number,
  doorwayOccupied: boolean,
): GateRuntimeState {
  if (!Number.isFinite(now) || now < state.phaseStartedAt) return state;

  let current = state;
  for (let transitionCount = 0; transitionCount < 8; transitionCount += 1) {
    const duration = GATE_TIMINGS_MS[current.phase];
    if (now - current.phaseStartedAt < duration) return current;

    if (current.phase === 'warning_close' && doorwayOccupied) {
      // Keep the doorway visibly open and retry from the end of the warning
      // period. This makes clearing the doorway safe without changing the
      // cadence of any other gate.
      return {
        ...current,
        phaseStartedAt: now - duration,
      };
    }

    if (current.phase === 'closing' && doorwayOccupied) {
      // Something entered during the visual closing movement. Abort before a
      // collider is enabled and give it a complete warning period to leave.
      return {
        id: current.id,
        phase: 'warning_close',
        phaseStartedAt: now,
      };
    }

    current = {
      id: current.id,
      phase: nextPhase(current.phase),
      phaseStartedAt: current.phaseStartedAt + duration,
    };
  }

  return current;
}

export function getGateCollisionWalls(
  definitions: readonly GateDefinition[],
  states: readonly GateRuntimeState[],
): Array<{ x: number; y: number; w: number; h: number }> {
  const stateById = new Map(states.map(state => [state.id, state]));
  return definitions.flatMap(definition => {
    const state = stateById.get(definition.id);
    if (!state || !gateHasCollision(state.phase)) return [];
    return [{ x: definition.x, y: definition.y, w: definition.w, h: definition.h }];
  });
}

export function gateStatesMatchDefinitions(
  definitions: readonly GateDefinition[],
  states: readonly GateRuntimeState[],
): boolean {
  if (definitions.length !== states.length) return false;
  const expectedIds = new Set(definitions.map(definition => definition.id));
  return states.every(state =>
    expectedIds.has(state.id) &&
    isGatePhase(state.phase) &&
    Number.isFinite(state.phaseStartedAt) &&
    state.phaseStartedAt >= 0,
  );
}
