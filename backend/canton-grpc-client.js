/**
 * Canton gRPC Client for UserManagementService
 * Uses gRPC to call UserManagementService.GrantUserRights directly via Ledger API
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const CANTON_LEDGER_API_HOST = process.env.CANTON_LEDGER_API_HOST || '95.216.34.215';
const CANTON_LEDGER_API_PORT = process.env.CANTON_LEDGER_API_PORT || '31217';
const CANTON_LEDGER_API_URL = `${CANTON_LEDGER_API_HOST}:${CANTON_LEDGER_API_PORT}`;

class CantonGrpcClient {
  constructor() {
    this.client = null;
    this.metadata = null;
  }

  /**
   * Initialize gRPC client
   */
  async initialize(token) {
    // Always recreate metadata with fresh token
    this.metadata = new grpc.Metadata();
    this.metadata.add('authorization', `Bearer ${token}`);

    if (this.client) {
      return; // Client already initialized
    }

    try {
      const protoPath = path.join(__dirname, 'user_management_service.proto');
      console.log('[gRPC] Loading proto file from:', protoPath);
      
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });

      const proto = grpc.loadPackageDefinition(packageDefinition);
      console.log('[gRPC] Connecting to:', CANTON_LEDGER_API_URL);
      
      this.client = new proto.com.daml.ledger.api.v1.admin.UserManagementService(
        CANTON_LEDGER_API_URL,
        grpc.credentials.createInsecure()
      );
      
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
}

module.exports = CantonGrpcClient;

