# Ricochet Arena repository instructions

Use the `game-deployment` skill; its canonical source is `deployment/skills/game-deployment`. The older Google Cloud and Vercel skills have been combined into it.

For authorized code/UI changes, inspect Git status, preserve unrelated work, run relevant checks, commit task changes to `main`, and push to `https://github.com/yigitefeoktar/Ricochet-Arena.git` without force-pushing. GitHub main is the source of truth. Do not start a local development server unless requested; bounded production smoke tests are allowed.

## Active deployment

- Contract: `deployment.json`. Frontend on Vercel; explicitly enabled multiplayer backend on this Windows PC. Do not infer or install a backend for other games from dependencies/server files. Missing/null backend declaration means skip backend operations.
- Vercel project `ricochet-arena`, ID `prj_SEhGa8EaVaR24mkSAr4xCM6mfsHT`, team `team_xVwirII3Qvw8wj4rshxpfiL4`. GitHub integration watches `main`. Build `npm run build:frontend`, output `dist/frontend`. Stable production alias: `https://so-i-have-a-game-on.vercel.app`; verify its successful deployment for the pushed SHA before reporting a release complete.
- Frontend backend URL: `https://ltestpc.tail3c0a5e.ts.net`, environment `VITE_BACKEND_URL`. Pilot analytics remain disabled with `VITE_ANALYTICS_ENABLED=false`; keep credentials out of GitHub and frontend code.
- PC backend: build `npm run build:backend`, entry `dist/backend/server.cjs`, Node 24, `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4103`, `SERVE_FRONTEND=false`. Candidate tests use port 4105. Tailscale Funnel publishes the existing backend via HTTPS.
- `deployment/pc/update.cjs` polls GitHub main every minute, builds/tests an isolated commit release, then restarts with rollback on activation failure. Only the configured Ricochet repository is enrolled. Windows tasks start updater and crash recovery at user sign-in; multiplayer needs the PC awake, signed in and online. Inspect local configuration/state for installed paths; never manage unrelated listeners or PIDs.
- Updates ending matches are acceptable; the user updates when nobody is playing. Do not require match draining or ask permission again for an authorized update.

## Verification

Run `npm run lint`, `npm run build:frontend`, `npm run build:backend`, and `node --test deployment/pc/update.test.cjs`. For backend changes run `node deployment/pc/smoke.cjs` against an isolated candidate using `PILOT_BACKEND_URL`; verify public health and polling/WebSocket after activation. The smoke covers two clients, room create/join, match start, state/input relay and reconnect.

The original `npm test` baseline is 83/84 passing: closed-gate player-sized connectivity fails for `crush_circuit` in `src/shared/gateMapLayouts.test.ts`. The same failure was reproduced before migration; do not hide it or change unrelated gameplay just to pass infrastructure checks.

Wait for a successful Vercel deployment tied to the pushed SHA and PC updater success for that same SHA; fix relevant failures before claiming completion. Report the production URL, short SHA and check results. Verify single-player remains usable when the backend is unavailable.

## Google Cloud fallback

Cloud Run `the-ricochet-arena` in `gen-lang-client-0375824487`, us-west1, remains at the saved revision. Cloud Build trigger `8486727b-150d-411e-ab44-ab0303ee6dec` was disabled on 2026-10-03. Ordinary main pushes must never deploy there. Preserve service/revision/settings/secrets/domains and `https://the-ricochet-arena.ai.studio`. Do not re-enable or redeploy without an explicit user request. Historical build/start files are fallback material only. The other three frozen game triggers are recorded in `deployment/cloud-fallback.json`.
