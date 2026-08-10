# Gameplay analytics data dictionary

Ricochet Arena emits a versioned, observer-only semantic timeline through ByteBrew. Analytics is disabled when `/api/analytics-config` does not provide enabled credentials. Gameplay never waits for analytics, and analytics results are never read back into the game.

## Shared fields

Every custom event contains:

| Field | Meaning |
| --- | --- |
| `test_tag` | Always `not_deployed` until the explicit production-tag migration. |
| `timeline_version` | Schema version. This dictionary describes version `2`. |
| `timeline_session_id` | Browser-session analytics identifier. |
| `run_id` | Unique gameplay-run segment identifier. |
| `previous_run_id` | Previous segment when a retry or load starts a linked run. |
| `event_sequence` | Monotonically increasing sequence within the run. |
| `event_time_ms` | Unix time in milliseconds. |
| `run_elapsed_ms` | Milliseconds since run start, including pauses. |
| `active_run_elapsed_ms` | Milliseconds since run start, excluding pauses. |
| `event_category` | `lifecycle`, `combat`, `objective`, `ability`, `world`, or `state`. |
| `event_source` | Where the observation came from, such as local or host authority. |
| `actor_type`, `actor_x`, `actor_y` | Semantic actor and world position when applicable. |
| `target_type`, `target_x`, `target_y` | Semantic target and world position when applicable. |
| `map_id`, `game_mode`, `match_type`, `player_role` | Run context. |
| `run_origin` | `fresh_start`, `retry`, `quick_load`, `save_file`, or `multiplayer_round`. |
| `world_width`, `world_height` | World units. Currently `3000 × 3000`. |
| `device_type`, `control_scheme`, `orientation` | Runtime presentation/input context; these never alter gameplay. |
| `analytics_sdk`, `analytics_sdk_version`, `app_version` | Transport and deployed application versions. |

Coordinates are world units. Durations are milliseconds. Counts are integers. Boolean values are transported as `"true"` or `"false"` for ByteBrew custom-event compatibility.

## Event registry

| Event | Category / priority | Meaning and important fields | Authority / frequency |
| --- | --- | --- | --- |
| `game_run_started` | lifecycle / critical | Starts one run segment. Initial player position and complete run context are present. | Local player; once per segment. |
| `game_run_ended` | lifecycle / critical | Normal result or abandonment plus final score/entity counts and run summary. | Local player; at most once per normally closed segment. |
| `game_paused`, `game_resumed` | lifecycle / normal | Pause boundaries used to calculate active time. | Local player; per actual transition. |
| `player_bullet_fired` | combat / normal | Player position, bullet ID, normalized direction, and aim target. | The shooting player after host acceptance in multiplayer. |
| `enemy_spawned` | world / normal | Enemy ID/position, source spawner position, spawn type, and current enemy count. | Single-player authority or multiplayer host; once after creation. |
| `enemy_killed` | combat / normal | Enemy position, bullet information, and points awarded. | Authoritative owner outcome; once after confirmed death. |
| `spawner_engaged` | objective / normal | First confirmed bullet contact for a player and spawner during a run. | Single-player authority or multiplayer host; analytics-deduplicated. |
| `spawner_destroyed` | objective / normal | Spawner position, bullet information, points, and remaining spawners. | Authoritative outcome; once after destruction. |
| `bouncer_destroyed` | combat / normal | Bouncer position/size, bullet information, and points. | Authoritative outcome; once after destruction. |
| `special_activated`, `build_activated` | ability / normal | Player position when the accepted ability action occurs. | Owning player after authoritative acceptance. |
| `player_state_sample` | state / low | Position, speed, score, live entity counts, nearest-spawner distance, sample index. | Local observer every five active visible seconds. Never catches up. |
| `player_defeated` | combat / critical | Final player position and defeat cause. | Defeated player after authoritative outcome. |

In multiplayer, the host may relay validated analytics-only world/owner events. Relayed events carry a stable event ID and round ID. Guests reject malformed, stale, wrong-round, and duplicate messages. The relay is not part of match state and cannot mutate gameplay.

## Run summary calculations

`game_run_ended` includes counters derived only from analytics events accepted during that run:

- `bullets_fired_count`, `enemy_kills_count`, `enemy_spawns_observed_count`
- `spawner_engagements_count`, `spawners_destroyed_count`, `bouncers_destroyed_count`
- `special_uses_count`, `build_uses_count`, `state_samples_count`
- first shot, enemy kill, spawner engagement, and spawner destruction active-time fields
- `total_duration_ms`, `paused_duration_ms`, and `active_duration_ms`
- `approximate_distance_traveled`, calculated between consecutive five-second samples
- final score and remaining entity counts supplied by the read-only end observer
- `analytics_events_dropped`, `state_samples_skipped`, and `timeline_complete`

An ordinary hidden/background browser pauses sampling but does not end the run. A quick load or file load abandons the current segment and begins a linked segment with a new `run_id`. Quitting an active game records `cause_code=quit_to_menu`. A missing `game_run_ended` indicates an abrupt close or otherwise incomplete timeline.

## Queue and gameplay-safety contract

- Calls enqueue sanitized data and return immediately; gameplay never awaits a transport operation.
- ByteBrew loading, readiness checks, and sends occur through deferred work outside the animation loop.
- Under pressure, state samples are skipped first. Critical lifecycle/outcome events are retained preferentially.
- Transport failures fail closed, keep or discard analytics safely as appropriate, and never throw into gameplay.
- New games should extend the typed event registry and emit observations only after authoritative decisions. They must not place analytics inside physics/collision inner loops or branch gameplay on analytics state.
