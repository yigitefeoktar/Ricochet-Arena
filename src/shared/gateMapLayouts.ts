import type { GateDefinition } from './gateMechanics';

export type GateMapDifficulty = 'MEDIUM' | 'HARD' | 'EXPERT';

export interface GateMapLayout {
  name: string;
  difficulty: GateMapDifficulty;
  description: string;
  walls: Array<{ x: number; y: number; w: number; h: number }>;
  spawners: Array<{
    x: number;
    y: number;
    radius: number;
    hp: number;
    maxHp: number;
    specialType?: string;
  }>;
  gates: GateDefinition[];
}

export const NEW_GATE_MAP_IDS = [
  'overflow',
  'containment_breach',
  'crossflow',
  'conveyor',
  'crush_circuit',
  'the_press',
  'kill_chambers',
  'pulse_corridor',
] as const;

export type NewGateMapId = typeof NEW_GATE_MAP_IDS[number];

const WORLD_SIZE = 3_000;
const BASE_WALLS = [
  { x: 0, y: 0, w: WORLD_SIZE, h: 50 },
  { x: 0, y: 0, w: 50, h: WORLD_SIZE },
  { x: WORLD_SIZE - 50, y: 0, w: 50, h: WORLD_SIZE },
  { x: 0, y: WORLD_SIZE - 50, w: WORLD_SIZE, h: 50 },
];

const spawner = (x: number, y: number) => ({
  x,
  y,
  radius: 40,
  hp: 100,
  maxHp: 100,
});

const PULSE_CORRIDOR_GATE_COUNT = 14;
const PULSE_CORRIDOR_X_START = 250;
const PULSE_CORRIDOR_X_PITCH = 190;
const PULSE_CORRIDOR_GATE_WIDTH = 50;
const PULSE_CORRIDOR_GATE_Y = 1_350;
const PULSE_CORRIDOR_GATE_HEIGHT = 300;
const PULSE_CORRIDOR_HALL_TOP = 1_150;
const PULSE_CORRIDOR_HALL_BOTTOM = 1_850;

const PULSE_CORRIDOR_GATES: GateDefinition[] = Array.from(
  { length: PULSE_CORRIDOR_GATE_COUNT },
  (_, column) => {
    const x = PULSE_CORRIDOR_X_START + column * PULSE_CORRIDOR_X_PITCH;
    return {
      id: `pulse-${column}`,
      x,
      y: PULSE_CORRIDOR_GATE_Y,
      w: PULSE_CORRIDOR_GATE_WIDTH,
      h: PULSE_CORRIDOR_GATE_HEIGHT,
      orientation: 'vertical' as const,
      initialDelayMs: column * 220,
    };
  },
);

const PULSE_CORRIDOR_SUPPORTS = Array.from(
  { length: PULSE_CORRIDOR_GATE_COUNT },
  (_, column) => {
    const x = PULSE_CORRIDOR_X_START + column * PULSE_CORRIDOR_X_PITCH;
    return [
      {
        x,
        y: PULSE_CORRIDOR_HALL_TOP,
        w: PULSE_CORRIDOR_GATE_WIDTH,
        h: PULSE_CORRIDOR_GATE_Y - PULSE_CORRIDOR_HALL_TOP,
      },
      {
        x,
        y: PULSE_CORRIDOR_GATE_Y + PULSE_CORRIDOR_GATE_HEIGHT,
        w: PULSE_CORRIDOR_GATE_WIDTH,
        h: PULSE_CORRIDOR_HALL_BOTTOM - (PULSE_CORRIDOR_GATE_Y + PULSE_CORRIDOR_GATE_HEIGHT),
      },
    ];
  },
).flat();

const PULSE_CORRIDOR_SPAWNERS = [0, 3, 6, 9, 12].map((column, index) =>
  spawner(
    PULSE_CORRIDOR_X_START + column * PULSE_CORRIDOR_X_PITCH + PULSE_CORRIDOR_GATE_WIDTH + 70,
    index % 2 === 0 ? 1_450 : 1_550,
  )
);

