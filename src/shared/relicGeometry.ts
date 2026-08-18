export const STANDARD_TITAN_RELIC_TYPES = [
  'titan_sweeper',
  'titan_cross',
  'titan_moons',
  'titan_gate',
  'titan_triangle',
] as const;

export const OVERDRIVE_TITAN_RELIC_TYPES = [
  'titan_sweeper_overdrive',
  'titan_cross_overdrive',
  'titan_moons_overdrive',
  'titan_gate_overdrive',
  'titan_triangle_overdrive',
] as const;

export const TITAN_RELIC_TYPES = [
  ...STANDARD_TITAN_RELIC_TYPES,
  ...OVERDRIVE_TITAN_RELIC_TYPES,
] as const;

export type StandardTitanRelicType = typeof STANDARD_TITAN_RELIC_TYPES[number];
export type TitanRelicType = typeof TITAN_RELIC_TYPES[number];

export type TitanRelicSegment = {
  kind: 'segment';
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
};

export type TitanRelicCircle = {
  kind: 'circle';
  id: string;
  cx: number;
  cy: number;
  radius: number;
};

export type TitanRelicPrimitive = TitanRelicSegment | TitanRelicCircle;

export type TitanRelicCarry = {
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  overlap: number;
};

export type TitanRelicCarriedPosition = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  contactCount: number;
};

export type TitanRelicPalette = {
  fill: string;
  accent: string;
};

export const TITAN_ORBIT_RELIC_LAYOUT = [
  { x: 640, y: 640, specialType: 'titan_sweeper' },
  { x: 2_360, y: 640, specialType: 'titan_cross' },
  { x: 1_500, y: 1_500, specialType: 'titan_triangle' },
  { x: 640, y: 2_360, specialType: 'titan_moons' },
  { x: 2_360, y: 2_360, specialType: 'titan_gate' },
] as const satisfies ReadonlyArray<{ x: number; y: number; specialType: StandardTitanRelicType }>;

const TITAN_PALETTES: Record<StandardTitanRelicType, TitanRelicPalette> = {
  titan_sweeper: { fill: '#45d9ff', accent: '#126b82' },
  titan_cross: { fill: '#ffd34d', accent: '#806200' },
  titan_moons: { fill: '#ff7597', accent: '#7d2440' },
  titan_gate: { fill: '#66e39b', accent: '#17683d' },
  titan_triangle: { fill: '#c681ff', accent: '#612b88' },
};

export function isTitanRelicType(value: string | undefined): value is TitanRelicType {
  return TITAN_RELIC_TYPES.includes(value as TitanRelicType);
}

export function isOverdriveTitanRelicType(value: string | undefined): boolean {
  return typeof value === 'string' && value.endsWith('_overdrive') && isTitanRelicType(value);
}

function getStandardType(value: TitanRelicType): StandardTitanRelicType {
  return value.replace('_overdrive', '') as StandardTitanRelicType;
}

export function getTitanRelicPalette(value: string | undefined): TitanRelicPalette {
  if (!isTitanRelicType(value)) return { fill: '#b9b5c2', accent: '#6f397f' };
  return TITAN_PALETTES[getStandardType(value)];
}

function getOrbitAngle(
  spawner: { x: number; y: number },
  currentTime: number,
  speed: number,
  overdrive: boolean,
): number {
  const seed = Math.round(spawner.x / 10) * 17 + Math.round(spawner.y / 10) * 31;
  const direction = seed % 2 === 0 ? 1 : -1;
  const phaseOffset = (seed % 360) * Math.PI / 180;
  const speedScale = overdrive ? 1.38 : 1;
  return phaseOffset + direction * currentTime * speed * speedScale;
}

function segmentAt(
  id: string,
  centerX: number,
  centerY: number,
  angle: number,
  halfLength: number,
  radius: number,
): TitanRelicSegment {
  const dx = Math.cos(angle) * halfLength;
  const dy = Math.sin(angle) * halfLength;
  return {
    kind: 'segment',
    id,
    ax: centerX - dx,
    ay: centerY - dy,
    bx: centerX + dx,
    by: centerY + dy,
    radius,
  };
}

