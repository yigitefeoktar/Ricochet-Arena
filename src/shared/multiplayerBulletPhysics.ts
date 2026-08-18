const EPSILON = 1e-7;
const SEPARATION_EPSILON = 1e-3;

export type MultiplayerBulletSurfaceKind = 'wall' | 'build' | 'relic';

export interface AxisAlignedSurface {
  id: string;
  kind: 'wall' | 'build';
  x: number;
  y: number;
  w: number;
  h: number;
  data?: unknown;
}

export interface SurfaceHit {
  id: string;
  kind: MultiplayerBulletSurfaceKind;
  t: number;
  x: number;
  y: number;
  normals: Array<{ nx: number; ny: number }>;
  /** Optional render/physics-safe depenetrated start for the remaining step. */
  separationX?: number;
  separationY?: number;
  /** Resolve an existing overlap even when the bullet velocity points outward. */
  forceResolve?: boolean;
  data?: unknown;
}

export interface BulletTraceSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startFraction: number;
  endFraction: number;
  dx: number;
  dy: number;
  collision: SurfaceHit | null;
}

export interface BulletMotionTrace {
  x: number;
  y: number;
  dx: number;
  dy: number;
  segments: BulletTraceSegment[];
  collisions: SurfaceHit[];
  exhaustedCollisionBudget: boolean;
}

export interface CircleTarget<T = unknown> {
  id: string;
  x: number;
  y: number;
  radius: number;
  priority: number;
  data: T;
}

export interface CircleTargetHit<T = unknown> {
  target: CircleTarget<T>;
  segmentIndex: number;
  segmentT: number;
  stepFraction: number;
  x: number;
  y: number;
}

export type DynamicSurfaceResolver = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startFraction: number,
  endFraction: number,
) => SurfaceHit | null;

const surfacePriority = (kind: MultiplayerBulletSurfaceKind) => {
  if (kind === 'wall') return 0;
  if (kind === 'build') return 1;
  return 2;
};

const compareSurfaceHits = (a: SurfaceHit, b: SurfaceHit) => {
  if (Math.abs(a.t - b.t) > EPSILON) return a.t - b.t;
  const priorityDelta = surfacePriority(a.kind) - surfacePriority(b.kind);
  if (priorityDelta !== 0) return priorityDelta;
  return a.id.localeCompare(b.id);
};

/**
 * Sweeps a circle against an axis-aligned rectangle by expanding the rectangle
 * by the circle radius and ray-casting the circle centre. The returned point is
 * the exact centre position at first contact.
 */
export function sweepCircleAgainstAabb(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  radius: number,
  surface: AxisAlignedSurface,
): SurfaceHit | null {
  const moveX = endX - startX;
  const moveY = endY - startY;
  if (Math.abs(moveX) <= EPSILON && Math.abs(moveY) <= EPSILON) return null;

  const left = surface.x;
  const right = surface.x + surface.w;
  const top = surface.y;
  const bottom = surface.y + surface.h;
  const candidates: Array<{ t: number; nx: number; ny: number }> = [];
  const addCandidate = (t: number, nx: number, ny: number) => {
    if (t < -EPSILON || t > 1 + EPSILON) return;
    if (moveX * nx + moveY * ny >= -EPSILON) return;
    candidates.push({ t: Math.max(0, Math.min(1, t)), nx, ny });
  };

  if (moveX > EPSILON) {
    const t = (left - radius - startX) / moveX;
    const y = startY + moveY * t;
    if (y >= top - EPSILON && y <= bottom + EPSILON) addCandidate(t, -1, 0);
  } else if (moveX < -EPSILON) {
    const t = (right + radius - startX) / moveX;
    const y = startY + moveY * t;
    if (y >= top - EPSILON && y <= bottom + EPSILON) addCandidate(t, 1, 0);
  }

  if (moveY > EPSILON) {
    const t = (top - radius - startY) / moveY;
    const x = startX + moveX * t;
    if (x >= left - EPSILON && x <= right + EPSILON) addCandidate(t, 0, -1);
  } else if (moveY < -EPSILON) {
    const t = (bottom + radius - startY) / moveY;
    const x = startX + moveX * t;
    if (x >= left - EPSILON && x <= right + EPSILON) addCandidate(t, 0, 1);
  }

  const a = moveX * moveX + moveY * moveY;
  const corners = [
    { x: left, y: top, xSign: -1, ySign: -1 },
    { x: right, y: top, xSign: 1, ySign: -1 },
    { x: left, y: bottom, xSign: -1, ySign: 1 },
    { x: right, y: bottom, xSign: 1, ySign: 1 },
  ];
  for (const corner of corners) {
    const offsetX = startX - corner.x;
    const offsetY = startY - corner.y;
    const b = 2 * (offsetX * moveX + offsetY * moveY);
    const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(Math.max(0, discriminant));
    const t = c <= 0 ? 0 : (-b - root) / (2 * a);
    if (t < -EPSILON || t > 1 + EPSILON) continue;
    const contactX = startX + moveX * t;
    const contactY = startY + moveY * t;
    if ((contactX - corner.x) * corner.xSign < -EPSILON ||
        (contactY - corner.y) * corner.ySign < -EPSILON) continue;
    const normalLength = Math.hypot(contactX - corner.x, contactY - corner.y);
    if (normalLength <= EPSILON) continue;
    addCandidate(
      t,
      (contactX - corner.x) / normalLength,
      (contactY - corner.y) / normalLength,
    );
  }

  if (candidates.length === 0) return null;
  candidates.sort((aHit, bHit) => aHit.t - bHit.t || aHit.nx - bHit.nx || aHit.ny - bHit.ny);
  const t = candidates[0].t;
  const normals: Array<{ nx: number; ny: number }> = [];
  for (const candidate of candidates) {
    if (Math.abs(candidate.t - t) > EPSILON) break;
    if (!normals.some(normal =>
      Math.abs(normal.nx - candidate.nx) <= EPSILON &&
      Math.abs(normal.ny - candidate.ny) <= EPSILON)) {
      normals.push({ nx: candidate.nx, ny: candidate.ny });
    }
  }

  return {
    id: surface.id,
    kind: surface.kind,
    t,
    x: startX + moveX * t,
    y: startY + moveY * t,
    normals,
    data: surface.data,
  };
}

