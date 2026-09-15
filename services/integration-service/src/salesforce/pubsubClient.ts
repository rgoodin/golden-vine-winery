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

  const schemaCache = new Map<string, avro.Type>();

  function getSchema(schemaId: string): Promise<avro.Type> {
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
  }

  const stream = client.Subscribe();

  stream.on('data', async (fetchResponse: any) => {
    for (const consumerEvent of fetchResponse.events ?? []) {
      const schemaId = consumerEvent.event.schemaId as string;
      const avroType = await getSchema(schemaId);
      const payload = avroType.fromBuffer(consumerEvent.event.payload as Buffer);
      const replayId = consumerEvent.replayId as Buffer;

      await onEvent({
        schemaId,
        payload: payload as Record<string, unknown>,
        replayId,
      });

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
