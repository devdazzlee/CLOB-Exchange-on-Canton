import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wallet, Lock, RefreshCw, TrendingUp, TrendingDown, BarChart2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient, API_ROUTES } from '@/config/config';
import { getHoldings } from '../../services/balanceService';

/**
 * Portfolio View Component - Shows user's real balances and trade positions.
 *
 * Balance data comes from TradingInterface props (already loaded via WebSocket/API).
 * Trade history enriches the view with P&L calculations.
 */
export default function PortfolioView({ partyId, balance = {}, lockedBalance = {} }) {
  const [positions, setPositions] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load trade history for P&L calculation
  useEffect(() => {
    if (!partyId) return;
    loadTradeHistory();
  }, [partyId, refreshKey]);

  const loadTradeHistory = async () => {
    setTradesLoading(true);
    try {
      const tradesJson = await apiClient
        .get(API_ROUTES.TRADES.GET_USER(partyId, 500))
        .catch(() => ({ data: {} }));

      const tradesPayload = tradesJson?.data ?? tradesJson;
      const trades = tradesPayload?.trades || [];
      const userTrades = trades.filter(t => {
        const buyer = t.payload?.buyer || t.buyer;
        const seller = t.payload?.seller || t.seller;
        return buyer === partyId || seller === partyId;
      });

      // Build position map from trade history
      const positionMap = new Map();
      userTrades.forEach(trade => {
        const pair = trade.payload?.tradingPair || trade.tradingPair || 'UNKNOWN';
        const price = parseFloat(trade.payload?.price || trade.price || 0);
        const quantity = parseFloat(trade.payload?.quantity || trade.quantity || 0);
        const isBuy = (trade.payload?.buyer || trade.buyer) === partyId;

        if (!positionMap.has(pair)) {
          positionMap.set(pair, {
            tradingPair: pair,
            totalBuyQty: 0,
            totalSellQty: 0,
            totalBuyValue: 0,
            totalSellValue: 0,
            tradeCount: 0,
          });
        }

        const pos = positionMap.get(pair);
        pos.tradeCount++;
        if (isBuy) {
          pos.totalBuyQty += quantity;
          pos.totalBuyValue += price * quantity;
        } else {
          pos.totalSellQty += quantity;
          pos.totalSellValue += price * quantity;
        }
      });

      const positionsList = Array.from(positionMap.values()).map(pos => {
        pos.avgBuyPrice = pos.totalBuyQty > 0 ? pos.totalBuyValue / pos.totalBuyQty : 0;
        pos.avgSellPrice = pos.totalSellQty > 0 ? pos.totalSellValue / pos.totalSellQty : 0;
        pos.realizedPnL = pos.totalSellValue - (pos.avgBuyPrice * pos.totalSellQty);
        pos.realizedPnLPct = pos.avgBuyPrice > 0 && pos.totalSellQty > 0
          ? (pos.realizedPnL / (pos.avgBuyPrice * pos.totalSellQty)) * 100
          : 0;
        return pos;
      });

      setPositions(positionsList);
    } catch (err) {
      console.error('[PortfolioView] Failed to load trade history:', err);
      setPositions([]);
    } finally {
      setTradesLoading(false);
    }
  };

  // Build token list from the balance prop (real data from TradingInterface)
  const availableTokens = Object.entries(balance || {}).filter(([, v]) => parseFloat(v) > 0);
  const lockedTokens = Object.entries(lockedBalance || {}).filter(([, v]) => parseFloat(v) > 0);

  // All unique tokens across available and locked
  const allTokenSymbols = [...new Set([
    ...Object.keys(balance || {}),
    ...Object.keys(lockedBalance || {}),
  ])];

  const hasBalances = allTokenSymbols.length > 0;

  return (
    <div className="h-full flex flex-col gap-3 overflow-auto p-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#F7B500]" />
          <span className="text-[11px] font-black uppercase tracking-widest text-[#F7B500]">Portfolio</span>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="p-1.5 text-[#848E9C] hover:text-white hover:bg-white/5 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Token Balances — Real data from TradingInterface */}
      <div className="flex-shrink-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#848E9C] mb-2">
          Balances
        </div>
        {!hasBalances ? (
          <div className="text-[12px] text-[#848E9C] italic py-3">
            No token balances found. Use the faucet to mint test tokens.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {allTokenSymbols.map(symbol => {
              const avail = parseFloat(balance?.[symbol] || 0);
              const locked = parseFloat(lockedBalance?.[symbol] || 0);
              const total = avail + locked;
              if (total === 0) return null;
              return (
                <motion.div
                  key={symbol}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-[#161b22] border border-[#21262d] rounded-xl p-3 hover:border-[#F7B500]/30 transition-colors"
                >
                  <div className="text-[11px] font-bold text-[#F7B500] mb-1">{symbol}</div>
                  <div className="text-[15px] font-mono font-bold text-white">
                    {avail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                  </div>
                  {locked > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Lock className="w-2.5 h-2.5 text-yellow-500/70" />
                      <span className="text-[10px] text-yellow-500/70 font-mono">
                        {locked.toLocaleString(undefined, { maximumFractionDigits: 4 })} locked
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trade Positions — P&L from trade history */}
      <div className="flex-1 min-h-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#848E9C] mb-2 flex items-center gap-2">
          <BarChart2 className="w-3 h-3" />
          Trade History &amp; P&amp;L
        </div>
        {tradesLoading ? (
          <div className="text-[12px] text-[#848E9C] animate-pulse py-2">Loading trade history...</div>
        ) : positions.length === 0 ? (
          <div className="text-[12px] text-[#848E9C] italic py-2">
            No trades yet. Place your first order to see P&amp;L here.
          </div>
        ) : (
          <div className="space-y-2 overflow-auto">
            {positions.map((pos, idx) => (
              <motion.div
                key={pos.tradingPair}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="bg-[#161b22] border border-[#21262d] rounded-xl p-3 hover:border-[#F7B500]/20 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-[13px] font-bold text-white">{pos.tradingPair}</span>
                    <span className="ml-2 text-[10px] text-[#848E9C]">{pos.tradeCount} trades</span>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "text-[13px] font-bold font-mono",
                      pos.realizedPnL >= 0 ? "text-[#00b07b]" : "text-[#f84962]"
                    )}>
                      {pos.realizedPnL >= 0 ? '+' : ''}
                      {pos.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </div>
                    {pos.realizedPnLPct !== 0 && (
                      <div className={cn(
                        "text-[10px] font-mono",
                        pos.realizedPnLPct >= 0 ? "text-[#00b07b]" : "text-[#f84962]"
                      )}>
                        {pos.realizedPnLPct >= 0 ? '+' : ''}{pos.realizedPnLPct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#848E9C]">Avg Buy</span>
                    <span className="font-mono text-white">{pos.avgBuyPrice > 0 ? pos.avgBuyPrice.toFixed(4) : '--'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#848E9C]">Avg Sell</span>
                    <span className="font-mono text-white">{pos.avgSellPrice > 0 ? pos.avgSellPrice.toFixed(4) : '--'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#848E9C]">Buy Vol</span>
                    <span className="font-mono text-[#00b07b]">{pos.totalBuyQty.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#848E9C]">Sell Vol</span>
                    <span className="font-mono text-[#f84962]">{pos.totalSellQty.toFixed(4)}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
