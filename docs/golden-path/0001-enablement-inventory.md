# Golden Path Enablement Inventory

**Status:** Analysis only. No code changed, no scaffolding created, no
Golden Path built. This document classifies the existing Salesforce →
Integration Service → ServiceNow implementation so a human can approve
a reuse boundary before the smallest usable Golden Path slice is built.

**Context:** follows a human-led Phase 2 Observation Review that
deliberately narrowed scope away from a complete DevEx Dojo toward a
demonstrable Golden Path (Start → Create → Configure → Run → Verify →
Evaluate). This inventory is the bounded first step of that narrower
effort - see `docs/devex/dojo-perspectives.md` for the DevEx Dojo
material this builds on, and ADRs 0001-0007 /
`docs/devex/{observations,friction-log,lessons-learned}.md` for the
underlying evidence, cited below rather than repeated.

**Terminology note:** per the Observation Review, this document does
not use "Tier 1"/"Tier 2" language, even though ADR 0005-0007 do. Those
ADRs are preserved unmodified as historical evidence of how the
reliability contract was actually decided; new Golden Path material
(this document and whatever follows it) uses different, plainer
language on purpose.

---

## Classification legend

- **A - Business/application-specific.** Business semantics, mappings,
  business-operation identity, target-specific content. Must stay
  visible to the consuming developer, not hidden inside platform code.
- **B - Reusable Golden Path capability.** Repeated technical
  complexity a second developer shouldn't have to rediscover.
- **C - Platform/operations capability.** Machinery developers consume
  but don't normally maintain.
- **D - Teaching/verification artifact.** Experiments/tests that should
  stay runnable so a developer can validate behavior, not just be told
  it works.
- **E - Historical evidence only.** Real evidence from building this
  first integration; informative, not part of the normal path forward.
- **F - Unresolved.** Insufficient evidence to assign ownership
  confidently yet.

---

## A. Business/application-specific

| Item | Why |
|---|---|
| `src/types/events.ts` (`DistributorOnboardingRequestedEvent`) | The canonical event shape is Golden Vine's business contract, explicitly labeled "a starting contract, not a confirmed schema" (`CLAUDE.md`). Fields (`distributor`, `sales`, ...) are this business process's, not a platform convention. |
| `src/salesforce/subscriber.ts`'s `toCanonicalEvent()` | Defines exactly how Salesforce's flat Platform Event fields map onto the canonical shape above - a business-schema decision, not transport. |
| `src/servicenow/incidentAdapter.ts` | Defines what a "distributor onboarding" ServiceNow Incident looks like (`short_description`, `description` content, which fields populate it). A different business process would need different content, not a parameter tweak. |
| The specific `pubsubTopic` default in `src/config.ts` | `/event/Distributor_Onboarding_Requested__e` is this integration's topic, not a platform default. |
| `scripts/create-platform-event-fields.ts`'s field list | This business event's specific Platform Event fields (`docs/decisions/0003-platform-event-schema.md`). |
| The choice of `correlationId` as business-operation identity, in `src/processDistributorOnboardingEvent.ts` and `src/recoverStaleDistributorOnboardingOperation.ts` | **Business, not platform, decides what identifies "the same business operation."** The orchestration *shape* around this choice is reusable (see B) - the choice itself isn't. |
| The definition of "duplicate" baked into `src/servicenow/incidentReconciliation.ts` and `scripts/detect-unprocessed-events.ts` (`>1 Incident sharing one `correlation_id`` = `DUPLICATE`) | Same principle: **what counts as a duplicate side effect is a business/target-specific semantic decision.** It happens to be encoded in platform-adjacent code today because there's only one target and one business process - see Unresolved. |
| `docs/decisions/0003-platform-event-schema.md` | The ADR recording the business contract decision itself. |

## B. Reusable Golden Path capability

