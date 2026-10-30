import test from "node:test";
import assert from "node:assert/strict";
import { validateBook } from "../src/validation.js";
import {
  validatePublisher,
  validatePublisherIds,
  validatePublisherNames,
} from "../src/publisher-input.js";
import { sameBookIdentity } from "../src/book-identity.js";

test("publisher input validates fields, URLs and relation IDs", () => {
  assert.deepEqual(
    validatePublisher(
      {
        name: " Nhà xuất bản Mộc ",
        website: "https://example.com",
        description: null,
      },
      true,
    ),
    {
      name: "Nhà xuất bản Mộc",
      website: "https://example.com",
      description: null,
    },
  );
  assert.deepEqual(validatePublisherIds([1, 2, 1]), [1, 2]);
  assert.deepEqual(validatePublisherNames([" Mộc ", "mộc", "Trẻ"]), [
    "mộc",
    "Trẻ",
  ]);
  for (const input of [
    {},
    { name: "" },
    { name: null },
    { name: "A", id: 1 },
    { name: "A", website: "javascript:alert(1)" },
    { name: "A", website: "ftp://example.com" },
  ]) {
    assert.throws(
      () => validatePublisher(input, true),
      (error) => error.status === 400,
    );
  }
  for (const ids of [null, [0], [-1], ["1"], [1.5], Array(51).fill(1)])
    assert.throws(() => validatePublisherIds(ids));
  assert.throws(() => validatePublisherNames(["a".repeat(256)]));
  assert.throws(() => validateBook({ publisher: "A", publisher_ids: [1] }));
  assert.throws(() =>
    validateBook({ publisher_names: ["A"], publisher_ids: [1] }),
  );
  assert.deepEqual(validateBook({ publisher_ids: [] }), { publisher_ids: [] });
});

test("book matching compares complete publisher sets without relying on display strings", () => {
  const first = {
    title: "Book",
    author_names: ["Author"],
    publisher_names: ["NXB A", "NXB B"],
  };
  assert.equal(
    sameBookIdentity(first, {
      ...first,
      publisher_names: [" nxb b ", "NXB A"],
    }),
    true,
  );
  assert.equal(
    sameBookIdentity(first, { ...first, publisher_names: ["NXB A"] }),
    false,
  );
  assert.equal(
    sameBookIdentity(first, {
      title: "Book",
      author_names: ["Author"],
      publisher: "NXB A, NXB B",
    }),
    false,
  );
  assert.equal(
    sameBookIdentity(
      { ...first, publisher_names: ["NXB Mộc"] },
      { ...first, publisher_names: ["NXB Moc"] },
    ),
    false,
  );
  assert.equal(
    sameBookIdentity(
      { title: "Book", publisher: "NXB A" },
      { title: "Book", publisher_names: ["nxb a"] },
    ),
    true,
  );
});
