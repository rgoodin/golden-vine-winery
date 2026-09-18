import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import avro from 'avsc';
import { authenticate, SalesforceTransportConfig } from './auth';
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

async function createClient(config: SalesforceTransportConfig) {
  const { accessToken, instanceUrl } = await authenticate(config);
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

  return new PubSubClient(config.pubsubHost, channelCredentials);
}

/**
 * Calls the Pub/Sub API's GetTopic RPC and returns the raw TopicInfo.
 * Investigative helper, originally built to check what Salesforce
 * actually exposes about a topic (e.g. retention) rather than assuming -
 * see docs/devex/friction-log.md (LL-0007) in the golden-vine-winery
 * repository this package was extracted from.
 */
export async function getTopicInfo(
  config: SalesforceTransportConfig,
  topicName: string
): Promise<Record<string, unknown>> {
  const client = await createClient(config);
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
 * Returns the raw decoded payload rather than a typed business event,
 * because Platform Events are flat (no nested objects) - mapping the flat
 * fields onto a canonical business event shape is the consuming
 * integration's job, not this package's. See
 * docs/golden-path/create.md in golden-vine-winery for that boundary.
 *
 * Replay checkpoint: after each event is successfully passed to
 * `onEvent`, its replay ID is persisted via `saveCheckpoint()` (optional
 * `checkpointPath`, defaults to `<cwd>/.checkpoint.json`). On the next
 * call to `subscribe`, if a checkpoint exists, the subscription resumes
 * with `ReplayPreset: CUSTOM` from that position instead of `LATEST`.
 */
export async function subscribe(
  config: SalesforceTransportConfig,
  topicName: string,
  onEvent: (event: DecodedPubSubEvent) => void | Promise<void>,
  checkpointPath?: string
): Promise<void> {
  const client = await createClient(config);
  const getSchema = createSchemaResolver(client);

  const stream = client.Subscribe();

  stream.on('data', async (fetchResponse: any) => {
    for (const consumerEvent of fetchResponse.events ?? []) {
      const schemaId = consumerEvent.event.schemaId as string;
      const avroType = await getSchema(schemaId);
      const payload = avroType.fromBuffer(consumerEvent.event.payload as Buffer);
      const replayId = consumerEvent.replayId as Buffer;

      // Experimental, deterministic fault injection, preserved from this
      // package's origin project: temporarily REVERSES normal ordering to
      // test the opposite checkpoint-write timing - persist the
      // checkpoint BEFORE calling onEvent, then force termination before
      // onEvent runs. Tests whether that ordering causes the event to be
      // silently skipped on restart instead of reprocessed. Mutually
      // exclusive with EXPERIMENT_CRASH_BEFORE_CHECKPOINT below. Never
      // set outside that one experiment; normal ordering (checkpoint
      // after onEvent) is untouched when this is unset.
      if (process.env.EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW === 'true') {
        saveCheckpoint(replayId, checkpointPath);
        console.log(
          `[experiment] EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW set - checkpoint saved ` +
            `BEFORE calling onEvent (replayId=${replayId.toString('base64')}), ` +
            'now forcing exit before onEvent runs.'
        );
        process.exit(1);
      }

      await onEvent({
        schemaId,
        payload: payload as Record<string, unknown>,
        replayId,
      });

      // Experimental, deterministic crash point, preserved from this
      // package's origin project: when set, terminates the process
      // immediately after onEvent has succeeded but before the checkpoint
      // below is persisted - to directly test whether that specific gap
      // causes a duplicate on restart. Never set outside that one
      // experiment. Does not change normal checkpoint semantics in any
      // other case.
      if (process.env.EXPERIMENT_CRASH_BEFORE_CHECKPOINT === 'true') {
        console.log(
          '[experiment] EXPERIMENT_CRASH_BEFORE_CHECKPOINT set - exiting now, ' +
            'after onEvent succeeded but before saveCheckpoint() runs.'
        );
        process.exit(1);
      }

      saveCheckpoint(replayId, checkpointPath);
      console.log(
        `[checkpoint] saved replayId=${replayId.toString('base64')} at ${new Date().toISOString()}`
      );
    }
  });

  stream.on('error', (err: grpc.ServiceError) => {
    throw new Error(`Pub/Sub subscribe stream error: ${err.code} ${err.details}`);
  });

  const checkpoint = loadCheckpoint(checkpointPath);
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
 * without touching the runtime checkpoint file (`checkpoint.ts` is not
 * imported here for that reason - this function never calls
 * `loadCheckpoint`/`saveCheckpoint`). Used to investigate whether an
 * event "skipped" by a checkpoint can still be retrieved from Salesforce
 * after the fact - see docs/devex/lessons-learned.md (LL-0009) in the
 * golden-vine-winery repository this package was extracted from.
 *
 * `from` is either a base64 replay ID (resumes with `ReplayPreset.CUSTOM`
 * - requires already knowing a position before the region of interest)
 * or the literal string `'EARLIEST'` (a full sweep of everything
 * Salesforce has retained for this topic, needing no prior knowledge at
 * all).
 *
 * This does not, by itself, detect anything - it only answers "can the
 * data still be fetched." Cross-referencing against a target is the
 * caller's job.
 */
export async function replayRange(
  config: SalesforceTransportConfig,
  topicName: string,
  from: string | 'EARLIEST',
  windowMs = 8000
): Promise<DecodedPubSubEvent[]> {
  const client = await createClient(config);
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
