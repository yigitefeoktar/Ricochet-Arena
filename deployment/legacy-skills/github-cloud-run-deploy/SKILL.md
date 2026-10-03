---
name: github-cloud-run-deploy
description: Set up, migrate, verify, or repair continuous deployment from GitHub to Google Cloud Run through Cloud Build, and record the verified release workflow in the repository's AGENTS.md for future AI agents. Use when connecting a repository and branch to a Cloud Run service, preserving production settings, diagnosing failed deploys, or proving that future commits deploy automatically.
---

# GitHub to Cloud Run deployment

Establish a reproducible GitHub -> Cloud Build -> Cloud Run pipeline and verify the live application end to end. Preserve production behavior while replacing only the source and deployment path.

## Select the operating path

1. Prefer authenticated `gh` and `gcloud` CLIs when they are available.
2. Otherwise use the connected GitHub app for repository work and an authenticated Chrome/Cloud Console session for Google Cloud work.
3. Use an existing Cloud Run service unless the user explicitly asks for a new service.
4. For Ricochet Arena, read [references/ricochet-arena.md](references/ricochet-arena.md) before acting.
5. When a build or deployment fails, read [references/troubleshooting.md](references/troubleshooting.md).

Do not install GitHub access across all repositories when access to one repository is sufficient. Do not create a test commit unless the user has authorized repository writes; prefer manually running the trigger against the current branch commit.

## 1. Establish the deployment contract

Identify and record:

- GitHub owner, repository, and deployment branch.
- Google Cloud project ID and project number.
- Cloud Run service and region.
- Public URL and expected health endpoint.
- Whether deployment uses a Dockerfile, Cloud Build config, or Google buildpacks.
- Runtime port, start command, and build command.
- Stateful constraints such as in-memory sessions, WebSockets, session affinity, or a required maximum instance count.

Treat these values as the acceptance criteria for the task. Do not silently choose another project, service, region, or branch.

## 2. Prepare and verify the repository

Inspect the application before configuring Cloud Build.

For a Node application using buildpacks, require:

- A committed lockfile.
- A working production `start` script.
- A server that listens on `process.env.PORT`, with a local fallback only for development.
- A reproducible install and build (`npm ci`, then the intended build command).
- A supported Node engine when the runtime needs an explicit version.
- No dependency on development-only servers in production.

Run the repository's lint, tests, and production build in proportion to risk. Start the production server on an injected non-default port and verify its health endpoint before touching Cloud Run.

Keep preparation changes narrowly scoped. Commit them through the user's normal GitHub workflow before creating the trigger.

## 3. Back up and inventory the Cloud Run service

Before editing an existing service, save its complete YAML or equivalent configuration. With `gcloud`, prefer:

```bash
gcloud run services describe SERVICE --region REGION --project PROJECT_ID --format=export > cloud-run-before.yaml
```

If using Cloud Console, copy the entire YAML into a recoverable local variable or file before saving any edit.

Inventory and preserve:

- Service name, region, domains, ingress, and authentication.
- Traffic allocation and revision tags.
- Service-level and revision-level scaling.
- Session affinity, concurrency, timeout, CPU, and memory.
- Container port, health checks, volumes, and Cloud SQL connections.
- Service account, VPC/network settings, and execution environment.
- Environment-variable names and secret references.

Never print, store in the skill, or repeat secret values. Do not remove apparently unused variables or rotate credentials as part of pipeline setup unless the user separately authorizes that cleanup.

## 4. Create the Cloud Build trigger

Enable only the required APIs, normally Cloud Build, Cloud Run, Artifact Registry, IAM, and Container Analysis as prompted by Google Cloud.

Connect GitHub through the Google Cloud Build GitHub App and grant access only to the intended repository when possible. Configure:

- Event: push to branch.
- Branch regex: `^BRANCH$` (normally `^main$`).
- Build type: the repository's chosen Dockerfile, build config, or Google Cloud buildpacks.
- Build context: repository root unless the application is in a subdirectory.
- Entrypoint: leave blank for buildpacks when `npm start` is correct.
- Function target: leave blank for a web service.
- Target: the exact existing Cloud Run service and region.

