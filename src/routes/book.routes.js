import {Router} from 'express';
import * as controller from '../controllers/book.controller.js';
import * as categories from '../controllers/category.controller.js';
const router=Router();
router.get('/books',controller.list);
router.get('/books/:id',controller.detail);
router.post('/books',controller.create);
router.put('/books/:id',controller.update); // PUT/PATCH both update supplied fields, documented for simple Postman use.
router.patch('/books/:id',controller.update);
router.delete('/books/:id',controller.remove);
router.get('/categories',categories.list);
router.get('/categories/:id',categories.detail);
router.post('/categories',categories.create);
router.put('/categories/:id',categories.update);
router.patch('/categories/:id',categories.update);
router.delete('/categories/:id',categories.remove);
export default router;
