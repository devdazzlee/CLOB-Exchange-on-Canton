/**
 * Onboarding Routes
 * External party onboarding endpoints
 */

const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboardingController');

// Debug middleware
router.use((req, res, next) => {
  console.log(`[OnboardingRoutes] ${req.method} ${req.path}`);
  next();
});

// POST /api/onboarding/allocate-party - 2-step allocate (topology + allocate)
router.post('/allocate-party', onboardingController.allocateParty);

// POST /api/onboarding/ensure-rights - NO-OP verification
router.post('/ensure-rights', onboardingController.ensureRights);

// POST /api/onboarding/create-preapproval - Optional, not required
router.post('/create-preapproval', onboardingController.createPreapproval);

// GET /api/onboarding/discover-synchronizer - Get synchronizerId
router.get('/discover-synchronizer', onboardingController.discoverSynchronizer);

module.exports = router;
