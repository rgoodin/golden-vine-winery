# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Current Repository State

We are in **Phase 1 — Developer Experience** (see "Golden Path Evolution"
below). One service exists so far:

    services/integration-service/   Node.js + TypeScript

**Phase 1's first milestone is done — the whole chain works:** a real
Salesforce Platform Event (`Distributor_Onboarding_Requested__e`, full
canonical field set — `docs/decisions/0003-platform-event-schema.md`) is
published, received via a real Pub/Sub API gRPC subscription
(`docs/decisions/0001-integration-architecture.md`,
`src/salesforce/pubsubClient.ts`), mapped onto the canonical nested
`DistributorOnboardingRequested` shape from this file
(`src/salesforce/subscriber.ts`), and used to create a real ServiceNow
Incident (`docs/decisions/0004-servicenow-authentication.md`,
`src/servicenow/incidentAdapter.ts`). This is this file's own "Initial
Definition of Success," achieved. See `docs/devex/observations.md`
(OB-0001–OB-0006) for how it was proven and `docs/devex/friction-log.md`
(FL-0001–FL-0010) for everything learned getting there.

**Phase 2 (Observation Review) has been done twice, feeding a chain of
Phase 3 experiments** — full history in `docs/devex/lessons-learned.md`
(LL-0001–LL-0011). Condensed summary:

- Both Phase 3 candidates from the first review were built: a local
  setup/test script library (LL-0004) and non-interactive-auth runbooks
  for both platforms (LL-0003, `docs/runbooks/`).
- Rather than build retry/idempotency speculatively, that friction was
  deliberately experienced and confirmed real: duplicate delivery
  (FL-0011), a process-crashing ServiceNow failure (FL-0012), and —
  after building a minimal replay checkpoint
  (`src/salesforce/checkpoint.ts`) that successfully recovers offline
  events (OB-0008) — **both possible checkpoint orderings' failure modes
  were directly confirmed and compared (LL-0009):** checkpoint-after-
  ServiceNow (current default) causes a **duplicate** Incident on a
  crash (FL-0015); checkpoint-before-ServiceNow causes a **silent
  loss** — no Incident, no log trail (FL-0016). Neither is simply safer.
- **Whether a silent loss is detectable after the fact was investigated
  and confirmed** (`replayRange()` in `pubsubClient.ts`, either from a
  known position or a full `ReplayPreset.EARLIEST` sweep — confirmed to
  return this project's entire test history — LL-0010).
- **The detector was then extended to count Incidents, not just check
  existence** (`GAP`/`OK`/`DUPLICATE`/`UNEVALUABLE`,
  `npm run detect-unprocessed-events`), and validated against the
  complete 11-event history with **zero discrepancies** from the
  independently-predicted result (OB-0012, LL-0011).

**With that evidence in hand, a reliability architecture spike
investigated how to guarantee "exactly one Incident per business
event"** — full round-by-round history in
`docs/architecture/0001-reliability-architecture-spike.md` (now marked
RESOLVED). It examined target-side ServiceNow idempotency (**A**),
lookup-before-create (**B**), integration-owned durable processing
state (**C**), and Salesforce's `ManagedSubscribe`/`CommitReplay`
(solves only replay/checkpoint, not side-effect atomicity) against
every failure mode this project reproduced. Both strongest candidates
were tested directly, repeatedly, not reasoned about: **A never
achieved a verified ServiceNow-side enforcement mechanism** (blocked by
platform design on one path, unexplained on the supported path —
FL-0018, OB-0016, OB-0019, OB-0023 — including confirming no
conditional-write API exists to lean on instead). **C** (a `node:sqlite`
durable-ownership prototype, `scripts/lib/idempotencyStore.ts`) was
escalated one property at a time and protects against concurrent
processing, both reproduced crash boundaries, and concurrent reclaim
(OB-0017, OB-0021) — but a genuinely concurrent **slow-owner race**,
reproduced with real independent processes, defeats it deterministically
(OB-0022), and no ServiceNow API can close that gap either (OB-0023).

**That evidence chain is now decided: [ADR 0005](docs/decisions/0005-external-side-effect-reliability-contract.md)
adopts a two-tier reliability contract.** Tier 1 (mandatory, any
target): recoverable at-least-once processing via durable ownership +
reclaim + target reconciliation, **paired with** audit-based detection
of residual `GAP`/`DUPLICATE` (`detect-unprocessed-events.ts`,
validated zero-discrepancy in OB-0012) — explicitly **not**
exactly-once external effects. Tier 2 (opt-in, earned per target):
exactly-once external effects, only once a target is *proven* — by
experiment, not documentation — to enforce uniqueness itself; ServiceNow
has not earned it here. The Golden Vine integration today targets
Tier 1 only.

**Enablement has begun: Tier 1's normal processing path and concurrent-
initial-processing protection are now wired into the real service.**
`src/reliability/idempotencyStore.ts` (the production extraction of the
validated `node:sqlite` durable-ownership mechanism — `acquire`/
`complete`/`get`, keyed on `correlationId`, never `eventId`) and
`src/processDistributorOnboardingEvent.ts` (the orchestration function
`src/index.ts` now calls for every real event) replace the old direct
event → ServiceNow path. Verified against real Salesforce and
ServiceNow: normal processing, concurrent-delivery rejection (via the
real function, `npm run test-production-concurrent-idempotency`), and
checkpoint/replay resume across a restart — all independently confirmed
against ServiceNow, not just local state (OB-0025).

**Stale-operation recovery is now also wired into the real service.**
`idempotencyStore.ts` gained `reclaimOperation()` (same atomic
`UPDATE ... WHERE` shape as the experimental `reclaim()`, OB-0020/
OB-0021, `staleAfterMs` still caller-supplied); ServiceNow-specific
reconciliation was deliberately kept out of it —
`src/servicenow/incidentReconciliation.ts` (queries the standard
`correlation_id` field) and `src/recoverStaleDistributorOnboardingOperation.ts`
(reclaim → query ServiceNow → complete-or-create) are new, separate
modules. Both previously-reproduced crash boundaries and concurrent
reclaim were verified through these production functions against real
ServiceNow (`npm run test-production-recovery`, OB-0026), and normal
processing/checkpoint behavior confirmed unregressed. Two things this
round surfaced, not previously visible: recovery needs the original
event payload, which the durable store deliberately never stores
(FL-0024); and normal Salesforce redelivery does **not** trigger
recovery on its own — a stuck operation stays stuck until something
external deliberately calls the recovery function for it (FL-0025).
Nothing yet does that automatically.

**Before wiring that automatic connection, a bounded investigation asked
where recovery's payload should actually come from** (FL-0024's open
question) — see OB-0027. Compared source-owned replay (Approach A),
integration-owned payload storage (Approach B), and a minimal durable
Salesforce-position reference (Approach C) with two direct experiments,
not just reasoning: a bare business-operation ID *was* relocatable to
its source event via a full `ReplayPreset.EARLIEST` sweep (no
server-side query-by-field RPC exists — confirmed from the proto
itself), but Salesforce's retention window for this topic is still
unestablished (FL-0013); and an event's own replay ID does **not** let
you refetch that event later (confirmed directly, not just from docs —
`ReplayPreset.CUSTOM` resumes *after* the given position). **Recommends
Approach A** (no code change, reuses already-validated tooling,
preserves the target/source-agnostic boundary the reliability store has
held since OB-0025).

