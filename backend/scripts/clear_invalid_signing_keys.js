/**
 * Clear signing keys that are invalid (not 32 or 64 bytes).
 * Run this if post-settlement cancel fails with "invalid key (19 bytes)".
 * After running, re-login (rehydrate) to store correct owner keys,
 * and fix OPERATOR_SIGNING_KEY_BASE64 for operator.
 *
 * Usage: node scripts/clear_invalid_signing_keys.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

function decodeKey(keyBase64) {
  if (!keyBase64 || typeof keyBase64 !== 'string') return null;
  const s = keyBase64.trim();
  let keyBytes;
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    keyBytes = Buffer.from(s, 'hex');
  } else {
    keyBytes = Buffer.from(s, 'base64');
  }
  return keyBytes.length;
}

async function main() {
  const prisma = new PrismaClient();
  const all = await prisma.signingKey.findMany();
  const invalid = all.filter((k) => {
    const len = decodeKey(k.keyBase64);
    return len !== 32 && len !== 64;
  });

  if (invalid.length === 0) {
    console.log('✅ All signing keys are valid (32 or 64 bytes).');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${invalid.length} invalid key(s):`);
  for (const k of invalid) {
    const len = decodeKey(k.keyBase64);
    console.log(`  - ${k.partyId.substring(0, 50)}... (${len} bytes)`);
  }

  const result = await prisma.signingKey.deleteMany({
    where: { partyId: { in: invalid.map((k) => k.partyId) } },
  });
  const count = result.count ?? result.deleted ?? invalid.length;
  console.log(`\n✅ Deleted ${count} invalid key(s).`);
  console.log('   Next: Re-login (rehydrate) to store correct owner keys.');
  console.log('   For operator: set OPERATOR_SIGNING_KEY_BASE64 (32-byte key, base64 or hex) and restart.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
