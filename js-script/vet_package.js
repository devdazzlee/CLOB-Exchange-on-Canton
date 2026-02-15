#!/usr/bin/env node

/**
 * Script to vet a DAML package through Canton wallet
 */

const fs = require('fs');
const https = require('https');

// Configuration
const WALLET_URL = 'https://wallet.validator.dev.canton.wolfedgelabs.com';
const PACKAGE_ID = 'f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454';
const TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njk0MjQ3MjMsImlhdCI6MTc2OTQyMjkyMywiYXV0aF90aW1lIjoxNzY0MjI5MjIsImp0aSI6Im9mcnRhYzpiOGZkMGQzYi1jYWUtNTVjNy03NzdiLTBjOGNkMTU5MDRlNSIsImlzcyI6Imh0dHBzOi8va2V5Y2xvYWsud29sZmVkZ2VsYWJzLmNvbTo4NDQzL3JlYWxtcy9jYW50b24tZGV2bmV0IiwiYXVkIjpbImh0dHBzOi8vY2FudG9uLm5ldHdvcmsuZ2xvYmFsIiwiaHR0cHM6Ly92YWxpZGF0b3Itd2FsbGV0LnRhaWxiNGY1Ni50cy5uZXQiLCJodHRwczovL3dhbGxldC52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiYWNjb3VudCJdLCJzdWIiOiI4MTAwYjJkYi04NmNmLTQwYTEtODM1MS01NTQ4M2MxNTFjZGMiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiI0cm9oOVg3eTRUeVQ4OWZlSnU3QW5NMnNNWmJSOXhoNyIsInNpZCI6IjFjMDkyNjNmLTFiM2QtNDQyMC04MzIxLTk2ODNhNTk1MTFkNiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9zeW5jaW5zaWdodHMtYXBwLmRldi5jYW50b24ud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0Mi52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiaHR0cHM6Ly93YWxsZXQxLnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3dhbGxldC52YWxpZGF0b3Iud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0LnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQtY2FudG9uLWRldm5ldC50YWlsZWI0ZjU2LnRzLm5ldCJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiZGVmYXVsdC1yb2xlcy1jYW50b24tZGV2bmV0Iiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIG9mZmxpbmVfYWNjZXNzIHByb2ZpbGUgZGFtbF9sZWRnZXJfYXBpIHdhbGxldF9hdWRpZW5jZSBlbWFpbCIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiWm95YSBNdWhhbW1hZCIsInByZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.wWMlBfN-Omb8m4E23VVU815vVbmi66crxnwQr71HDwyia8uey2baTFu50YAl0JX9hUqt9ojIv6ZstbfWsy-JhNLA-ktVcKOhztzKOMIcgeZnvrlD629427zIKQlyRiEgkqHfievuC6Y4vvIZg2rkeqF9kyoN7n54QYWLpkWgcdsFEWkceUhZaVkhS0IpbprVEgwiZyjFs-JicwTb0I9eid1sGOLu5HdI8X5aDSit9iH6ecifTiUXZKHOccjX4syDnD7r9gSuhA4VsaCYs6fhNJaLn6jlEK_uDO75Z9L3OLUF4g0AgrZWFXIGMD2ASlCu-YWVr7h9ZsB2vRJMFnBdvg';

console.log('🔍 Checking package status...');

// Check package status
const checkStatus = () => {
  const options = {
    hostname: 'participant.dev.canton.wolfedgelabs.com',
    port: 443,
    path: '/v1/packages',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const packages = JSON.parse(data);
        const pkg = packages.find(p => p.packageId === PACKAGE_ID);
        if (pkg) {
          console.log(`✅ Package found: ${pkg.name} v${pkg.version}`);
          console.log(`📦 Package ID: ${pkg.packageId}`);
          console.log(`📅 Uploaded: ${pkg.uploadedAt}`);
        } else {
          console.log('❌ Package not found');
        }
      } catch (e) {
        console.error('Error parsing response:', e.message);
      }
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });

  req.end();
};

// Try to vet the package
const vetPackage = () => {
  console.log('\n📋 Attempting to vet package...');
  
  const options = {
    hostname: 'participant.dev.canton.wolfedgelabs.com',
    port: 443,
    path: '/v1/packages/vet',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  const postData = JSON.stringify({
    packageId: PACKAGE_ID,
    synchronizeVetting: false
  });

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      console.log(`Response (${res.statusCode}):`, data);
      if (res.statusCode === 200) {
        console.log('✅ Package vetted successfully!');
      } else {
        console.log('❌ Failed to vet package');
      }
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });

  req.write(postData);
  req.end();
};

// Run checks
checkStatus();
setTimeout(vetPackage, 2000);