**That recommendation is now decided:
[ADR 0006](docs/decisions/0006-tier1-recovery-payload-sourcing.md)
adopts Approach A** — Tier 1 recovery continues sourcing its payload by
scanning Salesforce's retained replay history at recovery time; the
reliability store persists no business payload and no Salesforce
position reference. The ADR is explicit about what this does *not*
guarantee (no permanent payload durability, no random-access event
retrieval, dependent on an unestablished retention horizon) and defines
the fallback when a source event can't be located: it remains an
observable `GAP`, never silently treated as recovered. Nothing from
this ADR was implemented at the time it was written —
`recoverStaleDistributorOnboardingOperation()` already matched the
decision as-is (OB-0026), so no code change was required to conform to
it.

**ADR 0006's own recommended next step is now done: `detect-unprocessed-events.ts`
can recover the GAPs it finds, in the same run, still fully manual.**
An explicit `--recover=<staleAfterMs>` mode (no default - a bare
`--recover` is rejected) hands each `GAP` classification's
already-decoded event straight to `recoverStaleDistributorOnboardingOperation()`
- no second Salesforce replay lookup, no change to
`idempotencyStore.ts`, `incidentReconciliation.ts`, or the recovery
function itself. Verified end-to-end via the real, unmodified CLI
(`npm run test-audit-recovery-composition`, OB-0028): a recoverable GAP
is classified, recovered, and reclassified `OK` on re-audit; a GAP with
no local durable record is classified, reported `NOT RECOVERED`, and
**stays GAP** rather than being marked completed just because recovery
was requested; a `DUPLICATE` is never routed through recovery at all.
Also recovered, unplanned but real: a genuinely stale operation left
over from an earlier session's experiment. One real operational finding
surfaced and was corrected before becoming a false claim: a "0 events
collected" sweep briefly looked like retention expiry and turned out to
be a transient cold-start artifact instead (FL-0026) - worth re-checking
before trusting, especially now that it can also mean "no recovery
attempted."

**Before scheduling that composition, a bounded operational-policy round
asked what automation would actually be allowed to do** (OB-0029).
[ADR 0007](docs/decisions/0007-tier1-scheduled-recovery-operational-contract.md)
decides the contract, not a scheduler: cadence and `staleAfterMs` both
require latency/frequency evidence this project doesn't have yet, and
are **explicitly not derived from the 2000ms value used experimentally
throughout OB-0020–OB-0028**; overlapping runs are a load/observability
concern to resolve with skip-if-running, not a correctness risk (the
atomic reclaim gate already prevents double-recovery regardless of
scheduling); a zero-event sweep (FL-0026) must gate out mutating
recovery for that run rather than read as "nothing to recover";
failures fail loudly with no internal retry, relying on the next
scheduled run instead. Most notably: **audit and recovery must be
independently schedulable, and the existing `--recover=<ms>` flag
already provides that separation for free** - no refactor of
`detect-unprocessed-events.ts` is required despite FL-0027's
growing-responsibility concern. Recommends scheduling **audit-only**
first - it satisfies ADR 0005's mandatory detection floor immediately,
at zero mutation risk, and is how this project would gather the
evidence scheduled recovery still needs. Nothing was implemented this
round - no scheduler, no configuration mechanism, no code change at all.

