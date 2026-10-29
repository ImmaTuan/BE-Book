import { Router } from 'express';
import { receiveOrderStatus } from '../controllers/ghn-webhook.controller.js';

const router = Router();

router.post('/ghn/orders', receiveOrderStatus);

export default router;