function triangleAt(
  idPrefix: string,
  centerX: number,
  centerY: number,
  angle: number,
  triangleRadius = 190,
  segmentRadius = 27,
): TitanRelicSegment[] {
  const vertices = Array.from({ length: 3 }, (_, index) => {
    const vertexAngle = angle + index * Math.PI * 2 / 3;
    return {
      x: centerX + Math.cos(vertexAngle) * triangleRadius,
      y: centerY + Math.sin(vertexAngle) * triangleRadius,
    };
  });
  return vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return {
      kind: 'segment' as const,
      id: `${idPrefix}-${index}`,
      ax: vertex.x,
      ay: vertex.y,
      bx: next.x,
      by: next.y,
      radius: segmentRadius,
    };
  });
}

function circleAt(
  id: string,
  centerX: number,
  centerY: number,
  angle: number,
  orbitRadius: number,
  radius: number,
): TitanRelicCircle {
  return {
    kind: 'circle',
    id,
    cx: centerX + Math.cos(angle) * orbitRadius,
    cy: centerY + Math.sin(angle) * orbitRadius,
    radius,
  };
}

function diamondAt(
  idPrefix: string,
  centerX: number,
  centerY: number,
  angle: number,
  radius: number,
): TitanRelicSegment[] {
  const points = Array.from({ length: 4 }, (_, index) => {
    const pointAngle = angle + Math.PI / 4 + index * Math.PI / 2;
    return {
      x: centerX + Math.cos(pointAngle) * radius,
      y: centerY + Math.sin(pointAngle) * radius,
    };
  });
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return {
      kind: 'segment' as const,
      id: `${idPrefix}-${index}`,
      ax: point.x,
      ay: point.y,
      bx: next.x,
      by: next.y,
      radius: 18,
    };
  });
}

