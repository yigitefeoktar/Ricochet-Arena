---
name: game-deployment
description: Deploy or migrate Yigit's games from GitHub main to Vercel, with a Windows PC backend only when explicitly declared. Use for game releases, deployment setup or repair, or updating deployment instructions in AGENTS.md. Google Cloud billing is disabled.
---

# Game deployment

Use GitHub `main` as the source of truth. Publish the frontend on Vercel. Run a persistent multiplayer backend on the Windows PC only when the repository explicitly enables it. These replace the old main-vercel-workflow and github-cloud-run-deploy instructions.

## Inspect before acting

Read the repository's `AGENTS.md`, Git status and remotes, `package.json`, `vercel.json`, `deployment.json`, CI workflows and current deployments. Preserve unrelated work. Never reuse another game's project, port, URL, remote or process. Discussion/read-only requests do not authorize commits or deployments.

The user's current preferences: free services only, no domain purchase, personal testing/play with friends. Updates may end multiplayer matches. Do not delay an authorized release to drain matches or ask for approval just because a restart ends them.

## Deployment contract

1. Use `main` for authorized releases. Commit only task changes and push to the verified GitHub remote without force-pushing. Reconcile upstream changes first.
2. Build only the frontend on Vercel, using a stable verified production alias for the website. Immutable preview URLs do not follow later main updates. Prefer Vercel's GitHub integration; if missing, connect it or use a documented CLI/API deployment tied to the exact main SHA. Verify the commit status/deployment rather than assuming a push deployed it.
3. **Backend is opt-in.** Missing `deployment.json`, missing `backend`, or `"backend": null` means skip every backend install/build/start, Windows task, port and tunnel operation. Dependencies, Express/server files, or a build script alone are not authorization to deploy a backend. A broken or deferred multiplayer implementation also stays disabled until explicitly enabled and tested.
4. An enabled backend must have `backend.provider: "pc"`, its own build/entry/health contract, a configured PC installation, localhost-only port, and a verified public HTTPS address. Existing Ricochet uses Tailscale Funnel. Do not buy a domain, create paid services, expose other ports, or copy another game's endpoint. Read [PC workflow](references/pc-workflow.md) before changing backend setup.
5. Keep frontend and backend configuration separate. A frontend-only game must not inherit Ricochet's `VITE_BACKEND_URL`. For split games, point frontend HTTP and Socket.IO calls at the explicitly configured backend. Keep single-player usable when the PC is unavailable. Secrets remain outside GitHub and frontend bundles.
6. Google Cloud billing was disabled on both game projects on 2026-10-04; their automatic game triggers were disabled on 2026-10-03. Treat remaining Cloud configuration as historical recovery material, not an available running fallback. Preserve remaining resources/settings/credentials/domains. Never re-enable billing or triggers, deploy to Cloud Run, alter traffic or delete remaining resources unless the user specifically requests that operation. Current releases and PC updates must not depend on paid Google Cloud services.

## Verify and finish

Run the repository's relevant checks and production build. Do not start a local development server unless asked; a bounded production/candidate smoke test is appropriate for deployment changes. Investigate failures, distinguish pre-existing failures, and never claim every test passed if one failed.

For a frontend, verify the exact main commit has a successful Vercel deployment, public HTTP load and the requested behavior. For an enabled backend, verify the PC updater reports the same SHA, localhost/public health, Socket.IO polling and WebSocket, and room create/join/start/relay. A build/probe failure must retain the running release; activation failure must restore the previous one. Restart/crash recovery must remain enabled.

Record the verified repository-specific contract in `AGENTS.md`: branch/remote, manifest, Vercel project/production URL, optional backend port/address/runtime, checks and known limitations, update/recovery commands, and disabled Cloud billing/triggers. Preserve unrelated instructions. The user's migration request resolves old Cloud-deployment instructions in favor of this workflow; do not ask again about that known conflict.

Report the production URL, deployed short SHA, meaningful verification results and any concrete limitation. If the PC is off, asleep, logged out, or offline, its backend is unavailable; the Vercel frontend remains available.
