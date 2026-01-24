# How to Get Synchronizer ID

The synchronizer ID is required for external party allocation. Here are several ways to get it:

## Method 1: Canton Console (If You Have Access)

If you have access to the Canton console connected to the participant:

```bash
# Connect to Canton console (if you have local access)
# This requires Canton CLI or console access

# Get the global synchronizer ID
participant.synchronizers.id_of("global")

# Or list all connected synchronizers
participant.synchronizers.list_connected()
```

**Output example:**
```
global-domain::1220a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0
```

## Method 2: Network Documentation / Configuration

The synchronizer ID is typically provided in:
- Network setup documentation
- Environment configuration files
- Network operator's documentation
- Admin panel or dashboard (if available)

**Check with:**
- Network operator (Wolf Edge Labs in your case)
- Network documentation/README
- Configuration files from network setup

## Method 3: Query via Admin API (If Available)

If you have Admin API access, you might be able to query it:

```bash
# Using gRPC Admin API (if available)
# This requires the Admin API client and proper authentication
```

## Method 4: Contact Network Operator

Since you're using:
- **Network**: Canton Devnet
- **Operator**: Wolf Edge Labs (keycloak.wolfedgelabs.com)

**Contact them to get:**
- The global synchronizer ID for the network
- Or ask for network configuration details

## Method 5: Try Common Patterns

Some networks use predictable patterns. You could try:

```bash
# Common patterns (these are examples, not guaranteed):
global-domain::1220...
global::...
synchronizer::global::...
```

**⚠️ Note:** These are just examples. You need the actual ID from your network.

## Method 6: Check Existing Configuration

If someone else has set up this network before, check:
- Existing `.env` files (don't commit secrets!)
- Configuration documentation
- Setup scripts
- Network operator's GitHub/docs

## What the Synchronizer ID Looks Like

The synchronizer ID typically has this format:
```
global-domain::<hex-string>
```

**Example:**
```
global-domain::1220a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0
```

## Once You Have It

1. **Add to `.env` file:**
```env
CANTON_SYNCHRONIZER_ID=global-domain::1220a1b2c3d4e5f6...
```

2. **Restart your server:**
```bash
cd apps/api
yarn dev
```

3. **Test the endpoint:**
```bash
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"YOUR_BASE64_PUBLIC_KEY"}'
```

## Quick Test (Without Synchronizer ID)

If you want to test the error handling, you can temporarily remove `CANTON_SYNCHRONIZER_ID` from `.env` and the server will give you a clear error message telling you exactly what's missing.

## Recommended Next Steps

1. **Contact Wolf Edge Labs** (network operator) to get the synchronizer ID
2. **Check network documentation** if available
3. **Ask in network support channels** (Discord, Slack, etc.)
4. **Check if it's in any setup scripts** or configuration files

## Alternative: Use a Different Endpoint (If Available)

Some networks might have alternative endpoints that don't require the synchronizer ID, but for external party allocation on Canton Network/Splice, the synchronizer is typically required.

---

**For your specific network (Canton Devnet by Wolf Edge Labs):**
- Contact: support@wolfedgelabs.com (or their support channel)
- Ask for: "Global synchronizer ID for Canton Devnet"
- Or: "Synchronizer ID for external party allocation"
