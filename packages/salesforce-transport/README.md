# golden-path-salesforce-transport

Salesforce Pub/Sub API transport: JWT Bearer Flow authentication, gRPC
connection setup, Avro schema resolution/caching, event subscription
with replay-checkpoint resume, and a read-only replay-range diagnostic.

Extracted from `golden-vine-winery/services/integration-service` as part
of the first Golden Path Enablement slice - see
`docs/golden-path/0001-enablement-inventory.md`,
`docs/golden-path/0002-design-principles.md`, and
`docs/devex/phase-2-observation-review.md` (Finding 3: "shared transport
complexity is a platform concern") in that repository for why.

## What this package knows, and deliberately does not know

It knows how to authenticate to one Salesforce org and move raw,
Avro-decoded Platform Event payloads in and out of it, with checkpoint
resume.

It does not know, and must never be extended to know, what any specific
Platform Event's fields mean. `subscribe()`/`replayRange()` return a raw
`{ schemaId, payload, replayId }` - mapping that flat payload onto a
canonical business event shape is the consuming integration's job. See
`docs/golden-path/create.md` in golden-vine-winery for that boundary.

## Configuration

Every exported function that needs to authenticate takes a
`SalesforceTransportConfig` as an explicit parameter - there is no
module-level config singleton, no direct environment-variable reading in
this package at all. The consuming service owns its own configuration
(env vars, `.env`, or anything else) and constructs this object itself:

```ts
interface SalesforceTransportConfig {
  loginUrl: string;
  clientId: string;
  username: string;
  jwtPrivateKeyPath: string;
  jwtAudience: string;
  pubsubHost: string;
}
```

This is deliberate, not an oversight - see this repository's
`docs/golden-path/0002-design-principles.md` ("hide accidental
complexity, not legitimate decisions"). Which Salesforce org, which
credentials, and where those credentials live are decisions specific to
each integration, not something this package should assume or hide.

## API

```ts
import {
  authenticate,
  getTopicInfo,
  subscribe,
  replayRange,
  loadCheckpoint,
  saveCheckpoint,
} from 'golden-path-salesforce-transport';

authenticate(config): Promise<{ accessToken, instanceUrl }>
getTopicInfo(config, topicName): Promise<Record<string, unknown>>
subscribe(config, topicName, onEvent, checkpointPath?): Promise<void>
replayRange(config, topicName, from, windowMs?): Promise<DecodedPubSubEvent[]>
loadCheckpoint(checkpointPath?): Checkpoint | null
saveCheckpoint(replayId, checkpointPath?): void
```

`checkpointPath` defaults to `<cwd>/.checkpoint.json` - relative to
wherever the *consuming* process runs - so a normal single-instance
service needs no extra configuration to get its own checkpoint file.

`replayRange` never touches the checkpoint file at all (read-only
diagnostic, distinct from `subscribe`'s runtime resume behavior).

## Testing

`npm test` (from here, or at the repository root) runs fast, local,
mock-free unit tests (`node:test`) for `checkpoint.ts`'s save/load
roundtrip - pure file I/O, no network, no reason to fake it.
`auth.ts`/`pubsubClient.ts` genuinely require a live Salesforce org and
are **not** unit-tested here - see golden-vine-winery's
`scripts/get-topic-info.ts`, `publish-test-event.ts`, and the
`test-production-*.ts` scripts for the real, live verification of those.

## Evidence this behavior is real, not asserted

The checkpoint-resume and replay-diagnostic behavior here was
established experimentally before extraction, not invented in this
package. See `docs/golden-path/verify.md` in golden-vine-winery, and
`docs/devex/phase-2-observation-review.md` Finding 7 for why running the
experiments matters more than trusting this README.
