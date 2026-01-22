/**
 * Test script for cleanEnvUrl function
 * Run with: tsx src/utils/clean-env-url.test.ts
 */

function cleanEnvUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error('Missing environment variable');
  }

  // Trim whitespace
  let cleaned = raw.trim();

  // Remove surrounding quotes (normal and smart quotes)
  cleaned = cleaned.replace(/^["'""]+/, '').replace(/["'""]+$/, '');

  // Detect remaining smart quotes (common copy/paste issue)
  if (/[""]/.test(cleaned)) {
    throw new Error(
      `URL contains smart quotes. Fix your .env value to plain ASCII: ${JSON.stringify(cleaned)}`
    );
  }

  // Validate URL format
  try {
    new URL(cleaned);
  } catch {
    throw new Error(`Invalid URL format: ${JSON.stringify(raw)}`);
  }

  return cleaned;
}

// Test cases
const testCases = [
  {
    name: 'Normal URL',
    input: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    expected: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    shouldPass: true,
  },
  {
    name: 'URL wrapped in normal quotes',
    input: '"https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token"',
    expected: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    shouldPass: true,
  },
  {
    name: 'URL with smart quotes',
    input: '"https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token"',
    expected: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    shouldPass: true,
  },
  {
    name: 'URL with leading/trailing whitespace',
    input: '  https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token  ',
    expected: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    shouldPass: true,
  },
  {
    name: 'URL with single quotes',
    input: "'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token'",
    expected: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    shouldPass: true,
  },
  {
    name: 'Missing URL (undefined)',
    input: undefined,
    expected: '',
    shouldPass: false,
  },
  {
    name: 'Invalid URL (missing scheme)',
    input: 'keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
    expected: '',
    shouldPass: false,
  },
];

console.log('Testing cleanEnvUrl function...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  try {
    const result = cleanEnvUrl(testCase.input as any);
    if (testCase.shouldPass && result === testCase.expected) {
      console.log(`✅ ${testCase.name}: PASSED`);
      passed++;
    } else if (!testCase.shouldPass) {
      console.log(`❌ ${testCase.name}: FAILED (expected error but got: ${result})`);
      failed++;
    } else {
      console.log(`❌ ${testCase.name}: FAILED (expected: ${testCase.expected}, got: ${result})`);
      failed++;
    }
  } catch (error: any) {
    if (!testCase.shouldPass) {
      console.log(`✅ ${testCase.name}: PASSED (correctly threw error: ${error.message})`);
      passed++;
    } else {
      console.log(`❌ ${testCase.name}: FAILED (unexpected error: ${error.message})`);
      failed++;
    }
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
