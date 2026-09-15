import 'dotenv/config';

export const config = {
  salesforce: {
    loginUrl: process.env.SALESFORCE_LOGIN_URL ?? '',
    clientId: process.env.SALESFORCE_CLIENT_ID ?? '',
    username: process.env.SALESFORCE_USERNAME ?? '',
    jwtPrivateKeyPath: process.env.SALESFORCE_JWT_PRIVATE_KEY_PATH ?? './certs/server.key',
    pubsubHost: process.env.SALESFORCE_PUBSUB_HOST ?? 'api.pubsub.salesforce.com:7443',
    pubsubTopic: process.env.SALESFORCE_PUBSUB_TOPIC ?? '/event/DistributorOnboardingRequested__e',
  },
};
