# document-workspace-service

Salesforce → SharePoint distributor document workspace integration.
This is **Developer #2's exercise** — `CLAUDE.md` Phase 5, "Second
Consumer" — a genuinely independent second integration built to test
whether `packages/reliability` and `packages/salesforce-transport`
(extracted from `services/integration-service`) actually transfer to a
different target platform, not a copy of the ServiceNow integration.

See `docs/golden-path/start.md` through `evaluate.md` for the
walkthrough this service follows, and
`docs/decisions/0008-sharepoint-authentication.md` /
`docs/runbooks/sharepoint-non-interactive-auth-setup.md` for how its
SharePoint credentials were set up.

## What it does

Subscribes to the same `Distributor_Onboarding_Requested__e` Salesforce
Platform Event `services/integration-service` subscribes to (Pub/Sub
broadcasts to every independent subscriber — no coordination needed),
and creates one SharePoint folder per distributor under a configured
document library folder, in the `Distributor Workspaces` SharePoint
site.

## What's imported vs. what's this service's own code

Imported unchanged, per `docs/golden-path/create.md`:

- `golden-path-reliability` — durable operation ownership
  (acquire/reclaim/complete/get).
- `golden-path-salesforce-transport` — Salesforce Pub/Sub connection,
  auth, checkpoint-based replay resume.

Written fresh for this integration, deliberately not shared with
`services/integration-service` (see `docs/golden-path/create.md` and
`docs/golden-path/0002-design-principles.md`, "abstractions are earned
through repetition"):

- `src/types/events.ts` / `src/salesforce/subscriber.ts` — this
  service's own canonical event type and field mapping. It looks the
  same as integration-service's because both read the same Salesforce
  object, not because the type is shared.
- `src/sharepoint/` — SharePoint auth, the folder-creation adapter, and
  target reconciliation. No generic target-adapter interface exists
  across this and the ServiceNow integration — one more target still
  isn't enough evidence to justify one.
- `src/processDistributorDocumentWorkspaceRequest.ts` /
  `src/recoverStaleDocumentWorkspaceOperation.ts` — orchestration. The
  *shape* (acquire → act → complete; reclaim → reconcile →
  complete-or-create) mirrors integration-service's exactly; the
  SharePoint-specific action inside each step does not.

## A design decision this target forced that ServiceNow didn't

ServiceNow Incidents have a native `correlation_id` field, so
reconciliation there is a direct field query. SharePoint folders have
no equivalent built-in field. `src/sharepoint/workspaceFolderName.ts`
solves this by encoding the correlationId directly into the folder
name (`<correlationId>__<distributor name>`), so both the adapter and
the reconciliation code can derive the same name independently and
stay in agreement without a shared lookup table. See
`docs/devex/observations.md` OB-0032 and `docs/golden-path/create.md`
("this is where your definition of duplicate actually lives in code").

## Setup

From the **repository root**:

```
npm install
```

Then, from this directory:

1. Copy `.env.example` to `.env` and fill in:
   - The `SALESFORCE_*` values — same Salesforce org/credentials as
     `services/integration-service/.env`; copy `certs/server.key` from
     that service into this one's own `certs/` directory too (each
     service owns its own copy of the credential it needs, per
     `docs/golden-path/0002-design-principles.md`).
   - The `AZURE_*`/`SHAREPOINT_*` values — from
     `docs/runbooks/sharepoint-non-interactive-auth-setup.md`.
2. `npm run dev` to run the subscriber.

## Commands

```
npm run dev                                   # run the subscriber (creates SharePoint workspace folders)
npm run build                                 # compile to dist/
npm start                                     # run compiled output
npm test                                      # fast, local, mock-free unit tests
npm run test-production-concurrent-idempotency # verify the durable-ownership gate via the real processing function
npm run test-production-recovery              # verify stale-operation recovery via the real recovery function
npm run detect-unprocessed-events -- --recover=<ms> # audit + recover GAPs manually, in one run
./scripts/ops/run-scheduled-audit.sh          # cron-invokable audit-only wrapper - not scheduled by default
npm run test-concurrent-create-race           # target-side uniqueness spike, Round 1 (see below)
npm run test-target-side-uniqueness-race      # target-side uniqueness spike, Round 2 (see below)
```

## Testing

`npm test` — `node:test`, no mocks, same philosophy as
`services/integration-service`: only pure/local logic is covered here
(`toCanonicalEvent()`'s field mapping, `folderNameFor()`'s naming and
sanitization). Anything touching live Salesforce or SharePoint is
verified manually against real systems — see `docs/golden-path/verify.md`
for the curated experiment set most integrations should run, and the
next section for the one experiment this integration's own target
specifically called for.

## Target-side uniqueness: a genuinely stronger claim than ServiceNow's

`createDistributorWorkspaceFolder()` creates folders with
`"@microsoft.graph.conflictBehavior": "fail"` — a real, server-side
conflict-detection mechanism ServiceNow's Table API never had. This was
tested directly, not assumed:
`docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md` /
[ADR 0009](../../docs/decisions/0009-sharepoint-folder-creation-uniqueness.md)
reproduced the exact slow-owner race
(`docs/devex/observations.md` OB-0022) that produced a real ServiceNow
duplicate 3/3 times — against SharePoint, **0/3 iterations produced a
duplicate**. For this one action, this service can honestly claim
evidence-backed exactly-once target-side behavior, not just recoverable
at-least-once processing plus audit detection. That claim is scoped
narrowly to exactly this action — see the ADR for what it does and
doesn't generalize to, and don't assume it extends to any other
SharePoint/Graph operation without its own evidence.

`recoverStaleDocumentWorkspaceOperation()` was subsequently updated to
actually lean on this: it attempts create directly and only falls back
to a reconciliation lookup on a real `WorkspaceFolderConflictError`,
rather than checking first the way the ServiceNow integration's
recovery does (a shape that made sense there because ServiceNow has no
equivalent atomic guarantee). Re-verified through the real orchestration
function under the genuine slow-owner race — see
`docs/devex/observations.md` OB-0035.

## Audit / scheduled detection

`scripts/detect-unprocessed-events.ts` is the SharePoint counterpart to
`services/integration-service`'s audit tool — same two-mode shape
(audit-only, opt-in `--recover=<ms>`) and classification model
(`GAP`/`OK`/`DUPLICATE`/`UNEVALUABLE`), built per
`docs/devex/phase-6-iteration-review.md` Finding 4 (a deliberate
exception to "don't anticipate friction" — this is a repetition of
already-validated capability, not speculation).

The actual reconciliation mechanism underneath is genuinely different
from ServiceNow's, not a mechanical port: ServiceNow has an indexed
`correlation_id` field, so its audit queries once per event. SharePoint
doesn't, so `listWorkspaceFolders()`
(`src/sharepoint/workspaceReconciliation.ts`) lists the target's actual
state **once per run**, and every event is classified against that
single in-memory snapshot — see that function's own comment, and
`docs/devex/observations.md` OB-0033 for how every classification
branch (including a manufactured `DUPLICATE` and the empty-site/404
path) was verified live, not assumed from the port.

`scripts/ops/run-scheduled-audit.sh` is a cron-invokable wrapper,
verified by direct invocation. No standing cron schedule is installed
for it — that remains a separate, deliberate decision, the same way it
was for `services/integration-service` (OB-0031).