function reflectVelocity(
  dx: number,
  dy: number,
  normals: Array<{ nx: number; ny: number }>,
) {
  let nextDx = dx;
  let nextDy = dy;
  for (const normal of normals) {
    const dot = nextDx * normal.nx + nextDy * normal.ny;
    if (dot < 0) {
      nextDx -= 2 * dot * normal.nx;
      nextDy -= 2 * dot * normal.ny;
    }
  }
  return { dx: nextDx, dy: nextDy };
}

/**
 * Traces an authoritative multiplayer bullet through a complete simulation
 * step. Every bounce consumes only the distance travelled before contact; the
 * remaining time is continued with the reflected velocity.
 */
export function traceReflectedBulletMotion(options: {
  x: number;
  y: number;
  dx: number;
  dy: number;
  durationSeconds: number;
  radius: number;
  surfaces: AxisAlignedSurface[];
  dynamicSurface?: DynamicSurfaceResolver;
  allowDynamicDepenetration?: boolean;
  maxCollisions?: number;
}): BulletMotionTrace {
  const {
    radius,
    surfaces,
    dynamicSurface,
    allowDynamicDepenetration = false,
    maxCollisions = 12,
  } = options;

  if (
    !Number.isFinite(options.x) || !Number.isFinite(options.y) ||
    !Number.isFinite(options.dx) || !Number.isFinite(options.dy) ||
    !Number.isFinite(options.durationSeconds) || options.durationSeconds < 0 ||
    !Number.isFinite(radius) || radius < 0
  ) {
    throw new Error('Invalid authoritative bullet motion input');
  }

  let x = options.x;
  let y = options.y;
  let dx = options.dx;
  let dy = options.dy;
  let remaining = options.durationSeconds;
  let elapsed = 0;
  let collisionCount = 0;
  let ignoreSurfaceId: string | null = null;
  const totalDuration = Math.max(options.durationSeconds, EPSILON);
  const segments: BulletTraceSegment[] = [];
  const collisions: SurfaceHit[] = [];

  while (remaining > EPSILON && collisionCount < maxCollisions) {
    const startX = x;
    const startY = y;
    const startFraction = elapsed / totalDuration;
    const intendedX = startX + dx * remaining;
    const intendedY = startY + dy * remaining;
    const endFraction = Math.min(1, (elapsed + remaining) / totalDuration);

    const hits: SurfaceHit[] = [];
    for (const surface of surfaces) {
      const hit = sweepCircleAgainstAabb(startX, startY, intendedX, intendedY, radius, surface);
      if (!hit) continue;
      if (hit.t <= EPSILON && surface.id === ignoreSurfaceId) continue;
      hits.push(hit);
    }

    const dynamicHit = dynamicSurface?.(
      startX,
      startY,
      intendedX,
      intendedY,
      startFraction,
      endFraction,
    );
    const dynamicApproaching = dynamicHit?.normals.some(normal =>
      dx * normal.nx + dy * normal.ny < -EPSILON);
    if (
      dynamicHit &&
      (dynamicApproaching || (allowDynamicDepenetration && dynamicHit.forceResolve)) &&
      !(dynamicHit.t <= EPSILON && dynamicHit.id === ignoreSurfaceId)
    ) {
      hits.push(dynamicHit);
    }

    hits.sort(compareSurfaceHits);
    const hit = hits[0] ?? null;
    if (!hit) {
      segments.push({
        startX,
        startY,
        endX: intendedX,
        endY: intendedY,
        startFraction,
        endFraction,
        dx,
        dy,
        collision: null,
      });
      x = intendedX;
      y = intendedY;
      elapsed += remaining;
      remaining = 0;
      break;
    }

    const usedDuration = remaining * hit.t;
    const hitFraction = Math.min(1, (elapsed + usedDuration) / totalDuration);
    segments.push({
      startX,
      startY,
      endX: hit.x,
      endY: hit.y,
      startFraction,
      endFraction: hitFraction,
      dx,
      dy,
      collision: hit,
    });
    collisions.push(hit);

    const reflected = reflectVelocity(dx, dy, hit.normals);
    dx = reflected.dx;
    dy = reflected.dy;
    elapsed += usedDuration;
    remaining -= usedDuration;
    collisionCount += 1;
    ignoreSurfaceId = hit.id;

    const speed = Math.hypot(dx, dy);
    if (speed <= EPSILON) {
      x = hit.x;
      y = hit.y;
      remaining = 0;
      break;
    }

    const separatedX = allowDynamicDepenetration && Number.isFinite(hit.separationX) ? hit.separationX! : hit.x;
    const separatedY = allowDynamicDepenetration && Number.isFinite(hit.separationY) ? hit.separationY! : hit.y;
    x = separatedX + (dx / speed) * SEPARATION_EPSILON;
    y = separatedY + (dy / speed) * SEPARATION_EPSILON;
    const separationTime = Math.min(remaining, SEPARATION_EPSILON / speed);
    remaining = Math.max(0, remaining - separationTime);
    elapsed += separationTime;
  }

  return {
    x,
    y,
    dx,
    dy,
    segments,
    collisions,
    exhaustedCollisionBudget: remaining > EPSILON,
  };
}

