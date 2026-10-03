# Ricochet Arena deployment profile

Use this profile only for the Ricochet Arena repository and production service. Reconfirm values in GitHub and Google Cloud before mutating live infrastructure.

## Deployment contract

- GitHub repository: `yigitefeoktar/Ricochet-Arena`
- Deployment branch: `main`
- Google Cloud project name: `Deneme`
- Project ID: `gen-lang-client-0375824487`
- Project number: `823233237078`
- Cloud Run service: `the-ricochet-arena`
- Region: `us-west1`
- Public URL: `https://the-ricochet-arena.ai.studio`
- Health endpoint: `/api/health`
- Expected health payload field: `status=ok`
- Realtime transport: Socket.IO polling must return an Engine.IO open packet.

## Production constraints

- Preserve service-level autoscaling at minimum `0`, maximum `1` unless the multiplayer architecture is changed to external shared state.
- The maximum of one instance matters because multiplayer rooms and coordination are held in process memory.
- Preserve session affinity and all working WebSocket/Socket.IO behavior.
- The application listens on Cloud Run's injected `PORT`; its current container port is `3000`.
- Preserve the custom `ai.studio` URL and 100% traffic to the latest healthy revision.

## Current pipeline baseline

The initial GitHub-to-Cloud-Run setup was completed on 2026-08-07.

- Trigger ID: `8486727b-150d-411e-ab44-ab0303ee6dec`
- Trigger branch regex: `^main$`
- Build type: Google Cloud buildpacks
- Build context: repository root
- First verified build ID: `44f09cfc-afc8-469c-b276-9994961753f3`
- First verified source commit: `7cf853441d1af62c8e7a88281c8c56d7ef708b21`

Treat build and revision identifiers as historical evidence, not as values to reuse for a new deployment.

## Security note

The Cloud Run service inherited old AI Studio environment variables. At least one API credential appeared unused by the current GitHub source at setup time. Never expose its value. Recommend removing or rotating unused credentials as a separate, explicitly authorized cleanup after confirming the application does not reference them.
