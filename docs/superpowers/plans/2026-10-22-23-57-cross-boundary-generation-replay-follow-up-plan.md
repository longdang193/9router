---
layer: change
artifact_type: plan
contract_version: "1"
status: superseded
template_id: implementation-plan
name: cross-boundary-generation-replay-follow-up
targets:
  - project-OS-starter/scripts/herdr_main_launcher.py
  - project-OS-starter/tests/test_herdr_main_launcher.py
  - LightRSI/components/adapters/codex/src/proxy-runtime.ts
  - LightRSI/components/adapters/codex/src/upstream.ts
  - LightRSI/components/adapters/codex/tests/benchmark-admission.test.ts
  - LightRSI/components/adapters/codex/tests/context-history-replayability.test.ts
  - LightRSI/components/adapters/codex/tests/upstream.test.ts
  - src/app/api/v1/responses/route.js
  - src/app/api/provider-nodes/[id]/route.js
  - src/lib/db/repos/nodesRepo.js
  - src/sse/handlers/chat.js
  - src/sse/utils/requestCorrelation.js
  - open-sse/handlers/chatCore.js
  - open-sse/executors/base.js
  - tests/unit/chat-request-correlation.test.js
  - tests/unit/generation-single-flight.test.js
  - tests/unit/provider-replay-policy.test.js
  - tests/unit/executor-replay-policy.test.js
  - tests/unit/no-replay-routing.test.js
  - tools/cgw-codex-shim/server.js
  - tools/cgw-codex-shim/cgwResponses.js
  - tools/cgw-codex-shim/test/server.test.js
  - tools/cgw-codex-shim/test/cgw-responses.test.js
---

# Cross-Boundary Generation Replay Follow-Up Plan

Historical plan superseded and retired on October 23, 2026 during the CGW plan
review. Retained for historical context; no successor plan is required.

## Goal

Close the remaining duplicate-prompt paths after the merged LightRSI and
9Router fixes, without adding another scheduler, database, pane manager,
submission gate, or replay service.

The plan makes one model-producing generation a stable cross-boundary identity,
admits it before launcher-side pane/process mutation, and gives the canonical
9Router Responses path ownership of the physical execution lifecycle. A
disconnected HTTP observer must not cancel or replay an already-dispatched
generation, and a generation identifier must never silently refer to a
different request.

The current Project OS logical-operation identity contract remains unchanged:
`project-OS-starter/scripts/project_os_runtime/submission_gate.py:57` derives
the logical operation from `task_id`, `plan_revision`, and `run_id`; existing
tests cover its non-binding-scoped behavior. This follow-up does, however,
correct launcher admission ordering so claim success precedes pane/workspace
and process preparation. It must not add a second gate or alter the existing
logical-ID formula.

The canonical generation path is:

```text
src/app/api/v1/responses/route.js
  -> src/sse/handlers/chat.js
  -> open-sse/handlers/chatCore.js
  -> open-sse/executors/base.js
```

`tools/cgw-codex-shim` remains a diagnostic and parity target only; it is not
the primary protection for production generation execution.

Reviewed baseline:

- `project-OS-starter`: `9f3a849f`.
- `LightRSI`: `85e599b3`.
- `9router`: `8376eeaf`.
- Existing active plan `docs/superpowers/plans/2026-10-22-21-31-cross-boundary-generation-idempotency-plan.md` is stale for this follow-up and must not be marked complete or reused as the implementation ledger.
- Existing unrelated Project OS modifications and 9Router untracked `.serena/` and `scripts/watch-9router.ps1` files must remain untouched.

## Implementation Outcomes

### Stable generation identity

LightRSI emits a generation identity distinct from its per-request journal
`requestId`. Native Responses metadata is authoritative when available;
otherwise the identity uses the stable admission/payload identity already used
for duplicate admission. Legitimate continuations receive new generation IDs;
retries or observer reconnects for the same generation retain the original ID.

