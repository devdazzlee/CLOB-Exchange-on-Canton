-- CreateTable
CREATE TABLE "PendingSettlement" (
    "id" TEXT NOT NULL,
    "tradingPair" TEXT NOT NULL,
    "sellerPartyId" TEXT NOT NULL,
    "buyerPartyId" TEXT NOT NULL,
    "sellOrderId" TEXT NOT NULL,
    "buyOrderId" TEXT NOT NULL,
    "sellOrderContractId" TEXT,
    "buyOrderContractId" TEXT,
    "sellOrderTemplateId" TEXT,
    "buyOrderTemplateId" TEXT,
    "sellOrderRemaining" TEXT,
    "buyOrderRemaining" TEXT,
    "sellIsPartial" BOOLEAN NOT NULL DEFAULT false,
    "buyIsPartial" BOOLEAN NOT NULL DEFAULT false,
    "matchPrice" TEXT,
    "sellAllocCid" TEXT NOT NULL,
    "buyAllocCid" TEXT NOT NULL,
    "baseSymbol" TEXT NOT NULL,
    "quoteSymbol" TEXT NOT NULL,
    "matchQty" TEXT NOT NULL,
    "quoteAmount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_WITHDRAW',
    "sellerWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "buyerWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "multiLegAllocCid" TEXT,
    "preparedMultiLeg" JSONB,
    "sellerMultiLegSig" JSONB,
    "buyerMultiLegSig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSettlement" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderId" TEXT,
    "tradingPair" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingSettlement_sellerPartyId_idx" ON "PendingSettlement"("sellerPartyId");

-- CreateIndex
CREATE INDEX "PendingSettlement_buyerPartyId_idx" ON "PendingSettlement"("buyerPartyId");

-- CreateIndex
CREATE INDEX "PendingSettlement_status_idx" ON "PendingSettlement"("status");

-- CreateIndex
CREATE INDEX "TradeSettlement_partyId_asset_idx" ON "TradeSettlement"("partyId", "asset");

-- CreateIndex
CREATE INDEX "TradeSettlement_tradeId_idx" ON "TradeSettlement"("tradeId");

-- CreateIndex
CREATE INDEX "TradeSettlement_partyId_idx" ON "TradeSettlement"("partyId");
