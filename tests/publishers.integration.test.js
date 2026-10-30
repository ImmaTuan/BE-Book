import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { pool } from "../src/config/db.js";
import { secret } from "../src/config/auth.js";

test(
  "publisher and book_publisher HTTP integration with MySQL",
  { skip: process.env.RUN_MYSQL_INTEGRATION !== "1" },
  async () => {
    const prefix = `__pub_check_${randomUUID().replaceAll("-", "")}_`;
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    try {
      const [[admin]] = await pool.execute(
        "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1",
      );
      assert.ok(
        admin,
        "An existing active admin is required for local API verification",
      );
      const token = jwt.sign({}, secret(), {
        subject: String(admin.id),
        issuer: "book-backend",
        audience: "book-app",
        expiresIn: "5m",
      });
      const call = async (method, path, body, auth = token) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : await response.json(),
        };
      };
      const expect = async (method, path, body, status = 200, auth = token) => {
        const result = await call(method, path, body, auth);
        assert.equal(
          result.status,
          status,
          `${method} ${path}: ${JSON.stringify(result.body)}`,
        );
        return result.body;
      };
      await expect(
        "POST",
        "/admin/publishers",
        { name: prefix + "Unauthenticated" },
        401,
        "",
      );
      const [[customer]] = await pool.execute(
        "SELECT id FROM users WHERE role = 'customer' AND is_active = 1 ORDER BY id LIMIT 1",
      );
      if (customer) {
        const customerToken = jwt.sign({}, secret(), {
          subject: String(customer.id),
          issuer: "book-backend",
          audience: "book-app",
          expiresIn: "5m",
        });
        await expect(
          "POST",
          "/admin/publishers",
          { name: prefix + "Forbidden" },
          403,
          customerToken,
        );
      }
      const a = (
        await expect(
          "POST",
          "/admin/publishers",
          {
            name: prefix + "A",
            website: "https://example.com",
            description: "Test fixture",
          },
          201,
        )
      ).data;
      const b = (
        await expect("POST", "/admin/publishers", { name: prefix + "B" }, 201)
      ).data;
      const c = (
        await expect("POST", "/admin/publishers", { name: prefix + "NXB Mộc" }, 201)
      ).data;
      const searchResult = await expect("GET", `/publishers?search=${encodeURIComponent(prefix.toUpperCase() + 'nxb moc')}`, undefined, 200, '');
      assert.ok(searchResult.data.some((publisher) => publisher.id === c.id));
      await expect(
        "POST",
        "/admin/publishers",
        { name: a.name.toUpperCase() },
        409,
      );
      await expect(
        "POST",
        "/admin/publishers",
        { name: "Invalid", website: "javascript:alert(1)" },
        400,
      );
      const [[category]] = await pool.execute(
        "SELECT id FROM categories ORDER BY id LIMIT 1",
      );
      const bookBody = {
        title: prefix + "Book",
        category_id: category.id,
        price: 90000,
        weight_grams: 200,
        stock_quantity: 5,
        is_active: false,
        author_names: [prefix + "Author"],
        publisher_ids: [a.id],
      };
      const book = (await expect("POST", "/admin/books", bookBody, 201)).data;
      assert.deepEqual(book.publisher_ids, [a.id]);
      assert.equal(book.publisher, a.name);
      assert.equal(
        (await expect("GET", `/admin/books/${book.id}/publishers`)).data[0].id,
        a.id,
      );
      const { publisher_ids, ...legacyBook } = bookBody;
      const duplicate = await expect("POST", "/admin/books", {
        ...legacyBook,
        publisher: a.name,
        stock_quantity: 3,
        price: 999999,
      });
      assert.equal(duplicate.action, "stock_added");
      assert.equal(duplicate.data.id, book.id);
      assert.equal(duplicate.data.stock_quantity, 8);
      assert.equal(duplicate.data.price, 90000);
      const replaced = await expect(
        "PUT",
        `/admin/books/${book.id}/publishers`,
        { publisher_ids: [b.id, a.id, a.id] },
      );
      assert.equal(replaced.data.publisher_ids.length, 2);
      const matched = await expect("POST", "/admin/books/match", {
        title: book.title,
        author_names: bookBody.author_names,
        publisher_ids: [b.id, a.id],
      });
      assert.equal(matched.data.id, book.id);
      const namedMatch = await expect("POST", "/admin/books/match", {
        title: book.title,
        author_names: bookBody.author_names,
        publisher_names: [b.name, a.name],
      });
      assert.equal(namedMatch.data.id, book.id);
      const other = (
        await expect(
          "POST",
          "/admin/books",
          { ...bookBody, publisher_ids: [b.id] },
          201,
        )
      ).data;
      assert.notEqual(other.id, book.id);
      await expect(
        "PUT",
        `/admin/books/${book.id}/publishers`,
        { publisher_ids: [b.id] },
        409,
      );
      assert.equal(
        (await expect("GET", `/admin/books/${book.id}`)).data.publisher_ids
          .length,
        2,
      );
      await expect("POST", `/admin/books/${book.id}/publishers`, {
        publisher_id: c.id,
      });
      await expect("POST", `/admin/books/${book.id}/publishers`, {
        publisher_id: c.id,
      });
      assert.equal(
        (await expect("GET", `/admin/books/${book.id}/publishers`)).data.length,
        3,
      );
      await expect("DELETE", `/admin/books/${book.id}/publishers/${c.id}`);
      await expect(
        "DELETE",
        `/admin/books/${book.id}/publishers/${c.id}`,
        undefined,
        404,
      );
      await expect(
        "PUT",
        `/admin/books/${book.id}/publishers`,
        { publisher_ids: [2147483647] },
        404,
      );
      await expect(
        "PUT",
        `/admin/books/${book.id}/publishers`,
        { publisher_ids: ["1"] },
        400,
      );
      await expect("DELETE", `/admin/publishers/${a.id}`, undefined, 409);
      const renamed = a.name + " renamed";
      await expect("PATCH", `/admin/publishers/${a.id}`, {
        name: renamed,
        description: "Updated description",
      });
      assert.ok(
        (
          await expect("GET", `/admin/books/${book.id}`)
        ).data.publisher_names.includes(renamed),
      );
      const [[cache]] = await pool.execute(
        "SELECT publisher FROM books WHERE id = ?",
        [book.id],
      );
      assert.equal(cache.publisher, renamed);
      await expect("PATCH", `/admin/publishers/${a.id}`, { name: b.name }, 409);
      await expect("GET", `/books/${book.id}/publishers`, undefined, 404, "");
      const publicPublisher = await expect(
        "GET",
        `/publishers/${a.id}`,
        undefined,
        200,
        "",
      );
      assert.equal(publicPublisher.data.book_count, 0);
      assert.equal(
        (await expect("GET", `/publishers/${a.id}/books`, undefined, 200, ""))
          .meta.total,
        0,
      );
      assert.equal(
        (await expect("GET", `/admin/publishers/${a.id}/books`)).meta.total,
        1,
      );
      assert.equal(
        (await expect("GET", `/admin/books?publisher_id=${a.id}`)).meta.total,
        1,
      );
      const publicList = await expect(
        "GET",
        "/publishers?limit=100",
        undefined,
        200,
        "",
      );
      assert.ok(publicList.data.some((publisher) => publisher.id === a.id));
      const cleared = await expect(
        "PUT",
        `/admin/books/${book.id}/publishers`,
        { publisher_ids: [] },
      );
      assert.equal(cleared.data.publisher, null);
      assert.deepEqual(cleared.data.publishers, []);
      await expect("DELETE", `/admin/publishers/${a.id}`, undefined, 204);
      await expect("GET", `/publishers/${a.id}`, undefined, 404, "");
      await expect("DELETE", `/admin/publishers/${c.id}`, undefined, 204);
      const live = await expect("GET", "/books?limit=10", undefined, 200, "");
      assert.ok(
        live.data.every(
          (item) => item.publishers.length && item.publisher_names.length,
        ),
      );
      const selected = live.data[0].publisher_ids[0];
      const filtered = await expect(
        "GET",
        `/books?publisher_id=${selected}&sort=price_asc&limit=100`,
        undefined,
        200,
        "",
      );
      assert.ok(
        filtered.data.every((item) => item.publisher_ids.includes(selected)),
      );
      assert.ok(
        filtered.data.every(
          (item, index, all) =>
            !index || Number(all[index - 1].price) <= Number(item.price),
        ),
      );
      console.log(
        "PASS: real MySQL + HTTP publisher CRUD, auth 401/403, input validation, duplicate name 409, book link add/replace/remove, public hidden-book protection, publisher filtering/counts, name-cache sync, multiple-publisher duplicate matching and stock increments, collision rollback, safe deletion.",
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        const [books] = await db.execute(
          "SELECT id, title FROM books WHERE LEFT(title, ?) = ?",
          [prefix.length, prefix],
        );
        assert.ok(books.every((book) => book.title.startsWith(prefix)));
        for (const book of books) {
          await db.execute("DELETE FROM book_publisher WHERE book_id = ?", [
            book.id,
          ]);
          await db.execute("DELETE FROM book_authors WHERE book_id = ?", [
            book.id,
          ]);
          await db.execute("DELETE FROM books WHERE id = ?", [book.id]);
        }
        const [authors] = await db.execute(
          "SELECT id, name FROM authors WHERE LEFT(name, ?) = ?",
          [prefix.length, prefix],
        );
        for (const author of authors)
          await db.execute(
            "DELETE FROM authors WHERE id = ? AND NOT EXISTS (SELECT 1 FROM book_authors WHERE author_id = ?)",
            [author.id, author.id],
          );
        const [publishers] = await db.execute(
          "SELECT id, name FROM publisher WHERE LEFT(name, ?) = ?",
          [prefix.length, prefix],
        );
        assert.ok(
          publishers.every((publisher) => publisher.name.startsWith(prefix)),
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
