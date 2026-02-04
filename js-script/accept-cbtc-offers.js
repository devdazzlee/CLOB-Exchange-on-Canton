#!/usr/bin/env node
/**
 * Accept CBTC Transfer Offers
 * 
 * Usage:
 *   node accept-cbtc-offers.js <contract-id-1> [contract-id-2] ...
 * 
 * Or set environment variable:
 *   CBTC_OFFER_IDS="contract-id-1,contract-id-2" node accept-cbtc-offers.js
 */

const http = require('http');

const PARTY_ID = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
const API_BASE = 'http://localhost:3001/api';

// Get contract IDs from command line args or env var
const contractIds = process.argv.slice(2);
const envIds = process.env.CBTC_OFFER_IDS ? process.env.CBTC_OFFER_IDS.split(',') : [];

const allContractIds = [...contractIds, ...envIds].filter(Boolean);

if (allContractIds.length === 0) {
  console.error('❌ No contract IDs provided!');
  console.error('');
  console.error('Usage:');
  console.error('  node accept-cbtc-offers.js <contract-id-1> [contract-id-2] ...');
  console.error('');
  console.error('Or:');
  console.error('  CBTC_OFFER_IDS="id1,id2" node accept-cbtc-offers.js');
  console.error('');
  console.error('To get contract IDs:');
  console.error('  1. Go to https://utilities.dev.canton.wolfedgelabs.com/');
  console.error('  2. Navigate to Registry -> Transfers');
  console.error('  3. Copy the contract ID from the table row');
  process.exit(1);
}

async function acceptOffer(contractId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      offerContractId: contractId,
      partyId: PARTY_ID,
      // Try Splice template first, will auto-discover if not found
      templateId: 'splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:TransferOffer'
    });

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/transfers/accept',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode === 200 && result.success) {
            resolve({ success: true, contractId, result });
          } else {
            reject({ success: false, contractId, error: result.error || result.message, statusCode: res.statusCode });
          }
        } catch (e) {
          reject({ success: false, contractId, error: body, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (error) => {
      reject({ success: false, contractId, error: error.message });
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('🔄 Accepting CBTC Transfer Offers...');
  console.log(`📋 Party ID: ${PARTY_ID.substring(0, 30)}...`);
  console.log(`📦 Offers to accept: ${allContractIds.length}`);
  console.log('');

  const results = [];

  for (const contractId of allContractIds) {
    console.log(`⏳ Accepting offer: ${contractId.substring(0, 30)}...`);
    try {
      const result = await acceptOffer(contractId);
      console.log(`✅ Accepted: ${contractId.substring(0, 30)}...`);
      results.push(result);
    } catch (error) {
      console.error(`❌ Failed: ${contractId.substring(0, 30)}...`);
      console.error(`   Error: ${error.error || error.message}`);
      results.push(error);
    }
    console.log('');
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   ✅ Accepted: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log('='.repeat(60));

  if (successful > 0) {
    console.log('');
    console.log('💡 Verify your CBTC balance:');
    console.log(`   curl "http://localhost:3001/api/balance/${PARTY_ID}"`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
