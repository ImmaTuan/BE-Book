import * as model from "../models/book.model.js";
import { fail, id, pagination, validateBook } from "../validation.js";

export async function list(req, res) {
  const page = pagination(req.query);
  const books = await model.listBooks({
    ...page,
    search: req.query.search ? String(req.query.search) : null,
    category_id: req.query.category_id ? id(req.query.category_id) : null,
    publisher_id: req.query.publisher_id ? id(req.query.publisher_id) : null,
  });
  res.json(books);
}

export async function detail(req, res) {
  const book = await model.findBook(id(req.params.id));
  if (!book) fail("Không tìm thấy sách", 404);
  res.json({ data: book });
}

export async function create(req, res) {
  const result = await model.createBook(validateBook(req.body, true));
  res.status(result.action === "created" ? 201 : 200).json({
    message:
      result.action === "created"
        ? "Đã thêm sách"
        : "Sách đã tồn tại. Đã cộng số lượng vào sách hiện có.",
    data: result.book,
    action: result.action,
    quantity_added: result.quantity_added,
  });
}

export async function match(req, res) {
  const identity = validateBook(req.body);
  if (
    !identity.title ||
    Object.keys(identity).some(
      (key) =>
        ![
          "title",
          "publisher",
          "publisher_names",
          "publisher_ids",
          "author_names",
          "author_ids",
        ].includes(key),
    )
  ) {
    fail("Chỉ nhận tên sách, tác giả và nhà xuất bản để kiểm tra trùng");
  }
  const book = await model.findMatchingBook(identity);
  res.json({ data: book });
}

export async function update(req, res) {
  const book = await model.updateBook(
    id(req.params.id),
    validateBook(req.body),
  );
  res.json({ message: "Đã cập nhật sách", data: book });
}

export async function addStock(req, res) {
  if (
    !req.body ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    Object.keys(req.body).some((key) => key !== "quantity")
  ) {
    fail("Body chỉ nhận trường quantity");
  }
  const quantity = req.body.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    fail("quantity phải là số nguyên dương");
  }
  const book = await model.addBookStock(id(req.params.id), quantity);
  res.json({ message: "Đã cộng số lượng sách", data: book });
}

export async function remove(req, res) {
  await model.deleteBook(id(req.params.id));
  res.status(204).end();
}
