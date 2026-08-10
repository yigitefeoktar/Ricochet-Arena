export const ANALYTICS_TEST_TAG = 'not_deployed';
export const ANALYTICS_TIMELINE_VERSION = 1;

export type GameplayAnalyticsEventName =
  | 'game_run_started'
  | 'game_run_ended'
  | 'game_paused'
  | 'game_resumed'
  | 'player_bullet_fired'
  | 'enemy_killed'
  | 'spawner_destroyed'
  | 'bouncer_destroyed'
  | 'special_activated'
  | 'build_activated'
  | 'player_defeated';

export type GameplayAnalyticsField = string | number | boolean | null | undefined;
export type GameplayAnalyticsFields = Record<string, GameplayAnalyticsField>;

interface ByteBrewConfig {
  enabled: boolean;
  appId?: string;
  sdkKey?: string;
  appVersion?: string;
}

export interface AnalyticsTransport {
  isReady(): boolean;
  send(eventName: string, fields: Record<string, string | number>): void;
}

interface QueuedAnalyticsEvent {
  eventName: GameplayAnalyticsEventName;
  fields: Record<string, string | number>;
}

export interface GameplayRunContext {
  map_id: string;
  game_mode: string;
  match_type: 'singleplayer' | 'multiplayer';
  player_role: 'single' | 'host' | 'guest';
  device_type: 'desktop' | 'mobile';
  match_id?: string;
  round_id?: number;
  player_x: number;
  player_y: number;
  initial_spawner_count: number;
}

interface ActiveRun {
  id: string;
  startedAt: number;
  sequence: number;
  context: GameplayRunContext;
  ended: boolean;
}

export interface GameplayAnalyticsDependencies {
  loadConfig: () => Promise<ByteBrewConfig>;
  loadTransport: (config: Required<Omit<ByteBrewConfig, 'enabled'>>) => Promise<AnalyticsTransport>;
  schedule: (task: () => void, delayMs: number) => void;
  monotonicNow: () => number;
  wallNow: () => number;
  createId: () => string;
}

const MAX_QUEUED_EVENTS = 5000;
const MAX_EVENTS_PER_DRAIN = 25;
const READY_RETRY_MS = 250;

function defaultSchedule(task: () => void, delayMs: number) {
  if (delayMs > 0) {
    globalThis.setTimeout(task, delayMs);
    return;
  }

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => task(), { timeout: 1000 });
  } else {
    globalThis.setTimeout(task, 0);
  }
}

function createBrowserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

