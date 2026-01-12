import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, CheckCircle, XCircle, Loader2, RefreshCw, Settings } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

export default function AdminPanel({ partyId }) {
  const [orderBooks, setOrderBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTradingPair, setNewTradingPair] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load existing OrderBooks
  const loadOrderBooks = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('http://localhost:3001/api/orderbooks');
      if (!response.ok) {
        throw new Error('Failed to load OrderBooks');
      }
      const data = await response.json();
      setOrderBooks(data.orderBooks || []);
    } catch (err) {
      setError(err.message || 'Failed to load OrderBooks');
    } finally {
      setLoading(false);
    }
  };

  // Create new OrderBook
  const createOrderBook = async (tradingPair) => {
    if (!tradingPair || !tradingPair.includes('/')) {
      setError('Invalid trading pair format. Use BASE/QUOTE (e.g., BTC/USDT)');
      return;
    }

    setCreating(true);
    setError('');
    setSuccess('');

    try {
      const encodedPair = encodeURIComponent(tradingPair);
      const response = await fetch(`http://localhost:3001/api/admin/orderbooks/${encodedPair}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setError(`OrderBook for ${tradingPair} already exists`);
        } else {
          throw new Error(data.error || data.message || 'Failed to create OrderBook');
        }
        return;
      }

      setSuccess(`OrderBook for ${tradingPair} created successfully!`);
      setNewTradingPair('');
      await loadOrderBooks();
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to create OrderBook');
    } finally {
      setCreating(false);
    }
  };

  // Create multiple OrderBooks at once
  const createMultipleOrderBooks = async (pairs) => {
    setCreating(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('http://localhost:3001/api/admin/orderbooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tradingPairs: pairs }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to create OrderBooks');
      }

      setSuccess(`Created ${data.results.filter(r => r.success).length} of ${pairs.length} OrderBooks`);
      await loadOrderBooks();
      
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.message || 'Failed to create OrderBooks');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    loadOrderBooks();
  }, []);

  const defaultPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Settings className="w-8 h-8" />
            Admin Panel
          </h2>
          <p className="text-muted-foreground mt-1">Manage OrderBooks and Exchange Configuration</p>
        </div>
        <Button
          onClick={loadOrderBooks}
          disabled={loading}
          variant="outline"
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-success/10 border border-success/20 rounded-lg flex items-center gap-2"
        >
          <CheckCircle className="w-5 h-5 text-success" />
          <span className="text-success font-medium">{success}</span>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2"
        >
          <XCircle className="w-5 h-5 text-destructive" />
          <span className="text-destructive font-medium">{error}</span>
        </motion.div>
      )}

      {/* Create OrderBook Section */}
      <Card>
        <CardHeader>
          <CardTitle>Create OrderBook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Trading Pair</Label>
              <Input
                placeholder="BTC/USDT"
                value={newTradingPair}
                onChange={(e) => setNewTradingPair(e.target.value.toUpperCase())}
                disabled={creating}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => createOrderBook(newTradingPair)}
                disabled={creating || !newTradingPair}
                className="w-full"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Create OrderBook
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Quick Create Default Pairs */}
          <div className="pt-4 border-t border-border">
            <Label className="mb-2 block">Quick Create Default Pairs</Label>
            <div className="flex flex-wrap gap-2">
              {defaultPairs.map((pair) => (
                <Button
                  key={pair}
                  variant="outline"
                  size="sm"
                  onClick={() => createOrderBook(pair)}
                  disabled={creating || orderBooks.some(ob => ob.tradingPair === pair)}
                >
                  {pair}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => createMultipleOrderBooks(defaultPairs)}
                disabled={creating}
                className="font-semibold"
              >
                Create All
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Existing OrderBooks */}
      <Card>
        <CardHeader>
          <CardTitle>Existing OrderBooks ({orderBooks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : orderBooks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No OrderBooks found.</p>
              <p className="text-sm mt-2">Create your first OrderBook above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orderBooks.map((ob) => (
                <motion.div
                  key={ob.contractId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 border border-border rounded-lg hover:bg-card transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-lg">{ob.tradingPair}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Buy Orders: {ob.buyOrdersCount || 0} | Sell Orders: {ob.sellOrdersCount || 0}
                      </div>
                      {ob.lastPrice && (
                        <div className="text-sm text-muted-foreground mt-1">
                          Last Price: {parseFloat(ob.lastPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground font-mono break-all max-w-xs">
                        {ob.contractId?.substring(0, 40)}...
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

