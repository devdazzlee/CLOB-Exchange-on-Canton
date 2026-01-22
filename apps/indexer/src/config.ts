import dotenv from 'dotenv';

dotenv.config();

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_cOkEhXC1oD5m@ep-purple-lake-ah6nayuo-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  },
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
