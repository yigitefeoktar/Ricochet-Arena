---
name: main-vercel-workflow
description: Install or follow a direct-to-main GitHub-to-Vercel deployment workflow in a repository. Use when the user wants that workflow recorded in AGENTS.md or applied to code/UI changes in a repository that uses it.
---

# Main-to-Vercel workflow

This skill applies to repositories whose `main` branch is pushed to `origin` and whose production deployment is triggered by that push and reported by a Vercel status check. Do not assume an arbitrary repository has this setup: inspect its Git remote, branch, deployment configuration, and existing instructions. If a prerequisite is absent or unclear, ask for the missing deployment choice before installing or following the workflow. Do not invent a production URL.

## Install in a repository

When this skill is used in a repository, create `AGENTS.md` at the repository root if it does not exist. If it exists, read it and add or update the workflow without deleting unrelated instructions. Do not silently replace conflicting instructions; ask the user to resolve the conflict. Use the following repository-neutral rules, adapting only the production URL to a verified URL for that repository. Do not copy another repository's URL, tests, or project details.

```markdown
## Required deployment workflow

For every requested code or UI change:

1. Commit only the task-related changes directly to `main` with a clear commit message.
2. Push the commit with `git push origin main`. This push triggers the production deployment. Do not start a local development server unless the user explicitly asks for one.
3. Wait for the Vercel status check on the pushed commit to reach `success`. If it fails, inspect the deployment or build logs, fix the issue, rerun the relevant verification checks, commit the fix, and push it. Do not report the deployment as complete while the check is failing or pending.
4. In the final response, include the verified production URL, the deployed commit's short SHA, the verification result, and the Vercel deployment result.
```

If the production URL cannot be verified, ask for it or report that it remains unverified; never substitute a URL from this skill or another repository. Run the repository's own relevant checks before committing. Preserve existing user work and stage only task-related files or hunks.

## Follow the workflow

For a requested code or UI change in a repository where this workflow is installed, follow its `AGENTS.md` and the rules above. The workflow does not authorize unrelated edits, a push for a read-only request, or a deployment to a repository that lacks the stated setup. If a deployment check fails, continue with in-scope fixes until it succeeds or a concrete blocker requires user input; report the actual state rather than claiming success.
