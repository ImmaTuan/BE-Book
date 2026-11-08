import { Router } from 'express';
import { showDashboard } from '../controllers/dashboard.controller.js';
const router = Router();
router.get('/', showDashboard);
export default router;