| Item | Why |
|---|---|
| `src/reliability/idempotencyStore.ts` | Genuinely target/source-agnostic durable ownership (`acquireOperation`/`reclaimOperation`/`completeOperation`/`getOperation`, keyed on an opaque ID). Never learns what a business operation *means* - confirmed three times over (`docs/devex/dojo-perspectives.md` DP-0003, DP-0007, DP-0011). The strongest, most validated candidate for actual promotion. |
| `src/salesforce/pubsubClient.ts` | Transport (gRPC channel, auth metadata, schema resolution/caching, subscribe, replay range) with zero knowledge of any specific event's shape - `DecodedPubSubEvent` is just `{schemaId, payload, replayId}`. Matches the Observation Review's framing of Salesforce transport as a platform-ownership candidate. |
| `src/salesforce/checkpoint.ts` | Generic replay-position persistence. Reusable, but its single-instance assumption (`docs/devex/friction-log.md` FL-0022) is a real, documented limitation that must travel with it, not be silently dropped. |
| `scripts/lib/salesforceTooling.ts`'s `createCustomField` | Generic Tooling API helper for creating a custom field on any Salesforce object - already written to be reused beyond this one event (its own header comment says so). |
| The orchestration *pattern* in `processDistributorOnboardingEvent.ts` (acquire → business action → complete) and `recoverStaleDistributorOnboardingOperation.ts` (reclaim → reconcile → complete-or-create) | The *shape* is what a Golden Path template should scaffold for a new integration; the business content inside each step is not (see A). |
| `src/servicenow/auth.ts`'s OAuth Client Credentials flow *code* | The flow itself (token request, bearer header) is reusable for any target using this grant type - distinct from the human setup steps that produce the credentials (see C). |
| `src/salesforce/auth.ts`'s JWT Bearer Flow signing *code* | Same distinction: the signing/exchange code is reusable; the human Connected App setup that produces the private key and client ID is not (see C). |

## C. Platform/operations capability

| Item | Why |
|---|---|
| `scripts/detect-unprocessed-events.ts` (sweep + classify + `--recover` composition) and `scripts/ops/run-scheduled-audit.sh` / `scripts/ops/crontab-hourly-audit.txt` | Per the Observation Review: scheduler/reconciliation/audit machinery is primarily Platform/Operations responsibility. Developers consume its *output* (see D) but shouldn't need to maintain the sweep/schedule/lock machinery itself. |
| ServiceNow machine-identity setup (`docs/runbooks/servicenow-non-interactive-auth-setup.md`, the dedicated `itil`-role user, the Inbound Integration OAuth record) | Per the Observation Review and ADR 0004: initially Platform/ServiceNow-team responsibility. Self-service has not been earned - the runbook is explicitly "a checklist, not automation" for exactly this reason. |
| Salesforce Connected App / JWT certificate setup (`docs/runbooks/salesforce-non-interactive-auth-setup.md`) | The human identity/credential steps (cert generation, Connected App fields, email verification) are Platform-coordinated and must stay visible - the runbook already refuses to script these away. |
| `.env`-based credential handling generally | Pattern is fine to reuse; specific values never are. |

## D. Teaching/verification artifact

