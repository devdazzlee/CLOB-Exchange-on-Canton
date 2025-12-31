/**
 * Canton JSON API integration
 * Base URL: https://participant.dev.canton.wolfedgelabs.com/
 */

const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com';
const API_VERSION = 'v1';

/**
 * Create a new contract on the ledger
 * @param {string} templateId - Template ID (e.g., "UserAccount:UserAccount")
 * @param {object} payload - Contract payload
 * @param {string} party - Party ID
 * @returns {Promise<object>} Created contract
 */
export async function createContract(templateId, payload, party) {
  try {
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId: templateId,
        payload: payload,
        actAs: [party]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to create contract: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating contract:', error);
    throw error;
  }
}

/**
 * Exercise a choice on a contract
 * @param {string} contractId - Contract ID
 * @param {string} choice - Choice name
 * @param {object} argument - Choice argument
 * @param {string} party - Party ID
 * @returns {Promise<object>} Exercise result
 */
export async function exerciseChoice(contractId, choice, argument, party) {
  try {
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/exercise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contractId: contractId,
        choice: choice,
        argument: argument,
        actAs: [party]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to exercise choice: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error exercising choice:', error);
    throw error;
  }
}

/**
 * Query active contracts by template
 * @param {string} templateId - Template ID
 * @param {string} party - Party ID (optional, for filtering)
 * @returns {Promise<Array>} Array of active contracts
 */
export async function queryContracts(templateId, party = null) {
  try {
    const query = {
      templateIds: [templateId]
    };

    if (party) {
      query.filter = {
        party: party
      };
    }

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(query)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to query contracts: ${response.statusText}`);
    }

    const result = await response.json();
    return result.result || [];
  } catch (error) {
    console.error('Error querying contracts:', error);
    throw error;
  }
}

/**
 * Get party details
 * @param {string} party - Party ID
 * @returns {Promise<object>} Party information
 */
export async function getPartyDetails(party) {
  try {
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/parties/${encodeURIComponent(party)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to get party details: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting party details:', error);
    throw error;
  }
}

/**
 * Fetch a specific contract by ID
 * @param {string} contractId - Contract ID
 * @returns {Promise<object>} Contract data
 */
export async function fetchContract(contractId) {
  try {
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contractId: contractId
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to fetch contract: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching contract:', error);
    throw error;
  }
}

/**
 * Fetch multiple contracts by their IDs
 * @param {Array<string>} contractIds - Array of contract IDs
 * @returns {Promise<Array<object>>} Array of contract data
 */
export async function fetchContracts(contractIds) {
  try {
    // Fetch all contracts in parallel
    const promises = contractIds.map(cid => fetchContract(cid).catch(err => {
      console.warn(`Failed to fetch contract ${cid}:`, err);
      return null; // Return null for failed fetches
    }));
    
    const results = await Promise.all(promises);
    // Filter out null results (failed fetches)
    return results.filter(r => r !== null);
  } catch (error) {
    console.error('Error fetching contracts:', error);
    throw error;
  }
}

