import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

export default function OrderForm({ 
  tradingPair,
  availablePairs = ['BTC/USDT'], // Available pairs from OrderBooks
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
  onSubmit 
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Place Order</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-6">
            {/* Trading Pair - Shadcn Dropdown */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">Trading Pair</label>
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
              {!orderBookExists && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-primary" />
                  <span>No OrderBook for this pair yet — you’ll be prompted to create it on first trade.</span>
                </div>
              )}
            </div>

            {/* Order Type - Buy/Sell */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">Order Type</label>
              <RadioGroup className="h-12 flex items-center">
                <RadioGroupItem 
                  value="BUY" 
                  checked={orderType === 'BUY'} 
                  onChange={onOrderTypeChange}
                  variant="success"
                >
                  Buy
                </RadioGroupItem>
                <RadioGroupItem 
                  value="SELL" 
                  checked={orderType === 'SELL'} 
                  onChange={onOrderTypeChange}
                  variant="danger"
                >
                  Sell
                </RadioGroupItem>
              </RadioGroup>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Order Mode - Limit/Market */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">Order Mode</label>
              <RadioGroup className="h-12 flex items-center">
                <RadioGroupItem 
                  value="LIMIT" 
                  checked={orderMode === 'LIMIT'} 
                  onChange={onOrderModeChange}
                  variant="default"
                >
                  Limit
                </RadioGroupItem>
                <RadioGroupItem 
                  value="MARKET" 
                  checked={orderMode === 'MARKET'} 
                  onChange={onOrderModeChange}
                  variant="default"
                >
                  Market
                </RadioGroupItem>
              </RadioGroup>
            </div>

            {/* Price */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                Price {orderMode === 'MARKET' && <span className="text-muted-foreground text-xs">(Market)</span>}
              </label>
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => onPriceChange(e.target.value)}
                disabled={orderMode === 'MARKET'}
                placeholder={orderMode === 'MARKET' ? 'Market price' : 'Enter price'}
              />
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">Quantity</label>
            <Input
              type="number"
              step="0.00000001"
              value={quantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              placeholder="Enter quantity"
              required
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={loading}
            variant={orderType === 'BUY' ? 'success' : 'danger'}
            className="w-full h-12 font-semibold text-base"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                Placing Order...
              </span>
            ) : (
              `${orderType} ${tradingPair.split('/')[0]}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