| Item | Why |
|---|---|
| `scripts/test-production-concurrent-idempotency.ts` | Demonstrates concurrent-initial-processing protection against the *real* production code path (OB-0025/OB-0026), not a simulation. |
| `scripts/test-production-recovery.ts` | Demonstrates both crash boundaries and concurrent reclaim against real production code (OB-0026). |
| `scripts/test-audit-recovery-composition.ts` | Demonstrates the GAP → recover → OK path, the "not recovered" path, and DUPLICATE exclusion, end-to-end, against the real CLI (OB-0028). |
| `scripts/lib/slowWorkerA.ts` / `slowWorkerB.ts` + `scripts/test-durable-state-slow-worker-race.ts` | Demonstrates a still-real, still-unsolved limitation (the slow-owner race, OB-0022) with genuinely independent OS processes. Per the Observation Review, developers should be able to run this and see the failure mode themselves, not just be told the guarantee has a gap. |
| `scripts/verify-recent-incidents.ts` | Developer self-check tool - "did my test event actually produce what I expected in the target." |
| `scripts/publish-test-event.ts` | Developer exploration tool for generating a real test event without a full Salesforce UI workflow. |
| `scripts/test-durable-state-concurrent-idempotency.ts`, `test-durable-state-crash-gap.ts`, `test-durable-state-reclaim-ambiguity.ts`, `test-durable-state-reclaim-reconciliation.ts` | Demonstrate the same properties production code now embodies, but against the throwaway experimental store (`scripts/lib/idempotencyStore.ts`), not production modules. Still true, still instructive - but see Unresolved for whether "Verify" tooling should be curated toward production-code experiments specifically. |

## E. Historical evidence only

| Item | Why |
|---|---|
| `scripts/lib/idempotencyStore.ts` (experimental prototype) | Superseded by `src/reliability/idempotencyStore.ts`. Valuable evidence of *how* the production module was derived and validated; not something a new integration should import. |
| `scripts/test-servicenow-concurrent-idempotency.ts`, `scripts/test-servicenow-conditional-create.ts` | Established that ServiceNow does not enforce uniqueness itself (OB-0014, OB-0023) - the conclusion is captured in ADR 0005/0007 and doesn't need re-running for this target. The *technique* (fire concurrent creates, then independently re-query) is a reusable way to evaluate whether a *future* target can enforce uniqueness itself - worth keeping as a documented pattern, not a routine step. |
| `scripts/get-topic-info.ts` | One-time investigative tool (topic metadata / retention questions, LL-0007). |
| `scripts/test-recovery-payload-source.ts` | Led directly to ADR 0006; its conclusion is captured there. Part 2's finding (Salesforce `ReplayPreset.CUSTOM` resumes *after* a given position, confirmed by direct test) is a durable platform fact worth keeping as a reference even though the script itself was a one-time investigation. |
| ADRs 0001-0007, `docs/architecture/0001-reliability-architecture-spike.md`, and `docs/devex/{observations,friction-log,lessons-learned,dojo-perspectives,decisions}.md` | Preserved exactly as written, including "Tier 1"/"Tier 2" language, as the real evidentiary record of how this integration's reliability contract was decided. Not to be edited to match this document's different vocabulary - the historical record should stay honest about what was actually decided and when. |

## F. Unresolved

| Item | Why it isn't resolved yet |
|---|---|
| Whether "Verify" tooling should be a curated set that runs only against production modules (a new, small set) vs. keeping the broader experimental-prototype family as supplementary teaching material | Real design choice, not yet made - see D's note on the `test-durable-state-*.ts` family. |
| Where the "target adapter" boundary actually belongs (a shape combining `incidentAdapter.ts`'s create + `incidentReconciliation.ts`'s reconcile is visible, but with exactly one implementation) | Locking in an interface now would repeat the mistake this project has twice avoided elsewhere (DP-0003, DP-0007) - premature abstraction from a sample size of one. Needs a second target to know what's actually shared. |
| Whether `src/config.ts`'s one-flat-object-per-target shape generalizes to N targets or needs restructuring | Untested with more than one target. |
| Whether the `eventId`/`correlationId` distinction should become a platform-enforced type-level contract (e.g. a shared base event interface) or stay a documented convention each integration must apply itself | No second event type exists yet to test either approach against. |
| `checkpoint.ts`'s single-instance limitation (FL-0022) | Unresolved whether this is a platform gap to close before Golden Path adoption or an acceptable, documented limitation to defer until a real multi-instance need appears. |

---

## Cross-cutting threads worth naming explicitly

