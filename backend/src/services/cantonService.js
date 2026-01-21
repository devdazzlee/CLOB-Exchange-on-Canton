/**
 * Canton Service
 * Handles all Canton ledger interactions
 */

const config = require('../config');
const CantonAdmin = require('./canton-admin');

class CantonService {
  constructor() {
    this.cantonAdmin = new CantonAdmin();
    this.cantonApiBase = config.canton.jsonApiBase;
    this.operatorPartyId = config.canton.operatorPartyId;
  }

  /**
   * Get admin token
   */
  async getAdminToken() {
    return await this.cantonAdmin.getAdminToken();
  }

  /**
   * Get ledger end offset
   */
  async getLedgerEndOffset(adminToken) {
    try {
      const response = await fetch(`${this.cantonApiBase}/v2/state/ledger-end`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.offset || null;
      }
    } catch (error) {
      console.warn('[CantonService] Failed to get ledger end:', error.message);
    }
    return null;
  }

  /**
   * Get active at offset (for queries)
   */
  async getActiveAtOffset(adminToken) {
    const ledgerEnd = await this.getLedgerEndOffset(adminToken);
    return ledgerEnd || '0';
  }

  /**
   * Query active contracts
   */
  async queryActiveContracts(adminToken, options = {}) {
    const {
      templateIds = [],
      contractIds = [],
      readAs = [this.operatorPartyId],
      activeAtOffset = null,
    } = options;

    const offset = activeAtOffset || await this.getActiveAtOffset(adminToken);

    const body = {
      readAs,
      activeAtOffset: offset,
      filter: {
        filtersByParty: {
          [this.operatorPartyId]: {
            inclusive: {},
          },
        },
      },
    };

    if (templateIds.length > 0) {
      body.filter.filtersByParty[this.operatorPartyId].inclusive.templateIds = templateIds;
    }

    if (contractIds.length > 0) {
      body.filter.filtersByParty[this.operatorPartyId].inclusive.contractIds = contractIds;
    }

    const response = await fetch(`${this.cantonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to query active contracts: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Submit command
   */
  async submitCommand(adminToken, command, actAs = [this.operatorPartyId]) {
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const response = await fetch(`${this.cantonApiBase}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        commandId,
        commands: [command],
        actAs,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText };
      }
      throw new Error(error.message || error.cause || `Command failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Exercise choice on contract
   */
  async exerciseChoice(adminToken, templateId, contractId, choice, argument, actAs = [this.operatorPartyId]) {
    const command = {
      exercise: {
        templateId,
        contractId,
        choice,
        argument,
      },
    };

    return await this.submitCommand(adminToken, command, actAs);
  }

  /**
   * Create contract
   */
  async createContract(adminToken, templateId, argument, actAs = [this.operatorPartyId]) {
    const command = {
      create: {
        templateId,
        argument,
      },
    };

    return await this.submitCommand(adminToken, command, actAs);
  }
}

module.exports = new CantonService();