`upstream.ts` participates in generation propagation and request telemetry.
No new custom native-header protocol is introduced merely to create identity;
existing native metadata is preserved, and deterministic synthesis is limited
to the compatibility shim when native metadata is absent.

### Admission before launcher mutation

Every model-producing launcher path claims the model submission before pane
ownership, workspace allocation, process creation, or other mutation that can
consume the limited pane/process capacity. Secretary behavior remains the
existing admission authority; no duplicate gate or scheduler is introduced.

### Canonical stateful single-flight execution

The canonical 9Router Responses path stores a stateful entry per generation
containing the immutable request fingerprint, lifecycle state, execution-owned
abort controller, shared promise or terminal result, dispatch status, and
terminal timestamp. Active entries are never evicted. Same-generation requests
with the same fingerprint join or reuse the existing result; a conflicting
fingerprint fails closed with HTTP `409`, `generation_identity_conflict`, and
`x-9router-no-replay: 1`.

### Non-replay and restart safety

The canonical CGW Responses provider is explicitly configured as
`apiType=responses` and `replayPolicy=non-replayable`. Startup or provider
preflight fails closed, or performs the existing supported migration, when the
canonical provider violates that policy.

In-memory admission and coalescing remain fail-closed across restart using only
existing evidence. Restart behavior is:

```text
restart + proven not-dispatched evidence
  -> retry permitted
restart + durable completed result
  -> return or reconcile the existing result
restart + dispatch may have happened
  -> reconciliation_required; no automatic redispatch
```

Evidence is limited to the Project OS submission gate, LightRSI request/context
journal, and existing trace, dispatch, and result receipts. No new database or
replay manager is added.

## Execution Approach

- Mode: `inline sequential`
- Coordination: `git-tracked`
- Required skills: `skill-writing-plans`, `skill-systematic-debugging`, `skill-backend-verification`, `skill-code-standards`, `skill-plan-document-reviewer`, `skill-verification-before-completion`
- Isolation: one clean implementation checkout per affected repository; preserve current unrelated dirty and untracked files; this plan is recorded in `9router`
- Commit policy: `no commits during execution`
- Preauthorized local actions: inspect and edit only the named files, run declared tests/typechecks/builds, and capture bounded local trace evidence
- User-approval actions: push, pull request creation or update, merge, branch deletion, pane cleanup outside task-owned resources, or deletion of evidence
- Parallel ownership: none; the identity and admission contracts must settle before canonical 9Router changes consume them
- Sequential fallback: complete Tasks 1 to 3, then Tasks 4 to 6 in 9Router, then Task 7 integrated verification

## Coordination State

- Coordination owner: `single lead controller`
- Coordination schema: `2`
- Branch: `master` for the plan record; implementation branches are selected per affected repository during execution
- Base commit: `8376eeaf` for the plan-record repository
- Expected workspace: 9Router retains only pre-existing `.serena/` and `scripts/watch-9router.ps1`; Project OS and LightRSI unrelated dirty state is preserved and not modified
- Next action: run the plan-document review, then activate only after the owner confirms the narrowed scope
- Blockers: LightRSI source checkout is not present in the current workspace; execution must use the current default-branch checkout at `85e599b3` or a clean equivalent before editing

| Task | State | Workspace | Executor | Depends On | Required Proof | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Task 1 | `pending` | all affected checkouts | `unresolved` | none | identity, admission, lifecycle, and restart contract | pending |
| Task 2 | `pending` | LightRSI clean checkout | `unresolved` | Task 1 | stable generation propagation and regression tests | pending |
| Task 3 | `pending` | Project OS clean checkout | `unresolved` | Task 1 | admission precedes pane/process mutation | pending |
| Task 4 | `pending` | 9Router current checkout or clean branch | `unresolved` | Tasks 2 and 3 | canonical stateful coalescing and observer lifecycle | pending |
| Task 5 | `pending` | 9Router current checkout or clean branch | `unresolved` | Task 4 | non-replay preflight, native identity, restart reconciliation | pending |
| Task 6 | `pending` | 9Router current checkout or clean branch | `unresolved` | Tasks 4 and 5 | diagnostic shim parity without primary ownership | pending |
| Task 7 | `pending` | all three runtime checkouts | `unresolved` | Tasks 1 to 6 | focused suites, direct boundary trace, and Codex Web proof | pending |

