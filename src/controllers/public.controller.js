import * as books from "../models/book.model.js";
import * as categories from "../models/category.model.js";
import { fail, id, pagination } from "../validation.js";
import { parseCatalogFilters } from "../catalog-filters.js";
import { decorateBookPromotions } from "../promotion-pricing.js";

export async function listBooks(req, res) {
  const page = pagination(req.query);
  const search = req.query.search ? String(req.query.search).trim() : null;
  if (search && search.length > 160) fail('Từ khóa tìm kiếm tối đa 160 ký tự');
  const result = await books.listPublicBooks({
    ...page,
    ...parseCatalogFilters(req.query),
    search,
    category_id: req.query.category_id ? id(req.query.category_id) : null,
    publisher_id: req.query.publisher_id ? id(req.query.publisher_id) : null,
  });
  result.data = await decorateBookPromotions(result.data);
  res.json(result);
}

export async function detailBook(req, res) {
  const book = await books.findPublicBook(id(req.params.id));
  if (!book) fail("Không tìm thấy sách", 404);
  res.json({ data: (await decorateBookPromotions([book]))[0] });
}

export async function listCategories(req, res) {
  const result = await categories.listCategories();
  res.json({ data: result });
}
