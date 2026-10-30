import { pool } from "../config/db.js";
import { fail, validateAuthorNames } from "../validation.js";
import { normalizeBookText } from "../book-identity.js";
import { lockCatalog, releaseCatalog } from "../catalog-lock.js";
import { validateAuthorIds } from "../author-input.js";

export async function resolveAuthorNames(data, db = pool) {
  if (data.author_ids !== undefined) {
    const ids = validateAuthorIds(data.author_ids);
    if (!ids.length) return [];
    const [rows] = await db.execute(
      `SELECT id, name FROM authors WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY name, id`,
      ids,
    );
    if (rows.length !== ids.length) fail("Không tìm thấy tác giả", 404);
    return rows.map((row) => row.name);
  }
  return validateAuthorNames(data.author_names || []);
}

export async function listAuthors({ page, limit, offset, search = null }) {
  const where = search ? " WHERE a.name LIKE ?" : "";
  const args = search ? [`%${search}%`] : [];
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM authors a${where}`,
    args,
  );
  const [rows] = await pool.execute(
    `SELECT a.id, a.name, a.biography, (SELECT COUNT(*) FROM book_authors ba WHERE ba.author_id = a.id) AS book_count
     FROM authors a${where} ORDER BY a.name, a.id LIMIT ${limit} OFFSET ${offset}`,
    args,
  );
  return { data: rows, meta: { page, limit, total: count.total } };
}

export async function findAuthor(id, db = pool) {
  const [rows] = await db.execute(
    "SELECT id, name, biography FROM authors WHERE id = ?",
    [id],
  );
  return rows[0];
}

export async function createAuthor(data) {
  const db = await pool.getConnection();
  let locked = false;
  try {
    await lockCatalog(db);
    locked = true;
    await db.beginTransaction();
    const [existing] = await db.execute(
      "SELECT id, name FROM authors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
      [data.name],
    );
    if (
      existing.some(
        (author) =>
          normalizeBookText(author.name) === normalizeBookText(data.name),
      )
    )
      fail("Tên tác giả đã tồn tại", 409);
    const [result] = await db.execute(
      "INSERT INTO authors (name, biography) VALUES (?, ?)",
      [data.name, data.biography ?? null],
    );
    const author = await findAuthor(result.insertId, db);
    await db.commit();
    return author;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await releaseCatalog(db, locked);
  }
}