export const NEW_GATE_MAP_LAYOUTS: Record<NewGateMapId, GateMapLayout> = {
  overflow: {
    name: 'Overflow',
    difficulty: 'MEDIUM',
    description: 'Three broad timed gates redirect movement and ricochets across an open arena. Every barrier has a calm route around its outer end.',
    walls: [
      ...BASE_WALLS,
      { x: 1_050, y: 250, w: 50, h: 900 },
      { x: 1_050, y: 1_500, w: 50, h: 1_050 },
      { x: 1_350, y: 1_850, w: 650, h: 50 },
      { x: 2_350, y: 1_850, w: 400, h: 50 },
      { x: 1_700, y: 700, w: 300, h: 50 },
      { x: 2_250, y: 700, w: 500, h: 50 },
      { x: 430, y: 1_250, w: 240, h: 100 },
      { x: 1_520, y: 2_350, w: 220, h: 120 },
    ],
    gates: [
      { id: 'overflow-west', x: 1_050, y: 1_150, w: 50, h: 350, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'overflow-south', x: 2_000, y: 1_850, w: 350, h: 50, orientation: 'horizontal', initialDelayMs: 2_400 },
      { id: 'overflow-north', x: 2_000, y: 700, w: 250, h: 50, orientation: 'horizontal', initialDelayMs: 4_800 },
    ],
    spawners: [
      spawner(420, 520),
      spawner(650, 2_350),
      spawner(1_500, 450),
      spawner(2_550, 1_250),
      spawner(2_100, 2_550),
    ],
  },

  containment_breach: {
    name: 'Containment Breach',
    difficulty: 'HARD',
    description: 'Five asymmetric containment rooms each have one timed exit. Wait for a gate to open, strike the exposed objective, then escape before it seals.',
    walls: [
      ...BASE_WALLS,
      // North-west room: the timed floor gate is its only exit.
      { x: 250, y: 250, w: 650, h: 50 },
      { x: 250, y: 250, w: 50, h: 650 },
      { x: 850, y: 250, w: 50, h: 650 },
      { x: 250, y: 850, w: 200, h: 50 },
      { x: 700, y: 850, w: 200, h: 50 },

      // North-east room: the timed west gate is its only exit.
      { x: 2_050, y: 300, w: 700, h: 50 },
      { x: 2_700, y: 300, w: 50, h: 650 },
      { x: 2_050, y: 900, w: 700, h: 50 },
      { x: 2_050, y: 300, w: 50, h: 200 },
      { x: 2_050, y: 750, w: 50, h: 200 },

      // Central room: the timed roof gate is its only exit.
      { x: 1_150, y: 1_150, w: 200, h: 50 },
      { x: 1_600, y: 1_150, w: 250, h: 50 },
      { x: 1_150, y: 1_150, w: 50, h: 700 },
      { x: 1_150, y: 1_800, w: 700, h: 50 },
      { x: 1_800, y: 1_150, w: 50, h: 700 },

      // South-west room: the timed east gate is its only exit.
      { x: 300, y: 2_050, w: 700, h: 50 },
      { x: 300, y: 2_050, w: 50, h: 700 },
      { x: 300, y: 2_700, w: 700, h: 50 },
      { x: 950, y: 2_050, w: 50, h: 200 },
      { x: 950, y: 2_500, w: 50, h: 250 },

      // South-east room: the timed roof gate is its only exit.
      { x: 2_000, y: 2_000, w: 250, h: 50 },
      { x: 2_500, y: 2_000, w: 250, h: 50 },
      { x: 2_000, y: 2_000, w: 50, h: 700 },
      { x: 2_700, y: 2_000, w: 50, h: 700 },
      { x: 2_000, y: 2_650, w: 750, h: 50 },
    ],
    gates: [
      { id: 'containment-nw', x: 450, y: 850, w: 250, h: 50, orientation: 'horizontal', initialDelayMs: 0 },
      { id: 'containment-ne', x: 2_050, y: 500, w: 50, h: 250, orientation: 'vertical', initialDelayMs: 1_500 },
      { id: 'containment-core', x: 1_350, y: 1_150, w: 250, h: 50, orientation: 'horizontal', initialDelayMs: 3_000 },
      { id: 'containment-sw', x: 950, y: 2_250, w: 50, h: 250, orientation: 'vertical', initialDelayMs: 4_500 },
      { id: 'containment-se', x: 2_250, y: 2_000, w: 250, h: 50, orientation: 'horizontal', initialDelayMs: 6_000 },
    ],
    spawners: [
      spawner(560, 540),
      spawner(2_400, 610),
      spawner(1_500, 1_500),
      spawner(650, 2_400),
      spawner(2_380, 2_360),
    ],
  },

  crossflow: {
    name: 'Crossflow',
    difficulty: 'HARD',
    description: 'Six offset gates pulse across intersecting routes. The open perimeter is dependable, while the center constantly changes its fastest path.',
    walls: [
      ...BASE_WALLS,
      { x: 1_450, y: 250, w: 50, h: 600 },
      { x: 1_450, y: 1_150, w: 50, h: 700 },
      { x: 1_450, y: 2_150, w: 50, h: 600 },
      { x: 250, y: 1_450, w: 500, h: 50 },
      { x: 1_050, y: 1_450, w: 900, h: 50 },
      { x: 2_250, y: 1_450, w: 500, h: 50 },
      { x: 1_750, y: 650, w: 400, h: 50 },
      { x: 2_400, y: 650, w: 350, h: 50 },
      { x: 650, y: 1_800, w: 50, h: 400 },
      { x: 650, y: 2_450, w: 50, h: 300 },
      { x: 930, y: 460, w: 170, h: 170 },
      { x: 2_100, y: 2_200, w: 190, h: 130 },
    ],
    gates: [
      { id: 'crossflow-north', x: 1_450, y: 850, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'crossflow-south', x: 1_450, y: 1_850, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 2_600 },
      { id: 'crossflow-west', x: 750, y: 1_450, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 1_300 },
      { id: 'crossflow-east', x: 1_950, y: 1_450, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 3_900 },
      { id: 'crossflow-ne', x: 2_150, y: 650, w: 250, h: 50, orientation: 'horizontal', initialDelayMs: 5_200 },
      { id: 'crossflow-sw', x: 650, y: 2_200, w: 50, h: 250, orientation: 'vertical', initialDelayMs: 6_500 },
    ],
    spawners: [
      spawner(470, 470),
      spawner(2_520, 430),
      spawner(480, 2_500),
      spawner(2_500, 2_500),
      spawner(1_050, 2_050),
    ],
  },

  conveyor: {
    name: 'The Conveyor',
    difficulty: 'HARD',
    description: 'Staggered doors force a serpentine flow through five broad lanes. Two cross-lane crushers turn the upper and lower passages into timed chokepoints.',
    walls: [
      ...BASE_WALLS,
      { x: 50, y: 600, w: 1_000, h: 50 },
      { x: 1_350, y: 600, w: 1_250, h: 50 },
      { x: 350, y: 1_200, w: 1_350, h: 50 },
      { x: 2_000, y: 1_200, w: 950, h: 50 },
      { x: 50, y: 1_800, w: 850, h: 50 },
      { x: 1_200, y: 1_800, w: 1_350, h: 50 },
      { x: 400, y: 2_400, w: 1_100, h: 50 },
      { x: 1_800, y: 2_400, w: 1_150, h: 50 },
      // These supports connect the vertical gates to the neighboring lane walls,
      // so the timed opening is the only way through each cross-lane divider.
      { x: 2_150, y: 650, w: 50, h: 150 },
      { x: 2_150, y: 1_050, w: 50, h: 150 },
      { x: 650, y: 1_850, w: 50, h: 150 },
      { x: 650, y: 2_250, w: 50, h: 150 },
    ],
    gates: [
      { id: 'conveyor-one', x: 1_050, y: 600, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 0 },
      { id: 'conveyor-two', x: 1_700, y: 1_200, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 1_200 },
      { id: 'conveyor-three', x: 900, y: 1_800, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 2_400 },
      { id: 'conveyor-four', x: 1_500, y: 2_400, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 3_600 },
      { id: 'conveyor-upper-cut', x: 2_150, y: 800, w: 50, h: 250, orientation: 'vertical', initialDelayMs: 4_800 },
      { id: 'conveyor-lower-cut', x: 650, y: 2_000, w: 50, h: 250, orientation: 'vertical', initialDelayMs: 6_000 },
    ],
    spawners: [
      spawner(300, 300),
      spawner(2_700, 900),
      spawner(300, 1_500),
      spawner(2_650, 2_100),
      spawner(500, 2_700),
    ],
  },

  crush_circuit: {
    name: 'Crush Circuit',
    difficulty: 'EXPERT',
    description: 'Six independently phased shortcuts cut through an asymmetric loop. Two objectives sit inside the circuit while the outer route remains available.',
    walls: [
      ...BASE_WALLS,
      { x: 750, y: 300, w: 50, h: 500 },
      { x: 750, y: 1_100, w: 50, h: 800 },
      { x: 750, y: 2_200, w: 50, h: 500 },
      { x: 2_200, y: 350, w: 50, h: 650 },
      { x: 2_200, y: 1_300, w: 50, h: 1_200 },
      { x: 800, y: 700, w: 550, h: 50 },
      { x: 1_650, y: 700, w: 550, h: 50 },
      { x: 800, y: 2_250, w: 400, h: 50 },
      { x: 1_500, y: 2_250, w: 500, h: 50 },
      { x: 900, y: 1_450, w: 400, h: 50 },
      { x: 1_600, y: 1_450, w: 450, h: 50 },
      { x: 1_180, y: 1_060, w: 180, h: 180 },
      { x: 1_720, y: 1_720, w: 210, h: 160 },
    ],
    gates: [
      { id: 'circuit-west-north', x: 750, y: 800, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'circuit-west-south', x: 750, y: 1_900, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 3_900 },
      { id: 'circuit-east', x: 2_200, y: 1_000, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 1_300 },
      { id: 'circuit-north', x: 1_350, y: 700, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 5_200 },
      { id: 'circuit-south-west', x: 1_200, y: 2_250, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 2_600 },
      { id: 'circuit-core', x: 1_300, y: 1_450, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 4_000 },
    ],
    spawners: [
      spawner(420, 430),
      spawner(1_600, 1_050),
      spawner(2_600, 720),
      spawner(500, 2_500),
      spawner(1_400, 1_850),
    ],
  },

  the_press: {
    name: 'The Press',
    difficulty: 'EXPERT',
    description: 'Four lanes contain paired crushing gates and generous side pockets. Read each synchronized press before committing to the center line.',
    walls: [
      ...BASE_WALLS,
      { x: 50, y: 750, w: 2_650, h: 50 },
      { x: 300, y: 1_500, w: 2_650, h: 50 },
      { x: 50, y: 2_250, w: 2_600, h: 50 },
      { x: 1_350, y: 280, w: 220, h: 120 },
      { x: 2_350, y: 1_020, w: 180, h: 130 },
      { x: 700, y: 1_700, w: 190, h: 150 },
      { x: 1_300, y: 2_600, w: 240, h: 110 },
    ],
    gates: [
      { id: 'press-a-left', x: 950, y: 170, w: 50, h: 460, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'press-a-right', x: 2_000, y: 170, w: 50, h: 460, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'press-b-left', x: 750, y: 920, w: 50, h: 460, orientation: 'vertical', initialDelayMs: 2_200 },
      { id: 'press-b-right', x: 1_750, y: 920, w: 50, h: 460, orientation: 'vertical', initialDelayMs: 2_200 },
      { id: 'press-c-left', x: 1_100, y: 1_670, w: 50, h: 460, orientation: 'vertical', initialDelayMs: 4_400 },
      { id: 'press-c-right', x: 2_250, y: 1_670, w: 50, h: 460, orientation: 'vertical', initialDelayMs: 4_400 },
      { id: 'press-d-left', x: 850, y: 2_420, w: 50, h: 400, orientation: 'vertical', initialDelayMs: 6_600 },
      { id: 'press-d-right', x: 1_900, y: 2_420, w: 50, h: 400, orientation: 'vertical', initialDelayMs: 6_600 },
    ],
    spawners: [
      spawner(350, 350),
      spawner(2_600, 1_080),
      spawner(500, 1_850),
      spawner(2_600, 2_650),
      spawner(1_450, 1_100),
    ],
  },

  kill_chambers: {
    name: 'Kill Chambers',
    difficulty: 'EXPERT',
    description: 'Four paired-gate cells interrupt an irregular route around an exposed objective. Each synchronized pair leaves narrow escape margins along its walls.',
    walls: [
      ...BASE_WALLS,
      // North-west horizontal chamber.
      { x: 200, y: 250, w: 950, h: 50 },
      { x: 200, y: 750, w: 950, h: 50 },
      // Tall east chamber, shifted down from the corner.
      { x: 2_100, y: 300, w: 50, h: 1_150 },
      { x: 2_700, y: 300, w: 50, h: 1_150 },
      // Wide south-west chamber.
      { x: 250, y: 1_950, w: 1_000, h: 50 },
      { x: 250, y: 2_550, w: 1_000, h: 50 },
      // Vertical inner chamber creates an offset fourth cell.
      { x: 1_450, y: 1_500, w: 50, h: 900 },
      { x: 2_000, y: 1_500, w: 50, h: 900 },
      // Open objective cover deliberately avoids a central square.
      { x: 900, y: 1_020, w: 150, h: 100 },
      { x: 1_250, y: 1_300, w: 110, h: 170 },
      { x: 700, y: 1_520, w: 190, h: 110 },
      { x: 2_350, y: 1_750, w: 180, h: 140 },
    ],
    gates: [
      { id: 'chamber-nw-entry', x: 450, y: 370, w: 50, h: 260, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'chamber-nw-exit', x: 900, y: 370, w: 50, h: 260, orientation: 'vertical', initialDelayMs: 0 },
      { id: 'chamber-east-entry', x: 2_250, y: 600, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 2_200 },
      { id: 'chamber-east-exit', x: 2_250, y: 1_100, w: 300, h: 50, orientation: 'horizontal', initialDelayMs: 2_200 },
      { id: 'chamber-sw-entry', x: 550, y: 2_100, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 4_400 },
      { id: 'chamber-sw-exit', x: 1_050, y: 2_100, w: 50, h: 300, orientation: 'vertical', initialDelayMs: 4_400 },
      { id: 'chamber-inner-entry', x: 1_580, y: 1_700, w: 290, h: 50, orientation: 'horizontal', initialDelayMs: 6_600 },
      { id: 'chamber-inner-exit', x: 1_580, y: 2_200, w: 290, h: 50, orientation: 'horizontal', initialDelayMs: 6_600 },
    ],
    spawners: [
      spawner(700, 500),
      spawner(2_420, 850),
      spawner(800, 2_280),
      spawner(1_720, 1_950),
      spawner(1_100, 1_200),
    ],
  },

  pulse_corridor: {
    name: 'Pulse Corridor',
    difficulty: 'EXPERT',
    description: 'Fourteen normal-sized gates open in a tight left-to-right sequence along one straight hall. Move with the travelling opening before the doors close behind you.',
    walls: [
      ...BASE_WALLS,
      { x: 150, y: 1_100, w: 2_700, h: 50 },
      { x: 150, y: 1_850, w: 2_700, h: 50 },
      { x: 150, y: 1_100, w: 50, h: 250 },
      { x: 150, y: 1_650, w: 50, h: 250 },
      { x: 2_800, y: 1_100, w: 50, h: 250 },
      { x: 2_800, y: 1_650, w: 50, h: 250 },
      ...PULSE_CORRIDOR_SUPPORTS,
    ],
    gates: PULSE_CORRIDOR_GATES,
    spawners: PULSE_CORRIDOR_SPAWNERS,
  },
};
