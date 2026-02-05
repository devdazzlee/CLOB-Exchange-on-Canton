import { motion } from 'framer-motion';
import { Wallet, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

// Token configuration - add new tokens here
const TOKEN_CONFIG = {
  BTC: { name: 'Bitcoin', symbol: '₿', color: 'text-primary', bgColor: 'bg-primary/20', borderColor: 'border-primary/40', decimals: 8 },
  USDT: { name: 'Tether', symbol: '$', color: 'text-success', bgColor: 'bg-success/20', borderColor: 'border-success/40', decimals: 2 },
  ETH: { name: 'Ethereum', symbol: 'Ξ', color: 'text-[#627EEA]', bgColor: 'bg-[#627EEA]/20', borderColor: 'border-[#627EEA]/40', decimals: 8 },
  SOL: { name: 'Solana', symbol: '◎', color: 'text-[#14F195]', bgColor: 'bg-[#14F195]/20', borderColor: 'border-[#14F195]/40', decimals: 8 },
  CBTC: { name: 'Canton BTC', symbol: '₵', color: 'text-[#F7931A]', bgColor: 'bg-[#F7931A]/20', borderColor: 'border-[#F7931A]/40', decimals: 8 },
  CC: { name: 'Canton Coin', symbol: '◈', color: 'text-[#6366F1]', bgColor: 'bg-[#6366F1]/20', borderColor: 'border-[#6366F1]/40', decimals: 8 },
};

function getTokenConfig(symbol) {
  return TOKEN_CONFIG[symbol] || {
    name: symbol,
    symbol: symbol[0],
    color: 'text-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-border',
    decimals: 8
  };
}

export default function BalanceCard({ balance = {}, loading, onRefresh }) {
  // Get all tokens from balance (dynamic - includes CBTC, CC, etc.)
  const tokens = Object.keys(balance).filter(token => {
    const amount = parseFloat(balance[token] || 0);
    return amount > 0 || TOKEN_CONFIG[token]; // Show tokens with balance OR known tokens
  });

  // Ensure we show at least some common tokens if balance is empty
  if (tokens.length === 0) {
    tokens.push('USDT', 'BTC');
  }

  return (
    <Card className="bg-gradient-to-br from-card to-background border-2 border-border shadow-xl">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold flex items-center space-x-2">
            <Wallet className="w-5 h-5 text-primary" />
            <span>Your Balance</span>
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 w-8"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dynamically render ALL tokens */}
        {tokens.map((token, index) => {
          const config = getTokenConfig(token);
          const amount = parseFloat(balance[token] || 0);
          
          return (
            <motion.div
              key={token}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative overflow-hidden bg-card border-2 border-border rounded-xl p-5 hover:${config.borderColor} hover:shadow-lg transition-all group`}
            >
              <div className={`absolute top-0 right-0 w-20 h-20 ${config.bgColor} rounded-full blur-2xl`}></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-12 h-12 ${config.bgColor} rounded-lg flex items-center justify-center border ${config.borderColor}`}>
                    <span className={`text-2xl font-bold ${config.color}`}>{config.symbol}</span>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{config.name}</div>
                    <div className="text-sm text-foreground font-medium">{token}</div>
                  </div>
                </div>
                <div className="text-right">
                  {loading ? (
                    <div className="animate-pulse bg-muted h-6 w-24 rounded"></div>
                  ) : (
                    <div className={`text-2xl font-bold text-foreground group-hover:${config.color} transition-colors`}>
                      {amount.toLocaleString(undefined, { 
                        minimumFractionDigits: 2, 
                        maximumFractionDigits: config.decimals 
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
        
        {/* Show message if no tokens */}
        {tokens.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No tokens found</p>
            <p className="text-xs mt-2">Use "Get Test Funds" to mint tokens</p>
          </div>
        )}
        
        {/* Total Value - only if we have USDT equivalent */}
        {tokens.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Tokens</span>
              <span className="text-sm font-semibold text-foreground">
                {tokens.length} asset{tokens.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
