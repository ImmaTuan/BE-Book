import { Router } from "express";
import * as controller from "../controllers/public.controller.js";
import * as publishers from "../controllers/publisher.controller.js";
import * as bookPublishers from "../controllers/book-publisher.controller.js";

const router = Router();
router.get("/books", controller.listBooks);
router.get("/books/:id", controller.detailBook);
router.get("/books/:id/publishers", bookPublishers.listPublic);
router.get("/publishers", publishers.listPublic);
router.get("/publishers/:id", publishers.detailPublic);
router.get("/publishers/:id/books", publishers.listPublicBooks);
router.get("/categories", controller.listCategories);
export default router;