export function getTitanRelicPrimitives(
  spawner: { x: number; y: number; specialType?: string },
  currentTime: number,
): TitanRelicPrimitive[] {
  const type = spawner.specialType;
  if (!isTitanRelicType(type)) return [];

  const standardType = getStandardType(type);
  const overdrive = isOverdriveTitanRelicType(type);

  // Titan Tempest uses many smaller pieces in five deliberately different
  // arrangements. Each arrangement stays inside a bounded motion zone so
  // relic systems belonging to neighboring spawners never intersect.
  if (overdrive && standardType === 'titan_sweeper') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00031, true);
    return Array.from({ length: 10 }, (_, index) => circleAt(
      `orb-chain-${index}`,
      spawner.x,
      spawner.y,
      angle + index * Math.PI * 2 / 10,
      460,
      52,
    ));
  }

  if (overdrive && standardType === 'titan_cross') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00035, true);
    return Array.from({ length: 10 }, (_, index) => {
      const blockAngle = angle + index * Math.PI * 2 / 10;
      const centerX = spawner.x + Math.cos(blockAngle) * 470;
      const centerY = spawner.y + Math.sin(blockAngle) * 470;
      return segmentAt(`bar-carousel-${index}`, centerX, centerY, blockAngle + Math.PI / 2, 68, 26);
    });
  }

  if (overdrive && standardType === 'titan_moons') {
    const outerAngle = getOrbitAngle(spawner, currentTime, 0.00028, true);
    const innerAngle = getOrbitAngle(spawner, currentTime, -0.00040, true) + Math.PI / 6;
    return [
      ...Array.from({ length: 6 }, (_, index) => circleAt(
        `double-ring-outer-${index}`,
        spawner.x,
        spawner.y,
        outerAngle + index * Math.PI / 3,
        460,
        50,
      )),
      ...Array.from({ length: 6 }, (_, index) => circleAt(
        `double-ring-inner-${index}`,
        spawner.x,
        spawner.y,
        innerAngle + index * Math.PI / 3,
        255,
        34,
      )),
    ];
  }

  if (overdrive && standardType === 'titan_gate') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00033, true);
    return Array.from({ length: 4 }, (_, index) => {
      const diamondAngle = angle + index * Math.PI / 2;
      const centerX = spawner.x + Math.cos(diamondAngle) * 420;
      const centerY = spawner.y + Math.sin(diamondAngle) * 420;
      return diamondAt(`diamond-chain-${index}`, centerX, centerY, -diamondAngle, 72);
    }).flat();
  }

  if (overdrive && standardType === 'titan_triangle') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00038, true);
    const bars = Array.from({ length: 8 }, (_, index) => {
      const turbineAngle = angle + index * Math.PI / 4;
      const centerX = spawner.x + Math.cos(turbineAngle) * 400;
      const centerY = spawner.y + Math.sin(turbineAngle) * 400;
      return segmentAt(`turbine-bar-${index}`, centerX, centerY, turbineAngle, 78, 23);
    });
    const nodes = Array.from({ length: 4 }, (_, index) => circleAt(
      `turbine-node-${index}`,
      spawner.x,
      spawner.y,
      -angle + Math.PI / 8 + index * Math.PI / 2,
      220,
      34,
    ));
    return [...bars, ...nodes];
  }

  if (standardType === 'titan_sweeper') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00023, overdrive);
    const count = overdrive ? 2 : 1;
    return Array.from({ length: count }, (_, index) => {
      const orbitAngle = angle + index * Math.PI;
      const centerX = spawner.x + Math.cos(orbitAngle) * 360;
      const centerY = spawner.y + Math.sin(orbitAngle) * 360;
      return segmentAt(`sweeper-${index}`, centerX, centerY, orbitAngle + Math.PI / 2, 310, 34);
    });
  }

  if (standardType === 'titan_cross') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00026, overdrive);
    const count = overdrive ? 2 : 1;
    return Array.from({ length: count }, (_, index) => {
      const orbitAngle = angle + index * Math.PI;
      const centerX = spawner.x + Math.cos(orbitAngle) * 390;
      const centerY = spawner.y + Math.sin(orbitAngle) * 390;
      return [
        segmentAt(`cross-${index}-a`, centerX, centerY, orbitAngle, 164, 24),
        segmentAt(`cross-${index}-b`, centerX, centerY, orbitAngle + Math.PI / 2, 164, 24),
      ];
    }).flat();
  }

  if (standardType === 'titan_moons') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00021, overdrive);
    const count = overdrive ? 4 : 2;
    return Array.from({ length: count }, (_, index) => {
      const moonAngle = angle + index * Math.PI * 2 / count;
      return {
        kind: 'circle' as const,
        id: `moon-${index}`,
        cx: spawner.x + Math.cos(moonAngle) * 410,
        cy: spawner.y + Math.sin(moonAngle) * 410,
        radius: 112,
      };
    });
  }

  if (standardType === 'titan_gate') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00024, overdrive);
    const orbitRadii = overdrive ? [300, 420, 540] : [255, 465];
    return orbitRadii.map((orbitRadius, index) => {
      const centerX = spawner.x + Math.cos(angle) * orbitRadius;
      const centerY = spawner.y + Math.sin(angle) * orbitRadius;
      return segmentAt(`gate-${index}`, centerX, centerY, angle + Math.PI / 2, 245, 30);
    });
  }

  const angle = getOrbitAngle(spawner, currentTime, 0.00022, overdrive);
  const count = overdrive ? 2 : 1;
  return Array.from({ length: count }, (_, index) => {
    const orbitAngle = angle + index * Math.PI;
    const centerX = spawner.x + Math.cos(orbitAngle) * 390;
    const centerY = spawner.y + Math.sin(orbitAngle) * 390;
    return triangleAt(`triangle-${index}`, centerX, centerY, orbitAngle, 148, 21);
  }).flat();
}

function closestPointOnSegment(
  x: number,
  y: number,
  segment: TitanRelicSegment,
): { x: number; y: number; t: number } {
  const vx = segment.bx - segment.ax;
  const vy = segment.by - segment.ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((x - segment.ax) * vx + (y - segment.ay) * vy) / lengthSquared))
    : 0;
  return {
    x: segment.ax + vx * t,
    y: segment.ay + vy * t,
    t,
  };
}

