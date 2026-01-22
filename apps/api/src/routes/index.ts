import { Router } from 'express';
import onboardingRoutes from './onboarding';
import discoveryRoutes from './discovery';
import faucetRoutes from './faucet';
import orderRoutes from './orders';
import balanceRoutes from './balances';

const router = Router();

router.use('/onboarding', onboardingRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/faucet', faucetRoutes);
router.use('/orders', orderRoutes);
router.use('/balances', balanceRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

export default router;
