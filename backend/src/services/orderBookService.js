/**
 * OrderBook Service
 * Handles OrderBook-related business logic
 */

const config = require("../config");
const cantonService = require("./cantonService");
const { getOrderBookContractId } = require("./canton-api-helpers");
const tradeStore = require("./trade-store");
const { NotFoundError } = require("../utils/errors");

const MAX_BATCH_SIZE = 200;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

class OrderBookService {
  constructor() {
    this.orderBookCache = new Map();
  }

  cacheOrderBookId(tradingPair, contractId) {
    if (tradingPair && contractId) {
      this.orderBookCache.set(tradingPair, contractId);
    }
  }

  getCachedOrderBookId(tradingPair) {
    return this.orderBookCache.get(tradingPair);
  }

  clearCachedOrderBookId(tradingPair) {
    if (tradingPair) {
      this.orderBookCache.delete(tradingPair);
    }
  }

  extractCreatedContractId(updatePayload) {
    if (!updatePayload) {
      return null;
    }

    // Try multiple paths to find the created contract ID
    const candidateEvents = [
      updatePayload.events,
      updatePayload.transaction?.events,
      updatePayload.update?.events,
      updatePayload.update?.transaction?.events,
      updatePayload.transactions?.flatMap((t) => t.events || []),
      updatePayload.updatePayload?.transaction?.events,
    ]
      .flat()
      .filter(Boolean);

    // Look for created event in various formats
    for (const event of candidateEvents) {
      if (event?.created?.contractId) {
        return event.created.contractId;
      }
      if (event?.createdEvent?.contractId) {
        return event.createdEvent.contractId;
      }
      if (event?.JsCreateEvent?.contractId) {
        return event.JsCreateEvent.contractId;
      }
      // Handle nested structure
      const unwrappedEvent =
        event?.transactionEntry?.JsActiveContract?.createdEvent || event;
      if (unwrappedEvent?.contractId) {
        return unwrappedEvent.contractId;
      }
    }

    return null;
  }

