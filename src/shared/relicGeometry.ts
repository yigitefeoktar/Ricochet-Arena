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

export type TitanRelicPalette = {
  fill: string;
  accent: string;
};

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
): TitanRelicSegment[] {
  const triangleRadius = 190;
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
      radius: 27,
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
      const centerX = spawner.x + Math.cos(orbitAngle) * 500;
      const centerY = spawner.y + Math.sin(orbitAngle) * 500;
      return [
        segmentAt(`cross-${index}-a`, centerX, centerY, orbitAngle, 210, 31),
        segmentAt(`cross-${index}-b`, centerX, centerY, orbitAngle + Math.PI / 2, 210, 31),
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
    const centerX = spawner.x + Math.cos(orbitAngle) * 500;
    const centerY = spawner.y + Math.sin(orbitAngle) * 500;
    return triangleAt(`triangle-${index}`, centerX, centerY, orbitAngle);
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
  const current = getTitanRelicPrimitives(spawner, currentTime);
  const previousById = new Map(
    getTitanRelicPrimitives(spawner, previousTime).map(primitive => [primitive.id, primitive]),
  );

  let best: TitanRelicCarry | null = null;
  for (const primitive of current) {
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
    if (distance >= minimumDistance) continue;

    const shapeDx = contactX - previousContactX;
    const shapeDy = contactY - previousContactY;
    const shapeSpeed = Math.hypot(shapeDx, shapeDy);
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
    const overlap = minimumDistance - distance;
    const carry = {
      dx: shapeDx + nx * (overlap + 0.5),
      dy: shapeDy + ny * (overlap + 0.5),
      nx,
      ny,
      overlap,
    };

    if (!best || carry.overlap > best.overlap) best = carry;
  }

  return best;
}

export function getTitanRelicVisualRadius(specialType: string | undefined): number {
  if (!isTitanRelicType(specialType)) return 0;
  const standardType = getStandardType(specialType);
  if (standardType === 'titan_sweeper') return 710;
  if (standardType === 'titan_cross') return 750;
  if (standardType === 'titan_moons') return 560;
  if (standardType === 'titan_gate') return isOverdriveTitanRelicType(specialType) ? 820 : 740;
  return 730;
}
