-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "partyId" TEXT,
    "publicKeyBase64" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningKey" (
    "partyId" TEXT NOT NULL,
    "keyBase64" TEXT NOT NULL,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "partyId" TEXT NOT NULL,
    "publicKeyBase64Der" TEXT,
    "publicKeyFingerprint" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_ALLOCATION',
    "allocatedAt" TIMESTAMP(3),
    "userAccountCreated" BOOLEAN NOT NULL DEFAULT false,
    "usdtMinted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "OrderReservation" (
    "orderId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "allocationContractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderReservation_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "StopLossOrder" (
    "orderId" TEXT NOT NULL,
    "orderContractId" TEXT,
    "tradingPair" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "stopPrice" TEXT NOT NULL,
    "quantity" TEXT NOT NULL DEFAULT '0',
    "allocationContractId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_TRIGGER',
    "triggeredAt" TIMESTAMP(3),
    "triggerPrice" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partyId" TEXT,

    CONSTRAINT "StopLossOrder_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "nonce" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "token" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "publicKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "QuotaCounter" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_partyId_key" ON "User"("partyId");

-- CreateIndex
CREATE INDEX "User_partyId_idx" ON "User"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "SigningKey_userId_key" ON "SigningKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "OrderReservation_partyId_asset_idx" ON "OrderReservation"("partyId", "asset");

-- CreateIndex
CREATE INDEX "StopLossOrder_tradingPair_idx" ON "StopLossOrder"("tradingPair");

-- CreateIndex
CREATE INDEX "StopLossOrder_partyId_idx" ON "StopLossOrder"("partyId");

-- CreateIndex
CREATE INDEX "StopLossOrder_status_idx" ON "StopLossOrder"("status");

-- CreateIndex
CREATE INDEX "Session_walletId_idx" ON "Session"("walletId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_partyId_idx" ON "RefreshToken"("partyId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "QuotaCounter_period_periodKey_idx" ON "QuotaCounter"("period", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaCounter_period_periodKey_key" ON "QuotaCounter"("period", "periodKey");

-- AddForeignKey
ALTER TABLE "SigningKey" ADD CONSTRAINT "SigningKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopLossOrder" ADD CONSTRAINT "StopLossOrder_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "User"("partyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
