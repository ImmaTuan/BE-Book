import {Router} from 'express';
import {updateCustomerProfile} from '../controllers/user.controller.js';

const router=Router();
router.patch('/:id/profile',updateCustomerProfile);
export default router;