## Task Breakdown

### Task 1: Freeze the cross-boundary contract

**Purpose:**
- Turn the review findings into one executable identity, admission, lifecycle, and restart contract before source edits.

**Task Function:**
- Reconcile LightRSI request/admission/journal identifiers, Project OS claim timing, canonical 9Router execution state, provider replay policy, and CGW native metadata.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: choose the lowest profile that can inspect all affected repositories and resolve cross-boundary semantics without guessing.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: independently review the contract and named symbols before implementation.

**Specification Coverage:**
- One stable generation ID crosses LightRSI, canonical 9Router, and CGW.
- `requestId` remains per-request telemetry and is not generation identity.
- Project OS logical-operation identity remains unchanged, while launcher admission ordering is corrected.
- The canonical Responses provider is non-replayable.
- Restart decisions use existing evidence and never redispatch uncertain work.

**Required Skills:**
- `skill-systematic-debugging`, `skill-code-standards`, `skill-plan-document-reviewer`

**Files And Symbols:**
- Inspect: `LightRSI/components/adapters/codex/src/proxy-runtime.ts` and `upstream.ts`
- Inspect: `project-OS-starter/scripts/herdr_main_launcher.py` claim and pane/process preparation paths, plus `scripts/secretary_live_runtime.py` admission behavior
- Inspect: `src/app/api/v1/responses/route.js`, `src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js`, `open-sse/executors/base.js`, and `src/sse/utils/requestCorrelation.js`
- Inspect: `open-sse/config/replayPolicy.js`, provider route/repository code, and existing replay-policy tests
- Verify: `project-OS-starter/scripts/project_os_runtime/submission_gate.py:57` and its logical-ID tests

**Authority:**
- Preauthorized local actions: read named source and tests and record the resolved contract in execution notes.
- Stop for: a source contract requiring a new durable registry, a public schema break, a second submission gate, or undocumented provider behavior.

**Steps:**
- [ ] Confirm native Responses metadata and legitimate continuation boundaries; do not define identity from `turn_id` alone.
- [ ] Record the generation fingerprint, lifecycle states, admission point, and restart evidence matrix.
- [ ] Confirm the canonical provider node and the exact preflight/migration owner for `replayPolicy=non-replayable`.

**Verification:**
- [ ] Source inspection shows one canonical generation ID, one per-request journal ID, one request fingerprint, one admission owner, and one canonical execution owner.
- Expected: no unresolved identity alias, stale shim-first target, or Project OS logical-ID change remains in task descriptions.

**Exit Criteria:**
- The contract is explicit and accepted by the plan reviewer.

### Task 2: Separate LightRSI generation identity from request telemetry

**Purpose:**
- Prevent a new random journal request ID from making the same generation look new to 9Router and CGW.

**Task Function:**
- Implement and test stable generation-ID derivation and propagation in the Codex adapter.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: bounded TypeScript adapter change with replay and admission semantics.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: verify duplicate, reconnect, and legitimate-continuation cases independently.

**Required Skills:**
- `skill-systematic-debugging`, `skill-backend-verification`, `skill-code-standards`

**Files And Symbols:**
- Modify: `LightRSI/components/adapters/codex/src/proxy-runtime.ts` identity setup, response evidence headers, and trace payloads
- Modify: `LightRSI/components/adapters/codex/src/upstream.ts` upstream request/provider-attempt metadata and generation propagation
- Modify: `LightRSI/components/adapters/codex/tests/benchmark-admission.test.ts`
- Modify: `LightRSI/components/adapters/codex/tests/context-history-replayability.test.ts`
- Modify: `LightRSI/components/adapters/codex/tests/upstream.test.ts`

