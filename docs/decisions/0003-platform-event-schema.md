# 0003. Platform Event field schema and flattening

## Context

The canonical `DistributorOnboardingRequested` event sketched in `CLAUDE.md`
is a nested JSON structure (`distributor.primaryContact.email`,
`sales.opportunityId`, etc.). Salesforce Platform Events are flat records —
custom fields cannot be nested objects.

## Decision

Represent the canonical event as a flat set of custom fields on
`Distributor_Onboarding_Requested__e`, all `Text`, and reconstruct the
nested canonical shape in the integration service
(`src/salesforce/subscriber.ts`, `toCanonicalEvent`) rather than changing
the canonical contract to be flat.

| Platform Event field | Canonical path | Length |
|---|---|---|
| `Event_Id__c` | `eventId` | 36 |
| `Event_Version__c` | `eventVersion` | 10 |
| `Correlation_Id__c` | `correlationId` | 36 |
| `Distributor_Name__c` | `distributor.name` | 255 |
| `Distributor_External_Id__c` | `distributor.externalId` | 255 |
| `Primary_Contact_Name__c` | `distributor.primaryContact.name` | 255 |
| `Primary_Contact_Email__c` | `distributor.primaryContact.email` | 255 |
| `Opportunity_Id__c` | `sales.opportunityId` | 18 |
| `Account_Id__c` | `sales.accountId` | 18 |
| `Sales_Owner__c` | `sales.owner` | 255 |

`timestamp` is not a separate field — it's derived from the Platform
Event's standard `CreatedDate`. `eventType` is not a field either; it's
implied by the topic/object itself and hardcoded when reconstructing the
canonical shape.

Fields were created via the Tooling API's `CustomField` sobject
(`scripts/create-platform-event-fields.ts`) rather than manually through
Setup, since creating 9 fields by hand would have been repetitive
mechanical work with no learning value - the developer chose this
explicitly rather than defaulting to it.

## Alternatives considered

- **Flatten the canonical contract itself** (drop nesting from
  `src/types/events.ts` to match Salesforce directly): rejected — the
  canonical event is meant to be platform-agnostic (per `CLAUDE.md`'s
  "Canonical Event / API Contract" architecture philosophy); Salesforce's
  flatness is a Platform-Event-specific constraint, not something every
  future consumer of the canonical event should have to know about.
- **Use a single serialized JSON text field** to preserve nesting:
  rejected — defeats the purpose of typed Platform Event fields (no
  filtering/reporting on individual values in Salesforce, and just moves
  the "real" schema into an untyped blob).

## Consequences

- The mapping in `toCanonicalEvent` is the one place that has to change if
  the Platform Event's fields change - keep it there rather than spreading
  field-name knowledge across the codebase.
- `Opportunity_Id__c`/`Account_Id__c` are plain `Text(18)`, not Salesforce
  Lookup/reference fields, so there's no referential integrity enforced at
  the platform level. Acceptable for now since nothing else in this system
  reads them relationally yet; revisit if that changes.
- All fields are optional (`required: false`) and untyped beyond `Text` at
  the Salesforce level (e.g. `Opportunity_Id__c` isn't validated as a
  15/18-char Salesforce ID). This is a deliberate "smallest useful change"
  choice, not a final schema.
