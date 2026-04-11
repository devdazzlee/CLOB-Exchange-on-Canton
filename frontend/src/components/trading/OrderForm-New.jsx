import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Loader2, Info, Calculator, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { placeOrder } from '../../services/apiService';

export default function OrderFormNew({ 
  tradingPair = 'BTC/USDT',
  availablePairs = ['BTC/USDT'],
  onOrderPlaced, // Callback when order is placed
  balance = { BTC: '0.0', USDT: '0.0' },
  orderBook = { bids: [], asks: [] }
}) {
  const [orderType, setOrderType] = useState('BUY'); // BUY | SELL
  const [orderMode, setOrderMode] = useState('LIMIT'); // LIMIT | MARKET
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Advanced options
  const [timeInForce, setTimeInForce] = useState('GTC');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');

  // Get base and quote tokens
  const [baseToken, quoteToken] = tradingPair.split('/');
  const baseBalance = parseFloat(balance[baseToken] || 0);
  const quoteBalance = parseFloat(balance[quoteToken] || 0);

  // Get best bid/ask prices from orderbook
  const bestBid = orderBook.bids?.[0]?.[0] || null;
  const bestAsk = orderBook.asks?.[0]?.[0] || null;
  const marketPrice = bestBid && bestAsk ? (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 : bestBid || bestAsk || null;

  // Calculate estimated cost/value
  const estimatedCost = useMemo(() => {
    if (!quantity || parseFloat(quantity) <= 0) return null;
    const qty = parseFloat(quantity);
    
    if (orderMode === 'MARKET') {
      if (orderType === 'BUY' && bestAsk) {
        return qty * parseFloat(bestAsk);
      } else if (orderType === 'SELL' && bestBid) {
        return qty * parseFloat(bestBid);
      }
    } else {
      if (price) {
        return qty * parseFloat(price);
      }
    }
    return null;
  }, [quantity, orderMode, orderType, price, bestBid, bestAsk]);

  // Validation
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    if (!quantity || parseFloat(quantity) <= 0) {
      errors.push('Quantity is required');
    }

    if (orderMode === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      errors.push('Price is required for limit orders');
    }

    const qty = parseFloat(quantity || 0);
    const cost = estimatedCost || 0;

    // Check balance
    if (orderType === 'BUY') {
      if (cost > quoteBalance) {
        errors.push(`Insufficient ${quoteToken} balance. Need: ${cost.toFixed(2)}, Available: ${quoteBalance.toFixed(2)}`);
      }
    } else {
      if (qty > baseBalance) {
        errors.push(`Insufficient ${baseToken} balance. Need: ${qty.toFixed(6)}, Available: ${baseBalance.toFixed(6)}`);
      }
    }

    // Warnings
    if (orderMode === 'LIMIT' && marketPrice) {
      const orderPrice = parseFloat(price || 0);
      if (orderType === 'BUY' && orderPrice > marketPrice * 1.05) {
        warnings.push('Buy price is 5% above market price');
      } else if (orderType === 'SELL' && orderPrice < marketPrice * 0.95) {
        warnings.push('Sell price is 5% below market price');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }, [quantity, price, orderMode, orderType, estimatedCost, baseBalance, quoteBalance, marketPrice]);

  // Auto-fill price for market orders
  useEffect(() => {
    if (orderMode === 'MARKET' && marketPrice) {
      setPrice(marketPrice.toString());
    }
  }, [orderMode, marketPrice]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validation.isValid) {
      setError(validation.errors.join(', '));
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const orderData = {
        pair: tradingPair,
        side: orderType,
        type: orderMode,
        price: orderMode === 'LIMIT' ? price : undefined,
        quantity: quantity,
        clientOrderId: `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };

      const result = await placeOrder(orderData);
      
      setSuccess(`Order placed successfully! Contract ID: ${result.data.order.contractId}`);
      
      // Reset form
      setQuantity('');
      if (orderMode === 'LIMIT') {
        setPrice('');
      }

      // Notify parent
      if (onOrderPlaced) {
        onOrderPlaced(result.data);
      }

    } catch (error) {
      setError(error.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const useMarketPrice = () => {
    if (marketPrice) {
      setPrice(marketPrice.toString());
    }
  };

  const fillMax = () => {
    if (orderType === 'BUY') {
      if (bestAsk) {
        const maxQty = quoteBalance / parseFloat(bestAsk);
        setQuantity(maxQty.toFixed(6));
      }
    } else {
      setQuantity(baseBalance.toFixed(6));
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Place Order</span>
          <div className="flex items-center gap-2">
            <TrendingUp className={`w-4 h-4 ${orderType === 'BUY' ? 'text-green-500' : 'text-red-500'}`} />
            <span className={`text-sm font-medium ${orderType === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
              {orderType}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Trading Pair */}
          <div className="space-y-2">
            <Label>Trading Pair</Label>
            <Select value={tradingPair} disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availablePairs.map(pair => (
                  <SelectItem key={pair} value={pair}>{pair}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Order Type */}
          <div className="space-y-2">
            <Label>Order Type</Label>
            <RadioGroup value={orderType} onValueChange={setOrderType} className="flex space-x-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="BUY" id="buy" />
                <Label htmlFor="buy" className="text-green-500 font-medium">BUY</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="SELL" id="sell" />
                <Label htmlFor="sell" className="text-red-500 font-medium">SELL</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Order Mode */}
          <div className="space-y-2">
            <Label>Order Mode</Label>
            <RadioGroup value={orderMode} onValueChange={setOrderMode} className="flex space-x-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="LIMIT" id="limit" />
                <Label htmlFor="limit">Limit</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="MARKET" id="market" />
                <Label htmlFor="market">Market</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Price */}
          {orderMode === 'LIMIT' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Price ({quoteToken})</Label>
                {marketPrice && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={useMarketPrice}
                    className="text-xs"
                  >
                    Use Market: {marketPrice.toFixed(2)}
                  </Button>
                )}
              </div>
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>
          )}

          {/* Quantity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Quantity ({baseToken})</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={fillMax}
                className="text-xs"
              >
                Max
              </Button>
            </div>
            <Input
              type="number"
              step="0.000001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.000000"
              className="font-mono"
            />
          </div>

          {/* Estimated Cost */}
          {estimatedCost && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Estimated {orderType === 'BUY' ? 'Cost' : 'Value'}:</span>
                <span className="font-mono font-semibold">
                  {estimatedCost.toFixed(2)} {quoteToken}
                </span>
              </div>
            </div>
          )}

          {/* Balance Display */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
              <div className="text-gray-500 dark:text-gray-400">{baseToken} Balance</div>
              <div className="font-mono font-semibold">{baseBalance.toFixed(6)}</div>
            </div>
            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
              <div className="text-gray-500 dark:text-gray-400">{quoteToken} Balance</div>
              <div className="font-mono font-semibold">{quoteBalance.toFixed(2)}</div>
            </div>
          </div>

          {/* Errors */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <span className="text-sm text-green-700 dark:text-green-300">{success}</span>
            </div>
          )}

          {/* Warnings */}
          {validation.warnings.length > 0 && (
            <div className="space-y-2">
              {validation.warnings.map((warning, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
                  <Info className="w-4 h-4" />
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={loading || !validation.isValid}
            className={`w-full h-12 font-semibold text-base ${
              orderType === 'BUY' 
                ? 'bg-green-600 hover:bg-green-700 text-white' 
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                Placing Order...
              </span>
            ) : (
              `${orderType} ${baseToken}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
