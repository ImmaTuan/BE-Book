import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { pool } from "../src/config/db.js";
import { secret } from "../src/config/auth.js";

test(
  "author dropdown APIs and ID-based book editing with MySQL",
  { skip: process.env.RUN_MYSQL_INTEGRATION !== "1" },
  async () => {
    const prefix = `__author_check_${randomUUID().replaceAll("-", "")}_`;
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    try {
      const [[admin]] = await pool.execute(
        "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1",
      );
      assert.ok(admin);
      const token = jwt.sign({}, secret(), {
        subject: String(admin.id),
        issuer: "book-backend",
        audience: "book-app",
        expiresIn: "5m",
      });
      const call = async (method, path, body, expected = 200, auth = token) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        assert.equal(
          response.status,
          expected,
          `${method} ${path}: ${JSON.stringify(result)}`,
        );
        return result;
      };
      await call("GET", "/admin/authors", undefined, 401, "");
      const a = (
        await call(
          "POST",
          "/admin/authors",
          { name: prefix + "A", biography: "Test biography" },
          201,
        )
      ).data;
      const b = (
        await call("POST", "/admin/authors", { name: prefix + "B" }, 201)
      ).data;
      await call("POST", "/admin/authors", { name: a.name.toUpperCase() }, 409);
      await call("POST", "/admin/authors", { name: "Invalid", id: 1 }, 400);
      assert.equal(
        (await call("GET", `/admin/authors/${a.id}`)).data.biography,
        "Test biography",
      );
      const list = await call(
        "GET",
        `/admin/authors?search=${encodeURIComponent(prefix)}&limit=1&page=2`,
      );
      assert.equal(list.meta.total, 2);
      assert.equal(list.data.length, 1);
      const pub = (
        await call(
          "POST",
          "/admin/publishers",
          { name: prefix + "Publisher" },
          201,
        )
      ).data;
      const [[category]] = await pool.execute(
        "SELECT id FROM categories ORDER BY id LIMIT 1",
      );
      const input = {
        category_id: category.id,
        title: prefix + "Book",
        author_ids: [a.id, b.id],
        publisher_ids: [pub.id],
        price: 100000,
        stock_quantity: 5,
        weight_grams: 200,
        is_active: false,
      };
      const book = (await call("POST", "/admin/books", input, 201)).data;
      assert.deepEqual(book.author_ids, [a.id, b.id]);
      assert.deepEqual(book.author_names, [a.name, b.name]);
      assert.equal(
        (
          await call("POST", "/admin/books/match", {
            title: book.title,
            author_ids: [b.id, a.id],
            publisher_ids: [pub.id],
          })
        ).data.id,
        book.id,
      );
      const duplicate = await call("POST", "/admin/books", {
        ...input,
        author_ids: [b.id, a.id],
        stock_quantity: 3,
      });
      assert.equal(duplicate.action, "stock_added");
      assert.equal(duplicate.data.stock_quantity, 8);
      await call(
        "POST",
        "/admin/books",
        { ...input, author_ids: [2147483647] },
        404,
      );
      const edited = (
        await call("PATCH", `/admin/books/${book.id}`, {
          author_ids: [b.id],
          price: 120000,
        })
      ).data;
      assert.deepEqual(edited.author_ids, [b.id]);
      assert.equal(edited.stock_quantity, 8);
      const [[linked]] = await pool.execute(
        "SELECT author_id FROM book_authors WHERE book_id = ?",
        [book.id],
      );
      assert.equal(linked.author_id, b.id);
      const parallel = await Promise.all(
        [1, 2].map(async () => {
          const response = await fetch(base + "/admin/authors", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ name: prefix + "Concurrent" }),
          });
          await response.json();
          return response.status;
        }),
      );
      assert.deepEqual(parallel.sort(), [201, 409]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        const [books] = await db.execute(
          "SELECT id,title FROM books WHERE LEFT(title, ?) = ?",
          [prefix.length, prefix],
        );
        assert.ok(books.every((book) => book.title.startsWith(prefix)));
        for (const book of books) {
          await db.execute("DELETE FROM book_authors WHERE book_id = ?", [
            book.id,
          ]);
          await db.execute("DELETE FROM book_publisher WHERE book_id = ?", [
            book.id,
          ]);
          await db.execute("DELETE FROM books WHERE id = ?", [book.id]);
        }
        const [authors] = await db.execute(
          "SELECT id FROM authors WHERE LEFT(name, ?) = ?",
          [prefix.length, prefix],
        );
        for (const author of authors)
          await db.execute(
            "DELETE FROM authors WHERE id = ? AND NOT EXISTS (SELECT 1 FROM book_authors WHERE author_id = ?)",
            [author.id, author.id],
          );
        const [publishers] = await db.execute(
          "SELECT id FROM publisher WHERE LEFT(name, ?) = ?",
          [prefix.length, prefix],
        );
        for (const publisher of publishers)
          await db.execute(
            "DELETE FROM publisher WHERE id = ? AND NOT EXISTS (SELECT 1 FROM book_publisher WHERE publisher_id = ?)",
            [publisher.id, publisher.id],
          );
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
        await pool.end();
      }
    }
  },
);
