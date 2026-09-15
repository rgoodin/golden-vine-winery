# Golden Vine Winery

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

The first integration built is **Salesforce → Integration Service →
ServiceNow**. SharePoint is intentionally deferred until that first
integration has produced enough observations to identify reusable patterns.

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
├── CLAUDE.md                     # Project charter, philosophy, phases, and constraints
├── README.md                     # This file
├── docs/
│   ├── decisions/                # Architecture Decision Records (ADRs)
│   ├── runbooks/                 # Platform setup checklists (Phase 3 Enablement)
│   └── devex/                    # Developer experience journal
│       ├── observations.md       # Raw, chronological observations
│       ├── friction-log.md       # Friction items (Observation/Friction/Impact/Enablement)
│       ├── decisions.md          # Lightweight, working-level decisions
│       └── lessons-learned.md    # Synthesized patterns, classified during Phase 2 review
└── services/
    └── integration-service/      # Node.js + TypeScript: Salesforce -> ServiceNow
```

## Status

**Phase 1's first milestone is done: the full chain works.** A real
Salesforce Platform Event is published, received via the Pub/Sub API, and
used to create a real ServiceNow Incident, end-to-end. A Phase 2
Observation Review has been completed, and both Phase 3 Enablement
candidates it identified have been built (see
[`docs/devex/lessons-learned.md`](./docs/devex/lessons-learned.md)).

See [`CLAUDE.md`](./CLAUDE.md) ("Current Repository State") for the
up-to-date detail, and
[`services/integration-service/README.md`](./services/integration-service/README.md)
for how to run it.
