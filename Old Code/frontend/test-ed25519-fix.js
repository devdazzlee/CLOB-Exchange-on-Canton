// Test the fix
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Apply the fix
if (!ed25519.etc.sha512Sync) {
  ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));
}

console.log('sha512Sync set:', typeof ed25519.etc.sha512Sync === 'function');
console.log('✅ Fix applied successfully!');