**Dependencies:**
- Task 1 identity contract.

**Steps:**
- [ ] Introduce one local `generationId` from native Responses metadata when available, otherwise stable admission/payload identity; keep `requestId` unchanged for journal and telemetry ownership.
- [ ] Emit the distinct IDs in their corresponding headers and pass `generationId` through `upstream.ts` to the canonical 9Router boundary.
- [ ] Preserve existing `providerCompatibilityProbe: "disabled"` and no-replay behavior; do not add a new native-header protocol.
- [ ] Add tests for stable duplicate/reconnect identity, distinct continuation identity, header separation, and post-dispatch uncertainty.

**Verification:**
- [ ] Adapter tests covering admission, replayability, and upstream propagation pass.
- [ ] Adapter typecheck and build pass.
- Expected: duplicate requests preserve one generation ID; legitimate continuation has a different generation ID; request telemetry remains request-scoped.

**Exit Criteria:**
- LightRSI no longer uses a random journal request ID as cross-boundary generation identity.

### Task 3: Admit model submissions before launcher-side mutation

**Purpose:**
- Remove the pane-allocation/lifecycle bottleneck where completed panes require cleanup before a new `--session auto --pane auto` probe can be admitted.

**Task Function:**
- Reorder existing launcher admission so claim success precedes pane/workspace/process preparation without creating another gate.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: bounded Python launcher lifecycle change with direct ordering tests.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: verify claim failure and claim success paths independently.

**Required Skills:**
- `skill-systematic-debugging`, `skill-backend-verification`, `skill-code-standards`

**Files And Symbols:**
- Modify: `project-OS-starter/scripts/herdr_main_launcher.py` model submission claim and pane/workspace/process preparation paths
- Modify: `project-OS-starter/tests/test_herdr_main_launcher.py`
- Verify without changing: `project-OS-starter/scripts/secretary_live_runtime.py` and submission-gate tests

**Dependencies:**
- Task 1 admission contract.

**Steps:**
- [ ] Move or gate the existing `claim_model_submission()` call so it occurs before pane ownership, workspace allocation, process creation, and equivalent model-producing mutation on every applicable launcher path.
- [ ] Preserve Secretary as the admission authority and preserve logical-operation ID derivation and binding checks.
- [ ] Add regression coverage proving failed admission performs no pane/process mutation and successful admission claims exactly once before preparation.

**Verification:**
- [ ] Project OS launcher and submission-gate tests pass.
- [ ] Contract validation passes with no unrelated Project OS source changes.
- Expected: a rejected or already-completed submission cannot consume a pane slot or start a second model process.

**Exit Criteria:**
- Launcher admission is observably before pane/process mutation, with no second gate or altered logical-ID formula.

### Task 4: Make the canonical 9Router generation execution stateful

**Purpose:**
- Ensure client disconnects, capacity pressure, and terminal failures cannot create a second physical execution for one generation on the production Responses path.

**Task Function:**
- Implement lifecycle-aware single-flight execution in the canonical chat core and executor boundary.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: high-risk JavaScript HTTP lifecycle change requiring focused boundary tests.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: validate race behavior, failure classification, and route propagation independently.

**Required Skills:**
- `skill-systematic-debugging`, `skill-backend-verification`, `skill-code-standards`

**Files And Symbols:**
- Modify: `src/app/api/v1/responses/route.js` request identity and route boundary
- Modify: `src/sse/handlers/chat.js` canonical request handling
- Modify: `open-sse/handlers/chatCore.js` generation coalescing and observer lifecycle
- Modify: `open-sse/executors/base.js` dispatch, abort, and replay classification
- Modify or extend: `src/sse/utils/requestCorrelation.js`
- Add or extend: `tests/unit/generation-single-flight.test.js` and `tests/unit/chat-request-correlation.test.js`

**Dependencies:**
- Tasks 1 and 2 stable generation contract; Task 3 admission ordering.

