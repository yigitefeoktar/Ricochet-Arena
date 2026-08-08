import {
  reconcileGuestBulletSnapshot,
  type SyncableBullet,
} from '../../src/shared/bulletSync';

export interface SimulatedBullet extends SyncableBullet {
  id: string;
  radius: number;
  removed?: boolean;
}

export interface NetworkProfile {
  latencyMs: number;
  jitterMs: number;
  dropChance: number;
  seed: number;
}

export interface SimulationOptions {
  durationMs?: number;
  removalAtMs?: number;
  network?: Partial<NetworkProfile>;
  bullet?: Partial<SimulatedBullet>;
}

export interface GuestSample {
  timeMs: number;
  bullet: SimulatedBullet | null;
  hostBullet: SimulatedBullet | null;
}

export interface SimulationResult {
  samples: GuestSample[];
  corrections: number[];
  deliveredSnapshots: number;
  droppedSnapshots: number;
  deliveredCriticalSnapshots: number;
  removalDeliveredAt: number | null;
}

interface SnapshotEnvelope {
  deliverAt: number;
  critical: boolean;
  bullet: SimulatedBullet;
}

const DEFAULT_NETWORK: NetworkProfile = {
  latencyMs: 70,
  jitterMs: 25,
  dropChance: 0.15,
  seed: 0x51f15e,
};

const cloneBullet = (bullet: SimulatedBullet): SimulatedBullet => ({ ...bullet });

const distance = (a: SimulatedBullet, b: SimulatedBullet) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Deterministic host-only physics for exercising the network layer. It is
 * intentionally test code and is not imported by the production bundle.
 */
function advanceHostBullet(bullet: SimulatedBullet, dtSeconds: number): void {
  const minX = 30;
  const maxX = 970;
  const minY = 30;
  const maxY = 570;

  bullet.x += bullet.dx * dtSeconds;
  bullet.y += bullet.dy * dtSeconds;

  while (bullet.x < minX || bullet.x > maxX) {
    if (bullet.x > maxX) {
      bullet.x = maxX - (bullet.x - maxX);
      bullet.dx = -Math.abs(bullet.dx);
    } else {
      bullet.x = minX + (minX - bullet.x);
      bullet.dx = Math.abs(bullet.dx);
    }
    bullet.bounceCount++;
  }

  while (bullet.y < minY || bullet.y > maxY) {
    if (bullet.y > maxY) {
      bullet.y = maxY - (bullet.y - maxY);
      bullet.dy = -Math.abs(bullet.dy);
    } else {
      bullet.y = minY + (minY - bullet.y);
      bullet.dy = Math.abs(bullet.dy);
    }
    bullet.bounceCount++;
  }
}

export function runMultiplayerBulletSimulation(
  options: SimulationOptions = {},
): SimulationResult {
  const frameMs = 1000 / 60;
  const snapshotMs = 50;
  const durationMs = options.durationMs ?? 8_000;
  const removalAtMs = options.removalAtMs ?? 6_500;
  const network: NetworkProfile = { ...DEFAULT_NETWORK, ...options.network };
  const random = createRandom(network.seed);

  let host: SimulatedBullet | null = {
    id: 'bullet-a',
    x: 180,
    y: 150,
    dx: 310,
    dy: 190,
    radius: 6,
    bounceCount: 0,
    ...options.bullet,
  };
  let guest: SimulatedBullet | null = null;
  let nextSnapshotAt = 0;
  let lastQueuedDeliveryAt = -Infinity;
  let lastBroadcastBounceCount = host.bounceCount;
  let removalQueued = false;
  const queue: SnapshotEnvelope[] = [];
  const samples: GuestSample[] = [];
  const corrections: number[] = [];
  let deliveredSnapshots = 0;
  let droppedSnapshots = 0;
  let deliveredCriticalSnapshots = 0;
  let removalDeliveredAt: number | null = null;

  const queueSnapshot = (timeMs: number, bullet: SimulatedBullet, critical: boolean) => {
    if (!critical && random() < network.dropChance) {
      droppedSnapshots++;
      return;
    }

    const jitter = (random() * 2 - 1) * network.jitterMs;
    // Socket.IO preserves ordering among packets that are actually delivered.
    const requestedDeliveryAt = timeMs + Math.max(0, network.latencyMs + jitter);
    const deliverAt = Math.max(requestedDeliveryAt, lastQueuedDeliveryAt + 0.001);
    lastQueuedDeliveryAt = deliverAt;
    queue.push({ deliverAt, critical, bullet: cloneBullet(bullet) });
  };

  for (let timeMs = 0; timeMs <= durationMs + 0.001; timeMs += frameMs) {
    if (host && timeMs > 0) {
      advanceHostBullet(host, frameMs / 1000);
    }

    if (host && timeMs >= removalAtMs) {
      host = null;
    }

    while (timeMs + 0.001 >= nextSnapshotAt) {
      if (host) {
        const critical = host.bounceCount !== lastBroadcastBounceCount;
        queueSnapshot(nextSnapshotAt, host, critical);
        lastBroadcastBounceCount = host.bounceCount;
      } else if (!removalQueued) {
        queueSnapshot(nextSnapshotAt, {
          id: 'bullet-a',
          x: 0,
          y: 0,
          dx: 0,
          dy: 0,
          radius: 6,
          bounceCount: lastBroadcastBounceCount,
          removed: true,
        }, true);
        removalQueued = true;
      }
      nextSnapshotAt += snapshotMs;
    }

    while (queue.length > 0 && queue[0].deliverAt <= timeMs + 0.001) {
      const envelope = queue.shift()!;
      deliveredSnapshots++;
      if (envelope.critical) deliveredCriticalSnapshots++;

      if (envelope.bullet.removed) {
        guest = null;
        removalDeliveredAt = timeMs;
        continue;
      }

      if (!guest || guest.id !== envelope.bullet.id) {
        guest = cloneBullet(envelope.bullet);
      } else {
        const previous = guest;
        guest = reconcileGuestBulletSnapshot(previous, envelope.bullet);
        corrections.push(distance(previous, guest));
      }
    }

    samples.push({
      timeMs,
      bullet: guest ? cloneBullet(guest) : null,
      hostBullet: host ? cloneBullet(host) : null,
    });
  }

  return {
    samples,
    corrections,
    deliveredSnapshots,
    droppedSnapshots,
    deliveredCriticalSnapshots,
    removalDeliveredAt,
  };
}
