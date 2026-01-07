import { motion } from 'framer-motion';
import { Wallet, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export default function BalanceCard({ balance, loading, onRefresh }) {
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
        {/* BTC Balance */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="relative overflow-hidden bg-card border-2 border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-lg transition-all group"
        >
          <div className="absolute top-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl"></div>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center border border-primary/40">
                <span className="text-2xl font-bold text-primary">₿</span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Bitcoin</div>
                <div className="text-sm text-foreground font-medium">BTC</div>
              </div>
            </div>
            <div className="text-right">
              {loading ? (
                <div className="animate-pulse bg-muted h-6 w-24 rounded"></div>
              ) : (
                <div className="text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                  {parseFloat(balance.BTC).toLocaleString(undefined, { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 8 
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
        
        {/* USDT Balance */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="relative overflow-hidden bg-card border-2 border-border rounded-xl p-5 hover:border-success/40 hover:shadow-lg transition-all group"
        >
          <div className="absolute top-0 right-0 w-20 h-20 bg-success/10 rounded-full blur-2xl"></div>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-success/20 rounded-lg flex items-center justify-center border border-success/40">
                <span className="text-2xl font-bold text-success">$</span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Tether</div>
                <div className="text-sm text-foreground font-medium">USDT</div>
              </div>
            </div>
            <div className="text-right">
              {loading ? (
                <div className="animate-pulse bg-muted h-6 w-24 rounded"></div>
              ) : (
                <div className="text-2xl font-bold text-success group-hover:text-[#26A17B] transition-colors">
                  {parseFloat(balance.USDT).toLocaleString(undefined, { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
        
        {/* Total Value */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Total Value</span>
            <span className="text-sm font-semibold text-foreground">
              {loading ? (
                <span className="animate-pulse bg-muted h-4 w-16 rounded inline-block"></span>
              ) : (
                `≈ ${parseFloat(balance.USDT).toLocaleString(undefined, { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })} USDT`
              )}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

