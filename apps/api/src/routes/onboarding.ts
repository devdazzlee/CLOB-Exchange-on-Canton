/**
 * Onboarding Routes
 * Handles wallet creation, party allocation, and preapproval setup
 */

import { Router, Request, Response } from 'express';
import { OnboardingService } from '../services/onboarding';

const router = Router();
const onboardingService = new OnboardingService();

/**
 * POST /onboarding/allocate-party
 * Allocate external party for user (2-step flow)
 * Step 1: Generate topology (returns multiHash to sign)
 * Step 2: If signature provided, completes allocation
 */
router.post('/allocate-party', async (req: Request, res: Response) => {
  try {
    const { 
      publicKey, 
      partyHint, 
      signature, 
      onboardingTransactions, 
      topologyTransactions, // Accept Canton's actual field name
      partyId // Accept partyId from Step 1 if provided
    } = req.body;

    // Validate publicKey always required (must be base64 string, not object)
    if (!publicKey) {
      return res.status(400).json({ error: 'publicKey is required (base64 string)' });
    }

    // Ensure publicKey is a string, not an object
    if (typeof publicKey !== 'string') {
      return res.status(400).json({ 
        error: 'publicKey must be a base64 string, not an object',
        hint: 'Send publicKey as base64 string. Backend will construct the publicKey object internally.'
      });
    }

    // Step 2 validation: If signature is provided, require transactions
    if (signature) {
      const hasTransactions = 
        (onboardingTransactions && Array.isArray(onboardingTransactions) && onboardingTransactions.length > 0) ||
        (topologyTransactions && Array.isArray(topologyTransactions) && topologyTransactions.length > 0);
      
      if (!hasTransactions) {
        return res.status(400).json({ 
          error: 'onboardingTransactions or topologyTransactions is required when signature is provided',
          hint: 'This is Step 2. You must provide the transactions from Step 1 response.'
        });
      }
    }

    // partyHint is optional - trim if provided, backend will derive if missing/empty
    const trimmedPartyHint = partyHint ? String(partyHint).trim() : undefined;

    const result = await onboardingService.allocateExternalParty({
      publicKey, // base64 string - backend will construct publicKey object
      partyHint: trimmedPartyHint,
      signature, // Optional - if provided, completes allocation (step 2)
      onboardingTransactions, // Accept alias
      topologyTransactions, // Accept Canton's actual field name
      partyId, // Pass through if provided (informational only, not sent to Canton)
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error allocating party:', error);
    
    // Provide more detailed error messages
    const errorMessage = error.message || 'Failed to allocate party';
    
    // Check if it's an OAuth error
    if (errorMessage.includes('OAuth') || errorMessage.includes('token') || errorMessage.includes('URL') || errorMessage.includes('Missing env')) {
      console.error('OAuth configuration error. Check your .env file:');
      console.error('  - CANTON_OAUTH_TOKEN_URL must be set and valid');
      console.error('  - CANTON_OAUTH_CLIENT_ID must be set');
      console.error('  - CANTON_OAUTH_CLIENT_SECRET must be set');
      console.error('  - Ensure no quotes (smart or normal) in URL');
    }
    
    // Log response data if available
    if (error.response?.data) {
      console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
    }
    
    // Include upstream API error details for better debugging
    const apiError = error.response?.data;
    const upstreamError = apiError 
      ? (typeof apiError === 'string' ? apiError : JSON.stringify(apiError))
      : undefined;
    
    res.status(500).json({ 
      error: errorMessage,
      cause: upstreamError, // Surface upstream API error
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      apiError: apiError,
    });
  }
});

/**
 * POST /onboarding/complete-allocation
 * Complete external party allocation (Step 2)
 * Called after frontend signs the multiHash
 */
router.post('/complete-allocation', async (req: Request, res: Response) => {
  try {
    const { onboardingTransactions, multiHash, signature, publicKey, partyHint } = req.body;

    if (!onboardingTransactions || !multiHash || !signature || !publicKey) {
      return res.status(400).json({ 
        error: 'onboardingTransactions, multiHash, signature, and publicKey are required' 
      });
    }

    const result = await onboardingService.completeExternalPartyAllocation(
      onboardingTransactions,
      multiHash,
      signature,
      publicKey,
      partyHint // Optional: party hint from step 1
    );

    res.json(result);
  } catch (error: any) {
    console.error('Error completing party allocation:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to complete party allocation',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      apiError: error.response?.data,
    });
  }
});

/**
 * POST /onboarding/create-preapproval
 * Create transfer preapproval (idempotent)
 */
router.post('/create-preapproval', async (req: Request, res: Response) => {
  try {
    // Accept party from req.body.party OR req.body.partyId (alias)
    const party = req.body.party || req.body.partyId;

    // Party is optional - if missing, skip (don't block onboarding)
    if (!party) {
      return res.json({ 
        success: true, 
        message: 'No party provided; skipping preapproval creation. Note: partyId only exists after Step 2 (allocation).' 
      });
    }

    await onboardingService.createTransferPreapproval(party);

    res.json({ success: true, message: 'Transfer preapproval created or already exists' });
  } catch (error: any) {
    console.error('Error creating preapproval:', error);
    // Don't fail onboarding if preapproval fails
    res.json({ 
      success: true, 
      message: 'Preapproval creation skipped (not yet implemented or error occurred)' 
    });
  }
});

/**
 * POST /onboarding/ensure-rights
 * Ensure user has necessary rights (idempotent check)
 * Party is optional - if missing, returns success (no-op)
 */
router.post('/ensure-rights', async (req: Request, res: Response) => {
  try {
    // Accept party from req.body.party OR req.body.partyId (alias)
    const party = req.body.party || req.body.partyId;

    // Party is optional - if missing, skip verification (don't block onboarding)
    if (!party) {
      return res.json({ 
        success: true, 
        message: 'No party provided; skipping rights verification. Note: partyId only exists after Step 2 (allocation).' 
      });
    }

    await onboardingService.ensureUserRights(party);

    res.json({ success: true, message: 'Rights verified' });
  } catch (error: any) {
    console.error('Error ensuring rights:', error);
    res.status(500).json({ error: error.message || 'Failed to ensure rights' });
  }
});

/**
 * GET /onboarding/synchronizers
 * Debug endpoint: Returns list of connected synchronizers
 * Useful for verifying environment and finding synchronizer IDs
 */
router.get('/synchronizers', async (req: Request, res: Response) => {
  try {
    const synchronizers = await onboardingService.getConnectedSynchronizers();
    
    // Return sanitized data (no secrets)
    res.json({
      connectedSynchronizers: synchronizers.connectedSynchronizers || [],
      count: synchronizers.connectedSynchronizers?.length || 0,
    });
  } catch (error: any) {
    console.error('Error fetching synchronizers:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch synchronizers',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

export default router;
