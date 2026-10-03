# GitHub main → Vercel frontend + optional PC backend

`deployment.json` is the release contract. Ricochet enables its PC backend; a game with no backend, or multiplayer deferred for later, must use `"backend": null`. No backend task or tunnel should be installed for such a game.

Frontend: Vercel builds `npm run build:frontend` into `dist/frontend`. Set `VITE_BACKEND_URL=https://ltestpc.tail3c0a5e.ts.net` for this game's split deployment. Pilot analytics remain disabled (`VITE_ANALYTICS_ENABLED=false`); no Cloud credentials were copied. A stable production Vercel alias follows future releases; an immutable preview URL does not.

PC: versioned scripts in `pc/` build an isolated copy of the exact GitHub main SHA, verify health and nine multiplayer protocol checks on a candidate port, then activate with rollback. A separate watcher recovers the running backend after a crash. Windows startup is at user sign-in. Updates are allowed to end matches. The PC must be awake, signed in and online for multiplayer.

Installed runtime configuration is local to this PC; no credentials or machine-specific paths are committed. `node deployment/pc/update.test.cjs` checks frontend-only skipping and preparation failures; `powershell -File deployment/pc/Activate-Ricochet.test.ps1 -TestRoot <scratch-folder>` verifies rollback using isolated fixtures. Stop the updater Windows task before manually running `node deployment/pc/update.cjs <local-config.json> --once` to check/retry main once; without `--once` it polls every minute. The updater lock prevents concurrent release builds. Read configuration/status before managing processes. Refresh the installed bootstrap explicitly when these scripts change; backend releases do not hot-swap the updater itself.

The canonical Codex skill is in `skills/game-deployment`. Install that folder into the user's Codex skills directory. Historical sources of the replaced skills are in `legacy-skills` and must not be installed as active defaults.

Google Cloud is a frozen fallback: its four game Cloud Build triggers were disabled on 2026-10-03; existing services and revisions were retained. See `cloud-fallback.json`. Do not deploy there or re-enable a trigger during ordinary releases.

Verification limitation: the original game suite has a reproduced baseline failure in `gateMapLayouts.test.ts` for closed-gate connectivity in `crush_circuit`. This migration does not alter map gameplay. Lint, builds, deployment guard tests and the multiplayer protocol smoke test are the release checks for this infrastructure change; do not report the original full suite as passing.
