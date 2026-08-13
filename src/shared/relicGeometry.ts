export const TITAN_RELIC_TYPES = [
  'titan_sweeper',
  'titan_cross',
  'titan_moons',
  'titan_gate',
  'titan_triangle',
] as const;

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

export function isTitanRelicType(value: string | undefined): value is TitanRelicType {
  return TITAN_RELIC_TYPES.includes(value as TitanRelicType);
}

function getOrbitAngle(
  spawner: { x: number; y: number },
  currentTime: number,
  speed: number,
): number {
  const seed = Math.round(spawner.x / 10) * 17 + Math.round(spawner.y / 10) * 31;
  const direction = seed % 2 === 0 ? 1 : -1;
  const phaseOffset = (seed % 360) * Math.PI / 180;
  return phaseOffset + direction * currentTime * speed;
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

export function getTitanRelicPrimitives(
  spawner: { x: number; y: number; specialType?: string },
  currentTime: number,
): TitanRelicPrimitive[] {
  const type = spawner.specialType;
  if (!isTitanRelicType(type)) return [];

  if (type === 'titan_sweeper') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00016);
    const centerX = spawner.x + Math.cos(angle) * 360;
    const centerY = spawner.y + Math.sin(angle) * 360;
    return [segmentAt('sweeper', centerX, centerY, angle + Math.PI / 2, 310, 34)];
  }

  if (type === 'titan_cross') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00019);
    const centerX = spawner.x + Math.cos(angle) * 500;
    const centerY = spawner.y + Math.sin(angle) * 500;
    return [
      segmentAt('cross-a', centerX, centerY, angle, 210, 31),
      segmentAt('cross-b', centerX, centerY, angle + Math.PI / 2, 210, 31),
    ];
  }

  if (type === 'titan_moons') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00014);
    return [0, 1].map(index => {
      const moonAngle = angle + index * Math.PI;
      return {
        kind: 'circle' as const,
        id: `moon-${index}`,
        cx: spawner.x + Math.cos(moonAngle) * 410,
        cy: spawner.y + Math.sin(moonAngle) * 410,
        radius: 112,
      };
    });
  }

  if (type === 'titan_gate') {
    const angle = getOrbitAngle(spawner, currentTime, 0.00017);
    return [-1, 1].map((side, index) => {
      const orbitRadius = 360 + side * 105;
      const centerX = spawner.x + Math.cos(angle) * orbitRadius;
      const centerY = spawner.y + Math.sin(angle) * orbitRadius;
      return segmentAt(`gate-${index}`, centerX, centerY, angle + Math.PI / 2, 245, 30);
    });
  }

  const angle = getOrbitAngle(spawner, currentTime, 0.00015);
  const centerX = spawner.x + Math.cos(angle) * 500;
  const centerY = spawner.y + Math.sin(angle) * 500;
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
      id: `triangle-${index}`,
      ax: vertex.x,
      ay: vertex.y,
      bx: next.x,
      by: next.y,
      radius: 27,
    };
  });
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
  switch (specialType) {
    case 'titan_sweeper': return 710;
    case 'titan_cross': return 750;
    case 'titan_moons': return 560;
    case 'titan_gate': return 570;
    case 'titan_triangle': return 730;
    default: return 0;
  }
}
