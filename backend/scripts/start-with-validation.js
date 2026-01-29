#!/usr/bin/env node

/**
 * Startup Script with Configuration Validation
 * Ensures all required environment variables are set before starting
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Starting CLOB Exchange with validation...\n');

// Check if .env file exists
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found!');
  console.error('\nPlease create a .env file from .env.example:');
  console.error('  cp .env.example .env');
  console.error('\nThen edit .env with your actual configuration values.\n');
  process.exit(1);
}

// Load and validate environment
require('dotenv').config({ path: envPath });

const ConfigValidator = require('../src/config/validation');

try {
  ConfigValidator.validate();
  ConfigValidator.validateCantonConnection();
  
  console.log('✅ All validations passed!\n');
  console.log('🎯 Starting server...\n');
  
  // Start the actual server
  require('../src/server');
  
} catch (error) {
  console.error('❌ Validation failed:', error.message);
  console.error('\nPlease fix the configuration issues above and try again.\n');
  process.exit(1);
}
