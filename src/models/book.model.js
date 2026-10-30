import { pool } from "../config/db.js";
import { fail } from "../validation.js";
import { lockCatalog, releaseCatalog } from "../catalog-lock.js";
import { resolveAuthorNames } from "./author.model.js";
import {
  attachPublishers,
  replaceBookPublishers,
  resolvePublisherNames,
} from "./publisher.model.js";
import {
  normalizeBookText,
  sameBookIdentity,
  validateAuthorNames,
} from "../book-identity.js";

async function attachBookRelations(books, db) {
  if (!books.length) return books;
  const [authors] = await db.execute(
    `SELECT ba.book_id, a.id, a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
     WHERE ba.book_id IN (${books.map(() => "?").join(", ")}) ORDER BY a.name, a.id`,
    books.map((book) => book.id),
  );
  const withAuthors = books.map((book) => {
    const author_names = authors
      .filter((author) => author.book_id === book.id)
      .map((author) => author.name);
    const author_ids = authors
      .filter((author) => author.book_id === book.id)
      .map((author) => author.id);
    return {
      ...book,
      author_ids,
      author_names,
      authors: author_names.join(", "),
    };
  });
  return attachPublishers(withAuthors, db);
}

async function replaceAuthors(connection, bookId, names, selectedIds) {
  await connection.execute("DELETE FROM book_authors WHERE book_id = ?", [
    bookId,
  ]);
  if (selectedIds !== undefined) {
    for (const authorId of new Set(selectedIds))
      await connection.execute(
        "INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)",
        [bookId, authorId],
      );
    return;
  }
  for (const name of validateAuthorNames(names)) {
    const [candidates] = await connection.execute(
      "SELECT id, name FROM authors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY id",
      [name],
    );
    let authorId = candidates.find(
      (author) => normalizeBookText(author.name) === normalizeBookText(name),
    )?.id;
    if (!authorId) {
      const [author] = await connection.execute(
        "INSERT INTO authors (name) VALUES (?)",
        [name],
      );
      authorId = author.insertId;
    }
    await connection.execute(
      "INSERT IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)",
      [bookId, authorId],
    );
  }
}

export async function findMatchingBook(identity, db = pool, excludeId = null) {
  const publisher_names = await resolvePublisherNames(identity, db);
  const author_names = await resolveAuthorNames(identity, db);
  const [candidates] = await db.execute(
    `SELECT b.*, c.name AS category_name FROM books b JOIN categories c ON c.id = b.category_id
     WHERE LOWER(TRIM(b.title)) = LOWER(TRIM(?))
       ${excludeId === null ? "" : "AND b.id <> ?"} ORDER BY b.id`,
    [identity.title, ...(excludeId === null ? [] : [excludeId])],
  );
  return (
    (await attachBookRelations(candidates, db)).find((book) =>
      sameBookIdentity(book, { ...identity, publisher_names, author_names }),
    ) || null
  );
}

export async function findBook(id, db = pool) {
  const [rows] = await db.execute(
    "SELECT b.*, c.name AS category_name FROM books b JOIN categories c ON c.id = b.category_id WHERE b.id = ?",
    [id],
  );
  return (await attachBookRelations(rows, db))[0];
}

