export const ANALYTICS_TEST_TAG = 'not_deployed';
export const ANALYTICS_TIMELINE_VERSION = 2;

export type GameplayAnalyticsEventName =
  | 'game_run_started'
  | 'game_run_ended'
  | 'game_paused'
  | 'game_resumed'
  | 'player_bullet_fired'
  | 'enemy_spawned'
  | 'enemy_killed'
  | 'spawner_engaged'
  | 'spawner_destroyed'
  | 'bouncer_destroyed'
  | 'special_activated'
  | 'build_activated'
  | 'player_state_sample'
  | 'player_defeated';

export type GameplayAnalyticsField = string | number | boolean | null | undefined;
export type GameplayAnalyticsFields = Record<string, GameplayAnalyticsField>;
export type GameplayRunOrigin =
  | 'fresh_start'
  | 'retry'
  | 'quick_load'
  | 'save_file'
  | 'multiplayer_round';

type AnalyticsEventPriority = 'critical' | 'normal' | 'low';
type AnalyticsEventCategory = 'lifecycle' | 'combat' | 'objective' | 'ability' | 'world' | 'state';
type SummaryCounterKey =
  | 'bulletsFired'
  | 'enemyKills'
  | 'enemySpawnsObserved'
  | 'spawnerEngagements'
  | 'spawnersDestroyed'
  | 'bouncersDestroyed'
  | 'specialUses'
  | 'buildUses'
  | 'stateSamples';
type FirstTimingKey =
  | 'firstShotActiveMs'
  | 'firstEnemyKillActiveMs'
  | 'firstSpawnerEngagementActiveMs'
  | 'firstSpawnerDestroyedActiveMs';

interface AnalyticsEventDefinition {
  category: AnalyticsEventCategory;
  priority: AnalyticsEventPriority;
  actorType?: string;
  actorXField?: string;
  actorYField?: string;
  targetType?: string;
  targetXField?: string;
  targetYField?: string;
  counter?: SummaryCounterKey;
  firstTiming?: FirstTimingKey;
}