1. **Business owns "what is a business operation" and "what is a
   duplicate."** Evidenced concretely by `correlationId`'s role
   (A) and the `correlation_id`-based duplicate definition (A). The
   generic store (B) correctly stays ignorant of both; the
   adapter/reconciliation code (currently A, by necessity, with one
   target and one business process) is where that decision currently
   lives. A Golden Path template must expose this as a decision point
   for the next developer to make, not a platform default to inherit.
2. **Recovery capability is not recovery authority.** The mechanism
   (`recoverStaleDistributorOnboardingOperation`, the audit's
   `--recover` mode) is technically able to act. *Whether and when* to
   let it act - which operations, under what staleness assumption - is
   a business/customer risk decision. ADR 0007 already treats
   `staleAfterMs` as unproven and evidence-gated; this reframes *why*
   that restraint matters beyond "we lack data": the decision itself
   isn't Platform's to make unilaterally, even once the data exists.
3. **One target means no target-adapter interface yet.** `incidentAdapter.ts`
   and `incidentReconciliation.ts` look like they suggest an interface
   (create + reconcile), but generalizing from one real implementation
   would be exactly the premature abstraction this project has
   twice declined elsewhere. Left as example code, not an interface,
   until a second target exists to prove what's actually shared.
4. **The experimental `staleAfterMs=2000` must never become a Golden
   Path default**, in a template, a scaffold, or documentation -
   consistent with ADR 0007 and restated here because a Golden Path
   artifact is exactly the kind of place a "reasonable-looking" default
   could quietly become policy without anyone deciding it.

---

## Recommended smallest coherent reusable slice

Mapped to the target experience (Start → Create → Configure → Run →
Verify → Evaluate). Nothing below is built - this is a recommendation
for what the next round should build, at the smallest scope that
produces the actual experience.

- **Start** - not code. A short, business-question-first entry point
  (target's requirements, sunny-day success definition, reporting
  needs) before any technical step. The smallest artifact is a
  document, not tooling.
- **Create** - extract exactly two modules as-is into a place a new
  integration can import without copy-pasting: `idempotencyStore.ts`
  (B) and `pubsubClient.ts` + `checkpoint.ts` (B). Everything else the
  new integration needs (its event type, its mapping, its target
  adapter, its orchestration function) is written fresh, *guided* by
  the pattern these establish, not generated from a template - a
  template would have to guess business content this document's own A
  category says must come from the business, not the platform.
- **Configure** - the two runbooks (C) as-is; no self-service is
  proposed for ServiceNow or Salesforce credential setup at this stage,
  consistent with the Observation Review.
- **Run** - the existing `npm run dev` / `npm run publish-test-event`
  pattern (A, but structurally reusable) as the template for "get one
  real event through."
- **Verify** - a **curated subset** of D, not all of it: recommend
  `test-production-concurrent-idempotency.ts`, `test-production-recovery.ts`,
  and the slow-owner-race pair as the representative set a new
  integration's developer runs to see real reliability properties
  (and one real limitation) rather than being told they exist. Leave
  the broader experimental family available but not part of the
  guided path (see Unresolved).
- **Evaluate** - not code. A short, human-facing checklist comparing
  observed Verify-step evidence against the Start-step requirements,
  with an explicit "insufficient - back to Platform/Dojo" outcome
  alongside "sufficient - proceed."

## What should not be generalized yet, even though it's technically possible

- `incidentAdapter.ts` / `incidentReconciliation.ts` into a generic
  target-adapter interface (Unresolved #2).
- `src/config.ts`'s shape into a multi-target configuration schema
  (Unresolved #3).
- The `eventId`/`correlationId` distinction into an enforced base type
  (Unresolved #4).
- Any specific `staleAfterMs` or audit cadence value, anywhere a
  template or scaffold could make it look like a default rather than a
  decision (cross-cutting thread #4).
- The `test-durable-state-*.ts` experimental family into the "official"
  Verify toolkit, ahead of curating a smaller production-code-based set
  (Unresolved #1).