export async function listBooks({
  page,
  limit,
  offset,
  search,
  category_id,
  publisher_id,
}) {
  const where = [];
  const args = [];
  if (search) {
    where.push("b.title LIKE ?");
    args.push(`%${search}%`);
  }
  if (category_id) {
    where.push("b.category_id = ?");
    args.push(category_id);
  }
  if (publisher_id) {
    where.push(
      "EXISTS (SELECT 1 FROM book_publisher bp WHERE bp.book_id = b.id AND bp.publisher_id = ?)",
    );
    args.push(publisher_id);
  }
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM books b${clause}`,
    args,
  );
  const [rows] = await pool.execute(
    `SELECT b.*, c.name AS category_name FROM books b JOIN categories c ON c.id = b.category_id${clause} ORDER BY b.id DESC LIMIT ${limit} OFFSET ${offset}`,
    args,
  );
  return {
    data: await attachBookRelations(rows, pool),
    meta: { page, limit, total: count.total },
  };
}

export async function listPublicBooks({
  page,
  limit,
  offset,
  search,
  category_id,
  publisher_id,
  sort = "newest",
  min_price = null,
  max_price = null,
  in_stock = false,
}) {
  const where = ["b.is_active = 1"];
  const args = [];
  if (search) {
    where.push("b.title LIKE ?");
    args.push(`%${search}%`);
  }
  if (category_id) {
    where.push("b.category_id = ?");
    args.push(category_id);
  }
  if (min_price !== null) {
    where.push("b.price >= ?");
    args.push(min_price);
  }
  if (max_price !== null) {
    where.push("b.price <= ?");
    args.push(max_price);
  }
  if (in_stock) where.push("b.stock_quantity > 0");
  if (publisher_id) {
    where.push(
      "EXISTS (SELECT 1 FROM book_publisher bp WHERE bp.book_id = b.id AND bp.publisher_id = ?)",
    );
    args.push(publisher_id);
  }
  const orderBy =
    {
      newest: "b.id DESC",
      price_asc: "b.price ASC, b.id DESC",
      price_desc: "b.price DESC, b.id DESC",
      title_asc: "b.title ASC, b.id DESC",
    }[sort] || "b.id DESC";
  const clause = ` WHERE ${where.join(" AND ")}`;
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM books b${clause}`,
    args,
  );
  const [rows] = await pool.execute(
    `SELECT b.*, c.name AS category_name,
      (SELECT GROUP_CONCAT(a.name ORDER BY a.name SEPARATOR ', ')
       FROM book_authors ba JOIN authors a ON a.id = ba.author_id
       WHERE ba.book_id = b.id) AS authors
     FROM books b JOIN categories c ON c.id = b.category_id${clause}
     ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    args,
  );
  return {
    data: await attachPublishers(rows, pool),
    meta: { page, limit, total: count.total },
  };
}

export async function findPublicBook(id) {
  const [rows] = await pool.execute(
    `SELECT b.*, c.name AS category_name,
      (SELECT GROUP_CONCAT(a.name ORDER BY a.name SEPARATOR ', ')
       FROM book_authors ba JOIN authors a ON a.id = ba.author_id
       WHERE ba.book_id = b.id) AS authors
     FROM books b JOIN categories c ON c.id = b.category_id
     WHERE b.id = ? AND b.is_active = 1`,
    [id],
  );
  return (await attachPublishers(rows, pool))[0];
}

async function categoryExists(db, id) {
  const [rows] = await db.execute("SELECT id FROM categories WHERE id = ?", [
    id,
  ]);
  if (!rows.length) fail("category_id không tồn tại", 400);
}

export async function createBook(data) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    await lockCatalog(connection);
    locked = true;
    await connection.beginTransaction();
    const {
      author_names = [],
      author_ids,
      publisher,
      publisher_names,
      publisher_ids,
      ...fields
    } = data;
    const names = await resolveAuthorNames(data, connection);
    const publisherNames = await resolvePublisherNames(data, connection);
    const existing = await findMatchingBook(
      { ...fields, author_names: names, publisher_names: publisherNames },
      connection,
    );
    if (existing) {
      const quantity = fields.stock_quantity ?? 0;
      if (quantity < 1)
        fail("Sách đã tồn tại. Nhập số lượng lớn hơn 0 để bổ sung.");
      await incrementStock(connection, existing.id, quantity);
      const book = await findBook(existing.id, connection);
      await connection.commit();
      return { book, action: "stock_added", quantity_added: quantity };
    }
    await categoryExists(connection, fields.category_id);
    const keys = Object.keys(fields);
    const [result] = await connection.execute(
      `INSERT INTO books (${keys.map((key) => `\`${key}\``).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      Object.values(fields),
    );
    await replaceAuthors(connection, result.insertId, names, author_ids);
    await replaceBookPublishers(connection, result.insertId, publisherNames);
    const book = await findBook(result.insertId, connection);
    await connection.commit();
    return { book, action: "created", quantity_added: 0 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await releaseCatalog(connection, locked);
  }
}

export async function updateBook(id, data, { publisherMode = "replace" } = {}) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    await lockCatalog(connection);
    locked = true;
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id FROM books WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) fail("Không tìm thấy sách", 404);
    const {
      author_names,
      author_ids,
      publisher,
      publisher_names,
      publisher_ids,
      ...fields
    } = data;
    const hasAuthorInput =
      data.author_names !== undefined || data.author_ids !== undefined;
    const hasPublisherInput = [
      "publisher",
      "publisher_names",
      "publisher_ids",
    ].some((key) => data[key] !== undefined);
    let publisherNames;
    if (
      [
        "title",
        "publisher",
        "publisher_names",
        "publisher_ids",
        "author_names",
        "author_ids",
      ].some((field) => data[field] !== undefined)
    ) {
      const current = await findBook(id, connection);
      if (hasPublisherInput) {
        if (publisherMode !== "replace") {
          await resolvePublisherNames({ publisher_ids }, connection);
          if (
            publisherMode === "remove" &&
            publisher_ids.some(
              (publisherId) => !current.publisher_ids.includes(publisherId),
            )
          )
            fail("Không tìm thấy liên kết nhà xuất bản của sách", 404);
          const desired =
            publisherMode === "add"
              ? [...new Set([...current.publisher_ids, ...publisher_ids])]
              : current.publisher_ids.filter(
                  (publisherId) => !publisher_ids.includes(publisherId),
                );
          publisherNames = await resolvePublisherNames(
            { publisher_ids: desired },
            connection,
          );
        } else publisherNames = await resolvePublisherNames(data, connection);
      }
      const identity = {
        ...current,
        ...fields,
        publisher_names: publisherNames ?? current.publisher_names,
        author_names: hasAuthorInput
          ? await resolveAuthorNames(data, connection)
          : current.author_names,
      };
      if (
        await findMatchingBook(
          {
            title: identity.title,
            author_names: identity.author_names,
            publisher_names: identity.publisher_names,
          },
          connection,
          id,
        )
      )
        fail(
          "Đã có sách khác trùng tên, tác giả và nhà xuất bản. Hãy thêm số lượng cho sách đó.",
          409,
        );
    }
    if (fields.category_id !== undefined)
      await categoryExists(connection, fields.category_id);
    if (Object.keys(fields).length) {
      await connection.execute(
        `UPDATE books SET ${Object.keys(fields)
          .map((key) => `\`${key}\` = ?`)
          .join(", ")} WHERE id = ?`,
        [...Object.values(fields), id],
      );
    }
    if (hasAuthorInput)
      await replaceAuthors(
        connection,
        id,
        await resolveAuthorNames(data, connection),
        author_ids,
      );
    if (hasPublisherInput)
      await replaceBookPublishers(connection, id, publisherNames);
    const book = await findBook(id, connection);
    await connection.commit();
    return book;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await releaseCatalog(connection, locked);
  }
}

async function incrementStock(connection, id, quantity) {
  const [rows] = await connection.execute(
    "SELECT stock_quantity FROM books WHERE id = ? FOR UPDATE",
    [id],
  );
  if (!rows.length) fail("Không tìm thấy sách", 404);
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    Number(rows[0].stock_quantity) + quantity > 2147483647
  ) {
    fail("Số lượng sau khi cộng vượt giới hạn cho phép", 400);
  }
  await connection.execute(
    "UPDATE books SET stock_quantity = stock_quantity + ? WHERE id = ?",
    [quantity, id],
  );
}

export async function addBookStock(id, quantity) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await incrementStock(connection, id, quantity);
    const book = await findBook(id, connection);
    await connection.commit();
    return book;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteBook(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id FROM books WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) fail("Không tìm thấy sách", 404);
    await connection.execute("DELETE FROM books WHERE id = ?", [id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
