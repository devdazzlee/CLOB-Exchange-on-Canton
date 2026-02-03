import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeDamlMap } from '../../utils/daml';
import { fetchContract } from '../../services/cantonApi';
import { apiClient, API_ROUTES } from '@/config/config';

/**
 * Portfolio View Component - Shows user's positions across all trading pairs
 */
const USER_ACCOUNT_STORAGE_KEY = 'user_account_contract_id';

function getUserAccountStorageKey(partyId) {
  return partyId ? `${USER_ACCOUNT_STORAGE_KEY}:${partyId}` : USER_ACCOUNT_STORAGE_KEY;
}

function getStoredUserAccountId(partyId) {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(getUserAccountStorageKey(partyId));
}

export default function PortfolioView({ partyId, cantonApi }) {
  const [positions, setPositions] = useState([]);
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
      const accountContractId = getStoredUserAccountId(partyId);
      let balances = {};
      if (accountContractId) {
        const account = await fetchContract(accountContractId, partyId);
        balances = normalizeDamlMap(account?.payload?.balances);
      }

      const tradesJson = await apiClient.get(API_ROUTES.TRADES.GET_USER(partyId, 500));
      const tradesPayload = tradesJson?.data ?? tradesJson;
      const trades = tradesPayload?.trades || [];
      const userTrades = trades.filter(t => {
        const buyer = t.payload?.buyer || t.buyer;
        const seller = t.payload?.seller || t.seller;
        return buyer === partyId || seller === partyId;
      });

        // Calculate positions per trading pair
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
            position.quoteQuantity -= price * quantity; // Pay quote
          } else {
            position.totalSellQty += quantity;
            position.totalSellValue += price * quantity;
            position.baseQuantity -= quantity;
            position.quoteQuantity += price * quantity; // Receive quote
          }
        });

        // Calculate averages and P&L
        const positionsList = Array.from(positionMap.values()).map(pos => {
          pos.avgBuyPrice = pos.totalBuyQty > 0 ? pos.totalBuyValue / pos.totalBuyQty : 0;
          pos.avgSellPrice = pos.totalSellQty > 0 ? pos.totalSellValue / pos.totalSellQty : 0;
          
          // Get current balance for this pair
          const [baseToken, quoteToken] = pos.tradingPair.split('/');
          const baseBalance = balances[baseToken] || 0;
          const quoteBalance = balances[quoteToken] || 0;
          
          pos.currentBaseBalance = parseFloat(baseBalance);
          pos.currentQuoteBalance = parseFloat(quoteBalance);
          
          // Calculate unrealized P&L (if we have current price)
          // For now, just show realized P&L
          pos.realizedPnL = pos.totalSellValue - (pos.avgBuyPrice * pos.totalSellQty);
          pos.realizedPnLPercent = pos.avgBuyPrice > 0 
            ? (pos.realizedPnL / (pos.avgBuyPrice * pos.totalSellQty)) * 100 
            : 0;
          
          return pos;
        });

        setPositions(positionsList);
        
        // Calculate total portfolio value (in USDT)
        const total = positionsList.reduce((sum, pos) => {
          const [baseToken, quoteToken] = pos.tradingPair.split('/');
          const quoteValue = pos.currentQuoteBalance || 0;
          // If quote is USDT, add directly; otherwise would need price conversion
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
        ) : positions.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No positions found
          </div>
        ) : (
          <div className="space-y-4">
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
                    <div className="text-xs text-muted-foreground mb-1">Base Balance</div>
                    <div className="font-mono text-foreground">
                      {position.currentBaseBalance.toFixed(8)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Quote Balance</div>
                    <div className="font-mono text-foreground">
                      {position.currentQuoteBalance.toFixed(2)} USDT
                    </div>
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