**Steps:**
- [ ] Define a generation entry with immutable fingerprint, lifecycle state, dispatch status, execution-owned controller, shared promise/result, observer count, and terminal timestamp.
- [ ] Route queued and dispatched work through the execution-owned controller; detach HTTP observers on disconnect and preserve shared execution after dispatch.
- [ ] Never evict active entries; evict only terminal entries under capacity pressure.
- [ ] Classify proven pre-dispatch failures as retryable and post-dispatch failures as non-replayable or reconciliation-required.
- [ ] Reject a reused generation ID with a different fingerprint using HTTP `409`, `generation_identity_conflict`, and `x-9router-no-replay: 1`.
- [ ] Add deterministic race tests for concurrent duplicates, first-observer disconnect, reconnect after dispatch, post-dispatch failure, pre-dispatch retry, active-capacity pressure, and conflict input.

**Verification:**
- [ ] Canonical unit and HTTP boundary tests pass.
- Expected: each duplicate/race case records one physical executor dispatch; conflicting fingerprints record zero additional upstream calls.

**Exit Criteria:**
- The canonical 9Router path owns generation lifecycle independently of any single HTTP observer and cannot evict or replay active or post-dispatch work.

### Task 5: Enforce canonical non-replay policy and restart-safe native identity

**Purpose:**
- Prevent provider defaults or restart uncertainty from turning an identified generation into a second prompt, while preserving native identity when it exists.

**Task Function:**
- Add provider preflight/migration enforcement and complete restart/native identity handling at the canonical boundary.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: cross-cutting provider configuration and failure-state change with existing policy tests.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: verify explicit policy, native metadata preservation, and restart matrix separately.

**Required Skills:**
- `skill-systematic-debugging`, `skill-backend-verification`, `skill-code-standards`

**Files And Symbols:**
- Modify: `src/app/api/provider-nodes/[id]/route.js` and `src/lib/db/repos/nodesRepo.js` provider preflight/migration path
- Verify or extend: `open-sse/config/replayPolicy.js`, `tests/unit/provider-replay-policy.test.js`, `tests/unit/executor-replay-policy.test.js`, and `tests/unit/no-replay-routing.test.js`
- Modify if needed: canonical request construction in `open-sse/handlers/chatCore.js` or `open-sse/executors/base.js` for native thread/turn metadata
- Verify: existing trace, dispatch, result, and LightRSI request/context receipt readers

**Dependencies:**
- Task 4 canonical generation entry and dispatch classification.

**Steps:**
- [ ] Require the canonical CGW Responses provider to resolve as `apiType=responses` and `replayPolicy=non-replayable`; fail startup/preflight or run the existing supported migration when it does not.
- [ ] Preserve supplied native thread and turn identity; when absent, deterministically synthesize identity only from stable generation identity in the compatibility path. Do not use `turn_id` alone as generation identity.
- [ ] Encode restart handling from existing evidence: retry only with proven not-dispatched evidence; return/reconcile durable completed results; otherwise emit `reconciliation_required` and prohibit redispatch.
- [ ] Add at least one restart/fault regression test covering uncertain post-dispatch state; do not add a new database or replay manager.

**Verification:**
- [ ] Provider, executor, and no-replay routing tests pass.
- [ ] Native identity payload tests pass for supplied, deterministic, and no-generation compatibility cases.
- Expected: canonical provider misconfiguration is rejected or migrated, and uncertain restart state never causes automatic redispatch.

**Exit Criteria:**
- Canonical provider policy and restart behavior are fail-closed, with native identity preserved wherever the upstream supplies it.

### Task 6: Keep the diagnostic shim in parity without making it canonical

**Purpose:**
- Prevent diagnostic probes from masking a canonical regression while avoiding a second production implementation.

**Task Function:**
- Align the shim’s observable counters, identity headers, conflict behavior, and lifecycle diagnostics with the canonical contract.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: narrow diagnostic parity change after canonical behavior is settled.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: compare shim evidence with canonical boundary evidence.

