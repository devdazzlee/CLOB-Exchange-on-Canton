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
import { apiClient } from '../../config/config';
import { loadWallet, decryptPrivateKey, signMessage } from '../../wallet/keyManager';
import websocketService from '../../services/websocketService';

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
      toast.error(`Failed to accept: ${err.message?.substring(0, 100)}`);
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
    <Card className="bg-gradient-to-br from-card to-background border-2 border-border shadow-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold flex items-center space-x-2">
            <Gift className="w-5 h-5 text-primary" />
            <span>Incoming Transfers</span>
            {offers.length > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
                {offers.length}
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchOffers}
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
        <p className="text-xs text-muted-foreground mt-1">
          Accept incoming token transfers (2-step transfers)
        </p>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        
        {loading && offers.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : offers.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No pending transfers</p>
            <p className="text-xs mt-1">
              Request tokens from{' '}
              <a 
                href="https://cbtc-faucet.bitsafe.finance/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                CBTC Faucet <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {offers.map((offer, index) => {
              const info = getTokenInfo(offer.token);
              const isAccepting = accepting === offer.contractId;
              
              return (
                <motion.div
                  key={offer.contractId}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 100 }}
                  transition={{ delay: index * 0.05 }}
                  className={`relative overflow-hidden rounded-xl border-2 ${info.border} ${info.bg} p-4`}
                >
                  <div className="flex items-center justify-between">
                    {/* Token info */}
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg ${info.bg} flex items-center justify-center border ${info.border}`}>
                        <span className={`text-xl font-bold ${info.color}`}>{info.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">
                            {parseFloat(offer.amount).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 8
                            })}
                          </span>
                          <span className={`font-medium ${info.color}`}>{offer.token}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <ArrowDownToLine className="w-3 h-3" />
                          <span>From: {offer.sender?.substring(0, 20)}...</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Accept button */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-8 px-3 bg-primary hover:bg-primary/90"
                        onClick={() => handleAccept(offer)}
                        disabled={isAccepting}
                      >
                        {isAccepting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="w-4 h-4 mr-1" />
                            Accept
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Splice badge */}
                  {offer.isSplice && (
                    <div className="absolute top-2 right-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                        Splice
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        
        {/* Help text */}
        <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
          <p>Canton uses 2-step transfers. Click Accept to receive tokens.</p>
        </div>
      </CardContent>

      {/* Interactive Signing Dialog (for external parties) */}
      {signingState && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border-2 border-primary/30 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Sign Transaction</h3>
                <p className="text-xs text-muted-foreground">
                  Unlock your wallet to authorize this transfer
                </p>
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
              <p className="text-sm text-foreground">
                Accept <span className="font-bold">
                  {parseFloat(signingState.offer.amount).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 8
                  })}
                </span>{' '}
                <span className="text-primary font-medium">{signingState.offer.token}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                From: {signingState.offer.sender?.substring(0, 25)}...
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Wallet Password
              </label>
              <input
                type="password"
                value={walletPassword}
                onChange={(e) => setWalletPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSignAndExecute()}
                placeholder="Enter your wallet password"
                autoFocus
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {signingError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{signingError}</span>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={handleCancelSigning}
                disabled={accepting === signingState.offer.contractId}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-primary hover:bg-primary/90"
                onClick={handleSignAndExecute}
                disabled={!walletPassword || accepting === signingState.offer.contractId}
              >
                {accepting === signingState.offer.contractId ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Sign & Accept
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </Card>
  );
}
