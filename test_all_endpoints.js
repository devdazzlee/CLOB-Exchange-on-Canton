/**
 * Comprehensive test suite for all Canton JSON API endpoints
 * Based on: https://docs.digitalasset.com/build/3.4/quickstart/operate/json-api.html
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('./backend/src/services/cantonService');
const tokenProvider = require('./backend/src/services/tokenProvider');
const { OPERATOR_PARTY_ID, CANTON_JSON_LEDGER_API_BASE } = require('./backend/src/config/constants');

const PARTY_ID = OPERATOR_PARTY_ID;

async function testEndpoint(name, testFn) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(70));
  try {
    const result = await testFn();
    console.log(`✅ PASS: ${name}`);
    return { name, status: 'pass', result };
  } catch (error) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${error.message}`);
    return { name, status: 'fail', error: error.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('CANTON JSON API ENDPOINT TEST SUITE');
  console.log('='.repeat(70));
  console.log(`Party ID: ${PARTY_ID.substring(0, 50)}...`);
  console.log(`API Base: ${CANTON_JSON_LEDGER_API_BASE}`);
  
  const token = await tokenProvider.getServiceToken();
  console.log(`Token obtained: ${token.substring(0, 20)}...`);
  
  const results = [];
  
  // Test 1: Get ledger end
  results.push(await testEndpoint('GET /v2/state/ledger-end', async () => {
    const offset = await cantonService.getLedgerEndOffset(token);
    console.log(`   Ledger end offset: ${offset}`);
    return { offset };
  }));
  
  // Test 2: Get packages
  results.push(await testEndpoint('GET /v2/packages', async () => {
    const packages = await cantonService.getPackages(token);
    console.log(`   Found ${packages.length} packages`);
    if (packages.length > 0) {
      console.log(`   First package: ${packages[0].substring(0, 40)}...`);
    }
    return { count: packages.length, packages: packages.slice(0, 5) };
  }));
  
  // Test 3: Query active contracts with template ID (object format)
  results.push(await testEndpoint('POST /v2/state/active-contracts (object templateId)', async () => {
    const templateId = {
      packageId: 'dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd',
      moduleName: 'Order',
      entityName: 'Order'
    };
    const contracts = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: [templateId],
    }, token);
    console.log(`   Found ${contracts.length} Order contracts`);
    return { count: contracts.length };
  }));
  
  // Test 4: Query active contracts with template ID (string format)
  results.push(await testEndpoint('POST /v2/state/active-contracts (string templateId)', async () => {
    const templateId = 'dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd:Order:Order';
    const contracts = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: [templateId],
    }, token);
    console.log(`   Found ${contracts.length} Order contracts`);
    return { count: contracts.length };
  }));
  
  // Test 5: Query active contracts with # prefix (package name format)
  results.push(await testEndpoint('POST /v2/state/active-contracts (# prefix)', async () => {
    // Try with # prefix - this should work according to client
    const templateId = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
    try {
      const contracts = await cantonService.queryActiveContracts({
        party: PARTY_ID,
        templateIds: [templateId],
      }, token);
      console.log(`   Found ${contracts.length} Holdings with # prefix`);
      return { count: contracts.length, templateId };
    } catch (error) {
      console.log(`   # prefix query failed: ${error.message}`);
      // Try alternative: query all packages and find Splice package
      const packages = await cantonService.getPackages(token);
      console.log(`   Testing ${Math.min(packages.length, 50)} packages for Splice templates...`);
      
      for (const pkgId of packages.slice(0, 50)) {
        const testTemplateId = `${pkgId}:Splice.Api.Token.HoldingV1:Holding`;
        try {
          const testContracts = await cantonService.queryActiveContracts({
            party: PARTY_ID,
            templateIds: [testTemplateId],
          }, token);
          if (testContracts.length > 0) {
            console.log(`   ✅ Found Splice template in package: ${pkgId.substring(0, 20)}...`);
            // Check for CBTC
            const hasCbtc = testContracts.some(c => {
              const p = c.payload || c.createArgument || {};
              return JSON.stringify(p).toUpperCase().includes('CBTC');
            });
            if (hasCbtc) {
              console.log(`   ✅✅✅ FOUND CBTC HOLDINGS!`);
            }
            return { count: testContracts.length, templateId: testTemplateId, hasCbtc };
          }
        } catch (e) {
          // Continue
        }
      }
      throw new Error('No Splice templates found in tested packages');
    }
  }));
  
  // Test 6: Query Holdings (custom template)
  results.push(await testEndpoint('POST /v2/state/active-contracts (Custom Holdings)', async () => {
    const templateId = 'f552adda6b4c5ed9caa3c943d004c0e727cc29df62e1fdc91b9f1797491f9390:Holding:Holding';
    const contracts = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: [templateId],
    }, token);
    console.log(`   Found ${contracts.length} custom Holdings`);
    return { count: contracts.length };
  }));
  
  // Test 7: Test balance endpoint
  results.push(await testEndpoint('GET /api/balance/:partyId', async () => {
    const response = await fetch(`http://localhost:3001/api/balance/${PARTY_ID}`);
    const data = await response.json();
    console.log(`   Success: ${data.success}`);
    console.log(`   Tokens: ${Object.keys(data.data?.available || {}).join(', ')}`);
    if (data.data?.available?.CBTC) {
      console.log(`   ✅✅✅ CBTC Balance: ${data.data.available.CBTC}`);
    }
    return data;
  }));
  
  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }
  
  return results;
}

main().catch(console.error);
