# Cloud Build and Cloud Run troubleshooting

## Stale AI Studio source annotation

### Symptom

The image builds and pushes successfully, but the final deploy step fails with:

```text
spec.template.metadata.annotations[run.googleapis.com/sources]:
Source annotation has sources that are not referenced by a container.
```

### Cause

An existing service deployed from Google AI Studio can retain source and runtime annotations tied to its old generated container. A GitHub/Cloud Build image no longer references those sources, so Cloud Run rejects the update.

### Safe migration

1. Export or copy the complete current service YAML.
2. Locate the image produced successfully by the failed Cloud Build run.
3. Construct a migration YAML from the backup.
4. Replace only the old placeholder/generated image with the new Artifact Registry image.
5. Remove obsolete AI Studio build/runtime fields when present:
   - `run.googleapis.com/sources`
   - `run.googleapis.com/base-images`
   - Old generated command and args that bypass the repository's container entrypoint
   - `runtimeClassName: run.googleapis.com/linux-base-image-update`
6. Preserve every functional setting inventoried before the edit.
7. Save and deploy a new revision.
8. Confirm it becomes ready before retrying the Cloud Build trigger.
9. Retry the trigger. Require the retry to succeed and produce the next active revision.

Do not remove unrelated annotations. Do not paste a minimal YAML over production. Do not copy secret values into logs or chat while comparing YAML.

## Build succeeds but the service is unhealthy

Check in this order:

1. The server binds to `0.0.0.0` and `process.env.PORT`.
2. The production `start` script starts the real server rather than a development server.
3. The configured container port matches the application.
4. Startup and health probes use valid paths and allow enough startup time.
5. Required environment variables and secret references are still present.
6. Cloud Run logs show no missing module, bind, or permission error.

## Trigger does not run on push

Verify:

- The GitHub Cloud Build App is installed for the repository.
- The connection still has authorization.
- The trigger repository and branch regex match the pushed repository and branch.
- The trigger is enabled and has a valid service account.
- Required APIs remain enabled.
- The commit reached the remote branch rather than only a local branch.

## Deployment works but multiplayer becomes unreliable

Compare service settings against the pre-migration inventory. For an in-memory multiplayer server, multiple instances can split rooms and sockets. Restore the intended service-level maximum instance count and session affinity. Do not treat scaling changes as a harmless deployment detail.

## Historical failure badges

Cloud Console retains failed builds. A red historical badge does not mean the active revision is broken. Judge current state using the latest trigger build, active revision, traffic allocation, health checks, and live endpoint.
