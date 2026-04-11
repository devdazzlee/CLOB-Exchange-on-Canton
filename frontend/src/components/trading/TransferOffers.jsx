/**
 * TransferOffers Component
 * 
 * Displays pending transfer offers (TransferInstructions) for a party.
 * Users can accept or reject incoming token transfers (like CBTC from faucet).
 * 
 * This implements the 2-step transfer flow required by Canton/Splice Token Standard.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowDownToLine, 
  Check, 
  X, 
  RefreshCw, 
  Loader2, 
  Gift,
  ExternalLink,
  AlertCircle,
  Inbox,
  KeyRound
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { cn } from '../../lib/utils';
import { apiClient } from '../../config/config';
import { loadWallet, decryptPrivateKey, signMessage } from '../../wallet/keyManager';
import websocketService from '../../services/websocketService';
import PasswordInput from '../PasswordInput';

export default function TransferOffers({ partyId, onTransferAccepted }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(null); // contractId being accepted
  const [error, setError] = useState(null);
  const toast = useToast();

  // Interactive signing state (for external parties)
  const [signingState, setSigningState] = useState(null); // { offer, preparedTransaction, preparedTransactionHash }
  const [walletPassword, setWalletPassword] = useState('');
  const [signingError, setSigningError] = useState(null);

  // Fetch pending transfer offers (one-time REST, then WebSocket updates)
  const prevCountRef = React.useRef(-1);
  
  const fetchOffers = useCallback(async (isInitial = false) => {
    if (!partyId) return;
    
    if (isInitial) setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.get(`/transfers/offers/${encodeURIComponent(partyId)}`);
      
      if (response.success) {
        const newOffers = response.data?.offers || [];
        setOffers(newOffers);
        if (newOffers.length !== prevCountRef.current) {
          console.log('[TransferOffers] Offers:', newOffers.length);
          prevCountRef.current = newOffers.length;
        }
      } else {
        throw new Error(response.error || 'Failed to fetch offers');
      }
    } catch (err) {
      if (isInitial) console.error('[TransferOffers] Error:', err);
      setError(err.message);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [partyId]);

  // Initial fetch + WebSocket subscription (no polling)
  useEffect(() => {
    fetchOffers(true);

    // Connect WebSocket if not connected
    if (!websocketService.isConnected()) {
      websocketService.connect();
    }

    // WebSocket handler for transfer offer updates
    const onTransferUpdate = (data) => {
      if (data?.type === 'TRANSFER_CREATED') {
        // New transfer offer received — add to list
        if (data.offer) {
          setOffers(prev => {
            const exists = prev.some(o => o.contractId === data.offer.contractId);
            if (exists) return prev;
            return [...prev, data.offer];
          });
        }
      } else if (data?.type === 'TRANSFER_ACCEPTED' || data?.type === 'TRANSFER_REJECTED') {
        // Transfer accepted/rejected — remove from list
        const cid = data.contractId || data.offer?.contractId;
        if (cid) {
          setOffers(prev => prev.filter(o => o.contractId !== cid));
        }
      } else if (data?.type === 'TRANSFERS_SNAPSHOT' && Array.isArray(data.offers)) {
        // Full snapshot pushed by backend
        setOffers(data.offers);
      }
    };

    websocketService.subscribe(`transfers:${partyId}`, onTransferUpdate);

    // No polling — all subsequent updates come via WebSocket

    return () => {
      websocketService.unsubscribe(`transfers:${partyId}`, onTransferUpdate);
    };
  }, [fetchOffers, partyId]);

  // Accept a transfer offer (2-step interactive signing for external parties)
  const handleAccept = async (offer) => {
    if (accepting) return;
    
    setAccepting(offer.contractId);
    setSigningError(null);
    
    try {
      console.log('[TransferOffers] Accepting offer:', offer.contractId.substring(0, 30));
      
      // Step 1: Call backend to prepare or directly accept
      const response = await apiClient.post('/transfers/accept', {
        offerContractId: offer.contractId,
        partyId: partyId,
        templateId: offer.templateId,
        registrarParty: offer.registrarParty,
      });
      
      if (response.success) {
        const data = response.data;
        
        // Check if this is an external party requiring interactive signing
        if (data.requiresSignature) {
          console.log('[TransferOffers] External party — interactive signing required');
          console.log('[TransferOffers] Hash to sign:', data.preparedTransactionHash?.substring(0, 40) + '...');
          
          // Show signing dialog (include hashingSchemeVersion for execute step)
          setSigningState({
            offer,
            preparedTransaction: data.preparedTransaction,
            preparedTransactionHash: data.preparedTransactionHash,
            hashingSchemeVersion: data.hashingSchemeVersion,
          });
          setAccepting(null); // Release accepting lock while waiting for password
          return;
        }
        
        // Internal party: accepted directly
        toast.success(`Accepted ${offer.amount} ${offer.token} transfer!`);
        setOffers(prev => prev.filter(o => o.contractId !== offer.contractId));
        if (onTransferAccepted) onTransferAccepted(offer);
      } else {
        throw new Error(response.error || 'Failed to accept transfer');
      }
    } catch (err) {
      console.error('[TransferOffers] Accept error:', err);
      const msg = err.message || '';
      if (msg.includes('no longer exists') || msg.includes('archived') || msg.includes('expired') || msg.includes('CONTRACT_NOT_FOUND') || msg.includes('not found')) {
        setOffers(prev => prev.filter(o => o.contractId !== offer.contractId));
        toast.info('Transfer already processed or expired — removed from list.');
      } else {
        toast.error(`Failed to accept: ${msg.substring(0, 100)}`);
      }
    } finally {
      setAccepting(null);
    }
  };

  // Step 2: Sign the prepared transaction hash and execute
  const handleSignAndExecute = async () => {
    if (!signingState || !walletPassword) return;
    
    const { offer, preparedTransaction, preparedTransactionHash, hashingSchemeVersion } = signingState;
    setAccepting(offer.contractId);
    setSigningError(null);
    
    try {
      // 1. Load wallet and decrypt private key
      const wallet = loadWallet();
      if (!wallet) throw new Error('Wallet not found. Please create/import wallet again.');
      
      const privateKey = await decryptPrivateKey(wallet.encryptedPrivateKey, walletPassword);
      console.log('[TransferOffers] Wallet unlocked, signing transaction hash...');
      
      // 2. Sign the prepared transaction hash (it's a base64-encoded hash from Canton)
      const signatureBase64 = await signMessage(privateKey, preparedTransactionHash);
      console.log('[TransferOffers] Transaction signed, executing...');
      
      // 3. Get the public key fingerprint
      // Canton partyId format is "partyHint::publicKeyFingerprint"
      // so we can extract it directly from the partyId — no localStorage needed
      const signedBy = localStorage.getItem('canton_key_fingerprint')
        || (partyId && partyId.includes('::') ? partyId.split('::')[1] : null);
      if (!signedBy) {
        throw new Error('Public key fingerprint not found. Please re-onboard your wallet.');
      }
      console.log('[TransferOffers] Using signedBy fingerprint:', signedBy.substring(0, 20) + '...');
      
      // 4. Call backend to execute the signed transaction
      const response = await apiClient.post('/transfers/execute-accept', {
        preparedTransaction,
        partyId,
        signatureBase64,
        signedBy,
        hashingSchemeVersion,
      });
      
      if (response.success) {
        toast.success(`Accepted ${offer.amount} ${offer.token} transfer!`);
        setOffers(prev => prev.filter(o => o.contractId !== offer.contractId));
        setSigningState(null);
        setWalletPassword('');
        if (onTransferAccepted) onTransferAccepted(offer);
      } else {
        throw new Error(response.error || 'Failed to execute transfer');
      }
    } catch (err) {
      console.error('[TransferOffers] Sign & execute error:', err);
      if (err.message.includes('decrypt') || err.message.includes('password')) {
        setSigningError('Incorrect wallet password. Please try again.');
      } else {
        setSigningError(err.message?.substring(0, 150));
      }
    } finally {
      setAccepting(null);
    }
  };

  // Cancel interactive signing
  const handleCancelSigning = () => {
    setSigningState(null);
    setWalletPassword('');
    setSigningError(null);
  };

  // Token symbols and colors
  const tokenInfo = {
    'CBTC': { icon: '₿', color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
    'CC': { icon: 'C', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    'Amulet': { icon: 'A', color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
    'USDT': { icon: '$', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' },
    'BTC': { icon: '₿', color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  };

  const getTokenInfo = (symbol) => tokenInfo[symbol] || { 
    icon: '?', 
    color: 'text-gray-400', 
    bg: 'bg-gray-500/10', 
    border: 'border-gray-500/30' 
  };

  return (
    <div className="bg-card h-full flex flex-col">
      {/* Content */}
      <div className="p-2 space-y-2 overflow-y-auto flex-1">
        {error && (
          <div className="flex items-center gap-2 p-2 mb-2 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive animate-in fade-in slide-in-from-top-1">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">{error.substring(0, 80)}</span>
          </div>
        )}

        {loading && offers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-[#F7B500]" />
            <p className="text-[9px] text-[#848E9C] font-black uppercase tracking-widest">Scanning...</p>
          </div>
        ) : offers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 lg:py-6 px-6 text-center h-full lg:h-auto">
            {/* Empty State — scales up on mobile (full screen), compact on desktop sidebar */}
            <div className="relative mb-5 lg:mb-3">
              <div className="absolute inset-0 bg-[#F7B500]/10 blur-2xl rounded-full animate-pulse" />
              <div className="relative w-20 h-20 lg:w-12 lg:h-12 bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-3xl lg:rounded-2xl flex items-center justify-center shadow-xl overflow-hidden">
                <Inbox className="w-10 h-10 lg:w-6 lg:h-6 text-[#F7B500] drop-shadow-[0_0_10px_rgba(247,181,0,0.3)]" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 lg:w-5 lg:h-5 bg-[#0d1117] border border-[#30363d] rounded-full flex items-center justify-center shadow-md">
                <ArrowDownToLine className="w-3.5 h-3.5 lg:w-2.5 lg:h-2.5 text-[#F7B500]" />
              </div>
            </div>

            <h3 className="text-base lg:text-[11px] font-black text-white uppercase tracking-[2px] mb-2 lg:mb-1">No Transfers</h3>
            <p className="text-xs lg:text-[9px] text-[#848E9C] font-bold leading-relaxed mb-8 lg:mb-4 uppercase tracking-widest">
              Ledger is Clear
            </p>

            {/* Faucet CTA — larger on mobile */}
            <a
              href="https://cbtc-faucet.bitsafe.finance/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative w-full max-w-xs lg:max-w-none p-5 lg:p-2.5 bg-[#161b22] border border-[#30363d] rounded-2xl lg:rounded-xl transition-all duration-300 hover:border-[#F7B500]/40 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-[#F7B500]/0 via-[#F7B500]/5 to-[#F7B500]/0 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4 lg:gap-2">
                  <div className="w-12 h-12 lg:w-8 lg:h-8 bg-[#F7B500]/10 border border-[#F7B500]/20 rounded-xl lg:rounded-lg flex items-center justify-center">
                    <Gift className="w-6 h-6 lg:w-4 lg:h-4 text-[#F7B500]" />
                  </div>
                  <div className="text-left leading-none">
                    <p className="text-sm lg:text-[9px] text-white font-black uppercase tracking-widest">Faucet</p>
                    <p className="text-xs lg:text-[8px] text-[#F7B500]/70 font-bold uppercase tracking-tight mt-1 lg:mt-0.5">Get Test Tokens</p>
                  </div>
                </div>
                <ExternalLink className="w-5 h-5 lg:w-3 lg:h-3 text-[#848E9C] group-hover:text-[#F7B500] transition-colors" />
              </div>
            </a>
          </div>
        ) : (
          <div className="space-y-2.5">
            <AnimatePresence>
              {offers.map((offer) => {
                const info = getTokenInfo(offer.token);
                const isAccepting = accepting === offer.contractId;
                return (
                  <motion.div
                    key={offer.contractId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex items-center justify-between p-4 lg:p-3 bg-[#161b22] border border-border/50 rounded-2xl hover:border-primary/30 transition-all group"
                  >
                    <div className="flex items-center gap-4 lg:gap-3 min-w-0">
                      <div className={cn("w-14 h-14 lg:w-10 lg:h-10 rounded-2xl lg:rounded-xl flex items-center justify-center text-2xl lg:text-lg font-bold shadow-inner flex-shrink-0", info.bg)}>
                        <span className={info.color}>{info.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-base lg:text-sm font-bold text-white leading-tight">
                          {parseFloat(offer.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          <span className="text-xs lg:text-[10px] text-muted-foreground ml-1.5 font-normal tracking-wide uppercase">{offer.token}</span>
                        </div>
                        <div className="text-xs lg:text-[10px] text-muted-foreground truncate font-mono mt-1">
                          from {offer.sender?.substring(0, 14)}...
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAccept(offer)}
                      disabled={isAccepting}
                      className={cn(
                        "flex-shrink-0 flex items-center justify-center h-12 w-12 lg:h-10 lg:w-10 lg:w-auto lg:px-4 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all",
                        isAccepting
                          ? "bg-muted cursor-not-allowed text-muted-foreground"
                          : "bg-success/10 text-success border border-success/20 hover:bg-success hover:text-white"
                      )}
                    >
                      {isAccepting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Check className="w-5 h-5 lg:w-4 lg:h-4 lg:mr-1.5" /><span className="hidden lg:inline">Accept</span></>}
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

          {/* Interactive Signing Dialog - Professional Standardized Modal */}
      {signingState && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-xl flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-[#161b22] border border-[#30363d] rounded-[2.5rem] p-8 max-w-sm w-full mx-4 shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden relative"
          >
            {/* Background Glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#F7B500]/10 blur-[80px] rounded-full" />
            
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-[#F7B500]/10 border border-[#F7B500]/20 rounded-2xl flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-[#F7B500]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-[1px]">Authorize Transfer</h3>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">Secure Transaction Signature</p>
                </div>
              </div>

              <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-2xl mb-6 group">
                <p className="text-[9px] text-[#848E9C] font-black uppercase tracking-widest mb-1 group-hover:text-[#F7B500] transition-colors">Amount to Receive</p>
                <div className="text-xl font-mono font-bold text-white tracking-tight flex items-baseline gap-2">
                  {parseFloat(signingState.offer.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                  <span className="text-xs text-[#F7B500] uppercase">{signingState.offer.token}</span>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-[10px] text-[#848E9C] font-black uppercase tracking-widest mb-2 ml-1">Wallet Password</label>
                  <PasswordInput
                    value={walletPassword}
                    onChange={(e) => setWalletPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSignAndExecute()}
                    placeholder="ENTER PASSWORD"
                    autoFocus
                    className="w-full px-4 py-3 rounded-2xl bg-[#0d1117] border border-[#30363d] text-white text-sm outline-none focus:border-[#F7B500]/50 transition-all font-mono"
                  />
                </div>
                
                {signingError && (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 bg-red-900/10 border border-red-500/20 rounded-xl text-[10px] text-red-500 font-bold uppercase tracking-wider flex items-center gap-2"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    {signingError}
                  </motion.div>
                )}
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={handleCancelSigning} 
                  disabled={accepting === signingState.offer.contractId}
                  className="flex-1 py-3.5 text-[10px] font-black uppercase tracking-[2px] border border-[#30363d] rounded-2xl text-[#848E9C] hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignAndExecute}
                  disabled={!walletPassword || accepting === signingState.offer.contractId}
                  className="flex-[1.5] py-3.5 text-[10px] font-black uppercase tracking-[2px] bg-[#F7B500] hover:bg-[#ffc107] text-[#0d1117] rounded-2xl transition-all disabled:opacity-30 disabled:grayscale flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(247,181,0,0.2)]"
                >
                  {accepting === signingState.offer.contractId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[3px]" />
                      Sign & Execute
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
