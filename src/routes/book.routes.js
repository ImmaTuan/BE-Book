import {Router} from 'express';
import * as controller from '../controllers/book.controller.js';
const router=Router();
router.get('/books',controller.list);
router.get('/books/:id',controller.detail);
router.post('/books',controller.create);
router.put('/books/:id',controller.update); // PUT/PATCH both update supplied fields, documented for simple Postman use.
router.patch('/books/:id',controller.update);
router.delete('/books/:id',controller.remove);
router.get('/categories',controller.categories); // Read only: choose category_id when editing books.
export default router;
