import {Router} from 'express';
import {getCustomerProfile,updateCustomerProfile} from '../controllers/user.controller.js';

const router=Router();
router.get('/:id/profile',getCustomerProfile);
router.patch('/:id/profile',updateCustomerProfile);
export default router;