async function loadByteBrewConfig(): Promise<ByteBrewConfig> {
  const response = await fetch('/api/analytics-config', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Analytics configuration unavailable: ${response.status}`);
  }
  return response.json() as Promise<ByteBrewConfig>;
}

async function loadByteBrewTransport(
  config: Required<Omit<ByteBrewConfig, 'enabled'>>,
): Promise<AnalyticsTransport> {
  const { ByteBrew } = await import('bytebrew-web-sdk');
  ByteBrew.initializeByteBrew(config.appId, config.sdkKey, config.appVersion);
  return {
    isReady: () => ByteBrew.isByteBrewInitialized(),
    send: (eventName, fields) => ByteBrew.newCustomEvent(eventName, fields),
  };
}

const defaultDependencies: GameplayAnalyticsDependencies = {
  loadConfig: loadByteBrewConfig,
  loadTransport: loadByteBrewTransport,
  schedule: defaultSchedule,
  monotonicNow: () => performance.now(),
  wallNow: () => Date.now(),
  createId: createBrowserId,
};

function normalizeFields(fields: GameplayAnalyticsFields): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[a-z0-9_]+$/.test(key) || value === null || value === undefined) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) normalized[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      normalized[key] = value ? 'true' : 'false';
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

export class GameplayAnalytics {
  private readonly dependencies: GameplayAnalyticsDependencies;
  private readonly timelineSessionId: string;
  private transport: AnalyticsTransport | null = null;
  private initialization: Promise<void> | null = null;
  private disabled = false;
  private drainScheduled = false;
  private queue: QueuedAnalyticsEvent[] = [];
  private activeRun: ActiveRun | null = null;

  constructor(dependencies: Partial<GameplayAnalyticsDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
    this.timelineSessionId = this.dependencies.createId();
  }

  initialize(): void {
    if (this.disabled || this.transport || this.initialization) return;

    this.initialization = (async () => {
      const config = await this.dependencies.loadConfig();
      if (
        !config.enabled ||
        typeof config.appId !== 'string' || !config.appId.trim() ||
        typeof config.sdkKey !== 'string' || !config.sdkKey.trim() ||
        typeof config.appVersion !== 'string' || !config.appVersion.trim()
      ) {
        this.disabled = true;
        this.queue = [];
        return;
      }

      this.transport = await this.dependencies.loadTransport({
        appId: config.appId,
        sdkKey: config.sdkKey,
        appVersion: config.appVersion,
      });
      this.scheduleDrain(READY_RETRY_MS);
    })().catch(() => {
      // Analytics must fail closed without surfacing errors into gameplay.
      this.disabled = true;
      this.queue = [];
    }).finally(() => {
      this.initialization = null;
    });
  }

  beginRun(context: GameplayRunContext): void {
    this.activeRun = {
      id: this.dependencies.createId(),
      startedAt: this.dependencies.monotonicNow(),
      sequence: 0,
      context,
      ended: false,
    };
    this.track('game_run_started', {
      player_x: context.player_x,
      player_y: context.player_y,
    });
  }

  endRun(fields: GameplayAnalyticsFields): void {
    if (!this.activeRun || this.activeRun.ended) return;
    this.track('game_run_ended', fields);
    this.activeRun.ended = true;
  }

  track(eventName: GameplayAnalyticsEventName, fields: GameplayAnalyticsFields = {}): void {
    if (this.disabled) return;

    const now = this.dependencies.monotonicNow();
    const run = this.activeRun;
    const sequence = run ? ++run.sequence : 0;
    const runElapsedMs = run ? Math.max(0, Math.round(now - run.startedAt)) : 0;
    const context = run?.context;

    const payload = normalizeFields({
      test_tag: ANALYTICS_TEST_TAG,
      timeline_version: ANALYTICS_TIMELINE_VERSION,
      timeline_session_id: this.timelineSessionId,
      run_id: run?.id ?? 'no_active_run',
      event_sequence: sequence,
      event_time_ms: this.dependencies.wallNow(),
      run_elapsed_ms: runElapsedMs,
      ...(context ?? {}),
      ...fields,
    });

    if (this.queue.length >= MAX_QUEUED_EVENTS) {
      this.queue.shift();
    }
    this.queue.push({ eventName, fields: payload });
    this.initialize();
    this.scheduleDrain(0);
  }

  private scheduleDrain(delayMs: number): void {
    if (this.disabled || this.drainScheduled || this.queue.length === 0) return;
    this.drainScheduled = true;
    this.dependencies.schedule(() => {
      this.drainScheduled = false;
      this.drain();
    }, delayMs);
  }

  private drain(): void {
    if (this.disabled || this.queue.length === 0) return;
    if (!this.transport || !this.transport.isReady()) {
      this.scheduleDrain(READY_RETRY_MS);
      return;
    }

    let sent = 0;
    while (sent < MAX_EVENTS_PER_DRAIN && this.queue.length > 0) {
      const event = this.queue.shift()!;
      try {
        this.transport.send(event.eventName, event.fields);
        sent += 1;
      } catch {
        this.queue.unshift(event);
        this.scheduleDrain(READY_RETRY_MS);
        return;
      }
    }

    if (this.queue.length > 0) {
      this.scheduleDrain(0);
    }
  }

  getPendingEventCountForTests(): number {
    return this.queue.length;
  }
}

export const gameplayAnalytics = new GameplayAnalytics();

export function initializeGameplayAnalytics(): void {
  gameplayAnalytics.initialize();
}