export function getTitanRelicCarry(
  playerX: number,
  playerY: number,
  playerRadius: number,
  spawner: { x: number; y: number; specialType?: string },
  previousTime: number,
  currentTime: number,
): TitanRelicCarry | null {
  const candidate = getTitanRelicCarryCandidate(
    playerX,
    playerY,
    playerRadius,
    spawner,
    previousTime,
    currentTime,
    null,
  );
  if (!candidate) return null;
  return {
    dx: candidate.dx,
    dy: candidate.dy,
    nx: candidate.nx,
    ny: candidate.ny,
    overlap: candidate.overlap,
  };
}

interface TitanRelicCarryCandidate extends TitanRelicCarry {
  primitiveId: string;
}

function getTitanRelicCarryCandidate(
  playerX: number,
  playerY: number,
  playerRadius: number,
  spawner: { x: number; y: number; specialType?: string },
  previousTime: number,
  currentTime: number,
  latchedPrimitiveId: string | null,
): TitanRelicCarryCandidate | null {
  const current = getTitanRelicPrimitives(spawner, currentTime);
  const previousById = new Map(
    getTitanRelicPrimitives(spawner, previousTime).map(primitive => [primitive.id, primitive]),
  );

  let best: TitanRelicCarryCandidate | null = null;
  for (const primitive of current) {
    if (latchedPrimitiveId !== null && primitive.id !== latchedPrimitiveId) continue;
    const previous = previousById.get(primitive.id);
    let contactX: number;
    let contactY: number;
    let previousContactX: number;
    let previousContactY: number;
    let obstacleRadius: number;

    if (primitive.kind === 'circle') {
      if (!previous || previous.kind !== 'circle') continue;
      contactX = primitive.cx;
      contactY = primitive.cy;
      previousContactX = previous.cx;
      previousContactY = previous.cy;
      obstacleRadius = primitive.radius;
    } else {
      if (!previous || previous.kind !== 'segment') continue;
      const closest = closestPointOnSegment(playerX, playerY, primitive);
      contactX = closest.x;
      contactY = closest.y;
      previousContactX = previous.ax + (previous.bx - previous.ax) * closest.t;
      previousContactY = previous.ay + (previous.by - previous.ay) * closest.t;
      obstacleRadius = primitive.radius;
    }

    const offsetX = playerX - contactX;
    const offsetY = playerY - contactY;
    const distance = Math.hypot(offsetX, offsetY);
    const minimumDistance = playerRadius + obstacleRadius;

    const shapeDx = contactX - previousContactX;
    const shapeDy = contactY - previousContactY;
    const shapeSpeed = Math.hypot(shapeDx, shapeDy);
    // A latched contact gets a very small release margin. Without it, the
    // penetration correction places the entity exactly on the surface and
    // floating-point/frame-step differences make contact alternate on/off.
    // New contacts still require a real overlap, so nearby relics cannot pull
    // an entity toward them.
    const releaseMargin = latchedPrimitiveId === primitive.id
      ? Math.max(2, Math.min(8, shapeSpeed * 1.5 + 1))
      : 0;
    if (distance >= minimumDistance + releaseMargin) continue;

    const nx = distance > 0.001
      ? offsetX / distance
      : shapeSpeed > 0.001
        ? shapeDx / shapeSpeed
        : 1;
    const ny = distance > 0.001
      ? offsetY / distance
      : shapeSpeed > 0.001
        ? shapeDy / shapeSpeed
        : 0;
    const overlap = Math.max(0, minimumDistance - distance);
    const carry = {
      dx: shapeDx + nx * overlap,
      dy: shapeDy + ny * overlap,
      nx,
      ny,
      overlap,
      primitiveId: primitive.id,
    };

    if (!best || carry.overlap > best.overlap) best = carry;
  }

  return best;
}

export interface TitanRelicContact {
  spawnerIndex: number;
  primitiveId: string;
}

export interface TitanRelicContactResult extends TitanRelicCarriedPosition {
  contact: TitanRelicContact | null;
}

