import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import avro from 'avsc';
import { authenticate } from './auth';
import { config } from '../config';
import { loadCheckpoint, saveCheckpoint } from './checkpoint';

const PROTO_PATH = path.join(__dirname, 'proto', 'pubsub_api.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// The proto is loaded dynamically (no generated TS types), so the client is
// typed loosely rather than pulling in a full codegen step for one service.
const proto = grpc.loadPackageDefinition(packageDefinition) as any;
const PubSubClient = proto.eventbus.v1.PubSub;

export interface DecodedPubSubEvent {
  schemaId: string;
  payload: Record<string, unknown>;
  replayId: Buffer;
}

function createSchemaResolver(client: any) {
  const schemaCache = new Map<string, avro.Type>();
  return function getSchema(schemaId: string): Promise<avro.Type> {
    const cached = schemaCache.get(schemaId);
    if (cached) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      client.GetSchema({ schemaId }, (err: grpc.ServiceError | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        const type = avro.Type.forSchema(JSON.parse(response.schemaJson));
        schemaCache.set(schemaId, type);
        resolve(type);
      });
    });
  };
}

async function createClient() {
  const { accessToken, instanceUrl } = await authenticate();
  const tenantId = accessToken.split('!')[0];

  const metadataGenerator = (
    _params: unknown,
    callback: (err: Error | null, metadata?: grpc.Metadata) => void
  ) => {
    const metadata = new grpc.Metadata();
    metadata.add('accesstoken', accessToken);
    metadata.add('instanceurl', instanceUrl);
    metadata.add('tenantid', tenantId);
    callback(null, metadata);
  };

  const channelCredentials = grpc.credentials.combineChannelCredentials(
    grpc.credentials.createSsl(),
    grpc.credentials.createFromMetadataGenerator(metadataGenerator)
  );

  return new PubSubClient(config.salesforce.pubsubHost, channelCredentials);
}

/**
 * Calls the Pub/Sub API's GetTopic RPC and returns the raw TopicInfo.
 * Investigative helper (Phase 3 Enablement, LL-0007) - used to check what
 * Salesforce actually exposes about a topic (e.g. retention) rather than
 * assuming. See scripts/get-topic-info.ts.
 */
