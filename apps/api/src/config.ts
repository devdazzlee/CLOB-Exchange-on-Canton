import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    env: process.env.NODE_ENV || 'development',
  },
  oauth: {
    tokenUrl: process.env.CANTON_OAUTH_TOKEN_URL || '',
    clientId: process.env.CANTON_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.CANTON_OAUTH_CLIENT_SECRET || '',
    insecureTls: process.env.CANTON_OAUTH_INSECURE_TLS === 'true',
  },
  canton: {
    jsonApiBaseUrl: process.env.JSON_API_BASE_URL || '',
    synchronizerId: process.env.CANTON_SYNCHRONIZER_ID || '',
    ledgerGrpcHost: process.env.LEDGER_GRPC_HOST || '',
    ledgerGrpcPort: parseInt(process.env.LEDGER_GRPC_PORT || '31217', 10),
    adminGrpcHost: process.env.ADMIN_GRPC_HOST || '',
    adminGrpcPort: parseInt(process.env.ADMIN_GRPC_PORT || '30100', 10),
  },
  scan: {
    baseUrl: process.env.SCAN_PROXY_BASE_URL || '',
    prefix: process.env.SCAN_PROXY_PREFIX || '/api/scan',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
};
