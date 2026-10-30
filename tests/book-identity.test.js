import test from "node:test";
import assert from "node:assert/strict";
import { sameBookIdentity, validateAuthorNames } from "../src/book-identity.js";
import { validateBook } from "../src/validation.js";

const book = {
  title: "Cuốn sách",
  publisher: "Nhà xuất bản",
  author_names: ["Minh An", "Thu Hà"],
};

test("matching requires title, publisher and the complete author set; author order does not matter", () => {
  assert.equal(
    sameBookIdentity(book, {
      ...book,
      title: " cuốn sách ",
      author_names: ["thu hà", "MINH AN"],
    }),
    true,
  );
  assert.equal(
    sameBookIdentity(book, { ...book, author_names: ["Minh An"] }),
    false,
  );
  assert.equal(
    sameBookIdentity(book, { ...book, author_names: ["Minh An", "Thu Ha"] }),
    false,
  );
  assert.equal(
    sameBookIdentity(book, { ...book, publisher: "Other publisher" }),
    false,
  );
  assert.equal(sameBookIdentity(book, { ...book, title: "Other book" }), false);
  assert.equal(
    sameBookIdentity(
      { title: "Book", publisher: null },
      { title: "Book", publisher: "", author_names: [] },
    ),
    true,
  );
  assert.equal(
    sameBookIdentity(book, { ...book, title: book.title.normalize("NFD") }),
    true,
  );
});

test("author names are validated, deduplicated and kept separate from arbitrary book fields", () => {
  assert.deepEqual(validateAuthorNames([" Minh An ", "minh an", "Thu Hà"]), [
    "minh an",
    "Thu Hà",
  ]);
  for (const names of [
    null,
    "Author",
    [""],
    [12],
    ["a".repeat(256)],
    Array(51).fill("Name"),
  ]) {
    assert.throws(
      () => validateBook({ author_names: names }),
      (error) => error.status === 400,
    );
  }
  assert.deepEqual(
    validateBook({ author_names: ["Author, Jr."] }).author_names,
    ["Author, Jr."],
  );
  assert.throws(() => validateBook({ "title = 1; DROP TABLE books": "x" }));
});