export async function getTopicInfo(topicName: string): Promise<Record<string, unknown>> {
  const client = await createClient();
  return new Promise((resolve, reject) => {
    client.GetTopic({ topicName }, (err: grpc.ServiceError | null, response: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Opens a Pub/Sub API subscription to `topicName` and invokes `onEvent` for
 * each event received, decoded from Avro into a plain object.
 *
 * Returns the raw decoded payload rather than a typed
 * DistributorOnboardingRequestedEvent, because Platform Events are flat
 * (no nested objects), so the actual field names won't match the nested
 * canonical event shape in src/types/events.ts until that Platform Event
 * object exists in Salesforce and its fields are mapped. See
 * docs/devex/friction-log.md.
 *
 * Experimental replay checkpoint (Phase 3 Enablement, LL-0007): after each
 * event is successfully passed to `onEvent`, its replay ID is persisted
 * (see checkpoint.ts). On the next call to `subscribe`, if a checkpoint
 * exists, the subscription resumes with `ReplayPreset: CUSTOM` from that
 * position instead of `LATEST`. This is a minimal experiment, not a
 * general reliability mechanism - see docs/devex/friction-log.md for what
 * this did and didn't prove.
 */
export async function subscribe(
  topicName: string,
  onEvent: (event: DecodedPubSubEvent) => void | Promise<void>
): Promise<void> {
  const client = await createClient();
  const getSchema = createSchemaResolver(client);

  const stream = client.Subscribe();

  stream.on('data', async (fetchResponse: any) => {
    for (const consumerEvent of fetchResponse.events ?? []) {
      const schemaId = consumerEvent.event.schemaId as string;
      const avroType = await getSchema(schemaId);
      const payload = avroType.fromBuffer(consumerEvent.event.payload as Buffer);
      const replayId = consumerEvent.replayId as Buffer;

      // Experimental, deterministic fault injection (Phase 3 Enablement,
      // LL-0008 follow-up): temporarily REVERSES normal ordering to test
      // the opposite checkpoint-write timing - persist the checkpoint
      // BEFORE calling ServiceNow, then force termination before
      // ServiceNow is ever called. Tests whether that ordering causes
      // the event to be silently skipped on restart instead of
      // reprocessed. Mutually exclusive with
      // EXPERIMENT_CRASH_BEFORE_CHECKPOINT below. Never set outside this
      // one experiment; normal ordering (checkpoint after onEvent) is
      // untouched when this is unset.
      if (process.env.EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW === 'true') {
        saveCheckpoint(replayId);
        console.log(
          `[experiment] EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW set - checkpoint saved ` +
            `BEFORE calling ServiceNow (replayId=${replayId.toString('base64')}), ` +
            'now forcing exit before onEvent (the ServiceNow call) runs.'
        );
        process.exit(1);
      }

      await onEvent({
        schemaId,
        payload: payload as Record<string, unknown>,
        replayId,
      });

      // Experimental, deterministic crash point (Phase 3 Enablement,
      // LL-0008): when set, terminates the process immediately after
      // onEvent has succeeded (i.e. after ServiceNow has already created
      // the Incident) but before the checkpoint below is persisted - to
      // directly test whether that specific gap causes a duplicate on
      // restart. Never set outside that one experiment. Does not change
      // normal checkpoint semantics in any other case.
      if (process.env.EXPERIMENT_CRASH_BEFORE_CHECKPOINT === 'true') {
        console.log(
          '[experiment] EXPERIMENT_CRASH_BEFORE_CHECKPOINT set - exiting now, ' +
            'after onEvent succeeded but before saveCheckpoint() runs.'
        );
        process.exit(1);
      }

      saveCheckpoint(replayId);
      console.log(
        `[checkpoint] saved replayId=${replayId.toString('base64')} at ${new Date().toISOString()}`
      );
    }
  });

  stream.on('error', (err: grpc.ServiceError) => {
    throw new Error(`Pub/Sub subscribe stream error: ${err.code} ${err.details}`);
  });

  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(
      `[checkpoint] resuming with ReplayPreset.CUSTOM from replayId=${checkpoint.replayId} ` +
        `(captured ${checkpoint.capturedAt})`
    );
    stream.write({
      topicName,
      replayPreset: 'CUSTOM',
      replayId: Buffer.from(checkpoint.replayId, 'base64'),
      numRequested: 10,
    });
  } else {
    console.log('[checkpoint] none found - starting with ReplayPreset.LATEST (tip of stream)');
    stream.write({
      topicName,
      replayPreset: 'LATEST',
      numRequested: 10,
    });
  }
}

/**
 * Read-only diagnostic: replays events from `from` and returns whatever
 * arrives within `windowMs`, without invoking any business logic and
 * without touching the runtime checkpoint file (checkpoint.ts is not
 * imported by this function). Used to investigate whether an event
 * "skipped" by a checkpoint can still be retrieved from Salesforce after
 * the fact - see docs/devex/lessons-learned.md LL-0009's recommended
 * investigation and scripts/detect-unprocessed-events.ts.
 *
 * `from` is either a base64 replay ID (resumes with `ReplayPreset.CUSTOM`
 * - requires already knowing a position before the suspected gap) or the
 * literal string `'EARLIEST'` (a full sweep of everything Salesforce has
 * retained for this topic, needing no prior knowledge at all - confirmed
 * viable in this org: it returned all 11 events published across this
 * project's testing so far, not just a recent few).
 *
 * This does not, by itself, detect anything - it only answers "can the
 * data still be fetched." Cross-referencing against ServiceNow is the
 * caller's job (see the script).
 */
export async function replayRange(
  topicName: string,
  from: string | 'EARLIEST',
  windowMs = 8000
): Promise<DecodedPubSubEvent[]> {
  const client = await createClient();
  const getSchema = createSchemaResolver(client);
  const collected: DecodedPubSubEvent[] = [];

  const stream = client.Subscribe();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      try {
        stream.cancel();
      } catch {
        // stream may already be closed; nothing to do
      }
      resolve(collected);
    };

    const timer = setTimeout(finish, windowMs);

    stream.on('data', async (fetchResponse: any) => {
      for (const consumerEvent of fetchResponse.events ?? []) {
        const schemaId = consumerEvent.event.schemaId as string;
        const avroType = await getSchema(schemaId);
        const payload = avroType.fromBuffer(consumerEvent.event.payload as Buffer);
        collected.push({
          schemaId,
          payload: payload as Record<string, unknown>,
          replayId: consumerEvent.replayId as Buffer,
        });
      }
    });

    stream.on('error', () => finish());

    if (from === 'EARLIEST') {
      stream.write({
        topicName,
        replayPreset: 'EARLIEST',
        numRequested: 50,
      });
    } else {
      stream.write({
        topicName,
        replayPreset: 'CUSTOM',
        replayId: Buffer.from(from, 'base64'),
        numRequested: 50,
      });
    }
  });
}
