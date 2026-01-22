/**
 * Scan Proxy API Client
 * For Token Standard registry and transfer preapprovals
 */

import axios, { AxiosInstance } from 'axios';

export interface ScanConfig {
  baseURL: string;
  prefix: string;
}

export interface TransferPreapproval {
  contractId: string;
  party: string;
  templateId: string;
  payload: Record<string, any>;
}

export interface InstrumentRegistry {
  instrumentId: string;
  factoryContractId?: string;
  transferFactory?: {
    templateId: string;
    contractId: string;
    choiceContextData?: Record<string, any>;
  };
  allocationFactory?: {
    templateId: string;
    contractId: string;
    choiceContextData?: Record<string, any>;
  };
}

export class ScanApiClient {
  private client: AxiosInstance;
  private prefix: string;

  constructor(config: ScanConfig) {
    this.prefix = config.prefix;
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get DSO (Domain Synchronizer Operator) information
   */
  async getDSO(): Promise<any> {
    const response = await this.client.get(`${this.prefix}/v0/dso`);
    return response.data;
  }

  /**
   * Get transfer preapproval by party
   */
  async getTransferPreapprovalByParty(party: string): Promise<TransferPreapproval | null> {
    try {
      const response = await this.client.get(
        `${this.prefix}/v0/transfer-preapprovals/by-party/${encodeURIComponent(party)}`
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query instruments from registry
   */
  async queryInstruments(filter?: {
    instrumentId?: string;
    party?: string;
  }): Promise<InstrumentRegistry[]> {
    const response = await this.client.get(`${this.prefix}/v0/instruments`, {
      params: filter,
    });
    return response.data;
  }

  /**
   * Get instrument by ID
   */
  async getInstrument(instrumentId: string): Promise<InstrumentRegistry> {
    const response = await this.client.get(
      `${this.prefix}/v0/instruments/${encodeURIComponent(instrumentId)}`
    );
    return response.data;
  }
}
