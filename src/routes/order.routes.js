import { history } from '../controllers/customer-feature.controller.js';
import { createPayment, checkPayment } from '../controllers/vnpay.controller.js';
import { rateLimit } from 'express-rate-limit';
import { Router } from 'express';
import * as controller from '../controllers/order.controller.js';

const router = Router();

const paymentLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
router.post('/:id/payments/vnpay', paymentLimiter, createPayment);
router.post('/:id/payments/vnpay/check', paymentLimiter, checkPayment);
router.post('/quote', controller.quoteOwnOrder);
router.get('/', controller.listOwnOrders);
router.post('/', controller.createOwnOrder);
router.get('/:id/history', history);
router.get('/:id', controller.getOwnOrder);

export default router;