**ADR 0007's recommended next step is now done: Tier 1's mandatory
detection can run unattended, non-mutating, and observable.**
`scripts/ops/run-scheduled-audit.sh` is a cron + `flock` wrapper -
existing OS mechanisms, no new dependency - that runs
`detect-unprocessed-events.ts` with **no arguments, ever**; `--recover`
cannot appear. The script gained two small additions: `checkSweepHealth()`
(ADR 0007 §4/FL-0026) exits before classification or recovery if a
sweep returns zero events; a `RUN_SUMMARY:` JSON line and per-`GAP`
`ageMs`/`localDwellMs` fields give structured, non-mutating evidence for
future cadence/threshold decisions, using only timestamps that already
existed. Verified against real Salesforce/ServiceNow, repeatedly:
non-mutation (local store and ServiceNow Incident count byte-identical
across ~7 runs, one skip, one failure), skip-if-running (a second
concurrent invocation exits immediately, `flock`-gated), and a genuine
failure (a bad credential fails loudly, exit 1, and a subsequent run
succeeds cleanly right after - no internal retry, no lingering bad
state). **Two real bugs were found only by testing failure/import paths
directly, not by reading the code** (FL-0028: a minimal cron-like PATH
silently resolved the wrong, too-old Node rather than failing to find
one; FL-0029: a `set -e`/`pipefail` interaction silently dropped the
wrapper's own failure logging; FL-0030: exporting a function for direct
testing triggered a real live run via an unguarded top-level `main()`
call) - all three fixed this round. The crontab entry itself was
**not** installed that round - a standing, persistent scheduling change
was explicitly left for a deliberate human decision.

**That decision has since been made: audit-only is installed and
running hourly** (OB-0031), on the user's explicit instruction, as
ADR 0007's provisional evidence-gathering cadence - not a chosen Tier 1
audit SLA, not recovery policy. `crontab -l` confirms it; a reference
copy lives at `scripts/ops/crontab-hourly-audit.txt`. See
`services/integration-service/README.md`'s "Operating the scheduled
audit" section for where results land, how to tell success from
failure, what exit 75 means, and how to disable it.

Also proposed but deliberately not built: giving the audit tool its own
incremental "last audited position" so repeat runs don't always re-sweep
from `EARLIEST` (LL-0011). Not yet built/decided: scheduled recovery
(blocked on cadence/`staleAfterMs` evidence this hourly job exists to
gather), a configuration mechanism for `staleAfterMs`, any Tier 2
investigation, and tests. See
`services/integration-service/README.md` for current status and
`docs/devex/dojo-perspectives.md` for what these Enablement rounds
looked like from each DevEx Dojo role.

**A human-led Phase 2 Observation Review checkpoint is now complete —
`docs/devex/phase-2-observation-review.md`.** This is a separate,
higher-order review from the contemporaneous "Phase 2" cycles
summarized above; it reached 15 numbered findings about what should
become reusable Golden Path capability vs. stay a developer/business
decision, retired "Tier 1/Tier 2" as forward-looking terminology
(without rewriting ADRs 0005–0007, which remain historical record), and
established "It's a Golden Path, not a gold watch" as a durable
principle. See also `docs/golden-path/0002-design-principles.md` and
`docs/golden-path/ownership-boundaries.md`, both derived from this
review, and `docs/golden-path/0001-enablement-inventory.md` (analysis
input, not itself a backlog). That review round was documentation
only — no Golden Path capability was scaffolded or extracted as part
of it.

