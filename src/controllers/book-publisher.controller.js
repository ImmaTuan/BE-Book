import * as books from "../models/book.model.js";
import { fail, id } from "../validation.js";
import { validatePublisherIds } from "../publisher-input.js";

function requireBody(body, field) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    body[field] === undefined
  )
    fail(`Body chỉ nhận trường ${field}`);
}

async function listFor(req, res, publicOnly) {
  const book = await (publicOnly
    ? books.findPublicBook(id(req.params.id))
    : books.findBook(id(req.params.id)));
  if (!book) fail("Không tìm thấy sách", 404);
  res.json({ data: book.publishers });
}
export const list = (req, res) => listFor(req, res, false);
export const listPublic = (req, res) => listFor(req, res, true);

export async function replace(req, res) {
  requireBody(req.body, "publisher_ids");
  const book = await books.updateBook(id(req.params.id), {
    publisher_ids: validatePublisherIds(req.body.publisher_ids),
  });
  res.json({ message: "Đã cập nhật nhà xuất bản của sách", data: book });
}
export async function add(req, res) {
  requireBody(req.body, "publisher_id");
  const book = await books.updateBook(
    id(req.params.id),
    { publisher_ids: validatePublisherIds([req.body.publisher_id]) },
    { publisherMode: "add" },
  );
  res.json({ message: "Đã liên kết nhà xuất bản với sách", data: book });
}
export async function remove(req, res) {
  const book = await books.updateBook(
    id(req.params.id),
    { publisher_ids: [id(req.params.publisherId)] },
    { publisherMode: "remove" },
  );
  res.json({ message: "Đã gỡ liên kết nhà xuất bản của sách", data: book });
}