export interface TitanRelicPenetrationResult {
  x: number;
  y: number;
  correctionCount: number;
}

/**
 * Deterministically moves a circular entity outside titan geometry at one
 * world phase. This is a multiplayer safety net for a moving platform that
 * overtakes an entity between authoritative ticks; non-titan relics are
 * intentionally ignored.
 */
export function resolveTitanRelicPenetration(
  entity: { x: number; y: number; radius: number },
  spawners: ReadonlyArray<{ x: number; y: number; specialType?: string }>,
  currentTime: number,
  maxIterations: number = 8,
): TitanRelicPenetrationResult {
  let x = entity.x;
  let y = entity.y;
  let correctionCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let best: {
      overlap: number;
      nx: number;
      ny: number;
      key: string;
    } | null = null;

    for (let spawnerIndex = 0; spawnerIndex < spawners.length; spawnerIndex += 1) {
      const spawner = spawners[spawnerIndex];
      if (!spawner || !isTitanRelicType(spawner.specialType)) continue;
      for (const primitive of getTitanRelicPrimitives(spawner, currentTime)) {
        let contactX: number;
        let contactY: number;
        if (primitive.kind === 'circle') {
          contactX = primitive.cx;
          contactY = primitive.cy;
        } else {
          const closest = closestPointOnSegment(x, y, primitive);
          contactX = closest.x;
          contactY = closest.y;
        }

        const offsetX = x - contactX;
        const offsetY = y - contactY;
        const distance = Math.hypot(offsetX, offsetY);
        const overlap = entity.radius + primitive.radius - distance;
        if (overlap <= 1e-6) continue;

        let nx: number;
        let ny: number;
        if (distance > 1e-6) {
          nx = offsetX / distance;
          ny = offsetY / distance;
        } else if (primitive.kind === 'circle') {
          const radialX = primitive.cx - spawner.x;
          const radialY = primitive.cy - spawner.y;
          const radialLength = Math.hypot(radialX, radialY);
          nx = radialLength > 1e-6 ? radialX / radialLength : 1;
          ny = radialLength > 1e-6 ? radialY / radialLength : 0;
        } else {
          const segmentX = primitive.bx - primitive.ax;
          const segmentY = primitive.by - primitive.ay;
          const segmentLength = Math.hypot(segmentX, segmentY);
          nx = segmentLength > 1e-6 ? -segmentY / segmentLength : 1;
          ny = segmentLength > 1e-6 ? segmentX / segmentLength : 0;
        }

        const key = `${spawnerIndex}:${primitive.id}`;
        if (
          !best ||
          overlap > best.overlap + 1e-9 ||
          (Math.abs(overlap - best.overlap) <= 1e-9 && key < best.key)
        ) {
          best = { overlap, nx, ny, key };
        }
      }
    }

    if (!best) break;
    x += best.nx * (best.overlap + 1e-3);
    y += best.ny * (best.overlap + 1e-3);
    correctionCount += 1;
  }

  return { x, y, correctionCount };
}

/**
 * Runtime-only contact-aware carry. Callers keep the returned contact outside
 * serialized/networked gameplay state and pass it back on the next frame.
 */
