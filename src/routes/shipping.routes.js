import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as controller from '../controllers/shipping.controller.js';

const router = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/ghn/provinces', limiter, controller.listGhnProvinces);
router.get('/ghn/provinces/:provinceId/wards', limiter, controller.listGhnWards);

export default router;
