import { Router } from 'express';
import * as controller from '../controllers/order.controller.js';

const router = Router();

router.get('/', controller.listAllOrders);
router.get('/:id', controller.getOrder);
router.post('/:id/shipment', controller.createShipment);
router.get('/:id/shipment', controller.getShipment);
router.patch('/:id/status', controller.changeOrderStatus);

export default router;
