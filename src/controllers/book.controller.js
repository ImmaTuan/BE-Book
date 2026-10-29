import * as model from '../models/book.model.js';
import { fail, id, pagination, validateBook } from '../validation.js';

export async function list(req, res) {
  const page = pagination(req.query);
  const books = await model.listBooks({
    ...page,
    search: req.query.search ? String(req.query.search) : null,
    category_id: req.query.category_id ? id(req.query.category_id) : null,
  });
  res.json(books);
}

export async function detail(req, res) {
  const book = await model.findBook(id(req.params.id));
  if (!book) fail('Không tìm thấy sách', 404);
  res.json({ data: book });
}

export async function create(req, res) {
  const book = await model.createBook(validateBook(req.body, true));
  res.status(201).json({ message: 'Đã thêm sách', data: book });
}

export async function update(req, res) {
  const book = await model.updateBook(id(req.params.id), validateBook(req.body));
  res.json({ message: 'Đã cập nhật sách', data: book });
}

export async function remove(req, res) {
  await model.deleteBook(id(req.params.id));
  res.status(204).end();
}
