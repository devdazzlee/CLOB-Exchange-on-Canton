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
  Inbox
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { apiClient } from '../../config/config';

export default function TransferOffers({ partyId, onTransferAccepted }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(null); // contractId being accepted
  const [error, setError] = useState(null);
  const toast = useToast();

  // Fetch pending transfer offers
  const fetchOffers = useCallback(async () => {
    if (!partyId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('[TransferOffers] Fetching offers for:', partyId.substring(0, 30));
      const response = await apiClient.get(`/transfers/offers/${encodeURIComponent(partyId)}`);
      
      if (response.success) {
        setOffers(response.data?.offers || []);
        console.log('[TransferOffers] Found', response.data?.offerCount, 'offers');
      } else {
        throw new Error(response.error || 'Failed to fetch offers');
      }
    } catch (err) {
      console.error('[TransferOffers] Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  // Initial fetch
  useEffect(() => {
    fetchOffers();
    
    // Poll every 30 seconds for new offers
    const interval = setInterval(fetchOffers, 30000);
    return () => clearInterval(interval);
  }, [fetchOffers]);

  // Accept a transfer offer
  const handleAccept = async (offer) => {
    if (accepting) return;
    
    setAccepting(offer.contractId);
    
    try {
      console.log('[TransferOffers] Accepting offer:', offer.contractId.substring(0, 30));
      
      const response = await apiClient.post('/transfers/accept', {
        offerContractId: offer.contractId,
        partyId: partyId,
        templateId: offer.templateId,
      });
      
      if (response.success) {
        toast.success(`Accepted ${offer.amount} ${offer.token} transfer!`);
        
        // Remove from list
        setOffers(prev => prev.filter(o => o.contractId !== offer.contractId));
        
        // Notify parent to refresh balances
        if (onTransferAccepted) {
          onTransferAccepted(offer);
        }
      } else {
        // Check if it needs to be done through Utilities UI
        if (response.error?.includes('Utilities UI') || response.error?.includes('utilities.dev.canton')) {
          toast.warning(
            `Splice transfers require additional credentials. Please accept via WolfEdge Utilities UI.`,
            { duration: 8000 }
          );
          // Open the utilities UI in a new tab
          window.open('https://utilities.dev.canton.wolfedgelabs.com/', '_blank');
        } else {
          throw new Error(response.error || 'Failed to accept transfer');
        }
      }
    } catch (err) {
      console.error('[TransferOffers] Accept error:', err);
      
      // Check for Splice-specific errors
      if (err.message?.includes('Utilities UI') || err.message?.includes('disclosedContracts')) {
        toast.warning(
          `This transfer requires accepting through the WolfEdge Utilities UI.`,
          { duration: 8000 }
        );
        window.open('https://utilities.dev.canton.wolfedgelabs.com/', '_blank');
      } else {
        toast.error(`Failed to accept: ${err.message?.substring(0, 100)}`);
      }
    } finally {
      setAccepting(null);
    }
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
                    
                    {/* Accept via Utilities UI */}
                    <div className="flex items-center gap-2">
                      {offer.isSplice ? (
                        // Splice transfers require Utilities UI
                        <a
                          href="https://utilities.dev.canton.wolfedgelabs.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Accept in Utilities
                        </a>
                      ) : (
                        // Non-Splice transfers can be accepted directly
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 hover:bg-destructive/20 hover:text-destructive"
                            disabled={isAccepting}
                            title="Reject"
                          >
                            <X className="w-4 h-4" />
                          </Button>
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
                        </>
                      )}
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
          <p>Canton uses 2-step transfers. Accept offers to receive tokens.</p>
          {offers.some(o => o.isSplice) && (
            <p className="mt-1 text-yellow-500">
              💡 CBTC/Splice transfers must be accepted via{' '}
              <a 
                href="https://utilities.dev.canton.wolfedgelabs.com/" 
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-yellow-400"
              >
                WolfEdge Utilities
              </a>
              {' '}(Registry → Transfers)
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