Record the trigger ID and generated name. Confirm it appears on the Cloud Run service's Triggers tab.

## 5. Run the trigger and migrate safely

Run the trigger against the current deployment-branch commit. Monitor the complete build through image push and Cloud Run deployment.

If an existing Google AI Studio service rejects the deploy because of stale source metadata, follow the exact migration procedure in [references/troubleshooting.md](references/troubleshooting.md). Do not replace the whole YAML with a minimal service definition; preserve functional settings and remove only obsolete AI Studio build/runtime metadata.

After a one-time migration succeeds, rerun the same trigger. A successful trigger deployment—not merely a manually deployed image—is required to prove continuous deployment works.

## 6. Verify the deployment

Require all of the following:

1. Cloud Build reports success for the trigger run.
2. Cloud Run reports the service ready.
3. The newest revision receives 100% of intended traffic.
4. Revision details link to the expected GitHub commit and Cloud Build run.
5. The public page returns HTTP 200 and expected identifying content.
6. The health endpoint returns its expected result.
7. Realtime transports such as Socket.IO respond when the application uses them.
8. Critical service settings from the inventory remain unchanged.

Use the bundled verifier for HTTP, health, title, and optional Socket.IO checks:

```bash
node scripts/verify-deployment.mjs https://example.com \
  --health /api/health \
  --health-field status=ok \
  --title "Expected App Title" \
  --socketio
```

The script is supplemental. Always confirm the revision source commit, traffic, trigger, and preserved Cloud Run settings in Cloud Console or through `gcloud`.

## 7. Persist the workflow in AGENTS.md

For an authorized repository-changing setup, migration, or repair, create `AGENTS.md` at the repository root if it is absent. If it exists, read it and merge or update the deployment section without deleting unrelated instructions. Do not silently replace conflicting branch, verification, or deployment rules; ask the user to resolve a material conflict. Do not make this repository change for a read-only diagnosis or when repository writes have not been authorized.

Record the verified deployment contract from step 1, not values copied from another project: the deployment branch, Cloud project ID, Cloud Run service and region, public URL and health endpoint, and the repository's relevant lint, test, and build checks. Do not include credentials or secret values. Add durable instructions for every requested code or UI change that tell future agents to:

1. Inspect Git status, preserve unrelated user work, run the relevant repository checks, and stage only task-related files or hunks.
2. Commit the task-related changes directly to the verified deployment branch with a clear message and push that branch to `origin`. The push is the production deployment trigger; never force-push or start a local development server unless the user explicitly asks for one. A production-server smoke test needed to validate a Cloud Run change is not a development server.
3. Wait for the pushed commit's Cloud Build trigger run to succeed and for Cloud Run to be ready, with the intended traffic on a revision linked to that commit. If deployment fails, inspect the build or service logs, make in-scope fixes, rerun the relevant checks, commit, push, and verify again. Do not claim success while a build is failed or pending.
4. Include the verified production URL, the deployed commit's short SHA, verification results, and Cloud Build/Cloud Run deployment result in the final response.

Commit `AGENTS.md` with the other authorized repository changes when possible. If it requires a later commit, verify that later commit's build and active revision too; an earlier successful trigger run does not prove the instructions commit deployed. If the file cannot be safely installed, report that explicitly instead of claiming future agents will inherit this workflow.

## 8. Hand off the result

Report:

- Repository and deployment branch.
- Cloud project, service, and region.
- Trigger identity and last successful build.
- Active revision and source commit.
- Live URL and verification results.
- Confirmation that future pushes to the branch deploy automatically.
- Any separate security or configuration cleanup recommendation.

Explain that historical failed builds remain visible and are harmless once a later build and active revision are successful. Leave the most useful Cloud Run service, revision, or build page open when operating through the user's browser.
