# 0001. Salesforce trigger mechanism: Platform Event via Pub/Sub API

## Context

The integration service needs to learn when a distributor reaches the
onboarding stage in Salesforce. Salesforce offers several ways to notify an
external system:

- **Platform Event**, consumed via the gRPC-based Pub/Sub API — near
  real-time, event-driven.
- **Outbound Message** — a SOAP callout Salesforce sends from a workflow/flow
  to an HTTP endpoint we expose.
- **Polling** the REST/SOQL API on an interval for records in the target
  stage.

## Decision

Use a Salesforce Platform Event (`DistributorOnboardingRequested__e`),
consumed by the integration service via the Pub/Sub API.

## Alternatives considered

- **Outbound Message (SOAP):** simpler to receive (plain HTTP endpoint), but
  Salesforce-initiated (requires a publicly reachable endpoint) and uses a
  legacy SOAP contract.
- **Polling REST/SOQL:** simplest to build first, but not event-driven and
  introduces latency between the Salesforce stage change and onboarding
  starting.

## Consequences

- The integration service must implement a gRPC client, an OAuth
  authentication flow, and Avro schema decoding for the Pub/Sub API — none
  of which exist yet. This is tracked as open friction in
  `docs/devex/friction-log.md` (FL-0001) and currently blocks an end-to-end
  proof of the first event.
- This keeps the integration event-driven and consistent with the
  "Canonical Event / API Contract" architecture philosophy in `CLAUDE.md`,
  rather than coupling the integration service to Salesforce-initiated SOAP
  callouts.
- This decision was made before hands-on experience with the Pub/Sub API.
  Per `CLAUDE.md`'s Developer #1 principle, it should be revisited if
  implementation experience shows a simpler mechanism (e.g. polling, or
  Outbound Message) would have been the better starting point.
