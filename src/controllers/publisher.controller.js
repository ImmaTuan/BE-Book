import * as publishers from "../models/publisher.model.js";
import * as books from "../models/book.model.js";
import { fail, id, pagination } from "../validation.js";
import { parseCatalogFilters } from "../catalog-filters.js";
import { validatePublisher } from "../publisher-input.js";

function searchValue(query) {
  if (query.search === undefined) return null;
  if (typeof query.search !== "string" || query.search.length > 255)
    fail("Từ khóa tìm kiếm tối đa 255 ký tự");
  return query.search.trim() || null;
}

async function listFor(req, res, publicOnly) {
  res.json(
    await publishers.listPublishers({
      ...pagination(req.query),
      search: searchValue(req.query),
      publicOnly,
    }),
  );
}
async function detailFor(req, res, publicOnly) {
  const publisher = await publishers.findPublisher(id(req.params.id), {
    publicOnly,
  });
  if (!publisher) fail("Không tìm thấy nhà xuất bản", 404);
  res.json({ data: publisher });
}
async function booksFor(req, res, publicOnly) {
  const publisherId = id(req.params.id);
  if (!(await publishers.findPublisher(publisherId, { publicOnly })))
    fail("Không tìm thấy nhà xuất bản", 404);
  const filters = {
    ...pagination(req.query),
    ...parseCatalogFilters(req.query),
    publisher_id: publisherId,
    search: searchValue(req.query),
    category_id: req.query.category_id ? id(req.query.category_id) : null,
  };
  res.json(
    await (publicOnly
      ? books.listPublicBooks(filters)
      : books.listBooks(filters)),
  );
}

export const list = (req, res) => listFor(req, res, false);
export const listPublic = (req, res) => listFor(req, res, true);
export const detail = (req, res) => detailFor(req, res, false);
export const detailPublic = (req, res) => detailFor(req, res, true);
export const listBooks = (req, res) => booksFor(req, res, false);
export const listPublicBooks = (req, res) => booksFor(req, res, true);

export async function create(req, res) {
  const publisher = await publishers.createPublisher(
    validatePublisher(req.body, true),
  );
  res.status(201).json({ message: "Đã thêm nhà xuất bản", data: publisher });
}
export async function update(req, res) {
  const publisher = await publishers.updatePublisher(
    id(req.params.id),
    validatePublisher(req.body),
  );
  res.json({ message: "Đã cập nhật nhà xuất bản", data: publisher });
}
export async function remove(req, res) {
  await publishers.deletePublisher(id(req.params.id));
  res.status(204).end();
}
