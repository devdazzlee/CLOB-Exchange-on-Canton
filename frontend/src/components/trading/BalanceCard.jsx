import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, RefreshCw, Lock, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';

// Token configuration - add new tokens here
const TOKEN_CONFIG = {
  BTC: { name: 'Bitcoin', symbol: '₿', color: 'text-primary', bgColor: 'bg-primary/20', borderColor: 'border-primary/40', decimals: 8 },
  USDT: { name: 'Tether', symbol: '$', color: 'text-success', bgColor: 'bg-success/20', borderColor: 'border-success/40', decimals: 2 },
  ETH: { name: 'Ethereum', symbol: 'Ξ', color: 'text-[#627EEA]', bgColor: 'bg-[#627EEA]/20', borderColor: 'border-[#627EEA]/40', decimals: 8 },
  SOL: { name: 'Solana', symbol: '◎', color: 'text-[#14F195]', bgColor: 'bg-[#14F195]/20', borderColor: 'border-[#14F195]/40', decimals: 8 },
  CBTC: { name: 'Canton BTC', symbol: '₵', color: 'text-[#F7931A]', bgColor: 'bg-[#F7931A]/20', borderColor: 'border-[#F7931A]/40', decimals: 8 },
  CC: { name: 'Canton Coin', symbol: '◈', color: 'text-[#6366F1]', bgColor: 'bg-[#6366F1]/20', borderColor: 'border-[#6366F1]/40', decimals: 8 },
  Amulet: { name: 'Amulet (CC)', symbol: '♦', color: 'text-[#A855F7]', bgColor: 'bg-[#A855F7]/20', borderColor: 'border-[#A855F7]/40', decimals: 10 },
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

export default function BalanceCard({
  partyId,
  balance = {},
  lockedBalance = {},
  loading,
  onRefresh,
  mintingLoading = false,
  onMintToken,
}) {
  const [mintToken, setMintToken] = useState('CC');
  const [mintAmount, setMintAmount] = useState('1');

  // Get all tokens from balance (dynamic - includes CBTC, CC, etc.)
  // Combine available + locked to get full token list
  const allTokens = new Set([
    ...Object.keys(balance),
    ...Object.keys(lockedBalance || {})
  ]);
  
  const tokens = [...allTokens].filter(token => {
    const available = parseFloat(balance[token] || 0);
    const locked = parseFloat((lockedBalance || {})[token] || 0);
    return (available + locked) > 0 || TOKEN_CONFIG[token]; // Show tokens with balance OR known tokens
  });

  // Ensure we show at least some common tokens if balance is empty
  if (tokens.length === 0) {
    tokens.push('USDT', 'BTC');
  }

  const handleMintClick = async () => {
    if (!partyId || !onMintToken) return;

    const amountNum = Number(mintAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) return;

    await onMintToken(mintToken, amountNum);
  };

  return (
    <Card className="bg-gradient-to-br from-card to-background border-2 border-border shadow-xl">
      <CardHeader className="pb-3 sm:pb-4 px-3 sm:px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-xl font-bold flex items-center space-x-2">
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
            <span>Your Balance</span>
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 w-7 sm:h-8 sm:w-8 hover:bg-primary/10 transition-colors"
            title="Refresh balance"
          >
            <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${loading ? 'animate-spin text-primary' : 'text-muted-foreground hover:text-primary'} transition-colors`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4 px-3 sm:px-6">
        {/* Dynamically render ALL tokens */}
        {tokens.map((token, index) => {
          const config = getTokenConfig(token);
          const available = parseFloat(balance[token] || 0);
          const locked = parseFloat((lockedBalance || {})[token] || 0);
          const total = available + locked;
          
          return (
            <motion.div
              key={token}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative overflow-hidden bg-card border-2 border-border rounded-xl p-3 sm:p-5 hover:${config.borderColor} hover:shadow-lg transition-all group`}
            >
              <div className={`absolute top-0 right-0 w-16 h-16 sm:w-20 sm:h-20 ${config.bgColor} rounded-full blur-2xl`}></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <div className={`w-9 h-9 sm:w-12 sm:h-12 ${config.bgColor} rounded-lg flex items-center justify-center border ${config.borderColor} flex-shrink-0`}>
                    <span className={`text-lg sm:text-2xl font-bold ${config.color}`}>{config.symbol}</span>
                  </div>
                  <div>
                    <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide font-semibold">{config.name}</div>
                    <div className="text-xs sm:text-sm text-foreground font-medium">{token}</div>
                  </div>
                </div>
                <div className="text-right min-w-0">
                  {loading ? (
                    <div className="animate-pulse bg-muted h-5 sm:h-6 w-20 sm:w-24 rounded"></div>
                  ) : (
                    <>
                      {/* Available balance (main display) */}
                      <div className={`text-lg sm:text-2xl font-bold text-foreground group-hover:${config.color} transition-colors truncate`}>
                        {available.toLocaleString(undefined, { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: config.decimals 
                        })}
                      </div>
                      {/* Show locked amount if any */}
                      {locked > 0 && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-yellow-500" />
                          <span className="text-[10px] sm:text-xs text-yellow-500/80">
                            {locked.toLocaleString(undefined, { 
                              minimumFractionDigits: 2, 
                              maximumFractionDigits: config.decimals 
                            })} locked
                          </span>
                        </div>
                      )}
                    </>
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
            <p className="text-xs mt-2">No tokens available</p>
          </div>
        )}
        
        {/* Total Value - only if we have tokens */}
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

        {/* UI mint helper for quick manual test minting */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mt-4 pt-4 border-t border-border"
        >
          <div className="relative rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-3 sm:p-4 shadow-lg">
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-primary/20 blur-3xl"
              animate={{ scale: [1, 1.08, 1], opacity: [0.35, 0.6, 0.35] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />

            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-primary/20 p-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-xs text-foreground uppercase tracking-wide font-semibold">
                    Mint Test Token
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={partyId}>
                  {partyId ? `${partyId.slice(0, 16)}...` : 'No party'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Select value={mintToken} onValueChange={setMintToken}>
                  <SelectTrigger
                    className="relative z-20 h-10 rounded-lg border-border/80 bg-background/90 px-3 text-sm shadow-sm"
                    disabled={mintingLoading}
                  >
                    <SelectValue placeholder="Token" />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    <SelectItem value="CC">CC</SelectItem>
                    <SelectItem value="CBTC">CBTC</SelectItem>
                    <SelectItem value="BTC">BTC</SelectItem>
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="SOL">SOL</SelectItem>
                  </SelectContent>
                </Select>

                <input
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  placeholder="Amount"
                  className="h-10 rounded-lg border border-border/80 bg-background/90 px-3 text-sm text-foreground shadow-sm transition-all focus:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={mintingLoading}
                />
              </div>

              <Button
                onClick={handleMintClick}
                disabled={mintingLoading || !partyId || !onMintToken || Number(mintAmount) <= 0}
                className="h-10 w-full border-primary/50 bg-gradient-to-r from-primary/20 to-primary/10 text-foreground hover:from-primary/30 hover:to-primary/20"
                variant="outline"
              >
                {mintingLoading ? 'Minting...' : `Mint ${mintToken}`}
              </Button>
            </div>
          </div>
        </motion.div>
      </CardContent>
    </Card>
  );
}
