# Quick Start - OAuth Configuration

## 1. Create `.env` file

Create `apps/api/.env` with:

```env
CANTON_OAUTH_TOKEN_URL=https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token
CANTON_OAUTH_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw
CANTON_OAUTH_CLIENT_SECRET=mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYc
CANTON_OAUTH_INSECURE_TLS=true
```

**Critical**: 
- NO quotes around values
- NO smart quotes `""`
- Plain ASCII only

## 2. Restart Server

```bash
cd apps/api
yarn dev
```

## 3. Test

```bash
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"test"}'
```

Should return party ID or clear error message.

## Troubleshooting

### "Missing env CANTON_OAUTH_TOKEN_URL"
- Check `.env` file exists
- Restart server after editing `.env`

### "Invalid URL"
- Remove any quotes from URL in `.env`
- Check for smart quotes (curly quotes)
- Ensure URL starts with `https://`

### Certificate errors
- Set `CANTON_OAUTH_INSECURE_TLS=true` (dev only)
