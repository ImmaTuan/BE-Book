import { Router } from 'express';
import * as controller from '../controllers/order.controller.js';

const router = Router();

router.post('/quote', controller.quoteOwnOrder);
router.get('/', controller.listOwnOrders);
router.post('/', controller.createOwnOrder);
router.get('/:id', controller.getOwnOrder);

export default router;
