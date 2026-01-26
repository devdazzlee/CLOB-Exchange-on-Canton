#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read and encode the DAR file
const darPath = path.join(__dirname, 'dars', 'clob-exchange-1.0.0.dar');
const darBuffer = fs.readFileSync(darPath);
const darBase64 = darBuffer.toString('base64');

// Prepare the request
const requestData = {
  darFile: darBase64
};

// Write to a temp file
fs.writeFileSync('/tmp/upload_dar_request.json', JSON.stringify(requestData));

console.log('DAR file encoded and saved to /tmp/upload_dar_request.json');
console.log('Run the following command to upload:');
console.log('cd backend && CANTON_ADMIN_TOKEN="your_token_here" curl -X POST http://localhost:3001/api/admin/upload-dar -H "Content-Type: application/json" -d @/tmp/upload_dar_request.json');