  async fetchOrderDetails(orderIds, adminToken, activeAtOffset) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      console.log("[OrderBookService] No order IDs to fetch");
      return [];
    }

    console.log(
      "[OrderBookService] Fetching details for",
      orderIds.length,
      "orders",
    );

    const batches = chunkArray(orderIds, MAX_BATCH_SIZE);
    const results = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(
        `[OrderBookService] Fetching batch ${batchIndex + 1}/${batches.length} with ${batch.length} orders`,
      );

      try {
        const response = await fetch(
          `${config.canton.jsonApiBase}/v2/state/active-contracts?limit=${batch.length}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
              readAs: [config.canton.operatorPartyId],
              activeAtOffset,
              verbose: true,
              filter: {
                filtersByParty: {
                  [config.canton.operatorPartyId]: {
                    inclusive: {
                      contractIds: batch,
                    },
                  },
                },
              },
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[OrderBookService] Fetch orders error details:", {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText.substring(0, 200),
            batchSize: batch.length,
            batchIndex,
          });
          // Continue with next batch instead of throwing
          continue;
        }

        const data = await response.json();
        const contracts = data.activeContracts || [];
        console.log(
          `[OrderBookService] Batch ${batchIndex + 1} returned ${contracts.length} contracts`,
        );

        results.push(
          ...contracts.map((entry) => {
            const contract =
              entry.contractEntry?.JsActiveContract?.createdEvent ||
              entry.createdEvent ||
              entry;
            const payload = contract.argument || contract.createArgument || {};
            const quantity = payload.quantity;
            const filled = payload.filled || 0;
            const remaining =
              quantity !== undefined
                ? Math.max(0, Number(quantity) - Number(filled || 0))
                : undefined;

            return {
              contractId: contract.contractId,
              owner: payload.owner,
              price: payload.price,
              quantity,
              filled,
              remaining,
              timestamp: payload.timestamp,
              status: payload.status,
              orderType: payload.orderType,
              orderMode: payload.orderMode,
              tradingPair: payload.tradingPair,
            };
          }),
        );
      } catch (batchError) {
        console.error(
          `[OrderBookService] Batch ${batchIndex + 1} failed:`,
          batchError.message,
        );
        // Continue with next batch
        continue;
      }
    }

    console.log(
      "[OrderBookService] Fetched total",
      results.length,
      "order details",
    );
    return results;
  }

  async discoverSynchronizerId() {
    try {
      if (config.canton.synchronizerId) {
        console.log("[OrderBookService] Using configured synchronizer ID");
        return config.canton.synchronizerId;
      }

      const adminToken = await cantonService.getAdminToken();
      const response = await fetch(
        `${config.canton.jsonApiBase}/v2/state/connected-synchronizers`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[OrderBookService] Synchronizer discovery failed:", {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        throw new Error(
          `Failed to discover synchronizerId: ${response.status} - ${errorText}`,
        );
      }

      const data = await response.json().catch(() => ({}));
      let synchronizerId = null;

      // Try multiple possible response formats
      if (
        data.connectedSynchronizers &&
        Array.isArray(data.connectedSynchronizers) &&
        data.connectedSynchronizers.length > 0
      ) {
        const synchronizers = data.connectedSynchronizers;
        const globalSync = synchronizers.find(
          (s) =>
            s.synchronizerAlias === "global" ||
            s.alias === "global" ||
            (s.synchronizerId && s.synchronizerId.includes("global")),
        );
        if (globalSync?.synchronizerId) {
          synchronizerId = globalSync.synchronizerId;
        } else {
          const globalDomainSync = synchronizers.find(
            (s) =>
              s.synchronizerId && s.synchronizerId.includes("global-domain"),
          );
          if (globalDomainSync?.synchronizerId) {
            synchronizerId = globalDomainSync.synchronizerId;
          } else if (synchronizers[0]?.synchronizerId) {
            synchronizerId = synchronizers[0].synchronizerId;
          } else if (typeof synchronizers[0] === "string") {
            synchronizerId = synchronizers[0];
          }
        }
      } else if (
        data.synchronizers &&
        Array.isArray(data.synchronizers) &&
        data.synchronizers.length > 0
      ) {
        const first = data.synchronizers[0];
        synchronizerId =
          typeof first === "string" ? first : first.synchronizerId || first.id;
      } else if (data.synchronizerId) {
        synchronizerId = data.synchronizerId;
      } else if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        synchronizerId =
          typeof first === "string" ? first : first.synchronizerId || first.id;
      }

      if (!synchronizerId) {
        console.error(
          "[OrderBookService] No synchronizer found in response:",
          JSON.stringify(data, null, 2),
        );
        throw new Error("No synchronizers found in discovery response");
      }

      console.log(
        "[OrderBookService] Discovered synchronizer ID:",
        synchronizerId.substring(0, 30) + "...",
      );
      return synchronizerId;
    } catch (error) {
      console.error(
        "[OrderBookService] Failed to discover synchronizer:",
        error.message,
      );
      throw error;
    }
  }

  buildTemplateId(moduleName, entityName) {
    const packageId = config.canton.packageIds?.clobExchange;
    if (!packageId) {
      console.error(
        `[OrderBookService] Missing package ID for ${moduleName}:${entityName}`,
        "Available config:",
        config.canton.packageIds,
      );
      throw new Error(
        `Missing package ID for ${moduleName}:${entityName}. Config: ${JSON.stringify(config.canton.packageIds)}`,
      );
    }
    return `${packageId}:${moduleName}:${entityName}`;
  }

  getMasterOrderBookTemplateId() {
    return this.buildTemplateId("MasterOrderBook", "MasterOrderBook");
  }

  getOrderBookTemplateId() {
    return this.buildTemplateId("OrderBook", "OrderBook");
  }

  getTradeTemplateId() {
    return this.buildTemplateId("Trade", "Trade");
  }

  /**
   * Get OrderBook contract ID for a trading pair
   */
  async getOrderBookContractId(tradingPair) {
    const cached = this.getCachedOrderBookId(tradingPair);
    if (cached) {
      return cached;
    }
    const adminToken = await cantonService.getAdminToken();
    const contractId = await getOrderBookContractId(
      tradingPair,
      adminToken,
      config.canton.jsonApiBase,
    );
    this.cacheOrderBookId(tradingPair, contractId);
    return contractId;
  }

  /**
   * Get OrderBook details with working filter structure
   */
  async getOrderBook(tradingPair) {
    const contractId = await this.getOrderBookContractId(tradingPair);

    if (!contractId) {
      throw new NotFoundError(
        `OrderBook not found for trading pair: ${tradingPair}`,
      );
    }

    if (contractId.startsWith("pending-")) {
      return {
        contractId,
        tradingPair,
        operator: null,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        userAccounts: {},
      };
    }

    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(
      `${config.canton.jsonApiBase}/v2/state/active-contracts?limit=10`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          readAs: [config.canton.operatorPartyId],
          activeAtOffset,
          verbose: false,
          filter: {
            filtersByParty: {
              [config.canton.operatorPartyId]: {
                inclusive: {
                  contractIds: [contractId],
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[OrderBookService] GetOrderBook error details:", {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        contractId: contractId,
        operatorPartyId: config.canton.operatorPartyId,
      });
      throw new Error(
        `Failed to fetch OrderBook: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    if (contracts.length === 0) {
      return {
        contractId,
        tradingPair,
        operator: null,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        userAccounts: {},
      };
    }

    const contract =
      contracts[0].contractEntry?.JsActiveContract?.createdEvent ||
      contracts[0].createdEvent ||
      contracts[0];
    const args = contract.argument || contract.createArgument || {};

    // Debug logging
    console.log("[OrderBookService] OrderBook contract args:", {
      hasArgs: !!args,
      argsKeys: Object.keys(args || {}),
      buyOrdersType: typeof args.buyOrders,
      buyOrdersLength: Array.isArray(args.buyOrders)
        ? args.buyOrders.length
        : "N/A",
      sellOrdersType: typeof args.sellOrders,
      sellOrdersLength: Array.isArray(args.sellOrders)
        ? args.sellOrders.length
        : "N/A",
    });

    const buyOrderIds = Array.isArray(args.buyOrders) ? args.buyOrders : [];
    const sellOrderIds = Array.isArray(args.sellOrders) ? args.sellOrders : [];

    console.log("[OrderBookService] Extracted order IDs:", {
      buyOrderIds: buyOrderIds.length,
      sellOrderIds: sellOrderIds.length,
    });

    const orderDetails = await this.fetchOrderDetails(
      [...buyOrderIds, ...sellOrderIds],
      adminToken,
      activeAtOffset,
    );

    console.log("[OrderBookService] Fetched order details:", {
      totalOrders: orderDetails.length,
      buyOrdersRetrieved: orderDetails.filter((o) => o.orderType === "BUY")
        .length,
      sellOrdersRetrieved: orderDetails.filter((o) => o.orderType === "SELL")
        .length,
    });

    const orderById = new Map(orderDetails.map((o) => [o.contractId, o]));
    const buyOrders = buyOrderIds
      .map((cid) => {
        const order = orderById.get(cid);
        if (!order) {
          console.warn(
            "[OrderBookService] Buy order not found for contract ID:",
            cid.substring(0, 30),
          );
        }
        return order;
      })
      .filter(Boolean);
    const sellOrders = sellOrderIds
      .map((cid) => {
        const order = orderById.get(cid);
        if (!order) {
          console.warn(
            "[OrderBookService] Sell order not found for contract ID:",
            cid.substring(0, 30),
          );
        }
        return order;
      })
      .filter(Boolean);

    return {
      contractId: contract.contractId,
      tradingPair: args.tradingPair,
      operator: args.operator,
      buyOrders,
      sellOrders,
      lastPrice: args.lastPrice,
      userAccounts: args.userAccounts || {},
    };
  }

  /**
   * Get all OrderBooks with working filter structure
   */
  async getAllOrderBooks() {
    const adminToken = await cantonService.getAdminToken();
    const activeAtOffset = await cantonService.getActiveAtOffset(adminToken);

    const response = await fetch(
      `${config.canton.jsonApiBase}/v2/state/active-contracts?limit=20`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          readAs: [config.canton.operatorPartyId],
          activeAtOffset,
          verbose: false,
          filter: {
            filtersByParty: {
              [config.canton.operatorPartyId]: {
                inclusive: {
                  templateIds: [this.getOrderBookTemplateId()],
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[OrderBookService] Query error details:", {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        operatorPartyId: config.canton.operatorPartyId,
      });
      throw new Error(
        `Failed to fetch OrderBooks: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    return contracts.map((entry) => {
      const contract =
        entry.contractEntry?.JsActiveContract?.createdEvent ||
        entry.createdEvent ||
        entry;
      const args = contract.argument || contract.createArgument || {};

      return {
        contractId: contract.contractId,
        tradingPair: args.tradingPair,
        operator: args.operator,
        buyOrdersCount: (args.buyOrders || []).length,
        sellOrdersCount: (args.sellOrders || []).length,
        lastPrice: args.lastPrice,
      };
    });
  }

  /**
   * Get trades for a trading pair using working filter structure
   */
  async getTrades(tradingPair, limit = 100) {
    const cachedTrades = tradeStore.getTrades(tradingPair, limit);
    if (cachedTrades.length > 0) {
      return cachedTrades;
    }

    return [];
  }

  /**
   * Create OrderBook for a trading pair
   */
  async createOrderBook(tradingPair) {
    const adminToken = await cantonService.getAdminToken();

    // Check if OrderBook already exists
    try {
      const existingContractId = await this.getOrderBookContractId(tradingPair);
      if (existingContractId && !existingContractId.startsWith("pending-")) {
        return {
          contractId: existingContractId,
          alreadyExists: true,
        };
      }
    } catch (e) {
      // OrderBook doesn't exist yet, proceed with creation
    }

    // Parse trading pair
    const [base, quote] = tradingPair.split("/");
    if (!base || !quote) {
      throw new Error("Invalid trading pair format. Expected BASE/QUOTE");
    }

    // Get package ID for OrderBook template
    const orderBookPackageId = await cantonService.getPackageIdForTemplate(
      "OrderBook",
      adminToken,
    );

    console.log("[OrderBook] Creating OrderBook for", tradingPair);
    console.log(
      "[OrderBook] Using package ID:",
      orderBookPackageId.substring(0, 30) + "...",
    );

    // Create OrderBook contract
    let orderBookResult;
    try {
      orderBookResult = await cantonService.createContract({
        token: adminToken,
        actAsParty: config.canton.operatorPartyId,
        templateId: `${orderBookPackageId}:OrderBook:OrderBook`,
        createArguments: {
          tradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: config.canton.operatorPartyId,
          activeUsers: [],
          userAccounts: null,
        },
        readAs: [config.canton.operatorPartyId],
      });
    } catch (error) {
      console.error("[OrderBook] Creation failed:", error.message);
      // Try with explicit synchronizer if available
      if (config.canton.synchronizerId) {
        console.log(
          "[OrderBook] Retrying with synchronizer:",
          config.canton.synchronizerId,
        );
        orderBookResult = await cantonService.createContract({
          token: adminToken,
          actAsParty: config.canton.operatorPartyId,
          templateId: `${orderBookPackageId}:OrderBook:OrderBook`,
          createArguments: {
            tradingPair,
            buyOrders: [],
            sellOrders: [],
            lastPrice: null,
            operator: config.canton.operatorPartyId,
            activeUsers: [],
            userAccounts: null,
          },
          readAs: [config.canton.operatorPartyId],
          synchronizerId: config.canton.synchronizerId,
        });
      } else {
        throw error;
      }
    }

    // Extract contract ID from response
    let contractId = null;

    // Try various paths to get the contract ID
    if (orderBookResult.transaction?.events?.[0]?.created?.contractId) {
      contractId = orderBookResult.transaction.events[0].created.contractId;
    } else if (orderBookResult.created?.contractId) {
      contractId = orderBookResult.created.contractId;
    } else if (orderBookResult.contractId) {
      contractId = orderBookResult.contractId;
    }

    console.log(
      "[OrderBook] Creation result - UpdateId:",
      orderBookResult.updateId,
      "ContractId:",
      contractId,
    );

    if (!contractId) {
      throw new Error(
        `Failed to extract contract ID from response. Result: ${JSON.stringify(orderBookResult).substring(0, 300)}`,
      );
    }

    // Cache the contract ID
    this.cacheOrderBookId(tradingPair, contractId);

    // Log success
    if (!contractId.startsWith("pending-")) {
      console.log(
        "[OrderBook] ✅ Created successfully with ID:",
        contractId.substring(0, 40) + "...",
      );
    } else {
      console.log("[OrderBook] ⚠️  Created with temporary ID:", contractId);
    }

    return {
      contractId,
      masterOrderBookContractId: null,
      alreadyExists: false,
    };
  }
}

module.exports = new OrderBookService();
