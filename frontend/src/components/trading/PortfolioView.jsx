import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { TrendingUp, TrendingDown, Wallet, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient, API_ROUTES } from '@/config/config';
import { getBalances, getHoldings } from '../../services/balanceService';

/**
 * Portfolio View Component - Shows user's positions across all trading pairs.
 *
 * Source of truth: Splice Holding contracts via /balance/v2 API, which queries
 * splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding contracts.
 *
 * Trade history enriches the view with P&L calculations.
 */

export default function PortfolioView({ partyId }) {
  const [positions, setPositions] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);

  useEffect(() => {
    if (partyId) {
      loadPortfolio();
    }
  }, [partyId]);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      // ═══ Source of truth: Splice Holdings via Token Standard API ═══
      const [balanceData, holdingsData, tradesJson] = await Promise.all([
        getBalances(partyId),
        getHoldings(partyId),
        apiClient.get(API_ROUTES.TRADES.GET_USER(partyId, 500)).catch(() => ({ data: {} })),
      ]);

      const balances = balanceData.available || {};
      const lockedBalances = balanceData.locked || {};
      const holdingsList = holdingsData?.holdings || [];
      setHoldings(holdingsList);

      const tradesPayload = tradesJson?.data ?? tradesJson;
      const trades = tradesPayload?.trades || [];
      const userTrades = trades.filter(t => {
        const buyer = t.payload?.buyer || t.buyer;
        const seller = t.payload?.seller || t.seller;
        return buyer === partyId || seller === partyId;
      });

      // Calculate positions per trading pair from trade history
      const positionMap = new Map();

      userTrades.forEach(trade => {
        const pair = trade.payload?.tradingPair || trade.tradingPair || 'UNKNOWN';
        const price = parseFloat(trade.payload?.price || trade.price || 0);
        const quantity = parseFloat(trade.payload?.quantity || trade.quantity || 0);
        const isBuy = (trade.payload?.buyer || trade.buyer) === partyId;

        if (!positionMap.has(pair)) {
          positionMap.set(pair, {
            tradingPair: pair,
            baseQuantity: 0,
            quoteQuantity: 0,
            avgBuyPrice: 0,
            avgSellPrice: 0,
            totalBuyQty: 0,
            totalSellQty: 0,
            totalBuyValue: 0,
            totalSellValue: 0,
            trades: []
          });
        }

        const position = positionMap.get(pair);
        position.trades.push(trade);

        if (isBuy) {
          position.totalBuyQty += quantity;
          position.totalBuyValue += price * quantity;
          position.baseQuantity += quantity;
          position.quoteQuantity -= price * quantity;
        } else {
          position.totalSellQty += quantity;
          position.totalSellValue += price * quantity;
          position.baseQuantity -= quantity;
          position.quoteQuantity += price * quantity;
        }
      });

      // Enrich with real balances from Splice Holdings (source of truth)
      const positionsList = Array.from(positionMap.values()).map(pos => {
        pos.avgBuyPrice = pos.totalBuyQty > 0 ? pos.totalBuyValue / pos.totalBuyQty : 0;
        pos.avgSellPrice = pos.totalSellQty > 0 ? pos.totalSellValue / pos.totalSellQty : 0;

        const [baseToken, quoteToken] = pos.tradingPair.split('/');
        pos.currentBaseBalance = parseFloat(balances[baseToken] || 0);
        pos.currentQuoteBalance = parseFloat(balances[quoteToken] || 0);
        pos.lockedBase = parseFloat(lockedBalances[baseToken] || 0);
        pos.lockedQuote = parseFloat(lockedBalances[quoteToken] || 0);

        pos.realizedPnL = pos.totalSellValue - (pos.avgBuyPrice * pos.totalSellQty);
        pos.realizedPnLPercent = pos.avgBuyPrice > 0
          ? (pos.realizedPnL / (pos.avgBuyPrice * pos.totalSellQty)) * 100
          : 0;

        return pos;
      });

      // Add tokens that have a holding balance but no trades yet
      const tradedTokens = new Set();
      positionsList.forEach(p => {
        const [base, quote] = p.tradingPair.split('/');
        tradedTokens.add(base);
        tradedTokens.add(quote);
      });

      const untradedTokens = Object.entries(balances)
        .filter(([symbol, amount]) => !tradedTokens.has(symbol) && parseFloat(amount) > 0);

      setPositions(positionsList);

      // Calculate total portfolio value (in USDT or base unit)
      const total = positionsList.reduce((sum, pos) => {
        const [, quoteToken] = pos.tradingPair.split('/');
        const quoteValue = pos.currentQuoteBalance || 0;
        return sum + (quoteToken === 'USDT' ? quoteValue : 0);
      }, 0);

      setTotalValue(total);
    } catch (error) {
      console.error('[PortfolioView] Error loading portfolio:', error);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Wallet className="w-5 h-5 text-primary" />
            <span>Portfolio</span>
          </CardTitle>
          <div className="text-right">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Value</div>
            <div className="text-2xl font-bold text-foreground">
              {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted-foreground text-sm">Loading portfolio...</div>
          </div>
        ) : positions.length === 0 && holdings.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No positions found
          </div>
        ) : (
          <div className="space-y-4">
            {/* Holdings summary from Splice Token Standard */}
            {holdings.length > 0 && (
              <div className="border border-border rounded-lg p-3 mb-2">
                <h5 className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  On-Chain Holdings (Token Standard)
                </h5>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {holdings.map((h, i) => (
                    <div key={i} className="text-xs font-mono">
                      <span className="text-foreground">{parseFloat(h.amount || 0).toFixed(4)}</span>
                      <span className="text-muted-foreground ml-1">{h.symbol || h.exchangeSymbol || '?'}</span>
                      {h.lock && (
                        <Lock className="inline w-3 h-3 text-yellow-500 ml-1" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {positions.map((position, idx) => (
              <motion.div
                key={position.tradingPair}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-foreground">{position.tradingPair}</h4>
                    <p className="text-xs text-muted-foreground">{position.trades.length} trades</p>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "text-lg font-bold",
                      position.realizedPnL >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {position.realizedPnL >= 0 ? '+' : ''}
                      {position.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </div>
                    <div className={cn(
                      "text-xs",
                      position.realizedPnLPercent >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {position.realizedPnLPercent >= 0 ? '+' : ''}
                      {position.realizedPnLPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Available Base</div>
                    <div className="font-mono text-foreground">
                      {position.currentBaseBalance.toFixed(8)}
                    </div>
                    {position.lockedBase > 0 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Lock className="w-2.5 h-2.5 text-yellow-500" />
                        <span className="text-[10px] text-yellow-500/80">
                          {position.lockedBase.toFixed(4)} locked
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Available Quote</div>
                    <div className="font-mono text-foreground">
                      {position.currentQuoteBalance.toFixed(2)}
                    </div>
                    {position.lockedQuote > 0 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Lock className="w-2.5 h-2.5 text-yellow-500" />
                        <span className="text-[10px] text-yellow-500/80">
                          {position.lockedQuote.toFixed(4)} locked
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Avg Buy Price</div>
                    <div className="font-mono text-foreground">
                      {position.avgBuyPrice > 0 ? position.avgBuyPrice.toFixed(2) : '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Avg Sell Price</div>
                    <div className="font-mono text-foreground">
                      {position.avgSellPrice > 0 ? position.avgSellPrice.toFixed(2) : '--'}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