**Required Skills:**
- `skill-backend-verification`, `skill-code-standards`

**Files And Symbols:**
- Modify only if parity requires it: `tools/cgw-codex-shim/server.js` and `tools/cgw-codex-shim/cgwResponses.js`
- Verify or extend: `tools/cgw-codex-shim/test/server.test.js` and `tools/cgw-codex-shim/test/cgw-responses.test.js`

**Dependencies:**
- Tasks 4 and 5 canonical behavior.

**Steps:**
- [ ] Compare shim and canonical generation headers, counters, conflict responses, and post-dispatch failure markers.
- [ ] Apply only diagnostic parity changes; do not move canonical ownership back to the shim.
- [ ] Preserve random compatibility IDs only for requests with no stable generation identity.

**Verification:**
- [ ] Shim tests pass and report the same one-send/no-replay semantics for equivalent inputs.
- Expected: shim evidence is consistent with, but not required to implement, canonical protection.

**Exit Criteria:**
- Diagnostic probes cannot falsely report a safe single-send result because they use a different identity or replay policy.

### Task 7: Run integrated backend and Codex Web proof

**Purpose:**
- Prove the user-visible duplicate-prompt issue at the direct HTTP boundary and in the Codex Web GPT app without treating browser behavior as a substitute for backend proof.

**Task Function:**
- Execute fresh automated checks, then one bounded live probe with immutable trace and submission evidence.

**Template Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: choose the lowest profile that can operate the configured runtime and capture trace evidence.

**Validator Profile:**
- Controller-selected: `unresolved while task is pending`
- Selection basis: independently review counters, IDs, pane lifecycle, and evidence artifacts.

**Required Skills:**
- `skill-backend-verification`, `skill-cgw-runtime-operations`, `skill-verification-before-completion`

**Files And Symbols:**
- Verify: Project OS submission, launcher, secretary, and contract tests
- Verify: LightRSI adapter admission, replayability, context-history, and upstream tests
- Verify: canonical 9Router response, correlation, replay-policy, no-replay, and single-flight tests
- Verify: diagnostic shim tests
- Capture: `%USERPROFILE%/.codex/tokenpilot-state/tokenpilot/event-trace.jsonl` and a new uniquely named receipt under `%LOCALAPPDATA%/project-os/submissions`

**Dependencies:**
- Tasks 1 to 6 completed with accepted task-local proof.
- Runtime identity and effective routing policy are confirmed before any model-producing request.
- Existing historical tabs, receipts, and traces are preserved; only task-owned disposable resources may be cleaned up.

**Authority:**
- Preauthorized local actions: run named tests and builds, start one bounded local probe, inspect trace and receipt output, and inspect the Codex Web GPT tab state.
- Stop for: identity mismatch, unexpected provider/model/profile call, second physical send for one generation, pane mutation before admission, uncertain pane ownership, or cleanup of unrelated tabs and files.

**Steps:**
- [ ] Run Project OS focused tests and contract validation as read-only regression proof.
- [ ] Run LightRSI adapter tests, typecheck, and build.
- [ ] Run canonical 9Router tests, provider-policy tests, shim parity tests, and build.
- [ ] Send one bounded prompt through the configured Codex Web GPT route and capture request, generation, admission, transport, dispatch, completion, and pane counters.
- [ ] Use HTTP observer A to start generation G, then have HTTP observer B reconnect or reissue G; assert one backend generation execution, one physical CGW request, and the same owned CGW browser surface. A newly created ChatGPT tab for the same generation is failure evidence, not the observer mechanism.
- [ ] Run a legitimate continuation and assert a distinct generation ID with one additional dispatch.
- [ ] Inject or reproduce post-dispatch connection loss and assert no fallback prompt, no 9Router replay, `reconciliation_required` or durable-result reconciliation, and no automatic redispatch.
- [ ] Compare trace and receipt artifacts by immutable IDs; preserve evidence and record any blocked live dependency.

