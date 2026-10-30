import * as authors from "../models/author.model.js";
import { fail, id, pagination } from "../validation.js";
import { validateAuthor } from "../author-input.js";

export async function list(req, res) {
  if (
    req.query.search !== undefined &&
    (typeof req.query.search !== "string" || req.query.search.length > 255)
  )
    fail("Từ khóa tìm kiếm tối đa 255 ký tự");
  res.json(
    await authors.listAuthors({
      ...pagination(req.query),
      search: req.query.search?.trim() || null,
    }),
  );
}
export async function detail(req, res) {
  const author = await authors.findAuthor(id(req.params.id));
  if (!author) fail("Không tìm thấy tác giả", 404);
  res.json({ data: author });
}
export async function create(req, res) {
  const author = await authors.createAuthor(validateAuthor(req.body));
  res.status(201).json({ message: "Đã thêm tác giả", data: author });
}
