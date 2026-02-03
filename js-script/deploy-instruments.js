#!/usr/bin/env node
/**
 * Deploy Instrument contracts for supported tokens (Token Standard)
 * Creates Instrument contracts for BTC, USDT, ETH, SOL
 */

const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  cantonApi: 'http://65.108.40.104:31539',
  keycloakUrl: 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token',
  oauthClientId: 'Sesnp3u6udkFF983rfprvsBbx3X3mBpw',
  oauthClientSecret: 'mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYc',
  operatorPartyId: '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292',
  packageId: 'ac5e34e7fc50cb726251a4fa71cbca275ebc19de34dae8f63bf8ba37bb91c0e4',
  synchronizerId: 'global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a'
};

// Instruments to create
const INSTRUMENTS = [
  { symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
  { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
  { symbol: 'SOL', name: 'Solana', decimals: 9 }
];

// Get service token from Keycloak
async function getServiceToken() {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CONFIG.oauthClientId,
      client_secret: CONFIG.oauthClientSecret,
      scope: 'openid profile email daml_ledger_api'
    }).toString();

    const url = new URL(CONFIG.keycloakUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.access_token) {
            resolve(json.access_token);
          } else {
            reject(new Error(`Failed to get token: ${body}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Make HTTP request
async function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.cantonApi + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Create Instrument contract
async function createInstrument(token, instrument) {
  const commandId = `create-instrument-${instrument.symbol}-${Date.now()}`;
  
  const body = {
    commands: {
      commandId: commandId,
      actAs: [CONFIG.operatorPartyId],
      readAs: [CONFIG.operatorPartyId],
      domainId: CONFIG.synchronizerId,
      commands: [{
        CreateCommand: {
          templateId: `${CONFIG.packageId}:Instrument:Instrument`,
          createArguments: {
            instrumentId: {
              issuer: CONFIG.operatorPartyId,
              symbol: instrument.symbol,
              version: "1.0"
            },
            description: instrument.name,
            decimals: instrument.decimals,
            observers: []
          }
        }
      }]
    }
  };

  console.log(`  Creating Instrument: ${instrument.symbol} (${instrument.name})`);
  const result = await httpRequest('POST', '/v2/commands/submit-and-wait-for-transaction', body, token);
  
  if (result.status === 200 && result.data.transaction) {
    const createdEvent = result.data.transaction.events?.find(e => 
      e.created?.templateId?.includes('Instrument')
    );
    if (createdEvent) {
      console.log(`  ✅ ${instrument.symbol} created: ${createdEvent.created.contractId.substring(0, 30)}...`);
      return createdEvent.created.contractId;
    }
  }
  
  console.log(`  ❌ Failed to create ${instrument.symbol}: ${JSON.stringify(result.data).substring(0, 200)}`);
  return null;
}

// Check if Instrument already exists
async function checkInstrumentExists(token, symbol) {
  // Get ledger end first
  const ledgerEndResult = await httpRequest('GET', '/v2/state/ledger-end', null, token);
  const offset = ledgerEndResult.data?.offset;
  
  if (!offset) {
    console.log('  ⚠️ Could not get ledger end offset');
    return false;
  }

  const body = {
    activeAtOffset: offset,
    filter: {
      filtersByParty: {
        [CONFIG.operatorPartyId]: {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: {
                value: {
                  templateId: `${CONFIG.packageId}:Instrument:Instrument`
                }
              }
            }
          }]
        }
      }
    }
  };

  const result = await httpRequest('POST', '/v2/state/active-contracts', body, token);
  
  if (result.status === 200 && result.data.activeContracts) {
    const found = result.data.activeContracts.find(c => 
      c.payload?.symbol === symbol
    );
    return !!found;
  }
  
  return false;
}

// Main function
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Deploy Instrument Contracts (Token Standard)              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Package ID: ${CONFIG.packageId}`);
  console.log(`Operator: ${CONFIG.operatorPartyId.substring(0, 30)}...`);
  console.log('');

  try {
    // Get service token
    console.log('🔑 Getting service token...');
    const token = await getServiceToken();
    console.log('✅ Got service token');
    console.log('');

    // Create each instrument
    console.log('📦 Creating Instrument contracts...');
    const results = [];
    
    for (const instrument of INSTRUMENTS) {
      // Check if already exists
      const exists = await checkInstrumentExists(token, instrument.symbol);
      if (exists) {
        console.log(`  ⏭️  ${instrument.symbol} already exists, skipping`);
        results.push({ symbol: instrument.symbol, status: 'exists' });
        continue;
      }
      
      const contractId = await createInstrument(token, instrument);
      results.push({ 
        symbol: instrument.symbol, 
        status: contractId ? 'created' : 'failed',
        contractId 
      });
    }

    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('Summary:');
    results.forEach(r => {
      const icon = r.status === 'created' ? '✅' : r.status === 'exists' ? '⏭️' : '❌';
      console.log(`  ${icon} ${r.symbol}: ${r.status}`);
    });
    console.log('════════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