/** Finds the first target reached along a reflected movement trace. */
export function findEarliestCircleTargetHit<T>(
  segments: BulletTraceSegment[],
  targetsForSegment: (segment: BulletTraceSegment, segmentIndex: number) => CircleTarget<T>[],
): CircleTargetHit<T> | null {
  let best: CircleTargetHit<T> | null = null;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const moveX = segment.endX - segment.startX;
    const moveY = segment.endY - segment.startY;
    const a = moveX * moveX + moveY * moveY;
    if (a <= EPSILON) continue;

    for (const target of targetsForSegment(segment, segmentIndex)) {
      const offsetX = segment.startX - target.x;
      const offsetY = segment.startY - target.y;
      const c = offsetX * offsetX + offsetY * offsetY - target.radius * target.radius;
      const b = 2 * (offsetX * moveX + offsetY * moveY);
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) continue;

      const root = Math.sqrt(Math.max(0, discriminant));
      const first = c <= 0 ? 0 : (-b - root) / (2 * a);
      const second = (-b + root) / (2 * a);
      let t = first;
      if (t < -EPSILON) t = second;
      if (t < -EPSILON || t > 1 + EPSILON) continue;
      t = Math.max(0, Math.min(1, t));

      // A surface at the exact segment endpoint wins the tie. This guarantees
      // that a target immediately behind a wall cannot be hit through it.
      if (segment.collision && t >= 1 - EPSILON) continue;

      const stepFraction = segment.startFraction +
        (segment.endFraction - segment.startFraction) * t;
      const candidate: CircleTargetHit<T> = {
        target,
        segmentIndex,
        segmentT: t,
        stepFraction,
        x: segment.startX + moveX * t,
        y: segment.startY + moveY * t,
      };

      if (!best ||
          candidate.stepFraction < best.stepFraction - EPSILON ||
          (Math.abs(candidate.stepFraction - best.stepFraction) <= EPSILON &&
            (target.priority < best.target.priority ||
              (target.priority === best.target.priority && target.id.localeCompare(best.target.id) < 0)))) {
        best = candidate;
      }
    }
  }

  return best;
}
