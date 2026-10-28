import {Router} from 'express';
import * as controller from '../controllers/public.controller.js';

const router=Router();
router.get('/books',controller.listBooks);
router.get('/books/:id',controller.detailBook);
router.get('/categories',controller.listCategories);
export default router;
