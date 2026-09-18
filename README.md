# Golden Vine Winery

[![CI](https://github.com/rgoodin/golden-vine-winery/actions/workflows/ci.yml/badge.svg)](https://github.com/rgoodin/golden-vine-winery/actions/workflows/ci.yml)

An enterprise integration engineering and Developer Experience (DevEx)
case study.

This project models a fictional winery, **Golden Vine Winery**, to explore
how a platform engineering team could provide a standardized "Golden Path"
for integrating enterprise SaaS platforms such as Salesforce, ServiceNow,
and Microsoft SharePoint.

> **Golden Vine Winery is fictional.** This is a portfolio project, not a
> real company, and is not affiliated with or built for any real employer.

## Business scenario

Golden Vine Winery sells products through distributors and retail partners.
Salesforce manages sales relationships; when a distributor reaches the
appropriate stage in Salesforce, an operational onboarding process must
begin in ServiceNow (and, later, a document workspace in SharePoint):

```
Salesforce
    ↓
Distributor Onboarding Event
    ↓
Integration Layer
    ↓
ServiceNow
    ↓
Operational / IT / Compliance Tasks
```

The first integration built was **Salesforce → Integration Service →
ServiceNow**, deliberately built manually first to produce enough
observations to identify reusable patterns before generalizing
anything. A second, independent integration - **Salesforce → Document
Workspace Service → SharePoint** - has since been built to test whether
those patterns actually transfer; see "Status" below.

## Approach

The project has two equally important goals:

1. Build a realistic enterprise application integration.
2. Observe the developer experience and evolve the implementation into a
   reusable Integration Golden Path.

Rather than designing the Golden Path upfront, the project begins as
**Developer #1**, building the first integration manually and recording
friction along the way. The Golden Path is meant to emerge from that
observed friction, following a DevEx Dojo improvement cycle:

```
Observation → Enablement → Mastery / Empowerment → Observation again
```

Full project philosophy, architecture principles, phased roadmap, and
engineering constraints (authentication, secrets, idempotency, retries,
correlation IDs, testing, CI/CD, IaC, etc.) are documented in
[`CLAUDE.md`](./CLAUDE.md).

## Repository layout

```
.
├── package.json                  # npm workspace root (packages/* + services/*)
├── CLAUDE.md                     # Project charter, philosophy, phases, and constraints
├── README.md                     # This file
├── .github/
│   └── workflows/
│       └── ci.yml                 # build + test + dependency audit, no lint/deploy stages yet
├── docs/
│   ├── architecture/              # Architecture spikes (investigation, not yet a decision)
│   ├── decisions/                 # Architecture Decision Records (ADRs)
│   ├── runbooks/                  # Platform setup checklists (Phase 3 Enablement)
│   ├── golden-path/                # Golden Path philosophy, inventory, and Start->Evaluate walkthrough
│   └── devex/                     # Developer experience journal
│       ├── observations.md        # Raw, chronological observations
│       ├── friction-log.md        # Friction items (Observation/Friction/Impact/Enablement)
│       ├── decisions.md           # Lightweight, working-level decisions
│       ├── lessons-learned.md     # Synthesized patterns, classified during Phase 2 review
│       ├── phase-2-observation-review.md  # Human-led review checkpoint (findings, not just logs)
│       └── developer-2-observations.md    # Phase 5 (Second Consumer) evaluation
├── packages/                     # Golden Path capability, extracted once proven reusable
│   ├── reliability/                # golden-path-reliability - durable operation ownership
│   └── salesforce-transport/       # golden-path-salesforce-transport - Pub/Sub API transport
└── services/
    ├── integration-service/          # Node.js + TypeScript: Salesforce -> ServiceNow (Developer #1)
    └── document-workspace-service/   # Node.js + TypeScript: Salesforce -> SharePoint (Developer #2)
```

## Status

**Phase 1's first milestone is done: the full chain works.** A real
Salesforce Platform Event is published, received via the Pub/Sub API, and
used to create a real ServiceNow Incident, end-to-end. Two rounds of
Observation Review and a chain of deliberate reliability experiments
followed, establishing exactly what does and doesn't hold up under
failure (duplicate delivery, crash recovery, silent loss, and whether
either is detectable after the fact) - culminating in an architecture
spike, and eight follow-up rounds actually testing its two strongest
candidates for guaranteeing "exactly one Incident per business event"
rather than reasoning about them. Neither candidate achieves that
guarantee unconditionally: ServiceNow itself never demonstrated a
working uniqueness-enforcement mechanism (five attempts, plus a direct
check confirming no conditional-write API exists to fall back on), and
a minimal integration-owned durable-state prototype closes every
sequential crash scenario reproduced but is defeated, deterministically,
by a genuinely concurrent "still running, not actually dead" race
between an original and a recovery owner.

**That investigation is now decided:
[ADR 0005](./docs/decisions/0005-external-side-effect-reliability-contract.md)
adopts a two-tier reliability contract.** Every Golden Path integration
gets a baseline guarantee - recoverable at-least-once processing paired
with validated audit-based detection of any residual gap or duplicate -
which is honest about not being exactly-once, but never lets a failure
go silent. A stronger, exactly-once guarantee is available only for a
target *proven* to enforce uniqueness itself, evaluated the same
rigorous way ServiceNow was: ServiceNow has not earned it yet.

**Enablement is underway.** The baseline guarantee's normal processing
path, concurrent-initial-processing protection, and stale-operation
recovery (reclaim plus ServiceNow reconciliation) are all wired into
the real service, replacing the old direct event-to-ServiceNow path,
and verified against real Salesforce and ServiceNow rather than only
against the experimental prototypes. Before wiring recovery up
automatically, a bounded investigation asked where recovery's payload
should come from in the first place, and
[ADR 0006](./docs/decisions/0006-tier1-recovery-payload-sourcing.md)
decided it: source it from Salesforce's retained replay history at
recovery time, rather than persisting business payload or a Salesforce
position reference locally - with an explicit fallback (an unlocatable
source event stays an observable, unresolved gap, never silently
treated as recovered). The existing audit tool and the recovery
function have since been composed under that contract: a manually
triggered `--recover` mode lets the audit sweep hand a GAP it just
found straight to recovery in the same run, verified end-to-end against
real Salesforce and ServiceNow - a duplicate is never touched by it, and
an unrecoverable gap stays a gap rather than being marked resolved just
because recovery was requested. What's still missing is anything that
triggers this automatically - today an operator has to run it
deliberately.

Before automating it, this project asked what automation should
actually be *allowed* to do, rather than jumping straight to a
scheduler: [ADR 0007](./docs/decisions/0007-tier1-scheduled-recovery-operational-contract.md)
decides that question as a contract, not a cron job. It doesn't pick a
schedule or a staleness threshold - both need real evidence this
project doesn't have yet, and neither may simply inherit the value used
experimentally throughout earlier rounds. It does decide that audit and
recovery must be independently schedulable (the existing interface
already allows this, no refactor needed), that a suspiciously empty
Salesforce sweep must block recovery rather than be read as "nothing to
do," and that failures should fail loudly rather than retry silently.
The recommended next step is smaller than "add a scheduler": schedule
detection only, which is mandatory under Tier 1 already and carries no
mutation risk - and is how the evidence for scheduling recovery would
actually get gathered.

That step is now built and verified. A small cron + `flock` wrapper
runs the audit tool unattended, non-mutating, and observable - proven
against real Salesforce and ServiceNow across repeated runs, a skipped
overlapping run, and a genuine failure (which fails loudly and recovers
cleanly on the next run, with no internal retry). Two real bugs
surfaced only by testing those exact conditions, not by reading the
code, and were fixed.

That standing decision has since been made deliberately: audit-only now
runs hourly on a real, installed schedule - an explicitly provisional
evidence-gathering cadence, not a chosen Tier 1 audit SLA or a recovery
policy. Scheduled recovery remains a separate, later decision, gated on
cadence and staleness evidence this hourly job exists to accumulate.

**A human-led Phase 2 Observation Review checkpoint followed** -
[`docs/devex/phase-2-observation-review.md`](./docs/devex/phase-2-observation-review.md) -
reaching 15 numbered findings about what should become reusable Golden
Path capability vs. stay a developer/business decision, and retiring
"Tier 1/Tier 2" as forward-looking terminology (the ADRs above are kept
unmodified as historical record - see the ADRs' own cross-reference
notes). That review's smallest usable Golden Path slice has since been
built: `golden-path-reliability` and `golden-path-salesforce-transport`
(`packages/`) are now real, separately importable packages, not just a
recommendation - see
[`docs/golden-path/start.md`](./docs/golden-path/start.md) for the
Start → Create → Configure → Run → Verify → Evaluate walkthrough this
produced, and
[`docs/golden-path/0002-design-principles.md`](./docs/golden-path/0002-design-principles.md)
for why extraction stopped exactly there (no ServiceNow-side
generalization yet - one target isn't enough evidence).

**Phase 5 (Second Consumer) is done: a genuinely independent second
integration, Salesforce → SharePoint, built live against a real
Microsoft 365 tenant** -
[`services/document-workspace-service/`](./services/document-workspace-service/).
Both extracted packages were imported unchanged and worked against a
target neither had seen before - normal processing, concurrent-
processing protection, and full stale-operation recovery, all
independently verified against real SharePoint, not just logged. See
[`docs/devex/developer-2-observations.md`](./docs/devex/developer-2-observations.md)
for the full evaluation: what transferred as-is, what this target
forced to be solved fresh (SharePoint has no equivalent of ServiceNow's
`correlation_id` field), and the real setup friction hit along the way.

**A follow-up architecture spike then found something genuinely
significant: SharePoint closes the exact concurrency race ServiceNow
never could.**
[`docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md`](./docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md) /
[ADR 0009](./docs/decisions/0009-sharepoint-folder-creation-uniqueness.md)
reproduced ADR 0005's slow-owner race - the scenario that produced a
real ServiceNow duplicate 3/3 times - against SharePoint instead, using
this service's real, unmodified production code. Zero duplicates in
3/3 iterations, independently verified against the live site. For this
one action, the SharePoint integration can honestly claim evidence-backed
exactly-once target-side behavior - a genuinely stronger, narrower claim
than either integration could make before, earned by direct experiment
rather than assumed from Microsoft's documentation.

See [`CLAUDE.md`](./CLAUDE.md) ("Current Repository State") for the
up-to-date summary,
[`docs/decisions/0005-external-side-effect-reliability-contract.md`](./docs/decisions/0005-external-side-effect-reliability-contract.md)
for the decision,
[`docs/architecture/0001-reliability-architecture-spike.md`](./docs/architecture/0001-reliability-architecture-spike.md)
for the full investigation behind it, and
[`services/integration-service/README.md`](./services/integration-service/README.md)
for how to run it.
