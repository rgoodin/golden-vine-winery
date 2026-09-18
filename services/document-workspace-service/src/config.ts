import 'dotenv/config';

export const config = {
  salesforce: {
    loginUrl: process.env.SALESFORCE_LOGIN_URL ?? '',
    clientId: process.env.SALESFORCE_CLIENT_ID ?? '',
    username: process.env.SALESFORCE_USERNAME ?? '',
    jwtPrivateKeyPath: process.env.SALESFORCE_JWT_PRIVATE_KEY_PATH ?? './certs/server.key',
    jwtAudience: process.env.SALESFORCE_JWT_AUDIENCE ?? 'https://login.salesforce.com',
    pubsubHost: process.env.SALESFORCE_PUBSUB_HOST ?? 'api.pubsub.salesforce.com:7443',
    pubsubTopic: process.env.SALESFORCE_PUBSUB_TOPIC ?? '/event/Distributor_Onboarding_Requested__e',
  },
  sharepoint: {
    tenantId: process.env.AZURE_TENANT_ID ?? '',
    clientId: process.env.AZURE_CLIENT_ID ?? '',
    clientSecret: process.env.AZURE_CLIENT_SECRET ?? '',
    siteId: process.env.SHAREPOINT_SITE_ID ?? '',
    workspaceFolder: process.env.SHAREPOINT_WORKSPACE_FOLDER ?? 'Distributor Workspaces',
  },
};
