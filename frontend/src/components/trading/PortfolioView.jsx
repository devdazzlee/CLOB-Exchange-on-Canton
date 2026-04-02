import React from 'react';
import { Wallet, Lock, Info, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || value === '') return '0.00';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#626AEB] mb-4" />
        <span className="text-sm font-medium">Loading portfolio data...</span>
      </div>
    );
  }

  if (allTokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#848E9C] py-12 px-6 text-center">
        <Wallet className="w-12 h-12 mb-4 opacity-20" />
        <span className="text-sm font-bold text-white">No assets found</span>
        <span className="text-xs mt-1 text-[#848E9C]">Your holdings will automatically appear here once updated.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0E1116]">
      {/* DESKTOP TABLE VIEW (Visible on medium screens and larger) */}
      <div className="hidden md:block overflow-x-auto">
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

      {/* MOBILE CARD VIEW (Visible on small screens) */}
      <div className="md:hidden flex flex-col divide-y divide-[#21262d]/40">
        {allTokens.map((token) => {
          const available = parseFloat(balance[token] || 0);
          const locked = parseFloat((lockedBalance || {})[token] || 0);
          const total = available + locked;
          const decimals = (token === 'BTC' || token === 'ETH' || token === 'CBTC') ? 8 : 2;

          return (
            <div key={token} className="p-4 flex flex-col gap-3 active:bg-[#161b22]/40 transition-colors">
              {/* Top Row: Asset & Total */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#2B3139]/40 border border-[#2B3139] flex items-center justify-center shrink-0">
                    <span className="text-[15px] font-bold text-white">{token[0]}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[15px] font-bold text-white leading-tight">{token}</span>
                    <span className="text-[11px] font-medium text-[#848E9C] leading-tight">{TOKEN_NAMES[token] || token}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[16px] font-mono font-bold text-white">{formatNumber(total, decimals)}</span>
                  <span className="text-[11px] font-medium text-[#848E9C] uppercase tracking-wider">Total balance</span>
                </div>
              </div>

              {/* Bottom Row: Available & Locked */}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 bg-[#161b22]/40 border border-[#21262d]/60 rounded-md p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-[#848E9C] uppercase tracking-wide">Available</span>
                  <span className="text-[13px] font-mono font-bold text-[#00b07b]">{formatNumber(available, decimals)}</span>
                </div>
                <div className="flex-1 bg-[#161b22]/40 border border-[#21262d]/60 rounded-md p-2.5 flex flex-col gap-0.5">
                   <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold text-[#848E9C] uppercase tracking-wide">In Orders</span>
                      {locked > 0 && <Lock className="w-2.5 h-2.5 text-[#f84962]/70" />}
                   </div>
                  <span className={cn("text-[13px] font-mono font-bold text-[#f84962]", locked === 0 && "text-[#848E9C]/60")}>
                    {formatNumber(locked, decimals)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Portfolio Summary Footer (Responsive Padding) */}
      <div className="mt-auto px-4 md:px-6 py-3.5 border-t border-[#21262d] bg-[#161b22]/20 flex items-center justify-between">
         <div className="flex items-center gap-3 md:gap-4 text-[12px]">
            <div className="flex items-center gap-1.5">
               <span className="text-[#848E9C]">Assets:</span>
               <span className="text-white font-bold">{allTokens.length}</span>
            </div>
            <div className="h-3 w-px bg-[#21262d]" />
            <div className="flex items-center gap-1.5">
               <span className="text-[#848E9C] hidden sm:inline">Portfolio:</span>
               <span className="text-[#D4AF37] font-bold font-mono">Live Valuation</span>
            </div>
         </div>
         <div className="flex items-center gap-1 text-[11px] text-[#848E9C] hover:text-[#EAECEF] cursor-pointer">
            <Info className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Details</span>
         </div>
      </div>
    </div>
  );
}
