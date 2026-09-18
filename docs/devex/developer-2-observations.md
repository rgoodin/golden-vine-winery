# Developer #2 observations: Salesforce → SharePoint

`CLAUDE.md` Phase 5, "Second Consumer": "Build: Salesforce → SharePoint.
Use the Golden Path. Observe where the Golden Path succeeds and where
it fails." This document is that observation — the actual output this
exercise exists to produce, not the code itself (`services/document-workspace-service`).

Per the Core Principle cycle: Developer #1 (`services/integration-service`)
discovered the terrain. This is Developer #2 testing whether what was
learned actually transfers to a second, independent implementation.

## Start: the business questions, answered for this integration

Per `docs/golden-path/start.md`:

1. **What does the target need?** SharePoint, specifically the
   `Distributor Workspaces` site's default document library. Access
   was self-service to set up (a new Azure AD app registration, no
   platform-team gatekeeping) — see
   `docs/golden-path/ownership-boundaries.md`; this stayed a developer
   decision, same as it was for ServiceNow.
2. **What does successful completion mean?** One SharePoint folder per
   distributor, named so the business-operation ID is recoverable from
   the name alone.
3. **What reporting/visibility does the customer need?** Not
   determined this round — no real customer/business stakeholder was
   consulted for this exercise, unlike the original ServiceNow
   integration's business scenario. This is a real, deliberate gap in
   this evaluation, noted rather than filled in speculatively.
4. **What identifies "the same operation," and what's a duplicate?**
   The `correlationId`, embedded directly in the folder name
   (`<correlationId>__<distributor-name>`) — SharePoint has no native
   field equivalent to ServiceNow's `correlation_id`, so this
   integration had to invent its own encoding. See
   `src/sharepoint/workspaceFolderName.ts`.

## What transferred unchanged — real evidence, not assumed

Both Golden Path packages were imported with **zero code changes** and
worked against a target neither package has ever seen before:

- **`golden-path-reliability`**: `acquireOperation`/`reclaimOperation`/
  `completeOperation`/`getOperation` all worked correctly on first real
  attempt against SharePoint — normal processing, concurrent-initial-
  processing protection, and all three recovery cases (crash before
  side effect, crash after side effect, concurrent reclaim) passed,
  verified independently against live SharePoint (not just this
  service's own logs). See the live output of
  `npm run test-production-concurrent-idempotency` and
  `npm run test-production-recovery` in this service.
- **`golden-path-salesforce-transport`**: `subscribe()` and its
  cwd-relative checkpoint default gave this service its own,
  completely independent `.checkpoint.json` and `.idempotency.sqlite`
  with zero configuration — confirmed by inspecting the files directly,
  distinct from `services/integration-service`'s own. Pub/Sub's
  broadcast semantics were also confirmed for free: a single
  `publish-test-event` invocation from `integration-service` was
  received and correctly processed by this completely separate
  service's own subscription, with no coordination code written.

This is the strongest possible evidence for the packages' design intent
(`docs/golden-path/0002-design-principles.md`): parameterizing away the
hidden `integration-service`-specific assumptions actually produced
reusable capability, not just relocated code.

## What had to be reinvented — real target differences, not gaps

- **Business-operation identity encoding.** ServiceNow's
  `correlation_id` field has no SharePoint equivalent. This forced a
  genuine design decision (`workspaceFolderName.ts`) that
  `docs/golden-path/create.md` explicitly anticipated
  ("this is where your definition of duplicate actually lives in
  code") but could not solve in advance — a real, useful confirmation
  that the boundary was drawn in the right place.
- **No generic target-adapter interface** was needed or missed —
  `workspaceAdapter.ts`/`workspaceReconciliation.ts` were written fresh
  in well under an hour, reusing nothing from
  `servicenow/incidentAdapter.ts` beyond the *shape* of the pattern.
  One more data point that a shared interface still isn't earned
  (`docs/golden-path/0002-design-principles.md`).
- **No scheduled audit tooling exists for this target.** Deliberately
  out of scope for this round (see this service's README) — real
  infrastructure, not needed to answer the question this exercise was
  actually asking.

  > **Phase 6 note:** this was revisited immediately after this
  > document's own review and decided differently — see
  > `docs/devex/phase-6-iteration-review.md` Finding 4. The tool now
  > exists; this passage is left as-is because it accurately records
  > this round's state at the time, not because it's still current.

## Friction encountered getting here

Two real, non-code friction items were recorded as they happened, not
after the fact:

- **FL-0032**: the Microsoft 365 Developer Program's free sandbox path
  is no longer available to most individual developers — required a
  real-time pivot to a paid-after-trial tenant.
- **FL-0033**: granting the least-privilege `Sites.Selected` permission
  to one site required briefly holding the broadest possible SharePoint
  delegated permission (`Sites.FullControl.All`) — a real asymmetry
  against Salesforce's and ServiceNow's single-step credential setup
  (ADR 0002, ADR 0004).

Neither is a Golden Path failure — both are platform-specific setup
friction the two imported packages had no way to shield a developer
from, because neither package's job is Azure AD or SharePoint site
administration.

## Evaluate

**Sufficient.** The observed behavior satisfies what was written down
in Start: one real folder per distributor, created reliably, with the
same recoverable-from-a-crash guarantee the ServiceNow integration
has — demonstrated with the same rigor (live, independently verified,
not just logged) rather than merely asserted.

The one open item — reporting/visibility requirements (Start question
3) — was never answered because no real business stakeholder was
consulted for this exercise. That is an honest limitation of this
being a portfolio exercise, not a Golden Path shortfall, and is left
here rather than answered speculatively.

## Feeding Phase 6 (Iteration)

What actually transferred (both packages, unmodified) and what didn't
need to (a shared target-adapter interface, still not justified by two
data points) are both real signal for the next Golden Path iteration.
The one candidate worth Human Observation Review attention: whether
FL-0033's bootstrap friction is common enough across future Microsoft
Graph-based targets to warrant a documented, reusable procedure beyond
what the runbook already captures — not decided here, per
`CLAUDE.md`'s "Human-Led DevEx Observation Review" (Claude records and
proposes; humans decide).
