/**
 * Package Discovery Service
 * Discovers template IDs and choice names from installed packages
 */

import { CantonJsonApiClient } from '@clob-exchange/api-clients';
import { OAuthService } from './oauth';
import { config } from '../config';

export interface TemplateInfo {
  templateId: string;
  moduleName: string;
  entityName: string;
  choices: ChoiceInfo[];
}

export interface ChoiceInfo {
  choiceName: string;
  parameterType: string;
}

export class PackageDiscoveryService {
  private oauthService: OAuthService;
  private cantonClient: CantonJsonApiClient | null = null;
  private templateCache: Map<string, TemplateInfo> = new Map();

  constructor() {
    this.oauthService = new OAuthService();
  }

  private async getCantonClient(): Promise<CantonJsonApiClient> {
    if (!this.cantonClient) {
      const token = await this.oauthService.getAccessToken();
      this.cantonClient = new CantonJsonApiClient({
        baseURL: config.canton.jsonApiBaseUrl,
        accessToken: token,
      });
    }
    return this.cantonClient;
  }

  /**
   * Query installed packages
   * Note: This endpoint may vary - check Canton JSON API docs
   */
  async getInstalledPackages(): Promise<any[]> {
    const client = await this.getCantonClient();
    
    // TODO: Discover the actual endpoint for package listing
    // This might be via Admin API or a specific JSON API endpoint
    // For now, placeholder structure
    
    // Possible endpoints:
    // - GET /v2/packages
    // - GET /v2/package/list
    // - Or via Admin API gRPC
    
    return [];
  }

  /**
   * Find template by module and entity name
   */
  async findTemplate(moduleName: string, entityName: string): Promise<TemplateInfo | null> {
    const cacheKey = `${moduleName}:${entityName}`;
    
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey)!;
    }

    // Query packages to find template
    const packages = await this.getInstalledPackages();
    
    for (const pkg of packages) {
      // Parse package to find template
      // Structure depends on Canton package format
      // This is a placeholder - actual implementation needs package introspection
    }

    return null;
  }

  /**
   * Find ExternalParty template
   */
  async findExternalPartyTemplate(): Promise<TemplateInfo | null> {
    // Try common module names
    const possibleModules = [
      'DigitalAsset.Wallet',
      'Wallet',
      'ExternalParty',
      'PartyManagement',
    ];

    for (const module of possibleModules) {
      const template = await this.findTemplate(module, 'ExternalParty');
      if (template) {
        return template;
      }
    }

    return null;
  }

  /**
   * Find TransferPreapproval template
   */
  async findTransferPreapprovalTemplate(): Promise<TemplateInfo | null> {
    // Try common module names
    const possibleModules = [
      'Splice.Token',
      'Token',
      'TransferPreapproval',
      'Preapproval',
    ];

    for (const module of possibleModules) {
      const template = await this.findTemplate(module, 'TransferPreapproval');
      if (template) {
        return template;
      }
    }

    return null;
  }

  /**
   * Query active contracts to discover template IDs
   * Alternative method: query for known contract types and extract template IDs
   */
  async discoverTemplateFromActiveContracts(
    filter: { moduleName?: string; entityName?: string }
  ): Promise<string | null> {
    const client = await this.getCantonClient();

    // Query for contracts that might match
    // This is a heuristic approach when package introspection isn't available
    const result = await client.queryActiveContracts({
      filter: {
        // We can't filter by module/entity name directly
        // But we can query all contracts and inspect template IDs
      },
    });

    // Parse template IDs from results
    // Template ID format: "package-hash:Module:Entity"
    for (const contract of result.activeContracts) {
      const templateId = contract.templateId;
      // Parse template ID to extract module and entity
      // Format: "hash:Module:Entity"
      const parts = templateId.split(':');
      if (parts.length >= 3) {
        const entity = parts[parts.length - 1];
        const module = parts.slice(1, -1).join(':');
        
        if (
          (!filter.moduleName || module.includes(filter.moduleName)) &&
          (!filter.entityName || entity === filter.entityName)
        ) {
          return templateId;
        }
      }
    }

    return null;
  }
}
