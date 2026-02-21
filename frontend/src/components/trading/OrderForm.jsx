import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Loader2, Info, Calculator, TrendingUp, TrendingDown, Coins, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { placeOrder } from '../../services/apiService';

export default function OrderForm({ 
  tradingPair,
  availablePairs = ['BTC/USDT'],
  onTradingPairChange, 
  orderBookExists,
  orderType, 
  onOrderTypeChange, 
  orderMode, 
  onOrderModeChange, 
  price, 
  onPriceChange, 
  quantity, 
  onQuantityChange, 
  loading, 
  onSubmit,
  balance = { BTC: '0.0', USDT: '0.0' },
  lockedBalance = {},
  orderBook = { buys: [], sells: [] },
  onMintTokens = null,
  mintingLoading = false,
  lastTradePrice = null
}) {
  const [timeInForce, setTimeInForce] = useState('GTC'); // GTC, IOC, FOK
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopPrice, setStopPrice] = useState(''); // For STOP_LOSS order mode

  // Get base and quote tokens
  const [baseToken, quoteToken] = tradingPair.split('/');
  // Available = Total - Locked (so user sees actual free funds)
  const baseBalance = Math.max(0, parseFloat(balance[baseToken] || 0) - parseFloat(lockedBalance[baseToken] || 0));
  const quoteBalance = Math.max(0, parseFloat(balance[quoteToken] || 0) - parseFloat(lockedBalance[quoteToken] || 0));

  // Get best bid/ask prices - REAL DATA ONLY
  const bestBid = orderBook.buys?.[0]?.price || null;
  const bestAsk = orderBook.sells?.[0]?.price || null;
  
  // Market price priority: 1) Last trade price, 2) Mid-point bid/ask, 3) Best bid or ask
  const midPrice = bestBid && bestAsk 
    ? (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 
    : null;
  const marketPrice = (lastTradePrice && parseFloat(lastTradePrice) > 0 ? parseFloat(lastTradePrice) : null) 
    || midPrice 
    || parseFloat(bestBid) || parseFloat(bestAsk) || null;

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
      return null;
    } else {
      if (price && parseFloat(price) > 0) {
        return qty * parseFloat(price);
      }
    }
    return null;
  }, [quantity, price, orderMode, orderType, bestBid, bestAsk]);

  // Calculate percentage of balance
  const calculatePercentage = (percent) => {
    console.log('[OrderForm] Calculating percentage:', percent, 'OrderType:', orderType, 'OrderMode:', orderMode);
    
    if (orderType === 'BUY') {
      // For buy orders, calculate quantity based on available quote balance
      const availableBalance = quoteBalance;
      if (availableBalance <= 0) {
        console.warn('[OrderForm] No quote balance available');
        return;
      }
      
      let priceToUse = 1;
      if (orderMode === 'MARKET') {
        priceToUse = bestAsk || marketPrice || 1;
      } else {
        priceToUse = parseFloat(price) || 1;
      }
      
      if (priceToUse <= 0) {
        console.warn('[OrderForm] Invalid price for calculation');
        return;
      }
      
      const maxQty = availableBalance / priceToUse;
      const qty = (maxQty * percent) / 100;
      const qtyStr = qty.toFixed(8);
      console.log('[OrderForm] Calculated quantity:', qtyStr, 'from balance:', availableBalance, 'price:', priceToUse);
      onQuantityChange(qtyStr);
    } else {
      // For sell orders, use base balance
      const availableBalance = baseBalance;
      if (availableBalance <= 0) {
        console.warn('[OrderForm] No base balance available');
        return;
      }
      
      const qty = (availableBalance * percent) / 100;
      const qtyStr = qty.toFixed(8);
      console.log('[OrderForm] Calculated quantity:', qtyStr, 'from balance:', availableBalance);
      onQuantityChange(qtyStr);
    }
  };

  // Validation
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    // Required field checks
    const qty = parseFloat(quantity) || 0;
    if (!quantity || qty <= 0) {
      errors.push('Quantity is required');
    }
    if (orderMode === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      errors.push('Price is required for limit orders');
    }
    if (orderMode === 'STOP_LOSS' && (!stopPrice || parseFloat(stopPrice) <= 0)) {
      errors.push('Stop price is required for stop-loss orders');
    }

    // Balance checks (only if quantity is valid)
    if (qty > 0) {
      if (orderType === 'BUY') {
        if (estimatedCost && estimatedCost > quoteBalance) {
          errors.push(`Insufficient ${quoteToken} balance (need ${estimatedCost.toFixed(2)}, have ${quoteBalance.toFixed(2)})`);
        }
        if (orderMode === 'LIMIT' && price && bestAsk && parseFloat(price) > parseFloat(bestAsk) * 1.05) {
          warnings.push('Limit price is significantly above market price');
        }
      } else {
        if (qty > baseBalance) {
          errors.push(`Insufficient ${baseToken} balance (need ${qty.toFixed(8)}, have ${baseBalance.toFixed(8)})`);
        }
        if (orderMode === 'LIMIT' && price && bestBid && parseFloat(price) < parseFloat(bestBid) * 0.95) {
          warnings.push('Limit price is significantly below market price');
        }
      }
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }, [orderType, orderMode, price, quantity, stopPrice, estimatedCost, baseBalance, quoteBalance, baseToken, quoteToken, bestBid, bestAsk]);

  // Format number with proper decimals
  const formatNumber = (num, decimals = 8) => {
    if (!num || isNaN(num)) return '0';
    return parseFloat(num).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals
    });
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="px-3 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base">Place Order</CardTitle>
          {marketPrice && (
            <div className="text-right">
              <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Market Price</div>
              <div className="text-base sm:text-lg font-bold font-mono">
                {formatNumber(marketPrice, 2)} <span className="text-xs sm:text-sm">{quoteToken}</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <form onSubmit={(e) => {
          e.preventDefault();
          if (validation.isValid) {
            const orderData = {
              tradingPair,
              orderType,
              orderMode,
              price: orderMode === 'LIMIT' ? price : null,
              quantity,
              timeInForce,
              // Stop-loss: send stopPrice for STOP_LOSS mode, or optional stop-loss from advanced options
              stopPrice: orderMode === 'STOP_LOSS' ? stopPrice : (showAdvanced && stopLoss ? stopLoss : null),
              stopLoss: showAdvanced ? stopLoss : null,
              takeProfit: showAdvanced ? takeProfit : null
            };
            onSubmit(orderData);
          }
        }} className="space-y-5">
          {/* Trading Pair */}
          <div className="space-y-2">
            <Label>Trading Pair</Label>
            <Select value={tradingPair} onValueChange={onTradingPairChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select pair">{tradingPair}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availablePairs.map((pair) => {
                  const [base] = pair.split('/');
                  const icons = {
                    'BTC': { symbol: '₿', color: 'text-primary' },
                    'ETH': { symbol: 'Ξ', color: 'text-[#627EEA]' },
                    'SOL': { symbol: '◎', color: 'text-[#14F195]' },
                    'CBTC': { symbol: '₵', color: 'text-[#F7931A]' }, // Canton BTC
                    'CC': { symbol: '◈', color: 'text-[#6366F1]' }, // Canton Coin
                    'USDT': { symbol: '$', color: 'text-[#26A17B]' },
                  };
                  const icon = icons[base] || { symbol: base[0], color: 'text-foreground' };
                  
                  return (
                    <SelectItem key={pair} value={pair}>
                      <span className="flex items-center gap-2">
                        <span className={`${icon.color} font-bold`}>{icon.symbol}</span>
                        {pair}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Order Type - Buy/Sell */}
          <div className="space-y-2">
            <Label>Order Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={orderType === 'BUY' ? 'default' : 'outline'}
                className={`h-12 font-semibold ${
                  orderType === 'BUY' 
                    ? 'bg-success hover:bg-success/90 text-success-foreground' 
                    : 'hover:bg-success/10'
                }`}
                onClick={() => onOrderTypeChange({ target: { value: 'BUY' } })}
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Buy
              </Button>
              <Button
                type="button"
                variant={orderType === 'SELL' ? 'default' : 'outline'}
                className={`h-12 font-semibold ${
                  orderType === 'SELL' 
                    ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                    : 'hover:bg-destructive/10'
                }`}
                onClick={() => onOrderTypeChange({ target: { value: 'SELL' } })}
              >
                <TrendingDown className="w-4 h-4 mr-2" />
                Sell
              </Button>
            </div>
          </div>

          {/* Order Mode - Limit/Market/Stop-Loss */}
          <div className="space-y-2">
            <Label>Order Mode</Label>
            <div className="flex gap-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="LIMIT" 
                  id="limit"
                  checked={orderMode === 'LIMIT'}
                  onChange={() => {
                    console.log('[OrderForm] Order mode changed to LIMIT');
                    onOrderModeChange({ target: { value: 'LIMIT' } });
                  }}
                >
                  Limit
                </RadioGroupItem>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="MARKET" 
                  id="market"
                  checked={orderMode === 'MARKET'}
                  onChange={() => {
                    console.log('[OrderForm] Order mode changed to MARKET');
                    onOrderModeChange({ target: { value: 'MARKET' } });
                  }}
                >
                  Market
                </RadioGroupItem>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="STOP_LOSS" 
                  id="stop_loss"
                  checked={orderMode === 'STOP_LOSS'}
                  onChange={() => {
                    console.log('[OrderForm] Order mode changed to STOP_LOSS');
                    onOrderModeChange({ target: { value: 'STOP_LOSS' } });
                  }}
                >
                  Stop-Loss
                </RadioGroupItem>
              </div>
            </div>
          </div>

          {/* Price (Limit orders) */}
          {orderMode === 'LIMIT' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Price ({quoteToken})</Label>
                {bestBid && bestAsk && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => onPriceChange(bestBid.toString())}
                    >
                      Bid: {formatNumber(bestBid, 2)}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => onPriceChange(bestAsk.toString())}
                    >
                      Ask: {formatNumber(bestAsk, 2)}
                    </Button>
                  </div>
                )}
              </div>
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => onPriceChange(e.target.value)}
                placeholder="Enter price"
                className="font-mono"
              />
            </div>
          )}

          {/* Stop Price (Stop-Loss orders) */}
          {orderMode === 'STOP_LOSS' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="font-medium">
                    {orderType === 'SELL' 
                      ? 'Triggers a market sell when price drops to or below stop price' 
                      : 'Triggers a market buy when price rises to or above stop price'}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Stop Price ({quoteToken})</Label>
                  {marketPrice && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setStopPrice(marketPrice.toString())}
                    >
                      Market: {formatNumber(marketPrice, 2)}
                    </Button>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.01"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                  placeholder={orderType === 'SELL' ? 'Sell trigger price' : 'Buy trigger price'}
                  className="font-mono"
                  required
                />
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Quantity ({baseToken})</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Available: {formatNumber(orderType === 'BUY' ? quoteBalance : baseBalance, 8)} {orderType === 'BUY' ? quoteToken : baseToken}
                </span>
                {onMintTokens && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30 hover:border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
                    onClick={onMintTokens}
                    disabled={mintingLoading}
                  >
                    {mintingLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Coins className="w-3 h-3 mr-1" />
                        Get Test Funds
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            <Input
              type="number"
              step="0.00000001"
              value={quantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              placeholder="Enter quantity"
              className="font-mono"
              required
            />
            {/* Percentage buttons */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((percent) => (
                <Button
                  key={percent}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => calculatePercentage(percent)}
                >
                  {percent}%
                </Button>
              ))}
            </div>
          </div>

          {/* Order Summary */}
          {estimatedCost && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Calculator className="w-4 h-4" />
                Order Summary
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Estimated Cost</div>
                  <div className="font-semibold font-mono">
                    {formatNumber(estimatedCost, 2)} {quoteToken}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Quantity</div>
                  <div className="font-semibold font-mono">
                    {formatNumber(quantity, 8)} {baseToken}
                  </div>
                </div>
                {orderMode === 'LIMIT' && price && (
                  <div>
                    <div className="text-muted-foreground">Limit Price</div>
                    <div className="font-semibold font-mono">
                      {formatNumber(price, 2)} {quoteToken}
                    </div>
                  </div>
                )}
                {orderMode === 'STOP_LOSS' && stopPrice && (
                  <div>
                    <div className="text-muted-foreground">Stop Price</div>
                    <div className="font-semibold font-mono text-amber-600 dark:text-amber-400">
                      {formatNumber(stopPrice, 2)} {quoteToken}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground">Time In Force</div>
                  <div className="font-semibold">{timeInForce}</div>
                </div>
              </div>
            </div>
          )}

          {/* Validation Messages */}
          {validation.errors.length > 0 && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              {validation.errors.map((error, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  {error}
                </div>
              ))}
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              {validation.warnings.map((warning, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-primary">
                  <Info className="w-4 h-4" />
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* Advanced Options */}
          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full"
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Options
            </Button>
            {showAdvanced && (
              <div className="p-4 border border-border rounded-lg space-y-4">
                <div className="space-y-2">
                  <Label>Time In Force</Label>
                  <Select value={timeInForce} onValueChange={setTimeInForce}>
                    <SelectTrigger className="text-white">
                      <SelectValue placeholder="Select time in force" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GTC">GTC - Good Till Cancel</SelectItem>
                      <SelectItem value="IOC">IOC - Immediate Or Cancel</SelectItem>
                      <SelectItem value="FOK">FOK - Fill Or Kill</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Stop Loss (Optional)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                      placeholder="Stop loss price"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Take Profit (Optional)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                      placeholder="Take profit price"
                      className="font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={loading || !validation.isValid}
            className={`w-full h-12 font-semibold text-base ${
              orderType === 'BUY' 
                ? 'bg-success hover:bg-success/90 text-success-foreground' 
                : 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                {orderMode === 'STOP_LOSS' ? 'Setting Stop-Loss...' : 'Placing Order...'}
              </span>
            ) : (
              orderMode === 'STOP_LOSS' 
                ? `Stop-Loss ${orderType} ${baseToken}`
                : `${orderType} ${baseToken}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
