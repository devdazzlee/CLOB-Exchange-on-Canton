/**
 * Canton Admin Service
 * 
 * Facade for Admin operations.
 * Uses:
 * 1. gRPC Admin API (30100) for DAR Upload (PackageManagementService)
 * 2. Standard fetch for JSON API operations (Parties, Packages)
 * 3. TokenProvider for auth
 */

const config = require('../config');
const tokenProvider = require('./tokenProvider');
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

class CantonAdminService {
  constructor() {
    this.jsonApiBase = config.canton.jsonApiBase;
    this.adminHost = config.canton.adminHost;
    this.adminPort = config.canton.adminPort;
  }

  /**
   * Get admin token (Service Token)
   */
  async getAdminToken() {
    return tokenProvider.getServiceToken();
  }

  /**
   * Upload DAR file
   * Uses gRPC Admin API (usually 30100) with PackageManagementService
   */
  async uploadDar(darPath, token) {
    console.log(`[CantonAdmin] Uploading DAR from ${darPath}...`);

    if (!fs.existsSync(darPath)) {
      throw new Error(`DAR file not found: ${darPath}`);
    }

    if (!this.adminHost || !this.adminPort) {
      throw new Error('Admin API host/port not configured');
    }

    const darBuffer = fs.readFileSync(darPath);
    const adminUrl = `${this.adminHost}:${this.adminPort}`;
    console.log(`[CantonAdmin] Connecting to Admin API at ${adminUrl}`);

    // Load PackageService proto
    const protoPath = path.join(__dirname, '..', 'proto', 'package_service.proto');
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    const proto = grpc.loadPackageDefinition(packageDefinition);

    // Create Client
    // namespace: com.daml.ledger.api.v1.admin.PackageManagementService
    const Service = proto.com.daml.ledger.api.v1.admin.PackageManagementService;
    if (!Service) {
      throw new Error('PackageManagementService not found in proto definition');
    }

    const client = new Service(adminUrl, grpc.credentials.createInsecure());

    // Create metadata with token
    const metadata = new grpc.Metadata();
    metadata.add('authorization', `Bearer ${token}`);

    // Call UploadDarFile
    return new Promise((resolve, reject) => {
      const request = {
        dar_file: darBuffer,
        submission_id: `upload-${Date.now()}`
      };

      client.UploadDarFile(request, metadata, (err, response) => {
        if (err) {
          console.error('[CantonAdmin] gRPC Upload failed:', err);
          reject(err);
        } else {
          console.log('[CantonAdmin] ✅ DAR Uploaded Successfully');
          resolve(response);
        }
      });
    });
  }

  // =================================================================
  // JSON API Wrappers
  // =================================================================

  /**
   * List parties
   */
  async listParties(token) {
    const url = `${this.jsonApiBase}/v2/parties`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`List parties failed: ${res.status}`);
    const json = await res.json();
    return json.partyDetails || [];
  }

  /**
   * Get packages
   */
  async getPackages(token) {
    const url = `${this.jsonApiBase}/v2/packages`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`List packages failed: ${res.status}`);
    const json = await res.json();
    return json.packageIds || [];
  }

  /**
   * Get package status
   */
  async getPackage(packageId, token) {
    const url = `${this.jsonApiBase}/v2/packages/${encodeURIComponent(packageId)}/status`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Get package status failed: ${res.status}`);
    return res.json();
  }

  /**
   * Get synchronizers
   */
  async getSynchronizers(token) {
    const url = `${this.jsonApiBase}/v2/synchronizers`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    // Note: This endpoint might output 404 in some envs; handle gracefully in caller if needed
    if (!res.ok) throw new Error(`List synchronizers failed: ${res.status}`);
    const json = await res.json();
    return json.synchronizers || [];
  }
}

module.exports = CantonAdminService;
