/**
 * Store Operator Signing Key for Post-Settlement Allocation Cancel
 *
 * The post-settlement orphaned allocation cancel requires BOTH owner and executor
 * to sign. The executor is the operator (8100b2db...). This script stores the
 * operator's Ed25519 signing key so the backend can sign on its behalf.
 *
 * Prerequisites:
 * - You need the operator's Ed25519 private key (base64) and public key fingerprint
 * - These come from the Canton participant when the operator party was created
 *
 * Usage:
 *   OPERATOR_SIGNING_KEY_BASE64=<base64> OPERATOR_PUBLIC_KEY_FINGERPRINT=<hex> node scripts/store_operator_signing_key.js
 *
 * Or with .env:
 *   Add OPERATOR_SIGNING_KEY_BASE64 and OPERATOR_PUBLIC_KEY_FINGERPRINT to .env
 *   node scripts/store_operator_signing_key.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const OPERATOR_PARTY_ID = process.env.OPERATOR_PARTY_ID || '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

async function main() {
  const keyBase64 = process.env.OPERATOR_SIGNING_KEY_BASE64;
  const fingerprint = process.env.OPERATOR_PUBLIC_KEY_FINGERPRINT || '';

  if (!keyBase64) {
    console.error('❌ OPERATOR_SIGNING_KEY_BASE64 is required.');
    console.error('');
    console.error('Get the operator key from your Canton participant config.');
    console.error('Then run:');
    console.error('  OPERATOR_SIGNING_KEY_BASE64=<base64> OPERATOR_PUBLIC_KEY_FINGERPRINT=<hex> node scripts/store_operator_signing_key.js');
    process.exit(1);
  }

  // Validate key: must decode to 32 or 64 bytes (base64 or hex)
  const trimmed = keyBase64.trim();
  let keyBytes;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    keyBytes = Buffer.from(trimmed, 'hex');
  } else {
    keyBytes = Buffer.from(trimmed, 'base64');
  }
  if (keyBytes.length !== 32 && keyBytes.length !== 64) {
    console.error(`❌ Invalid key: decoded to ${keyBytes.length} bytes. Need 32 (seed) or 64 (seed+public) bytes.`);
    console.error('   Ensure OPERATOR_SIGNING_KEY_BASE64 is the full Ed25519 private key (base64 or hex).');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  await prisma.signingKey.upsert({
    where: { partyId: OPERATOR_PARTY_ID },
    create: { partyId: OPERATOR_PARTY_ID, keyBase64: keyBase64.trim(), fingerprint: fingerprint || null },
    update: { keyBase64: keyBase64.trim(), fingerprint: fingerprint || null },
  });
  await prisma.$disconnect();

  console.log(`✅ Operator signing key stored for ${OPERATOR_PARTY_ID.substring(0, 40)}...`);
  console.log('   Post-settlement orphaned allocation cancel will now work.');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