**The smallest usable Golden Path slice that review recommended has
since been built and verified.** This repository is now an npm
workspace (`package.json` at the root). `golden-path-reliability` and
`golden-path-salesforce-transport` (`packages/`) are real, separately
importable packages — durable operation ownership and Salesforce Pub/Sub
transport, respectively, extracted out of
`services/integration-service/src/` with their global-config
dependencies replaced by explicit parameters (see each package's own
README for its public API and what it deliberately still doesn't know).
Verified against real Salesforce/ServiceNow after extraction: normal
processing, checkpoint resume, concurrent-initial-processing protection,
both crash-boundary recoveries, concurrent reclaim, the audit-only
sweep, and the exact cron wrapper script all confirmed working through
the new package structure, with zero behavior change — this was a
where-the-code-lives change, not a what-it-does change. The
Start → Create → Configure → Run → Verify → Evaluate walkthrough this
enables lives at `docs/golden-path/start.md` onward. ServiceNow-side
code was **not** touched or generalized — one target remains
insufficient evidence for a target-adapter interface
(`docs/golden-path/0002-design-principles.md`).

**Phase 5 (Second Consumer) is done — `services/document-workspace-service/`,
Salesforce → SharePoint, built live against real Microsoft 365/SharePoint,
not simulated.** Both Golden Path packages were imported with **zero
code changes** and verified working against a target neither has ever
seen before: normal processing, concurrent-initial-processing
protection, and all three recovery cases, all independently confirmed
against a real SharePoint site — see
`docs/devex/developer-2-observations.md` for the full evaluation
(sufficient), what transferred unchanged, what this target forced to
be reinvented (there is no SharePoint equivalent of ServiceNow's
`correlation_id` field — see `src/sharepoint/workspaceFolderName.ts`),
and the real setup friction encountered along the way
(`docs/devex/friction-log.md` FL-0032, FL-0033;
`docs/devex/observations.md` OB-0032). Auth setup:
`docs/decisions/0008-sharepoint-authentication.md`,
`docs/runbooks/sharepoint-non-interactive-auth-setup.md`.

**Phase 6 (Iteration) has begun — a human-led review of what Developer #2's
exercise actually taught the Golden Path** (`docs/devex/phase-6-iteration-review.md`).
Five real decisions came out of it, most notably: build SharePoint
scheduled audit/detection tooling now, a deliberate exception to "don't
anticipate friction" because the *shape* was already proven once for
ServiceNow (Finding 4). That tool is now built —
`services/document-workspace-service/scripts/detect-unprocessed-events.ts` —
and it needed a genuinely different mechanism than ServiceNow's, not a
mechanical port: ServiceNow's `correlation_id` field lets its audit
query once per event; SharePoint has no such field, so
`listWorkspaceFolders()` lists the target's actual state once per run
and classifies every event against that single snapshot instead. Every
classification branch (`GAP`/`OK`/`DUPLICATE`/`UNEVALUABLE`, the
GAP→RECOVERED→OK composition, and the empty-site/404 case) was verified
live against real Salesforce/SharePoint, including a deliberately
manufactured `DUPLICATE` — see `docs/devex/observations.md` OB-0033.
Pagination past the first page is the one branch not empirically
tested (no realistic way to create 200+ real folders for this
portfolio project) — recorded honestly as an evidence gap, not assumed
working. No standing cron schedule was installed for it — a separate,
deliberate decision, same as it was for ServiceNow (OB-0031).

**A follow-up architecture spike then produced a genuinely significant
finding: SharePoint closed the exact race ServiceNow never could.**
`docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md` /
[ADR 0009](docs/decisions/0009-sharepoint-folder-creation-uniqueness.md)
directly tested whether `createDistributorWorkspaceFolder()`'s
`conflictBehavior: "fail"` provides real target-side uniqueness — the
same property ServiceNow was tested for and never demonstrated (ADR
0005). Two rounds of live experiments against real SharePoint: a direct
concurrent-create race (5/5 iterations, no local mechanism involved —
every race resolved to exactly one success and one real `409
nameAlreadyExists`), then an exact reproduction of OB-0022's
slow-owner race (3/3 iterations, through this service's real,
unmodified production functions) — the identical structure that
produced a real ServiceNow duplicate 3/3 times when first investigated.
**0/3 iterations produced a duplicate against SharePoint.** For this one
action, `document-workspace-service` can now honestly claim
evidence-backed exactly-once target-side behavior — narrower, but
genuinely stronger, than either integration could claim before. No
production code changed as part of this finding; whether it justifies
simplifying recovery logic is flagged as a real follow-up question, not
decided here. See `docs/devex/observations.md` OB-0034.

**That follow-up was then reviewed and resolved: recovery now leans on
the proven guarantee instead of a pre-check that no longer does safety
work.** `recoverStaleDocumentWorkspaceOperation()` attempts create
directly and falls back to a reconciliation lookup only on a real
`WorkspaceFolderConflictError` (a new, distinct error type) — one
network call instead of two in the common case, and no longer forcing
this integration's recovery shape to match ServiceNow's for its own
sake once real evidence justified diverging from it. Re-verified with
the same rigor as the original finding: all three `test-production-recovery`
cases pass against the new code (Case 2 directly exercises the new
conflict-then-lookup branch), and the slow-owner race
(`test-target-side-uniqueness-race`) was re-run through the real,
upgraded production function — 0/3 duplicates, same result as before,
now through the actual code path rather than the diagnostic scripts
used to establish it. See `docs/devex/observations.md` OB-0035.

**Minimal CI/CD is now live on GitHub Actions** (`.github/workflows/ci.yml`) -
scoped to exactly what exists: `npm install` → `npm run build`
(root-level, all workspaces) → `npm test` → `npm audit --audit-level=high`.
No lint stage (no lint tooling exists yet - not invented as a side
effect of this work) and no deploy/integration/promotion stages (no
deployment target exists anywhere in this project - every service runs
locally). Needs no secrets: typecheck, build, and the real test suite
never touch live credentials, and the manual
`test-production-*`/`test-durable-state-*`/investigation scripts stay
exactly as manual as they've always been, never folded into CI. Root
`package.json` gained a `build` script (there was previously no
single root-level way to build every workspace) and an `"engines":
{"node": ">=22"}` field, documenting the real `node:sqlite` constraint
at install time, not just in one package's README.

A Salesforce Developer Edition org (External Client App, JWT Bearer Flow)
and a ServiceNow Developer Instance (Client Credentials grant, dedicated
`itil`-role user) have been set up for testing; credentials live in
`services/integration-service/.env` (gitignored, not in this repo). A
Microsoft 365 Business Basic trial tenant and a dedicated Azure AD app
registration (`Sites.Selected`, scoped to one SharePoint site) were set
up the same way for `services/document-workspace-service/`; credentials
live in that service's own `.env` (also gitignored). See
`docs/devex/friction-log.md` FL-0032 for the trial's conversion date —
not tracked automatically anywhere in this repository.

Commands:

    npm install                                   # from the REPOSITORY ROOT - sets up the packages/* workspace symlinks
    npm test                                      # from the REPOSITORY ROOT - runs every workspace's fast, mock-free unit tests

The rest, from `services/integration-service/`:

    npm run dev                                   # run the subscriber (creates ServiceNow Incidents)
    npm run publish-test-event -- "Some Name"      # publish a test Salesforce event
    npm run build                                 # compile to dist/
    npm start                                      # run compiled output
    npm run test-production-concurrent-idempotency # verify the durable-ownership gate via the real processing function
    npm run test-production-recovery              # verify stale-operation recovery via the real recovery function
    npm run test-recovery-payload-source          # investigate where recovery should source its payload from (OB-0027)
    npm run detect-unprocessed-events -- --recover=<ms> # audit + recover GAPs manually, in one run (ADR 0006, OB-0028)
    npm run test-audit-recovery-composition       # verify the audit+recovery composition end-to-end (OB-0028)
    ./scripts/ops/run-scheduled-audit.sh          # cron-invokable audit-only wrapper (ADR 0007, OB-0030) - not scheduled by default

**A first formal test suite now exists** — `node:test` (built-in, zero
new dependencies), no mocks: only pure, local, no-external-system logic
is unit-tested (`golden-path-reliability`'s full acquire/reclaim/
complete/get behavior against a real local SQLite file;
`golden-path-salesforce-transport`'s checkpoint save/load roundtrip;
`toCanonicalEvent()`'s field mapping). `npm test` from the repository
root runs all of it in well under a second. The existing
`npm run test-production-*`/`test-durable-state-*` scripts remain
exactly as they were - deliberately manual, live-system verification
against real Salesforce/ServiceNow, not folded into `npm test` and not
replaced by it. There is still no lint tooling — do not invent commands
for that. The same suite exists for `services/document-workspace-service/`
(`toCanonicalEvent()`'s mapping, `folderNameFor()`'s naming/sanitization) -
`npm test` from the repository root runs both services' suites together.

`services/document-workspace-service/` has the same command shape, from
that directory: `npm run dev`, `npm run build`, `npm start`,
`npm run test-production-concurrent-idempotency`,
`npm run test-production-recovery`,
`npm run detect-unprocessed-events -- --recover=<ms>`,
`./scripts/ops/run-scheduled-audit.sh` (Phase 6, OB-0033 - see above).
It has no `publish-test-event` script of its own - it deliberately
reuses `integration-service`'s, to exercise real Salesforce Pub/Sub
broadcast semantics across two independent services rather than
duplicate a script.

If lint tooling is introduced, update this section with the real
commands and architecture rather than the aspirational structure
sketched later in this file.

# Golden Vine Integration Golden Path

## Project Purpose

This project is an enterprise integration engineering and Developer Experience
(DevEx) case study.

The project models a fictional winery named **Golden Vine Winery** and explores
how a platform engineering team could provide a standardized Golden Path for
integrating enterprise SaaS platforms such as:

- Salesforce
- ServiceNow
- Microsoft SharePoint

The initial business workflow is distributor onboarding.

The project has two equally important goals:

1. Build a realistic enterprise application integration.
2. Observe the developer experience and evolve the implementation into a
   reusable Integration Golden Path.

This is not intended to be a simple Salesforce, ServiceNow, or SharePoint
tutorial.

The final product should demonstrate:

- enterprise application development
- API integration
- event-driven integration
- authentication and authorization
- data modeling
- CI/CD
- automated testing
- observability
- infrastructure/configuration automation
- security
- technical documentation
- developer enablement
- platform engineering
- technical leadership and instruction


# Core Principle

DO NOT design the complete Golden Path before experiencing the integration as
a developer.

We are intentionally beginning as **Developer #1**.

The project follows the DevEx Dojo improvement cycle:

    Developer experience
            ↓
    Observation
            ↓
    Human Observation Review
            ↓
    Developer / Instructor /
    Platform Engineer / Director
    perspectives
            ↓
    Enablement decision
            ↓
    Golden Path / Dojo capability
            ↓
    Next developer
            ↓
    New observations

**Human Observation Review is a deliberate step, not a formality.**
Raw friction logs do not translate themselves into Golden Path
requirements. The Dojo is not a mechanism for saying:

    friction → automate it

It is a mechanism for deciding whether a piece of observed complexity
should be taught, standardized, automated, left visible, owned
elsewhere, or investigated further — see "Human-Led DevEx Observation
Review" below for what this means operationally, and
`docs/devex/phase-2-observation-review.md` for the first completed
review of this kind.

**Developer #2 is not the end of the cycle.** Developer #1 discovers
the terrain. Developer #2 tests whether what was learned actually
transfers to a second implementation. A later Developer #3 may expose a
requirement that invalidates an assumption baked into the existing
path — that is a healthy signal the cycle is supposed to produce, not a
failure to comply with the Golden Path (see "Golden Path Adoption"
below).

The Golden Path must emerge from observed developer friction, reviewed
by a human before it becomes a decision.

Do not prematurely automate a problem we have not experienced.


# Business Scenario

Golden Vine Winery sells products through distributors and retail partners.

Salesforce is used to manage sales relationships.

When a distributor reaches the appropriate stage in Salesforce, an operational
onboarding process must begin.

The target workflow is:

    Salesforce
        ↓
    Distributor Onboarding Event
        ↓
    Integration Layer
        ↓
    ServiceNow
        ↓
    Operational / IT / Compliance Tasks

A later phase will add:

    Integration Layer
        ↓
    SharePoint
        ↓
    Distributor Document Workspace

Completion of the onboarding process should eventually update Salesforce.


# Initial Integration

The first integration is:

    Salesforce → Integration Service → ServiceNow

Do not implement SharePoint until the first integration has produced enough
observations to identify reusable patterns.

The second integration will test whether those patterns are actually reusable.


# Architecture Philosophy

Prefer loosely coupled integrations.

Avoid:

    Salesforce → custom ServiceNow-specific code everywhere

Prefer:

    Salesforce
        ↓
    Canonical Event / API Contract
        ↓
    Integration Service
        ↓
    ServiceNow Adapter

Future:

                    ┌─ ServiceNow
    Salesforce ─────┼─ SharePoint
                    └─ Other Platforms

The integration layer should prevent individual enterprise platforms from
becoming unnecessarily coupled to one another.


# Canonical Business Event

The first domain event is:

    DistributorOnboardingRequested

Example conceptual payload:

    {
      "eventType": "DistributorOnboardingRequested",
      "eventVersion": "1.0",
      "eventId": "...",
      "correlationId": "...",
      "timestamp": "...",
      "distributor": {
        "externalId": "...",
        "name": "...",
        "primaryContact": {
          "name": "...",
          "email": "..."
        }
      },
      "sales": {
        "opportunityId": "...",
        "accountId": "...",
        "owner": "..."
      }
    }

This is only a starting contract.

Do not assume the schema is correct merely because it appears here.

Change it when implementation experience demonstrates a better design.


# Developer #1 Rule

During the initial implementation, record friction.

Examples:

- How do I obtain Salesforce credentials?
- Which authentication mechanism should I use?
- Where do secrets live?
- How do I configure a developer environment?
- How do I discover the Salesforce API?
- How do I discover the ServiceNow API?
- What identifiers map between systems?
- What happens when ServiceNow is unavailable?
- How do I replay a failed event?
- How do I prevent duplicate processing?
- How do I test without production systems?
- How do I inspect an integration transaction?
- How do I correlate logs across systems?
- How do I know whether deployment succeeded?
- How do I add another target system?

Do not hide these problems by immediately automating them.

Document them first.


# Developer Experience Journal

Maintain:

    docs/devex/

Recommended structure:

    docs/devex/
        observations.md
        decisions.md
        friction-log.md
        lessons-learned.md

**Record friction before coding starts, not only during
implementation.** A completed review of this project's own history
(`docs/devex/phase-2-observation-review.md`, Finding 1) found real,
meaningful friction — Salesforce configuration choices made before
having enough experience to understand their consequences — that the
original logs never captured, because deliberate recording only began
once implementation was underway. The observation mechanism was biased
toward implementation friction simply because that's when someone
started paying attention. Explicitly include:

- environment provisioning
- account creation
- platform configuration
- permissions and access requests
- terminology mismatches (what the docs call something vs. what the UI
  actually shows)
- credential retrieval
- documentation discovery (did you find the right docs, and how long
  did that take)
- decisions that feel premature — a choice the tool is asking for
  before you have enough context to make it well

Each meaningful friction item should capture:

## Observation

What was the developer attempting to accomplish?

## Friction

What made the task difficult, unclear, repetitive, risky, or slow?

## Impact

What did the friction cost?

Examples:

- time
- context switching
- security risk
- configuration errors
- cognitive load
- repeated work

## Possible Enablement

What could the platform provide to remove or reduce the friction?

DO NOT automatically implement the proposed solution.

Observation precedes enablement.


# DevEx Dojo Roles

The project should eventually be examined from several perspectives.

## Developer

Consumes the platform and attempts to deliver an integration.

Primary question:

    "What do I need to know or do to ship this?"

## Dojo Instructor

Helps the developer understand the system and removes unnecessary learning
barriers.

Primary question:

    "What does the developer need to learn, and how can we teach it?"

## Platform Engineer

Builds reusable capabilities that eliminate repeated engineering work.

Primary question:

    "What should developers no longer have to solve themselves?"

## Dojo Director

Examines patterns across integrations and teams.

Primary question:

    "What systemic improvement would make every future integration easier?"

Do not confuse these roles.

The developer experience should be understood before the platform engineer
abstracts it.


# Human-Led DevEx Observation Review

The DevEx Dojo uses a human-led Observation Review between raw
Developer experience and Enablement. See
`docs/devex/phase-2-observation-review.md` for the first completed
review of this kind, and the updated cycle diagram under "Core
Principle" above for where this step sits.

Claude may:

- record friction, observations, experiments, failures, and lessons;
- preserve contemporaneous evidence;
- identify possible enablement candidates;
- implement bounded work explicitly approved after review.

Claude must not:

- automatically convert friction into Golden Path requirements;
- treat "Possible Enablement" entries as approved backlog;
- promote Developer #1 architectural conclusions into universal
  Golden Path policy without human review;
- infer customer/business semantics such as business-operation
  identity or duplicate definition;
- choose customer risk policy such as recovery thresholds;
- claim reliability properties stronger than demonstrated evidence;
- generalize abstractions solely because doing so is technically possible;
- begin the next Enablement implementation merely because an inventory
  identifies a reusable candidate.

Human reviewers determine whether an observation should be:

- taught by the Dojo;
- exposed as a developer decision;
- standardized by Platform;
- automated by Platform;
- owned by Operations;
- owned by Business/Customer;
- left implementation-specific;
- investigated further.


# Golden Path Evolution

The expected evolution is approximately:

## Phase 0 — Baseline

Understand the business problem and architecture.

Produce only enough design to begin safely.

## Phase 1 — Developer Experience

Build the Salesforce → ServiceNow integration manually enough to understand
the real developer experience.

Document friction.

## Phase 2 — Observation Review

Classify observations.

Potential categories:

- environment setup
- authentication
- secrets
- API discovery
- schemas
- testing
- error handling
- deployment
- observability
- documentation

## Phase 3 — Enablement

Begin extracting reusable capabilities.

Possible examples:

- standard authentication modules
- standard event envelope
- schema validation
- logging conventions
- correlation IDs
- retry handling
- dead-letter handling
- test harness
- CI/CD templates
- environment bootstrap
- secrets integration

These are possibilities, not predetermined requirements.

## Phase 4 — Golden Path

Package proven reusable capabilities into an opinionated integration template.

Conceptually:

    goldenpath create-integration

The exact interface should be determined later.

## Phase 5 — Second Consumer

Build:

    Salesforce → SharePoint

Use the Golden Path.

Observe where the Golden Path succeeds and where it fails.

## Phase 6 — Iteration

Improve the Golden Path based on the second developer experience.

This demonstrates that the platform evolves through observation rather than
centralized assumptions.


# Golden Path Reliability Claims

Do not use Tier 1 / Tier 2 terminology as the Golden Path reliability model.

Describe reliability in terms of intended behavior, experimental evidence,
known limitations, and consumer validation.

Use this principle:

    "Here is the reliability behavior this profile is designed to provide.
    Here are the experiments that established it. Run them against your
    implementation. Compare the observations with your customer's
    requirements. Do not claim a stronger property than your evidence
    supports."

The Golden Path is a set of evidence-backed guardrails, not a guarantee
that an implementation satisfies a customer's requirements.

    "It's a Golden Path, not a gold watch."

See `docs/devex/phase-2-observation-review.md` (Findings 9, 12) and
`docs/golden-path/0002-design-principles.md` for the full reasoning.
`docs/decisions/0005-external-side-effect-reliability-contract.md`
through `0007` remain historical evidence of the Tier 1/Tier 2
reasoning Developer #1 actually used and are not rewritten to match
this section.


# Golden Path Adoption

Use of the Golden Path is encouraged, not mandatory.

A developer may determine through evidence that the Golden Path is
insufficient for a customer requirement.

Developers should be encouraged to bring that evidence to Platform/Dojo
before independently abandoning the path when practical.

A justified exception is an Observation and may become input to the next
Golden Path iteration.

Do not turn this philosophy into "Golden Path compliance." A developer
who deviates with evidence has produced a useful signal for the Dojo,
not a violation to correct.


# Repository Direction

Do not create the entire repository structure prematurely.

Current structure (as of the minimal CI/CD addition):

    .
    ├── package.json           # npm workspace root
    ├── CLAUDE.md
    ├── README.md
    ├── .github/
    │   └── workflows/
    │       └── ci.yml         # build + test + dependency audit - no lint/deploy stages yet
    ├── docs/
    │   ├── architecture/
    │   ├── devex/
    │   ├── decisions/
    │   ├── golden-path/        # philosophy, inventory, ownership, Start->Evaluate walkthrough
    │   └── runbooks/
    ├── packages/               # Golden Path capability - only what's been extracted with real evidence
    │   ├── reliability/
    │   └── salesforce-transport/
    └── services/
        ├── integration-service/          # Developer #1: Salesforce -> ServiceNow
        └── document-workspace-service/   # Developer #2: Salesforce -> SharePoint

A further-future structure may still add:

    ├── schemas/
    ├── tests/
    └── infrastructure/

Each addition to `packages/` should follow the same discipline that
produced the first two: extracted because a real, evidenced need showed
it was reusable (`docs/golden-path/0001-enablement-inventory.md`,
`docs/golden-path/0002-design-principles.md`), not created speculatively
ahead of that evidence.

Allow the structure to evolve with the project.


# Architecture Decision Records

Important architectural decisions should be captured as ADRs.

Location:

    docs/decisions/

Examples:

    0001-integration-architecture.md
    0002-event-contract.md
    0003-authentication-strategy.md

Each ADR should contain:

- Context
- Decision
- Alternatives considered
- Consequences

Do not manufacture alternatives merely to make an ADR appear sophisticated.


# Integration Engineering Requirements

As the project matures, consider the following concerns.

These are engineering concerns to investigate, not automatic implementation
requirements.

## Authentication

Prefer modern OAuth-based authentication where supported.

Never commit:

- passwords
- client secrets
- tokens
- certificates
- private keys

## Secrets

Secrets must eventually come from an appropriate secret-management mechanism.

Local development may use environment variables or another safe development
mechanism.

Never commit real credentials.

## Idempotency

Assume enterprise events may be delivered more than once.

Integration handlers should eventually be capable of safely processing
duplicate requests.

## Retry

Transient failures should be distinguishable from permanent failures.

Avoid blind retry loops.

## Dead Letter / Failure Handling

Failed integration transactions should eventually be inspectable and
recoverable.

## Correlation

Transactions should have a correlation identifier that can follow the business
operation across systems.

## Logging

Prefer structured logs.

Never log secrets or unnecessary sensitive information.

## Schema Versioning

Integration contracts should be explicitly versioned.

Breaking changes require deliberate handling.

## API Contracts

Where appropriate, prefer machine-readable contracts such as:

- OpenAPI
- JSON Schema

## Testing

Testing should eventually include:

- unit tests — **started**: `npm test` (root), `node:test`, mock-free,
  pure/local logic only (see "Current Repository State" above).
- schema tests
- contract tests
- integration tests — the existing `npm run test-production-*`/
  `test-durable-state-*` scripts already serve this role, against real
  Salesforce/ServiceNow, deliberately not mocked; not yet folded into
  any single runner or made to run automatically.
- failure-path tests — several already exist as deliberate, real
  failure-path experiments (crash boundaries, the slow-owner race,
  cron failure handling); not yet part of the unit suite, for the same
  reason integration tests aren't - they require real systems and real
  time, not something to run on every `npm test`.

Do not rely solely on happy-path testing.


# CI/CD Philosophy

CI/CD is part of the product.

The desired mature flow is approximately:

    lint
      ↓
    unit tests
      ↓
    schema / contract validation
      ↓
    security checks
      ↓
    build
      ↓
    deploy development
      ↓
    integration tests
      ↓
    promotion / approval
      ↓
    production

Do not implement pipeline stages that provide no demonstrated value simply to
make the pipeline larger.


# Infrastructure as Code

Prefer Infrastructure as Code wherever infrastructure is under our control.

Terraform is the preferred IaC technology unless the target platform provides
a compelling reason for another mechanism.

Configuration inside SaaS products may require platform-specific deployment
mechanisms.

Document the distinction between:

- infrastructure
- application configuration
- integration configuration


# GitHub

This project should use GitHub.

> **Note (2026-09-18):** this section was aspirational, unenforced text
> for the entire project's history until now - every prior commit
> actually pushed to GitLab (`gitlab.com:rgoodin2/golden-vine-winery`),
> not GitHub, and nothing caught the gap until CI/CD scoping required
> checking. Hosting has now been migrated to
> [github.com/rgoodin/golden-vine-winery](https://github.com/rgoodin/golden-vine-winery)
> (full history preserved), making this section accurate going forward.
> The GitLab remote (`gitlab`) still exists, untouched, as a backup -
> see `docs/devex/friction-log.md` FL-0034.

Prefer GitHub Actions for CI/CD.

Organization-level secrets may be used when appropriate.

Never place secrets directly in workflow YAML.


# Documentation as Product

Documentation is part of the Golden Path.

Eventually a new developer should be able to answer:

1. What does this integration do?
2. How do I run it locally?
3. How do I authenticate?
4. How do I test it?
5. How do I deploy it?
6. How do I troubleshoot it?
7. How do I create another integration?

If those answers require tribal knowledge, the platform is incomplete.


# Portfolio Integrity

This is a portfolio project.

Never imply that:

- Golden Vine Winery is a real company.
- This system was built for Gallo.
- We have access to Gallo systems.
- We know Gallo's internal architecture.
- We know Gallo's Salesforce, ServiceNow, or SharePoint implementation.
- The architecture represents Gallo's actual production environment.

Golden Vine Winery is fictional.

The business scenario is designed to demonstrate engineering capabilities
relevant to enterprise platform development.


# Resume / Interview Integrity

The project may eventually support statements such as:

    "Built a portfolio enterprise integration connecting Salesforce and
    ServiceNow using modern API and event-driven integration patterns."

It must NOT support claims such as:

    "Professional ServiceNow developer"

unless separate professional experience supports that statement.

Clearly distinguish:

- professional experience
- hands-on lab/portfolio experience
- conceptual knowledge


# Engineering Behavior

When implementing work:

1. Understand the current phase.
2. Do not skip ahead to the final platform.
3. Make the smallest useful change.
4. Test the change.
5. Record meaningful developer friction.
6. Update documentation when behavior changes.
7. Explain architectural decisions.
8. Avoid unnecessary complexity.
9. Prefer maintainable code over clever code.
10. Never hide failures merely to make a demo pass.


# Claude Operating Instructions

Before making significant changes:

1. Read this file.
2. Read the relevant documentation.
3. Determine which DevEx Dojo phase we are currently in.
4. State the proposed change.
5. Identify whether the change solves observed friction or anticipates friction.
6. If it anticipates friction, challenge whether it should be implemented yet.

When asked "what's next?", prefer the next smallest experiment that teaches us
something.

Do not automatically generate large amounts of infrastructure or boilerplate.

We are optimizing for learning first and automation second.


# Initial Definition of Success

The first milestone is NOT:

    "We have a Golden Path."

The first milestone is:

    "A developer successfully causes a realistic Salesforce business event to
    create or update something in ServiceNow, and we have documented what the
    developer experienced while making that happen."

Only after that milestone should we decide what belongs in the Golden Path.


# Long-Term Definition of Success

The project succeeds when a second developer can build a new enterprise
integration using the Golden Path with substantially less:

- setup work
- platform-specific knowledge
- duplicated code
- security decision-making
- deployment knowledge
- troubleshooting effort

while retaining enough visibility to understand how the integration works.

The final case study should be able to show the progression:

    Developer friction
        ↓
    Observation
        ↓
    Platform capability
        ↓
    Developer enablement
        ↓
    Reuse by another integration
        ↓
    Measured improvement
        ↓
    Further iteration

That evolution is the product.
