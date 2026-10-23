# 9router Upstream Synchronization

The fork owns its maintained behavior directly. Project OS no longer applies
9router patches at runtime; this repository is synchronized from
`decolua/9router` by one scheduled workflow and one automation branch.

## Remote roles

- `origin` is the fork and the only push destination.
- `upstream` is `https://github.com/decolua/9router.git` and is fetch-only.
- `master` is never changed directly by the workflow.
- `automation/upstream-sync` is the only branch used by scheduled sync.

## One-time setup

1. Reconcile the fork baseline with `upstream/master` using a normal merge
   commit. Confirm `git merge-base --is-ancestor upstream/master master`.
2. Enable repository auto-merge and require the exact `CI / test-and-build`
   check on `master`. That check intentionally runs the maintained retirement,
   routing, fallback, replay, attribution, relay, and build matrix. The
   repository-wide Vitest suite is not an automatic-sync gate because the
   current upstream baseline has unrelated failures; do not convert those
   failures into an upstream-sync approval loop without first establishing a
   separate baseline and owner for them.
3. Create a GitHub App installation limited to this repository with
   `contents: write` and `pull_requests: write`.
4. Store its credentials as `UPSTREAM_SYNC_APP_ID` and
   `UPSTREAM_SYNC_APP_PRIVATE_KEY` repository secrets.
5. Confirm the installation can push the automation branch, create/update the
   synchronization PR, and trigger pull-request CI without manual approval.
6. Confirm repository Actions policy allows the workflow and App token.

If any prerequisite is unavailable, leave auto-merge disabled and run the
workflow only as a manual review aid.

## Daily flow

The workflow runs daily at `03:17 UTC` or through `workflow_dispatch`. It
fetches both remotes, rebuilds the automation branch from `origin/master`, and
merges `upstream/master` with `--no-ff`.

- A clean merge updates one PR titled `chore: sync upstream 9router`.
- The branch push uses `--force-with-lease` with the observed remote head.
- The workflow disables existing auto-merge before rebuilding a reused branch.
- It stops rather than rewriting a branch whose PR head does not match the
  automation branch.
- Non-privileged changes wait for the exact CI check, then use merge-commit
  auto-merge only.
- Privileged changes create/update the PR but always require explicit review.

## Conflicts and privileged changes

Conflicts write the unresolved-path inventory, fork/upstream/branch SHAs, and
job-summary evidence before aborting. Existing auto-merge is disabled. The
workflow does not push a partial branch and does not modify `master`.

The following paths are privileged and withhold auto-merge:

- workflows, local actions, dependency or install scripts;
- authentication, database, API, security, and routing surfaces;
- fork-owned attribution, Responses, relay, and related regression tests.

Review these PRs manually against the fork contract and upstream changes.

## Rollback

Disable auto-merge, delete or reset only `automation/upstream-sync`, and close
its PR. Never reset `master`. Re-run the workflow after the source of the
conflict or policy failure has been reviewed.

## Local dry run

```powershell
git fetch --prune origin master
git fetch --prune upstream master
git merge-tree $(git merge-base origin/master upstream/master) origin/master upstream/master
git merge-base --is-ancestor upstream/master origin/master
```

The local dry run does not publish, enable auto-merge, or alter `master`.
