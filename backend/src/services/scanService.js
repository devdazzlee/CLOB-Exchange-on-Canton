/**
 * Scan Service - Token Standard API
 * 
 * Accesses the Scan API via the proxy for Token Standard operations.
 * Used for CC transfers, factory lookups, and registry operations.
 * 
 * Proxy: http://65.108.40.104:8088/api/scan
 * Docs: https://docs.sync.global/app_dev/scan_api/scan_openapi.html
 * Token Standard: https://docs.sync.global/app_dev/token_standard/index.html
 */

const config = require('../config');

class ScanService {
    constructor() {
        this.baseUrl = config.scan.baseUrl;
    }

    /**
     * Make a request to the Scan API
     */
    async request(path, options = {}) {
        if (!this.baseUrl) {
            throw new Error('Scan API not configured (SCAN_PROXY_BASE not set)');
        }

        const url = `${this.baseUrl}${path}`;

        console.log(`[ScanService] ${options.method || 'GET'} ${url}`);

        const res = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(options.token && { 'Authorization': `Bearer ${options.token}` }),
                ...options.headers
            },
            ...(options.body && { body: JSON.stringify(options.body) })
        });

        const text = await res.text();

        if (!res.ok) {
            console.error(`[ScanService] ❌ Request failed: ${res.status} - ${text}`);
            throw new Error(`Scan API error: ${res.status} - ${text}`);
        }

        try {
            return JSON.parse(text);
        } catch (e) {
            return text;
        }
    }

    // ==========================================================================
    // DSO Info
    // ==========================================================================

    /**
     * Get DSO info
     * GET /v0/dso
     */
    async getDsoInfo(token) {
        return this.request('/v0/dso', { token });
    }

    // ==========================================================================
    // Synchronizer
    // ==========================================================================

    /**
     * Get traffic status for a member
     * GET /v0/synchronizer/domain/{domainId}/member/{memberId}/traffic-status
     */
    async getTrafficStatus(domainId, memberId, token) {
        return this.request(
            `/v0/synchronizer/domain/${encodeURIComponent(domainId)}/member/${encodeURIComponent(memberId)}/traffic-status`,
            { token }
        );
    }

    // ==========================================================================
    // Token Standard - Factory Operations
    // ==========================================================================

    /**
     * Get transfer factory from registry
     * This is step 1 of the CC transfer flow
     * 
     * @returns {Object} { factoryId, disclosedContracts, choiceContextData }
     */
    async getTransferFactory(token) {
        // The exact endpoint depends on registry implementation
        // Common pattern: GET /v0/registry/transfer-factory
        return this.request('/v0/registry/transfer-factory', { token });
    }

    /**
     * Get allocation factory from registry
     */
    async getAllocationFactory(token) {
        return this.request('/v0/registry/allocation-factory', { token });
    }

    // ==========================================================================
    // Token Holdings
    // ==========================================================================

    /**
     * Get token holdings for a party
     * GET /v0/holdings/{partyId}
     */
    async getHoldings(partyId, token) {
        return this.request(`/v0/holdings/${encodeURIComponent(partyId)}`, { token });
    }

    /**
     * Get specific holding by contract ID
     * GET /v0/holdings/contract/{contractId}
     */
    async getHoldingByContractId(contractId, token) {
        return this.request(`/v0/holdings/contract/${encodeURIComponent(contractId)}`, { token });
    }

    // ==========================================================================
    // Utilities
    // ==========================================================================

    /**
     * Check if Scan API is available
     */
    async healthCheck() {
        try {
            const result = await this.request('/health');
            return { healthy: true, ...result };
        } catch (error) {
            return { healthy: false, error: error.message };
        }
    }
}

// Singleton instance
module.exports = new ScanService();
module.exports.ScanService = ScanService;
