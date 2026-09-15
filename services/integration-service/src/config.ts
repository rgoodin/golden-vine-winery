import 'dotenv/config';

export const config = {
  salesforce: {
    loginUrl: process.env.SALESFORCE_LOGIN_URL ?? '',
    clientId: process.env.SALESFORCE_CLIENT_ID ?? '',
    username: process.env.SALESFORCE_USERNAME ?? '',
    jwtPrivateKeyPath: process.env.SALESFORCE_JWT_PRIVATE_KEY_PATH ?? './certs/server.key',
    // Per Salesforce's JWT Bearer Flow spec, the JWT `aud` claim is the
    // fixed login host for the org's environment type (production/Developer
    // Edition vs. sandbox) - NOT the org's My Domain URL, which is instead
    // used as the token endpoint below.
    jwtAudience: process.env.SALESFORCE_JWT_AUDIENCE ?? 'https://login.salesforce.com',
    pubsubHost: process.env.SALESFORCE_PUBSUB_HOST ?? 'api.pubsub.salesforce.com:7443',
    // Salesforce auto-generates the API name from the Platform Event's
    // Label with underscores between words (see docs/devex/friction-log.md
    // FL-0006) - it is NOT automatically PascalCase.
    pubsubTopic: process.env.SALESFORCE_PUBSUB_TOPIC ?? '/event/Distributor_Onboarding_Requested__e',
  },
  serviceNow: {
    instanceUrl: process.env.SERVICENOW_INSTANCE_URL ?? '',
    clientId: process.env.SERVICENOW_CLIENT_ID ?? '',
    clientSecret: process.env.SERVICENOW_CLIENT_SECRET ?? '',
  },
};