export function getTitanRelicCarriedPositionWithContact(
  entity: { x: number; y: number; radius: number },
  spawners: ReadonlyArray<{ x: number; y: number; specialType?: string }>,
  previousTime: number,
  currentTime: number,
  previousContact: TitanRelicContact | null,
): TitanRelicContactResult {
  const trySpawner = (
    spawnerIndex: number,
    primitiveId: string | null,
  ): TitanRelicCarryCandidate | null => {
    const spawner = spawners[spawnerIndex];
    if (!spawner || !isTitanRelicType(spawner.specialType)) return null;
    return getTitanRelicCarryCandidate(
      entity.x,
      entity.y,
      entity.radius,
      spawner,
      previousTime,
      currentTime,
      primitiveId,
    );
  };

  if (previousContact) {
    const latched = trySpawner(previousContact.spawnerIndex, previousContact.primitiveId);
    if (latched) {
      return {
        x: entity.x + latched.dx,
        y: entity.y + latched.dy,
        dx: latched.dx,
        dy: latched.dy,
        contactCount: 1,
        contact: previousContact,
      };
    }
  }

  let acquired: { carry: TitanRelicCarryCandidate; spawnerIndex: number } | null = null;
  for (let spawnerIndex = 0; spawnerIndex < spawners.length; spawnerIndex += 1) {
    const carry = trySpawner(spawnerIndex, null);
    if (!carry) continue;
    if (!acquired || carry.overlap > acquired.carry.overlap) {
      acquired = { carry, spawnerIndex };
    }
  }

  if (!acquired) {
    return {
      x: entity.x,
      y: entity.y,
      dx: 0,
      dy: 0,
      contactCount: 0,
      contact: null,
    };
  }

  return {
    x: entity.x + acquired.carry.dx,
    y: entity.y + acquired.carry.dy,
    dx: acquired.carry.dx,
    dy: acquired.carry.dy,
    contactCount: 1,
    contact: {
      spawnerIndex: acquired.spawnerIndex,
      primitiveId: acquired.carry.primitiveId,
    },
  };
}

/**
 * Advances a known carried entity from one shared relic phase to another.
 * This is intended for render-only multiplayer reconciliation: it reproduces
 * the same curved platform motion without changing authoritative gameplay.
 */
export function projectTitanRelicContactPosition(
  entity: { x: number; y: number; radius: number },
  spawners: ReadonlyArray<{ x: number; y: number; specialType?: string }>,
  fromTime: number,
  toTime: number,
  contact: TitanRelicContact,
  maximumStepMs: number = 16,
): TitanRelicContactResult | null {
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    toTime < fromTime ||
    toTime - fromTime > 1_000 ||
    !Number.isFinite(maximumStepMs) ||
    maximumStepMs <= 0
  ) {
    return null;
  }

  let x = entity.x;
  let y = entity.y;
  let phase = fromTime;
  let activeContact: TitanRelicContact | null = contact;

  while (phase < toTime - 1e-6) {
    const nextPhase = Math.min(toTime, phase + maximumStepMs);
    const carried = getTitanRelicCarriedPositionWithContact(
      { x, y, radius: entity.radius },
      spawners,
      phase,
      nextPhase,
      activeContact,
    );
    if (!carried.contact) return null;
    x = carried.x;
    y = carried.y;
    activeContact = carried.contact;
    phase = nextPhase;
  }

  return {
    x,
    y,
    dx: x - entity.x,
    dy: y - entity.y,
    contactCount: activeContact ? 1 : 0,
    contact: activeContact,
  };
}

export function getTitanRelicCarriedPosition(
  entity: { x: number; y: number; radius: number },
  spawners: ReadonlyArray<{ x: number; y: number; specialType?: string }>,
  previousTime: number,
  currentTime: number,
): TitanRelicCarriedPosition {
  let x = entity.x;
  let y = entity.y;
  let contactCount = 0;

  for (const spawner of spawners) {
    if (!isTitanRelicType(spawner.specialType)) continue;
    const carry = getTitanRelicCarry(
      x,
      y,
      entity.radius,
      spawner,
      previousTime,
      currentTime,
    );
    if (!carry) continue;
    x += carry.dx;
    y += carry.dy;
    contactCount += 1;
  }

  return {
    x,
    y,
    dx: x - entity.x,
    dy: y - entity.y,
    contactCount,
  };
}

export function getTitanRelicVisualRadius(specialType: string | undefined): number {
  if (!isTitanRelicType(specialType)) return 0;
  const standardType = getStandardType(specialType);
  if (isOverdriveTitanRelicType(specialType)) {
    if (standardType === 'titan_sweeper') return 520;
    if (standardType === 'titan_cross') return 510;
    if (standardType === 'titan_moons') return 520;
    if (standardType === 'titan_gate') return 520;
    return 510;
  }
  if (standardType === 'titan_sweeper') return 520;
  if (standardType === 'titan_cross') return 580;
  if (standardType === 'titan_moons') return 530;
  if (standardType === 'titan_gate') return 560;
  return 560;
}
