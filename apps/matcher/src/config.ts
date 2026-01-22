import dotenv from 'dotenv';

dotenv.config();

export const config = {
  ledger: {
    grpcHost: process.env.LEDGER_GRPC_HOST || '',
    grpcPort: parseInt(process.env.LEDGER_GRPC_PORT || '31217', 10),
  },
  canton: {
    jsonApiBaseUrl: process.env.JSON_API_BASE_URL || '',
  },
  oauth: {
    tokenUrl: process.env.OAUTH_TOKEN_URL || '',
    clientId: process.env.OAUTH_CLIENT_ID || '',
    clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
  },
};
