import { pool } from "../config/db.js";
import { fail } from "../validation.js";
import { lockCatalog, releaseCatalog } from "../catalog-lock.js";
import {
  validatePublisherIds,
  validatePublisherNames,
} from "../publisher-input.js";

const columns =
  "p.id, p.name, p.description, p.website, p.created_at, p.updated_at";

export async function attachPublishers(books, db = pool) {
  if (!books.length) return books;
  const [rows] = await db.execute(
    `SELECT bp.book_id, ${columns} FROM book_publisher bp JOIN publisher p ON p.id = bp.publisher_id
     WHERE bp.book_id IN (${books.map(() => "?").join(", ")}) ORDER BY p.name_key, p.id`,
    books.map((book) => book.id),
  );
  return books.map((book) => {
    const publishers = rows
      .filter((row) => row.book_id === book.id)
      .map(({ book_id, ...publisher }) => publisher);
    const publisher_names = publishers.map((publisher) => publisher.name);
    return {
      ...book,
      publishers,
      publisher_ids: publishers.map((publisher) => publisher.id),
      publisher_names,
      publisher: publisher_names.join(", ") || null,
    };
  });
}

export async function resolvePublisherNames(data, db = pool) {
  if (data.publisher_ids !== undefined) {
    const ids = validatePublisherIds(data.publisher_ids);
    if (!ids.length) return [];
    const [rows] = await db.execute(
      `SELECT id, name FROM publisher WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY name_key, id`,
      ids,
    );
    if (rows.length !== ids.length) fail("Không tìm thấy nhà xuất bản", 404);
    return rows.map((row) => row.name);
  }
  if (data.publisher_names !== undefined)
    return validatePublisherNames(data.publisher_names);
  return data.publisher?.trim() ? validatePublisherNames([data.publisher]) : [];
}

export async function syncPublisherCache(db, bookIds) {
  if (!bookIds.length) return;
  await db.execute(
    `UPDATE books b SET publisher = (
      SELECT p.name FROM book_publisher bp JOIN publisher p ON p.id = bp.publisher_id
      WHERE bp.book_id = b.id ORDER BY p.name_key, p.id LIMIT 1
    ) WHERE b.id IN (${bookIds.map(() => "?").join(", ")})`,
    bookIds,
  );
}

export async function replaceBookPublishers(db, bookId, names) {
  await db.execute("DELETE FROM book_publisher WHERE book_id = ?", [bookId]);
  for (const name of validatePublisherNames(names)) {
    const [publisher] = await db.execute(
      "INSERT INTO publisher (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [name],
    );
    await db.execute(
      "INSERT INTO book_publisher (book_id, publisher_id) VALUES (?, ?)",
      [bookId, publisher.insertId],
    );
  }
  await syncPublisherCache(db, [bookId]);
}

export async function listPublishers({
  page,
  limit,
  offset,
  search = null,
  publicOnly = false,
}) {
  const where = search ? " WHERE p.name COLLATE utf8mb4_unicode_ci LIKE ?" : "";
  const args = search ? [`%${search}%`] : [];
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM publisher p${where}`,
    args,
  );
  const [rows] = await pool.execute(
    `SELECT ${columns}, (SELECT COUNT(*) FROM book_publisher bp JOIN books b ON b.id = bp.book_id
      WHERE bp.publisher_id = p.id ${publicOnly ? "AND b.is_active = 1" : ""}) AS book_count
     FROM publisher p${where} ORDER BY p.name_key, p.id LIMIT ${limit} OFFSET ${offset}`,
    args,
  );
  return { data: rows, meta: { page, limit, total: count.total } };
}

export async function findPublisher(
  id,
  { db = pool, publicOnly = false } = {},
) {
  const [rows] = await db.execute(
    `SELECT ${columns}, (SELECT COUNT(*) FROM book_publisher bp JOIN books b ON b.id = bp.book_id
      WHERE bp.publisher_id = p.id ${publicOnly ? "AND b.is_active = 1" : ""}) AS book_count
     FROM publisher p WHERE p.id = ?`,
    [id],
  );
  return rows[0];
}

async function writePublisher(callback) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    await lockCatalog(connection);
    locked = true;
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") fail("Tên nhà xuất bản đã tồn tại", 409);
    throw error;
  } finally {
    await releaseCatalog(connection, locked);
  }
}

export function createPublisher(data) {
  return writePublisher(async (db) => {
    const keys = Object.keys(data);
    const [result] = await db.execute(
      `INSERT INTO publisher (${keys.map((key) => `\`${key}\``).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      Object.values(data),
    );
    return findPublisher(result.insertId, { db });
  });
}

export function updatePublisher(id, data) {
  return writePublisher(async (db) => {
    if (!(await findPublisher(id, { db })))
      fail("Không tìm thấy nhà xuất bản", 404);
    await db.execute(
      `UPDATE publisher SET ${Object.keys(data)
        .map((key) => `\`${key}\` = ?`)
        .join(", ")} WHERE id = ?`,
      [...Object.values(data), id],
    );
    if (data.name !== undefined) {
      const [links] = await db.execute(
        "SELECT book_id FROM book_publisher WHERE publisher_id = ? ORDER BY book_id",
        [id],
      );
      await syncPublisherCache(
        db,
        links.map((link) => link.book_id),
      );
    }
    return findPublisher(id, { db });
  });
}

export function deletePublisher(id) {
  return writePublisher(async (db) => {
    const publisher = await findPublisher(id, { db });
    if (!publisher) fail("Không tìm thấy nhà xuất bản", 404);
    if (Number(publisher.book_count))
      fail(
        "Nhà xuất bản đang được liên kết với sách. Hãy gỡ liên kết trước.",
        409,
      );
    await db.execute("DELETE FROM publisher WHERE id = ?", [id]);
  });
}
