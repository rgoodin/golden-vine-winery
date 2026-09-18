import { getTopicInfo } from 'golden-path-salesforce-transport';
import { config } from '../src/config';

/**
 * Calls the Pub/Sub API's GetTopic RPC and prints the raw TopicInfo, to see
 * what Salesforce actually exposes about our topic (e.g. retention)
 * instead of assuming it from the .proto file or documentation. See
 * docs/devex/friction-log.md (Phase 3 Enablement, LL-0007 experiment).
 */
async function main() {
  const info = await getTopicInfo(config.salesforce, config.salesforce.pubsubTopic);
  console.log('TopicInfo:', info);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
