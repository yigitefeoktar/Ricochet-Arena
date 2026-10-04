# PC release workflow

Canonical implementation and installed skill source: `yigitefeoktar/Ricochet-Arena`, directories `deployment/pc` and `deployment/skills/game-deployment`. Do not depend on uncommitted developer files. Install the skill by copying this folder into the user's Codex skills directory. Archive the previous two skill folders outside the active skills directory; their historical sources live in `deployment/legacy-skills`.

## Optional backend declaration

A frontend-only or deferred game uses `"backend": null` in `deployment.json`. Do not create a runtime installation for it. A later backend needs its own inspected code, enabled manifest, port/task names, HTTPS routing and smoke tests. Ricochet's current updater intentionally accepts only its implemented contract, not arbitrary commands or targets.

Ricochet `deployment.json` declares `main`, Vercel `build:frontend` output `dist/frontend`, and PC `build:backend` entry `dist/backend/server.cjs`. Its backend address is `https://ltestpc.tail3c0a5e.ts.net`; production port 4103 and candidate port 4105 are loopback-only. Never assign these to another game.

## Installation and updates

On the Windows PC, an installed bootstrap copy of `deployment/pc/update.cjs` polls its explicitly configured GitHub repository's main branch every minute. Its local JSON contains repository URL, bounded release/cache root, npm CLI path, candidate port, pointer/pause files, and activation/pruning script paths. Keep local machine paths and credentials out of GitHub; the implementation and runbook are versioned there.

The updater fetches the exact main SHA into an isolated cache and inspects the manifest **before npm install or any backend operation**. It archives that commit into its own release folder, runs `npm ci`, lint and the backend build, then starts a candidate on a different localhost port. Health and a two-client Socket.IO smoke test must pass before activation. The current release continues running during preparation. Activation stops only the recorded owned backend, changes the release pointer, restarts and health-checks it. Failure restores the old pointer and restarts the previous release. Retain active, previous successful and latest attempted release; prune only validated 40-character commit directories under the configured release root.

An independent Windows watcher restarts the active backend after a crash and starts at user sign-in. The updater also starts at sign-in. This installation does not run the game backend before Windows sign-in or after logout. Do not claim a system service is installed. Intentional pause prevents updates/recovery until the user resumes. Failed commits are recorded and retried on a new main SHA or a manual one-shot retry; avoid endless failed builds every minute.

Synchronization failures are retried on the next poll. Once GitHub main matches the active release again, the updater verifies local health and clears the transient failure without rebuilding or restarting that release. An unhealthy active release remains failed until health recovers. Build/probe/activation failures remain separate from synchronization failures.

Keep the small installed bootstrap stable during backend releases. If its code changes on GitHub, validate and explicitly refresh the installed copy as part of that task; backend polling does not replace its own running code.

## Public access and limits

Tailscale Funnel publishes only Ricochet's 127.0.0.1:4103 through HTTPS. The existing background Funnel and Tailscale Windows service persist. Preserve network/auth/security settings and other routes. Tailscale reauthentication is required before machine key expiry (currently 2027-04-01); inspect live status rather than relying forever on this historical date. Funnel bandwidth restrictions and the PC/internet connection can affect lag. New free provider plan/terms claims require current official verification.

A browser blocked by client protections is not proof of a failed backend; preserve protections, test the public protocol and report the browser limitation. Real two-device mobile-data play remains a useful final user check.
