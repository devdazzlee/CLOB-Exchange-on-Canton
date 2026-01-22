/**
 * Discovery Routes
 * Endpoints for discovering templates and choices from installed packages
 */

import { Router, Request, Response } from 'express';
import { PackageDiscoveryService } from '../services/package-discovery';

const router = Router();
const discoveryService = new PackageDiscoveryService();

/**
 * GET /discovery/packages
 * List installed packages
 */
router.get('/packages', async (req: Request, res: Response) => {
  try {
    const packages = await discoveryService.getInstalledPackages();
    res.json({ packages });
  } catch (error: any) {
    console.error('Error getting packages:', error);
    res.status(500).json({ error: error.message || 'Failed to get packages' });
  }
});

/**
 * GET /discovery/template/:module/:entity
 * Find template by module and entity name
 */
router.get('/template/:module/:entity', async (req: Request, res: Response) => {
  try {
    const { module, entity } = req.params;
    const template = await discoveryService.findTemplate(module, entity);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(template);
  } catch (error: any) {
    console.error('Error finding template:', error);
    res.status(500).json({ error: error.message || 'Failed to find template' });
  }
});

/**
 * GET /discovery/external-party
 * Find ExternalParty template
 */
router.get('/external-party', async (req: Request, res: Response) => {
  try {
    const template = await discoveryService.findExternalPartyTemplate();
    
    if (!template) {
      return res.status(404).json({ error: 'ExternalParty template not found' });
    }
    
    res.json(template);
  } catch (error: any) {
    console.error('Error finding ExternalParty template:', error);
    res.status(500).json({ error: error.message || 'Failed to find template' });
  }
});

/**
 * GET /discovery/transfer-preapproval
 * Find TransferPreapproval template
 */
router.get('/transfer-preapproval', async (req: Request, res: Response) => {
  try {
    const template = await discoveryService.findTransferPreapprovalTemplate();
    
    if (!template) {
      return res.status(404).json({ error: 'TransferPreapproval template not found' });
    }
    
    res.json(template);
  } catch (error: any) {
    console.error('Error finding TransferPreapproval template:', error);
    res.status(500).json({ error: error.message || 'Failed to find template' });
  }
});

export default router;
