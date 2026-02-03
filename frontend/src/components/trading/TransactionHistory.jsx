import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { TrendingUp, TrendingDown, Download, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient, API_ROUTES } from '@/config/config';

/**
 * Transaction History Component - Shows user's trade history
 */
export default function TransactionHistory({ partyId, cantonApi }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'buy', 'sell'

  useEffect(() => {
    loadTransactions();
  }, [partyId, filter]);

  const loadTransactions = async () => {
    if (!partyId) return;
    
    setLoading(true);
    try {
      const json = await apiClient.get(API_ROUTES.TRADES.GET_USER(partyId, 500));
      const payload = json?.data ?? json;
      const trades = payload?.trades || [];
      
      // Filter trades where user participated
      const userTrades = trades.filter(trade => {
        const buyer = trade.payload?.buyer || trade.buyer;
        const seller = trade.payload?.seller || trade.seller;
        return buyer === partyId || seller === partyId;
      });

      // Apply filter
      let filtered = userTrades;
      if (filter === 'buy') {
        filtered = userTrades.filter(t => (t.payload?.buyer || t.buyer) === partyId);
      } else if (filter === 'sell') {
        filtered = userTrades.filter(t => (t.payload?.seller || t.seller) === partyId);
      }

      setTransactions(filtered);
    } catch (error) {
      console.error('[TransactionHistory] Error loading transactions:', error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '--';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return '--';
    }
  };

  const exportCSV = () => {
    const csv = [
      ['Time', 'Pair', 'Side', 'Price', 'Quantity', 'Total'].join(','),
      ...transactions.map(t => {
        const price = parseFloat(t.payload?.price || t.price || 0);
        const quantity = parseFloat(t.payload?.quantity || t.quantity || 0);
        const isBuy = (t.payload?.buyer || t.buyer) === partyId;
        return [
          formatDate(t.payload?.timestamp || t.timestamp),
          t.payload?.tradingPair || t.tradingPair || 'N/A',
          isBuy ? 'Buy' : 'Sell',
          price,
          quantity,
          price * quantity
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Transaction History</CardTitle>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1 border border-border rounded-md">
              <Button
                variant={filter === 'all' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter('all')}
                className="h-8"
              >
                All
              </Button>
              <Button
                variant={filter === 'buy' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter('buy')}
                className="h-8"
              >
                Buy
              </Button>
              <Button
                variant={filter === 'sell' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter('sell')}
                className="h-8"
              >
                Sell
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={exportCSV}
              className="h-8 w-8"
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted-foreground text-sm">Loading transactions...</div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No transactions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pair</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Side</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quantity</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => {
                  const price = parseFloat(tx.payload?.price || tx.price || 0);
                  const quantity = parseFloat(tx.payload?.quantity || tx.quantity || 0);
                  const total = price * quantity;
                  const isBuy = (tx.payload?.buyer || tx.buyer) === partyId;
                  
                  return (
                    <motion.tr
                      key={tx.contractId || tx.tradeId || idx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b border-border/50 hover:bg-card transition-colors"
                    >
                      <td className="py-3 px-4 text-foreground text-sm">{formatDate(tx.payload?.timestamp || tx.timestamp)}</td>
                      <td className="py-3 px-4 text-foreground text-sm font-medium">
                        {tx.payload?.tradingPair || tx.tradingPair || 'N/A'}
                      </td>
                      <td className={cn(
                        "py-3 px-4 font-semibold text-sm flex items-center space-x-1",
                        isBuy ? "text-success" : "text-destructive"
                      )}>
                        {isBuy ? (
                          <>
                            <TrendingUp className="w-3 h-3" />
                            <span>Buy</span>
                          </>
                        ) : (
                          <>
                            <TrendingDown className="w-3 h-3" />
                            <span>Sell</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground font-mono text-sm">
                        {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground font-mono text-sm">
                        {quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground font-mono text-sm font-semibold">
                        {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

