# Phase 6 Iteration Review

**Status:** Complete. This is the authoritative checkpoint for the
conclusions reached in this review.

**What this document is:** the first Phase 6 ("Iteration") review per
`CLAUDE.md`'s Golden Path Evolution — a **human-led** review of what
Developer #2's exercise (`docs/devex/developer-2-observations.md`,
`docs/decisions/0008-sharepoint-authentication.md`,
`docs/devex/friction-log.md` FL-0032/FL-0033,
`docs/devex/observations.md` OB-0032) actually taught about the Golden
Path, conducted as an interview immediately after that exercise
completed. Same discipline as `docs/devex/phase-2-observation-review.md`:
the findings below are **human-reviewed conclusions**, reached in
direct conversation with the project's owner, not Claude-generated
deductions. Claude's role was to ask questions grounded in the real
evidence, and to record and structure the conclusions reached — not to
originate them.

---

## Finding 1 — The `Sites.FullControl.All` bootstrap step stays a documented checklist, not automation, for now

FL-0033 (granting our app's `Sites.Selected` access to one SharePoint
site required briefly holding the broadest possible SharePoint
delegated permission) stays exactly what it is today: a reviewed,
manual checklist step in
`docs/runbooks/sharepoint-non-interactive-auth-setup.md`. This
continues the same reasoning Finding 5 of the Phase 2 review applied to
ServiceNow's machine-identity setup — self-service/scripted automation
for a platform-configuration step is not justified by one integration's
experience of it.

A scripted, reusable bootstrap procedure (e.g. a small CLI wrapper
around the delegated-consent + `POST /sites/{id}/permissions` sequence)
is recorded here as a **backlog candidate**, not approved work.
Revisit after more iterations or additional integrations have exercised
this same bootstrap step, not on a fixed timeline.

## Finding 2 — Identity-encoding-when-no-native-field is worth teaching; the code stays implementation-specific

`workspaceFolderName.ts`'s approach — encoding the business-operation
identity directly into the target record's name when the target has no
native correlation field — is a genuinely reusable *way of thinking*,
not a reusable *module*. It should be added to
`docs/golden-path/create.md` as explicit guidance for the next
developer whose target also lacks a native identity field: "here's how
to think about it," not a function to import.

This keeps Finding 8's lineage from the Phase 2 review intact —
business-operation identity (what makes two things "the same
operation") is a business/development decision the Platform carries,
not one it originates or standardizes away.

## Finding 3 — A shared target-adapter interface remains premature; the signal that would change this is now concrete

ServiceNow's and SharePoint's reconciliation functions have genuinely
different shapes: `findIncidentByCorrelationId(correlationId: string)`
vs. `findDistributorWorkspaceFolder(event: DistributorOnboardingRequestedEvent)` —
one is queryable by a native field, the other has to recompute a
derived identity from the full event. Forcing a shared interface today
would either widen ServiceNow's signature to carry data it doesn't
need, or hide the real semantic difference behind an interface that
pretends the two are the same.

**Decision: still premature — two different targets needing two
different shapes is evidence to wait for more data, not to
generalize.** The concrete signal that would change this: a third
target whose reconciliation needs the *same* shape as one of these two
existing targets — the first real repetition, not another one-off.

## Finding 4 — Build scheduled audit/detection tooling for SharePoint now, deliberately breaking from "wait for felt pain"

Unlike ServiceNow's original audit tool (`detect-unprocessed-events.ts`,
ADR 0006/0007), which was built only after duplicate/silent-loss
friction was actually experienced (`docs/devex/lessons-learned.md`
LL-0009/LL-0010), this decision is made **before** any equivalent
SharePoint friction has occurred. That is a deliberate, explicit
exception to the project's general "do not anticipate friction"
principle — justified specifically because the *shape* of the solution
is no longer speculative: it was already built once, for a different
target, and validated with real evidence (OB-0012, OB-0028, OB-0030,
OB-0031). Building it for SharePoint is treated as a repetition of
already-proven capability, not invention ahead of evidence.

This is **not** a standing policy that future targets automatically get
scheduled audit tooling on day one — it is reassessed iteration to
iteration, target to target, not fixed here as a rule.

**Approved next step (this review's actual Enablement decision):**
build a SharePoint equivalent of `detect-unprocessed-events.ts` for
`services/document-workspace-service/`. While building it, actively
look for a genuinely different solution shape SharePoint's target
might call for (not just a mechanical port) — and if one is found, test
it with the same rigor Developer #1's reliability investigation used:
real, reproducible experiments against live Salesforce/SharePoint, not
reasoning about it in the abstract. See
`docs/architecture/0001-reliability-architecture-spike.md` for the
standard this project holds itself to.

## Finding 5 — No process-level friction this round

Asked directly whether anything about *how* this round's collaboration
worked (Developer #2 built primarily by Claude, including live
browser-driven platform setup) was worth recording as its own
observation, separate from the technical findings: no. The process was
comfortable; nothing distinct enough to capture.

---

## What this review did not do

- It did not implement the SharePoint audit tool itself — Finding 4
  approves the work; the work is a separate following step.
- It did not choose a `staleAfterMs`, recovery cadence, or any other
  business/customer risk policy for the SharePoint integration — that
  remains a business/development decision per Finding 11 of the Phase 2
  review, unchanged by this one.
- It did not answer `docs/devex/developer-2-observations.md`'s open
  Start question (what reporting/visibility a real customer would need)
  — still genuinely unanswered, not addressed here.
- It did not decide anything about a third integration or a third
  target — Finding 3's signal is a condition to watch for, not a
  commitment to build one.

## Next step

Build the SharePoint scheduled audit/detection tool per Finding 4,
approved in this review.

**Status: done**, immediately following this review —
`services/document-workspace-service/scripts/detect-unprocessed-events.ts`
and `scripts/ops/run-scheduled-audit.sh`. See
`docs/devex/observations.md` OB-0033 for what was built, the new
solution shape it required (not a mechanical port of ServiceNow's
version), and how every classification branch was verified live. No
standing cron schedule was installed — that remains a separate,
deliberate decision.
