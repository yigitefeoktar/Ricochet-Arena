# GitHub main → Vercel frontend + optional PC backend

`deployment.json` is the release contract. Ricochet enables its PC backend; a game with no backend, or multiplayer deferred for later, must use `"backend": null`. No backend task or tunnel should be installed for such a game.

Frontend: Vercel builds `npm run build:frontend` into `dist/frontend`. Set `VITE_BACKEND_URL=https://ltestpc.tail3c0a5e.ts.net` for this game's split deployment. Pilot analytics remain disabled (`VITE_ANALYTICS_ENABLED=false`); no Cloud credentials were copied. A stable production Vercel alias follows future releases; an immutable preview URL does not.

The verified stable frontend address for the website is **https://so-i-have-a-game-on.vercel.app**. The existing GitHub integration deploys main automatically. The former `o21wxxo4b` preview remains an immutable test deployment.

PC: versioned scripts in `pc/` build an isolated copy of the exact GitHub main SHA, verify health and nine multiplayer protocol checks on a candidate port, then activate with rollback. A separate watcher recovers the running backend after a crash. Windows startup is at user sign-in. Updates are allowed to end matches. The PC must be awake, signed in and online for multiplayer.

Installed runtime configuration is local to this PC; no credentials or machine-specific paths are committed. `node deployment/pc/update.test.cjs` checks frontend-only skipping and preparation failures; `powershell -File deployment/pc/Activate-Ricochet.test.ps1 -TestRoot <scratch-folder>` verifies rollback using isolated fixtures. Stop the updater Windows task before manually running `node deployment/pc/update.cjs <local-config.json> --once` to check/retry main once; without `--once` it polls every minute. The updater lock prevents concurrent release builds. Read configuration/status before managing processes. Refresh the installed bootstrap explicitly when these scripts change; backend releases do not hot-swap the updater itself.

The canonical Codex skill is in `skills/game-deployment`. Install that folder into the user's Codex skills directory. Historical sources of the replaced skills are in `legacy-skills` and must not be installed as active defaults.

To reproduce the Windows setup, copy `pc/` to a dedicated runtime bootstrap folder; adapt `config.example.json` to that location and the absolute local Git/tar/PowerShell/npm CLI paths (scheduled tasks may have a different PATH); create `current.json` with a verified built seed release's `directory` and `commit`; run `Install-Tasks.ps1 -ConfigFile <config.json>` from the bootstrap folder. It refuses a seed without an explicitly enabled PC backend. Start `Codex-Ricochet-Backend` and `Codex-Ricochet-GitHub-Updates` after checking the seed. Keep the existing Funnel forwarding only localhost port 4103.

Pause with `Stop-Backend.ps1 -ConfigFile <config.json>`; the pause flag prevents updater activation and watcher restart. Resume with `Resume-Backend.ps1 -ConfigFile <config.json>`. An actual Windows reboot has not been tested; these are interactive sign-in tasks, not a system backend service. If stopping the updater task for maintenance, inspect `updater-process.json` and ensure its recorded Node process has exited before a manual retry; the lock refuses concurrent updaters.

Google Cloud billing was disabled on both game projects on 2026-10-04; the four game Cloud Build triggers were disabled on 2026-10-03. Remaining configuration is historical recovery material, not an available running fallback. See `cloud-fallback.json`. Do not re-enable billing/triggers, deploy there or modify/delete remaining Cloud resources during ordinary releases.

Verification limitation: the original game suite has a reproduced baseline failure in `gateMapLayouts.test.ts` for closed-gate connectivity in `crush_circuit`. This migration does not alter map gameplay. Lint, builds, deployment guard tests and the multiplayer protocol smoke test are the release checks for this infrastructure change; do not report the original full suite as passing.
