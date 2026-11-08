import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ipn, paymentReturn } from '../controllers/vnpay.controller.js';
const router = Router();
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
router.get('/vnpay/ipn', limiter, ipn);
router.get('/vnpay/return', limiter, paymentReturn);
export default router;
