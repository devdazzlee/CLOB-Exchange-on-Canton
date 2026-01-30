/**
 * Canton gRPC Client for UserManagementService
 * Uses gRPC to call UserManagementService.GrantUserRights directly via Ledger API
 * 
 * IMPORTANT: Uses centralized config - NO HARDCODED FALLBACKS
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const config = require('../config');

// Get from centralized config - NO HARDCODED FALLBACKS
const CANTON_LEDGER_API_HOST = config.canton.ledgerHost;
const CANTON_LEDGER_API_PORT = config.canton.ledgerPort;

// Validate gRPC config
if (!CANTON_LEDGER_API_HOST || !CANTON_LEDGER_API_PORT) {
  console.warn('[gRPC] CANTON_LEDGER_API_HOST or CANTON_LEDGER_API_PORT not configured - gRPC operations will fail');
}

const CANTON_LEDGER_API_URL = CANTON_LEDGER_API_HOST && CANTON_LEDGER_API_PORT
  ? `${CANTON_LEDGER_API_HOST}:${CANTON_LEDGER_API_PORT}`
  : null;

class CantonGrpcClient {
  constructor() {
    this.client = null;
    this.partyClient = null;
    this.metadata = null;
  }

  /**
     * Upload DAR file to Canton
     */
  async uploadDar(darBuffer, adminToken) {
    await this.initialize(adminToken);

    return new Promise((resolve, reject) => {
      const packageServiceProto = grpc.loadPackageDefinition(
        protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'package_service.proto'), {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true
        })
      );

      const packageClient = new packageServiceProto.com.daml.ledger.api.v1.admin.PackageService(
        CANTON_LEDGER_API_URL,
        grpc.credentials.createInsecure()
      );

      const request = {
        darFile: darBuffer,
        submissionId: `upload-${Date.now()}`
      };

      packageClient.uploadDarFile(request, this.metadata, (err, response) => {
        if (err) {
          console.error('[gRPC] Upload DAR error:', err);
          reject(err);
        } else {
          console.log('[gRPC] DAR uploaded successfully:', response);
          resolve(response);
        }
      });
    });
  }

  /**
   * Initialize gRPC client
   */
  async initialize(token) {
    // Always recreate metadata with fresh token
    this.metadata = new grpc.Metadata();
    this.metadata.add('authorization', `Bearer ${token}`);

    // Always re-check clients; we may need both services
    if (this.client && this.partyClient) return;

    try {
      const protoBasePath = path.join(__dirname, '..', 'proto');
      const protoV2Path = path.join(protoBasePath, 'user_management_service_v2.proto');
      const protoV1Path = path.join(protoBasePath, 'user_management_service.proto');
      const partyV2Path = path.join(protoBasePath, 'party_management_service_v2.proto');
      console.log('[gRPC] Loading proto files:', { v2: protoV2Path, v1: protoV1Path });

      const pkgDefV2 = protoLoader.loadSync(protoV2Path, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });
      const pkgDefV1 = protoLoader.loadSync(protoV1Path, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });
      const pkgDefPartyV2 = protoLoader.loadSync(partyV2Path, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });

      const protoV2 = grpc.loadPackageDefinition(pkgDefV2);
      const protoV1 = grpc.loadPackageDefinition(pkgDefV1);
      const protoPartyV2 = grpc.loadPackageDefinition(pkgDefPartyV2);

      console.log('[gRPC] Connecting to:', CANTON_LEDGER_API_URL);

      // Prefer v2 if available, else fallback to v1
      const ServiceV2 = protoV2?.com?.daml?.ledger?.api?.v2?.admin?.UserManagementService;
      const ServiceV1 = protoV1?.com?.daml?.ledger?.api?.v1?.admin?.UserManagementService;
      if (ServiceV2) {
        this.client = new ServiceV2(CANTON_LEDGER_API_URL, grpc.credentials.createInsecure());
        console.log('[gRPC] Using UserManagementService v2');
      } else if (ServiceV1) {
        this.client = new ServiceV1(CANTON_LEDGER_API_URL, grpc.credentials.createInsecure());
        console.log('[gRPC] Using UserManagementService v1');
      } else {
        throw new Error('Neither v2 nor v1 UserManagementService could be loaded from proto definitions.');
      }

      const PartyServiceV2 = protoPartyV2?.com?.daml?.ledger?.api?.v2?.admin?.PartyManagementService;
      if (PartyServiceV2) {
        this.partyClient = new PartyServiceV2(CANTON_LEDGER_API_URL, grpc.credentials.createInsecure());
        console.log('[gRPC] Using PartyManagementService v2');
      } else {
        console.warn('[gRPC] PartyManagementService v2 not found in proto; party allocation via gRPC will be unavailable');
      }

      console.log('[gRPC] Client initialized successfully');
    } catch (error) {
      console.error('[gRPC] Initialization error:', error);
      throw new Error(`Failed to initialize gRPC client: ${error.message}`);
    }
  }

  /**
   * Grant user rights via gRPC
   */
  async grantUserRights(userId, partyId, token) {
    try {
      await this.initialize(token);

      // Build request according to proto definition
      // Right message uses oneof, so we need to set can_act_as directly
      const request = {
        user_id: userId,
        rights: [
          {
            can_act_as: {
              party: partyId
            }
          },
          {
            can_read_as: {
              party: partyId
            }
          }
        ],
        identity_provider_id: '' // Empty string means default identity provider
      };

      return new Promise((resolve, reject) => {
        const deadline = new Date();
        deadline.setSeconds(deadline.getSeconds() + 10); // 10 second timeout

        this.client.GrantUserRights(request, this.metadata, { deadline }, (error, response) => {
          if (error) {
            // Log detailed error for debugging
            console.error('[gRPC] GrantUserRights failed:', {
              code: error.code,
              message: error.message,
              details: error.details,
              userId,
              partyId
            });
            reject(new Error(`gRPC call failed (${error.code}): ${error.message}`));
          } else {
            console.log('[gRPC] GrantUserRights succeeded:', response);
            resolve(response);
          }
        });
      });
    } catch (error) {
      console.error('[gRPC] Error in grantUserRights:', error);
      throw error;
    }
  }

  /**
   * List user rights via gRPC
   */
  async listUserRights(userId, token) {
    try {
      await this.initialize(token);

      const request = {
        user_id: userId
      };

      return new Promise((resolve, reject) => {
        this.client.ListUserRights(request, this.metadata, (error, response) => {
          if (error) {
            reject(new Error(`gRPC call failed: ${error.message}`));
          } else {
            resolve(response);
          }
        });
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Vet a package on the participant (required for transactions to work)
   * Uses the PackageService to vet a package for use on connected domains
   */
  async vetPackage(packageId, token) {
    try {
      await this.initialize(token);
      
      const protoBasePath = path.join(__dirname, '..', 'proto');
      
      // Try to load the package management service proto
      const packageProtoPath = path.join(protoBasePath, 'package_service.proto');
      
      const pkgDef = protoLoader.loadSync(packageProtoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });
      
      const proto = grpc.loadPackageDefinition(pkgDef);
      const PackageService = proto?.com?.daml?.ledger?.api?.v1?.admin?.PackageManagementService ||
                            proto?.com?.daml?.ledger?.api?.v2?.admin?.PackageManagementService;
      
      if (!PackageService) {
        console.log('[gRPC] PackageManagementService not available, trying participant admin...');
        // Try via participant admin API on port 30100
        return this.vetPackageViaAdmin(packageId, token);
      }
      
      const packageClient = new PackageService(CANTON_LEDGER_API_URL, grpc.credentials.createInsecure());
      
      const request = {
        package_ids: [packageId]
      };
      
      return new Promise((resolve, reject) => {
        const deadline = new Date();
        deadline.setSeconds(deadline.getSeconds() + 30);
        
        // Try VetDar or similar method
        if (packageClient.VetDar) {
          packageClient.VetDar(request, this.metadata, { deadline }, (error, response) => {
            if (error) {
              console.error('[gRPC] VetDar failed:', error.message);
              reject(error);
            } else {
              console.log('[gRPC] Package vetted successfully');
              resolve(response);
            }
          });
        } else {
          console.log('[gRPC] VetDar method not available');
          reject(new Error('VetDar method not available'));
        }
      });
    } catch (error) {
      console.error('[gRPC] Package vetting error:', error);
      throw error;
    }
  }

  /**
   * Vet package via participant admin API (port 30100)
   * This uses the Canton Admin gRPC service to vet packages on synchronizers
   */
  async vetPackageViaAdmin(packageId, synchronizerId, token) {
    const adminHost = config.canton.adminHost || process.env.CANTON_ADMIN_API_GRPC_HOST;
    const adminPort = config.canton.adminPort || process.env.CANTON_ADMIN_API_GRPC_PORT;
    
    if (!adminHost || !adminPort) {
      throw new Error('Admin API not configured');
    }
    
    const adminUrl = `${adminHost}:${adminPort}`;
    console.log(`[gRPC] Vetting package via admin API at ${adminUrl}`);
    console.log(`[gRPC] Package: ${packageId}`);
    console.log(`[gRPC] Synchronizer: ${synchronizerId}`);
    
    try {
      // Load the Canton admin package service proto
      const protoBasePath = path.join(__dirname, '..', 'proto');
      const adminPackageProtoPath = path.join(protoBasePath, 'canton_admin_package_service.proto');
      
      // If custom proto doesn't exist, we'll use grpc reflection or direct call
      const metadata = new grpc.Metadata();
      metadata.add('authorization', `Bearer ${token}`);
      
      // Create channel to admin API
      const channel = new grpc.Client(adminUrl, grpc.credentials.createInsecure());
      
      // Make unary call using generic client
      // The service is: com.digitalasset.canton.admin.participant.v30.PackageService/VetDar
      const request = {
        main_package_id: packageId,
        synchronize: true,
        synchronizer_id: synchronizerId
      };
      
      return new Promise((resolve, reject) => {
        // Use makeUnaryRequest for dynamic service call
        const servicePath = '/com.digitalasset.canton.admin.participant.v30.PackageService/VetDar';
        
        channel.makeUnaryRequest(
          servicePath,
          (arg) => Buffer.from(JSON.stringify(arg)), // Simple serializer
          (buffer) => JSON.parse(buffer.toString()), // Simple deserializer
          request,
          metadata,
          { deadline: new Date(Date.now() + 30000) },
          (error, response) => {
            if (error) {
              console.error('[gRPC Admin] VetDar failed:', error.message);
              reject(error);
            } else {
              console.log('[gRPC Admin] Package vetted successfully');
              resolve(response || {});
            }
          }
        );
      });
    } catch (error) {
      console.error('[gRPC Admin] Package vetting error:', error.message);
      throw error;
    }
  }

  /**
   * Allocate a party via gRPC v2 PartyManagementService
   */
  async allocateParty(partyIdHint, displayName, token) {
    try {
      await this.initialize(token);
      if (!this.partyClient) {
        throw new Error('PartyManagementService v2 client not initialized');
      }

      const request = {
        party_id_hint: partyIdHint,
        display_name: displayName || partyIdHint,
        identity_provider_id: ''
      };

      return new Promise((resolve, reject) => {
        const deadline = new Date();
        deadline.setSeconds(deadline.getSeconds() + 10);
        this.partyClient.AllocateParty(request, this.metadata, { deadline }, (error, response) => {
          if (error) {
            console.error('[gRPC] AllocateParty failed:', { code: error.code, message: error.message, details: error.details });
            reject(new Error(`gRPC AllocateParty failed (${error.code}): ${error.message}`));
          } else {
            console.log('[gRPC] AllocateParty succeeded:', response);
            resolve(response);
          }
        });
      });
    } catch (error) {
      throw error;
    }
  }
}

module.exports = CantonGrpcClient;
