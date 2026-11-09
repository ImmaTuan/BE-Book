import { Router } from 'express';
import * as controller from '../controllers/promotion.controller.js';

const router = Router();
router.get('/products', controller.listProductPromotions);
router.post('/products', controller.createProductPromotion);
router.patch('/products/:id/active', controller.setProductActive);
router.patch('/products/:id', controller.updateProductPromotion);
router.get('/coupons', controller.listCoupons);
router.post('/coupons', controller.createCoupon);
router.patch('/coupons/:id/active', controller.setCouponActive);
router.patch('/coupons/:id', controller.updateCoupon);

export default router;
