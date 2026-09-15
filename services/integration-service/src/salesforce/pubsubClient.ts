import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import avro from 'avsc';
import { authenticate } from './auth';
import { config } from '../config';

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
 */
export async function subscribe(
  topicName: string,
  onEvent: (event: DecodedPubSubEvent) => void | Promise<void>
): Promise<void> {
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

  const client = new PubSubClient(config.salesforce.pubsubHost, channelCredentials);

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
      await onEvent({
        schemaId,
        payload: payload as Record<string, unknown>,
        replayId: consumerEvent.replayId as Buffer,
      });
    }
  });

  stream.on('error', (err: grpc.ServiceError) => {
    throw new Error(`Pub/Sub subscribe stream error: ${err.code} ${err.details}`);
  });

  stream.write({
    topicName,
    replayPreset: 'LATEST',
    numRequested: 10,
  });
}