**Verification:**
- [ ] Project OS: `py -3 -m pytest tests/test_submission_gate.py tests/test_herdr_main_launcher.py tests/test_secretary_live_runtime.py -q`
- [ ] Project OS: `py -3 scripts/validate_repo_contracts.py --fast`
- [ ] LightRSI: `pnpm --filter @lightrsi/codex-adapter test`, `pnpm --filter @lightrsi/codex-adapter typecheck`, and `pnpm --filter @lightrsi/codex-adapter build`
- [ ] 9Router: canonical unit tests for response correlation, generation single-flight, provider replay policy, executor replay policy, and no-replay routing; diagnostic shim tests; and `npm run build`
- [ ] All changed repositories: `git diff --check`
- Expected: one generation records `logicalUpstreamSends=1`, `transportFetches=1`, one canonical 9Router dispatch, one CGW physical request, `successfulGenerations=1`, no unintended compatibility/profile call, no pre-admission pane mutation, and no duplicate prompt in Codex Web.

**Exit Criteria:**
- Fresh direct-boundary and Codex Web evidence satisfies every completion criterion, or the plan remains non-completed with the exact blocked boundary recorded.

## Verification

Final artifact verification runs only after all task-local checks pass:

- `project-OS-starter`: focused submission, launcher, secretary, and contract tests; launcher diff proves admission ordering and logical-ID formula is unchanged.
- `LightRSI`: adapter tests, typecheck, build, and `git diff --check` from the reviewed default-branch baseline.
- `9router`: canonical response/correlation/single-flight/replay-policy tests, diagnostic shim tests, `npm run build`, and `git diff --check`.
- Direct backend trace: one same-generation duplicate race, one disconnect and reconnect race, one pre-dispatch retry, one post-dispatch failure, one restart/fault case, and one legitimate continuation.
- Codex Web GPT trace: one accepted prompt in one owned CGW browser surface, observer reconnect without a second physical prompt, no unintended compatibility or profile call, and no pane mutation before admission.
- Evidence paths: a new immutable trace and receipt pair; prior artifacts are not overwritten.

## Completion Criteria

The plan is ready for completion verification when:

1. LightRSI emits a stable `generationId` separate from per-request `requestId`, and `upstream.ts` propagates it without changing request-scoped telemetry.
2. Native Responses metadata is preserved when present; deterministic synthesis is limited to the compatibility shim when native metadata is absent; `turn_id` alone is never treated as generation identity.
3. Legitimate continuations produce a different generation ID from the original generation.
4. Project OS claims model submission before pane/workspace/process mutation on every applicable launcher path.
5. Project OS logical-operation identity remains non-binding-scoped and its existing tests continue to pass; no second gate or altered formula is introduced.
6. The canonical 9Router Responses path coalesces identical concurrent generations into one physical execution and keeps active entries alive under capacity pressure.
7. A first observer disconnect does not abort a dispatched generation still needed by another observer.
8. Same generation ID with a different fingerprint returns `409 generation_identity_conflict`, marks no replay, and performs zero additional upstream calls.
9. The canonical CGW Responses provider is explicitly `apiType=responses` and `replayPolicy=non-replayable`; startup/preflight fails closed or performs the existing supported migration when this is false.
10. Post-dispatch failure and restart uncertainty are retained as non-replayable or `reconciliation_required`; proven pre-dispatch failure is the only retryable case.
11. Focused tests, typechecks, builds, and contract validation pass from the final candidate state.
12. Live trace proves one prompt submission, one admission, one generation dispatch, one physical CGW request, zero unintended compatibility/profile calls, no pre-admission pane mutation, and no duplicate prompt in the Codex Web GPT app.
13. No unrelated files, panes, tabs, receipts, traces, or existing dirty work are discarded.

The plan remains `proposed` until `skill-plan-document-reviewer` returns
implementation-ready and the user explicitly activates execution. It may be
marked `completed` only after `skill-verification-before-completion` returns
`verified` on fresh evidence.
