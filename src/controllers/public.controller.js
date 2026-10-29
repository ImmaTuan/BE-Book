import * as books from '../models/book.model.js';
import * as categories from '../models/category.model.js';
import { fail, id, pagination } from '../validation.js';

export async function listBooks(req, res) {
  const page = pagination(req.query);
  const result = await books.listPublicBooks({
    ...page,
    search: req.query.search ? String(req.query.search) : null,
    category_id: req.query.category_id ? id(req.query.category_id) : null,
  });
  res.json(result);
}

export async function detailBook(req, res) {
  const book = await books.findPublicBook(id(req.params.id));
  if (!book) fail('Không tìm thấy sách', 404);
  res.json({ data: book });
}

export async function listCategories(req, res) {
  const result = await categories.listCategories();
  res.json({ data: result });
}
