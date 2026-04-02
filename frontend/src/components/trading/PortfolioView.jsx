import React from 'react';
import { Wallet, Lock, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || value === '') return '0.00';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const TOKEN_NAMES = {
  BTC: 'Bitcoin',
  USDT: 'Tether',
  ETH: 'Ethereum',
  SOL: 'Solana',
  CBTC: 'Canton BTC',
  CC: 'Canton Coin',
};

export default function PortfolioView({ balance = {}, lockedBalance = {}, loading }) {
  // Combine all tokens to get the full list
  const allTokens = Array.from(new Set([
    ...Object.keys(balance),
    ...Object.keys(lockedBalance || {})
  ])).sort();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#848E9C] py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
        <span className="text-sm font-medium">Loading portfolio data...</span>
      </div>
    );
  }

  if (allTokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#848E9C] py-12">
        <Wallet className="w-12 h-12 mb-4 opacity-20" />
        <span className="text-sm font-medium">No assets found in your portfolio</span>
        <span className="text-xs mt-1">Found assets will appear here.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0E1116]">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b border-[#21262d] bg-[#161b22]/40">
              <th className="px-6 py-3 text-[11px] font-bold text-[#848E9C] uppercase tracking-wider">Asset</th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#848E9C] uppercase tracking-wider text-right">Total Balance</th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#848E9C] uppercase tracking-wider text-right">Available</th>
              <th className="px-6 py-3 text-[11px] font-bold text-[#848E9C] uppercase tracking-wider text-right">In Orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#21262d]/30">
            {allTokens.map((token) => {
              const available = parseFloat(balance[token] || 0);
              const locked = parseFloat((lockedBalance || {})[token] || 0);
              const total = available + locked;
              const decimals = (token === 'BTC' || token === 'ETH' || token === 'CBTC') ? 8 : 2;

              return (
                <tr key={token} className="hover:bg-[#161b22]/60 transition-colors group">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#2B3139]/30 border border-[#2B3139] flex items-center justify-center shrink-0">
                        <span className="text-[14px] font-bold text-[#EAECEF]">{token[0]}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-bold text-white leading-tight">{token}</span>
                        <span className="text-[11px] font-medium text-[#848E9C] leading-tight">{TOKEN_NAMES[token] || token}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <span className="text-[14px] font-mono font-bold text-white">
                      {formatNumber(total, decimals)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <span className="text-[14px] font-mono font-bold text-[#00b07b]">
                      {formatNumber(available, decimals)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {locked > 0 && <Lock className="w-3 h-3 text-[#f84962]/70" />}
                      <span className={cn("text-[14px] font-mono font-bold", locked > 0 ? "text-[#f84962]" : "text-[#848E9C]")}>
                        {formatNumber(locked, decimals)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* Dynamic Summary Footer */}
      <div className="mt-auto px-6 py-3 border-t border-[#21262d] bg-[#161b22]/20 flex items-center justify-between">
         <div className="flex items-center gap-4 text-[12px]">
            <div className="flex items-center gap-1.5">
               <span className="text-[#848E9C]">Assets:</span>
               <span className="text-white font-bold">{allTokens.length}</span>
            </div>
            <div className="h-3 w-px bg-[#21262d]" />
            <div className="flex items-center gap-1.5">
               <span className="text-[#848E9C]">Portfolio Value:</span>
               <span className="text-[#D4AF37] font-bold font-mono">Real-time Valuation Enabled</span>
            </div>
         </div>
         <div className="flex items-center gap-1 text-[11px] text-[#848E9C] hover:text-[#EAECEF] cursor-pointer">
            <Info className="w-3.5 h-3.5" />
            <span>How are balances calculated?</span>
         </div>
      </div>
    </div>
  );
}