export const GAMEPLAY_ANALYTICS_EVENT_DEFINITIONS: Record<GameplayAnalyticsEventName, AnalyticsEventDefinition> = {
  game_run_started: { category: 'lifecycle', priority: 'critical', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y' },
  game_run_ended: { category: 'lifecycle', priority: 'critical', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y' },
  game_paused: { category: 'lifecycle', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y' },
  game_resumed: { category: 'lifecycle', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y' },
  player_bullet_fired: {
    category: 'combat', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y',
    targetType: 'aim_point', targetXField: 'target_x', targetYField: 'target_y', counter: 'bulletsFired', firstTiming: 'firstShotActiveMs',
  },
  enemy_spawned: {
    category: 'world', priority: 'normal', actorType: 'spawner', actorXField: 'spawner_x', actorYField: 'spawner_y',
    targetType: 'enemy', targetXField: 'enemy_x', targetYField: 'enemy_y', counter: 'enemySpawnsObserved',
  },
  enemy_killed: {
    category: 'combat', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y',
    targetType: 'enemy', targetXField: 'enemy_x', targetYField: 'enemy_y', counter: 'enemyKills', firstTiming: 'firstEnemyKillActiveMs',
  },
  spawner_engaged: {
    category: 'objective', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y',
    targetType: 'spawner', targetXField: 'spawner_x', targetYField: 'spawner_y', counter: 'spawnerEngagements', firstTiming: 'firstSpawnerEngagementActiveMs',
  },
  spawner_destroyed: {
    category: 'objective', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y',
    targetType: 'spawner', targetXField: 'spawner_x', targetYField: 'spawner_y', counter: 'spawnersDestroyed', firstTiming: 'firstSpawnerDestroyedActiveMs',
  },
  bouncer_destroyed: {
    category: 'combat', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y',
    targetType: 'bouncer', targetXField: 'bouncer_x', targetYField: 'bouncer_y', counter: 'bouncersDestroyed',
  },
  special_activated: { category: 'ability', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y', counter: 'specialUses' },
  build_activated: { category: 'ability', priority: 'normal', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y', counter: 'buildUses' },
  player_state_sample: { category: 'state', priority: 'low', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y', counter: 'stateSamples' },
  player_defeated: { category: 'combat', priority: 'critical', actorType: 'player', actorXField: 'player_x', actorYField: 'player_y' },
};

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
  priority: AnalyticsEventPriority;
}

export interface GameplayRunContext {
  map_id: string;
  game_mode: string;
  match_type: 'singleplayer' | 'multiplayer';
  player_role: 'single' | 'host' | 'guest';
  device_type: 'desktop' | 'mobile';
  control_scheme?: 'keyboard_mouse' | 'touch';
  orientation?: 'portrait' | 'landscape';
  run_origin?: GameplayRunOrigin;
  match_id?: string;
  round_id?: number;
  player_x: number;
  player_y: number;
  initial_spawner_count: number;
  world_width?: number;
  world_height?: number;
}

interface RunSummary {
  bulletsFired: number;
  enemyKills: number;
  enemySpawnsObserved: number;
  spawnerEngagements: number;
  spawnersDestroyed: number;
  bouncersDestroyed: number;
  specialUses: number;
  buildUses: number;
  stateSamples: number;
  approximateDistanceTraveled: number;
  firstShotActiveMs?: number;
  firstEnemyKillActiveMs?: number;
  firstSpawnerEngagementActiveMs?: number;
  firstSpawnerDestroyedActiveMs?: number;
  lastSamplePosition?: { x: number; y: number };
  analyticsEventsDropped: number;
  stateSamplesSkipped: number;
}

interface ActiveRun {
  id: string;
  previousRunId?: string;
  startedAt: number;
  sequence: number;
  context: GameplayRunContext;
  ended: boolean;
  pausedAt: number | null;
  pausedDurationMs: number;
  summary: RunSummary;
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
const LOW_PRIORITY_BACKLOG_LIMIT = 250;
const MAX_EVENTS_PER_DRAIN = 25;
const READY_RETRY_MS = 250;
const BYTEBREW_WEB_SDK_VERSION = '1.0.1';

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

function createRunSummary(): RunSummary {
  return {
    bulletsFired: 0,
    enemyKills: 0,
    enemySpawnsObserved: 0,
    spawnerEngagements: 0,
    spawnersDestroyed: 0,
    bouncersDestroyed: 0,
    specialUses: 0,
    buildUses: 0,
    stateSamples: 0,
    approximateDistanceTraveled: 0,
    analyticsEventsDropped: 0,
    stateSamplesSkipped: 0,
  };
}

function copyMappedCoordinate(
  target: GameplayAnalyticsFields,
  outputKey: string,
  source: GameplayAnalyticsFields,
  sourceKey?: string,
): void {
  if (!sourceKey || target[outputKey] !== undefined) return;
  const value = source[sourceKey];
  if (typeof value === 'number' && Number.isFinite(value)) target[outputKey] = value;
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
  private lastRunId: string | null = null;
  private appVersion = 'unknown';

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

      this.appVersion = config.appVersion;
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
    try {
      if (this.activeRun && !this.activeRun.ended) {
        this.endRun({
          outcome: 'abandoned',
          cause_code: 'superseded',
        });
      }

      const id = this.dependencies.createId();
      this.activeRun = {
        id,
        previousRunId: this.lastRunId ?? undefined,
        startedAt: this.dependencies.monotonicNow(),
        sequence: 0,
        context: {
          ...context,
          run_origin: context.run_origin ?? 'fresh_start',
        },
        ended: false,
        pausedAt: null,
        pausedDurationMs: 0,
        summary: createRunSummary(),
      };
      this.track('game_run_started', {
        player_x: context.player_x,
        player_y: context.player_y,
      });
    } catch {
      // Gameplay must never observe analytics failures.
    }
  }

  endRun(fields: GameplayAnalyticsFields): void {
    try {
      const run = this.activeRun;
      if (!run || run.ended) return;

      const now = this.dependencies.monotonicNow();
      const totalDurationMs = Math.max(0, Math.round(now - run.startedAt));
      const pausedDurationMs = Math.max(0, Math.round(this.getPausedDurationMs(run, now)));
      const activeDurationMs = Math.max(0, totalDurationMs - pausedDurationMs);
      const summary = run.summary;

      this.track('game_run_ended', {
        total_duration_ms: totalDurationMs,
        active_duration_ms: activeDurationMs,
        paused_duration_ms: pausedDurationMs,
        bullets_fired_count: summary.bulletsFired,
        enemy_kills_count: summary.enemyKills,
        enemy_spawns_observed_count: summary.enemySpawnsObserved,
        spawner_engagements_count: summary.spawnerEngagements,
        spawners_destroyed_count: summary.spawnersDestroyed,
        bouncers_destroyed_count: summary.bouncersDestroyed,
        special_uses_count: summary.specialUses,
        build_uses_count: summary.buildUses,
        state_samples_count: summary.stateSamples,
        approximate_distance_traveled: Math.round(summary.approximateDistanceTraveled * 100) / 100,
        first_shot_active_ms: summary.firstShotActiveMs,
        first_enemy_kill_active_ms: summary.firstEnemyKillActiveMs,
        first_spawner_engagement_active_ms: summary.firstSpawnerEngagementActiveMs,
        first_spawner_destroyed_active_ms: summary.firstSpawnerDestroyedActiveMs,
        ...fields,
        analytics_events_dropped: summary.analyticsEventsDropped,
        state_samples_skipped: summary.stateSamplesSkipped,
        timeline_complete: summary.analyticsEventsDropped === 0,
      });
      run.ended = true;
      this.lastRunId = run.id;
    } catch {
      // Gameplay must never observe analytics failures.
    }
  }

  track(eventName: GameplayAnalyticsEventName, fields: GameplayAnalyticsFields = {}): void {
    try {
      if (this.disabled) return;

      const definition = GAMEPLAY_ANALYTICS_EVENT_DEFINITIONS[eventName];
      const run = this.activeRun;
      if (run?.ended) return;
      if (definition.priority === 'low' && this.queue.length >= LOW_PRIORITY_BACKLOG_LIMIT) {
        if (run && !run.ended) run.summary.stateSamplesSkipped += 1;
        return;
      }

      const now = this.dependencies.monotonicNow();
      if (run && eventName === 'game_resumed' && run.pausedAt !== null) {
        run.pausedDurationMs += Math.max(0, now - run.pausedAt);
        run.pausedAt = null;
      }

      const sequence = run ? ++run.sequence : 0;
      const runElapsedMs = run ? Math.max(0, Math.round(now - run.startedAt)) : 0;
      const activeRunElapsedMs = run ? this.getActiveElapsedMs(run, now) : 0;
      const context = run?.context;
      const enrichedFields = this.enrichFields(eventName, fields);

      if (run && !run.ended) {
        this.updateRunSummary(run, definition, enrichedFields, activeRunElapsedMs);
      }

      const payload = normalizeFields({
        test_tag: ANALYTICS_TEST_TAG,
        timeline_version: ANALYTICS_TIMELINE_VERSION,
        analytics_sdk: 'bytebrew_web',
        analytics_sdk_version: BYTEBREW_WEB_SDK_VERSION,
        timeline_session_id: this.timelineSessionId,
        run_id: run?.id ?? 'no_active_run',
        previous_run_id: run?.previousRunId,
        event_sequence: sequence,
        event_time_ms: this.dependencies.wallNow(),
        run_elapsed_ms: runElapsedMs,
        active_run_elapsed_ms: activeRunElapsedMs,
        ...(context ?? {}),
        ...enrichedFields,
      });

      this.enqueue({ eventName, fields: payload, priority: definition.priority });
      if (run && eventName === 'game_paused' && run.pausedAt === null) {
        run.pausedAt = now;
      }
      this.initialize();
      this.scheduleDrain(0);
    } catch {
      // Gameplay must never observe analytics failures.
    }
  }

  getPendingEventCountForTests(): number {
    return this.queue.length;
  }

  private getPausedDurationMs(run: ActiveRun, now: number): number {
    return run.pausedDurationMs + (run.pausedAt === null ? 0 : Math.max(0, now - run.pausedAt));
  }

  private getActiveElapsedMs(run: ActiveRun, now: number): number {
    const total = Math.max(0, now - run.startedAt);
    return Math.max(0, Math.round(total - this.getPausedDurationMs(run, now)));
  }

  private enrichFields(eventName: GameplayAnalyticsEventName, fields: GameplayAnalyticsFields): GameplayAnalyticsFields {
    const definition = GAMEPLAY_ANALYTICS_EVENT_DEFINITIONS[eventName];
    const enriched: GameplayAnalyticsFields = {
      event_category: definition.category,
      event_source: fields.event_source ?? 'local',
      actor_type: fields.actor_type ?? definition.actorType,
      target_type: fields.target_type ?? definition.targetType,
      ...fields,
    };
    copyMappedCoordinate(enriched, 'actor_x', fields, definition.actorXField);
    copyMappedCoordinate(enriched, 'actor_y', fields, definition.actorYField);
    copyMappedCoordinate(enriched, 'target_x', fields, definition.targetXField);
    copyMappedCoordinate(enriched, 'target_y', fields, definition.targetYField);
    return enriched;
  }

  private updateRunSummary(
    run: ActiveRun,
    definition: AnalyticsEventDefinition,
    fields: GameplayAnalyticsFields,
    activeRunElapsedMs: number,
  ): void {
    if (definition.counter) run.summary[definition.counter] += 1;
    if (definition.firstTiming && run.summary[definition.firstTiming] === undefined) {
      run.summary[definition.firstTiming] = activeRunElapsedMs;
    }

    if (definition.counter === 'stateSamples') {
      const x = fields.player_x;
      const y = fields.player_y;
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
        const previous = run.summary.lastSamplePosition;
        if (previous) run.summary.approximateDistanceTraveled += Math.hypot(x - previous.x, y - previous.y);
        run.summary.lastSamplePosition = { x, y };
      }
    }
  }

  private enqueue(event: QueuedAnalyticsEvent): void {
    if (this.queue.length >= MAX_QUEUED_EVENTS) {
      if (event.priority === 'low') {
        if (this.activeRun && !this.activeRun.ended) this.activeRun.summary.stateSamplesSkipped += 1;
        return;
      }

      let evictIndex = this.queue.findIndex(queued => queued.priority === 'low');
      if (evictIndex < 0 && event.priority === 'critical') {
        evictIndex = this.queue.findIndex(queued => queued.priority === 'normal');
      }
      if (evictIndex < 0 && event.eventName === 'game_run_ended') {
        evictIndex = this.queue.findIndex(queued => queued.eventName !== 'game_run_ended');
      }
      if (evictIndex < 0) {
        if (this.activeRun && !this.activeRun.ended) this.activeRun.summary.analyticsEventsDropped += 1;
        return;
      }
      this.queue.splice(evictIndex, 1);
      if (this.activeRun && !this.activeRun.ended) this.activeRun.summary.analyticsEventsDropped += 1;
    }
    this.queue.push(event);
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
        this.transport.send(event.eventName, {
          ...event.fields,
          app_version: this.appVersion,
        });
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
}

export const gameplayAnalytics = new GameplayAnalytics();

export function initializeGameplayAnalytics(): void {
  gameplayAnalytics.initialize();
}
