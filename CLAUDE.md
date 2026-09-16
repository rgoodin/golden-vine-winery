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

**With that evidence in hand, a reliability architecture spike investigated
(not chose) how to guarantee "exactly one Incident per business event"**
— see `docs/architecture/0001-reliability-architecture-spike.md` and
`docs/devex/observations.md` OB-0013. Examined target-side ServiceNow
idempotency, lookup-before-create, integration-owned durable processing
state, and Salesforce's `ManagedSubscribe`/`CommitReplay` (read directly
from the proto: it's explicit open beta and only ever addresses the
replay/checkpoint problem, never the side-effect atomicity one) against
every failure mode reproduced so far. Two candidates fully cover the
demonstrated failures on paper: target-side ServiceNow idempotency and
integration-owned durable state. Three focused follow-ups then tested
both directly rather than continuing to reason from documentation:

1. **A genuine concurrency test against ServiceNow** (two simultaneous
   create requests via `Promise.all`, not lookup-then-create) confirmed
   the unconstrained failure mode is real: with no enforced uniqueness
   constraint, both requests succeeded, creating two Incidents for one
   business operation (OB-0014).
2. **Getting ServiceNow to actually enforce a unique index remains
   unresolved**, despite real admin access, correctly elevating
   `security_admin` for the session (a genuine platform distinction —
   assigned vs. active), and removing a duplicate-data blocker the
   platform itself flagged. Even with every plausible cause ruled out,
   ServiceNow's index-creation UI returns success-shaped responses
   without ever persisting a constraint, checked four independent ways
   (FL-0018, OB-0016).
3. **A matching investigation-only prototype of the durable-state
   candidate** (`node:sqlite`, zero new dependency, a real `PRIMARY KEY`
   constraint as the atomic gate) showed the opposite mix: its core
   duplicate-prevention mechanism works cleanly, 5/5 concurrent trials
   (OB-0017) — but simulating a crash between acquiring ownership and
   calling ServiceNow causes **permanent silent loss**, with no reclaim
   mechanism designed or built (OB-0018), the same lesson as LL-0009's
   checkpoint-ordering finding, now confirmed for this candidate too.
4. **A fourth, bounded follow-up (next day) finally identified *why* the
   raw index-creation path fails**: its own Access Control requires a
   role no user can hold (`admin_overrides=false`, required role
   `nobody`) — a deliberate ServiceNow platform restriction, confirmed by
   reading the ACL directly, not a fixable gap. The *supported* wizard
   path remains unexplained despite ruling out privilege, dirty data, the
   uniqueness flag, and table complexity across five total attempts
   (tested down to a brand-new, empty, single-column table) — genuinely
   narrower evidence than before, still not a definitive answer
   (FL-0018, OB-0019). Per instruction, Candidate C's reclaim design was
   explicitly not touched this round.
5. **A fifth, same-day follow-up (bounded to Candidate C only — A left
   untouched, pending external ServiceNow input) tested whether a stale
   `in_flight` record can be safely reclaimed.** Extended the prototype
   by exactly one function, `reclaim()` — an atomic elapsed-time check,
   not a lease/heartbeat framework — then produced two crashed
   operations with an *identical* durable-record shape via different
   real paths (one that never called ServiceNow, one where ServiceNow
   genuinely succeeded first). Result: staleness-based reclaim recovers
   the genuinely-abandoned one correctly (exactly one Incident), but
   reintroduces a duplicate for the one that already succeeded — proving
   elapsed time alone cannot distinguish "abandoned" from "succeeded but
   not recorded" (OB-0020). The smallest fix identified (querying
   ServiceNow directly during reclaim) was reasoned through but
   deliberately not built (LL-0015).

On experimentally established facts alone, only Candidate C has ever
been shown to enforce the core invariant, and its own necessary
follow-up fix (reclaim) is now shown to be necessary but not
sufficient — so that's still not enough to choose it (LL-0014, LL-0015).
Both candidates now have a specific, named, unresolved blocker rather
than a vague "needs more investigation" — see
`docs/architecture/0001-reliability-architecture-spike.md` §7 for both.
Still no architecture chosen, no ADR written.

Also proposed but deliberately not built: giving the audit tool its own
incremental "last audited position" so repeat runs don't always re-sweep
from `EARLIEST` (LL-0011). Not yet built: any general retry/dead-letter/
idempotency solution, an automatic (rather than on-demand) detection
trigger, and tests. See `services/integration-service/README.md` for
current status.

A Salesforce Developer Edition org (External Client App, JWT Bearer Flow)
and a ServiceNow Developer Instance (Client Credentials grant, dedicated
`itil`-role user) have been set up for testing; credentials live in
`services/integration-service/.env` (gitignored, not in this repo).

Commands (from `services/integration-service/`):

    npm install                                   # install dependencies
    npm run dev                                   # run the subscriber (creates ServiceNow Incidents)
    npm run publish-test-event -- "Some Name"      # publish a test Salesforce event
    npm run build                                 # compile to dist/
    npm start                                      # run compiled output

There is no lint or test tooling yet — do not invent commands for either.
No other services exist yet. When more are added, or lint/test tooling is
introduced, update this section with the real commands and architecture
rather than the aspirational structure sketched later in this file.

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

    Observation
        ↓
    Enablement
        ↓
    Mastery / Empowerment
        ↓
    Observation again

The Golden Path must emerge from observed developer friction.

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


# Repository Direction

Do not create the entire repository structure prematurely.

A likely future structure may resemble:

    .
    ├── CLAUDE.md
    ├── README.md
    ├── docs/
    │   ├── architecture/
    │   ├── devex/
    │   ├── decisions/
    │   └── runbooks/
    ├── schemas/
    ├── services/
    ├── tests/
    ├── infrastructure/
    └── .github/
        └── workflows/

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

- unit tests
- schema tests
- contract tests
- integration tests
- failure-path tests

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
