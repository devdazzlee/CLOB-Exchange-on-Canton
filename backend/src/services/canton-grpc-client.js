/**
 * Canton gRPC Client for UserManagementService
 * Uses gRPC to call UserManagementService.GrantUserRights directly via Ledger API
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const CANTON_LEDGER_API_HOST = process.env.CANTON_LEDGER_API_HOST || '65.108.40.104';
const CANTON_LEDGER_API_PORT = process.env.CANTON_LEDGER_API_PORT || '31217';
const CANTON_LEDGER_API_URL = `${CANTON_LEDGER_API_HOST}:${CANTON_LEDGER_API_PORT}`;

class CantonGrpcClient {
  constructor() {
    this.client = null;
    this.partyClient = null;
    this.metadata = null;
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
      const protoV2Path = path.join(__dirname, 'user_management_service_v2.proto');
      const protoV1Path = path.join(__dirname, 'user_management_service.proto');
      const partyV2Path = path.join(__dirname, 'party_management_service_v2.proto');
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

