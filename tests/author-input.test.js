import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthor, validateAuthorIds } from "../src/author-input.js";
import { validateBook } from "../src/validation.js";

test("author creation validates name, biography and allowed fields", () => {
  assert.deepEqual(
    validateAuthor({ name: " Nguyễn Nhật Ánh ", biography: " Tiểu sử " }),
    { name: "Nguyễn Nhật Ánh", biography: "Tiểu sử" },
  );
  assert.deepEqual(validateAuthor({ name: "Name", biography: "" }), {
    name: "Name",
    biography: null,
  });
  for (const body of [
    null,
    [],
    {},
    { name: "" },
    { name: "a".repeat(256) },
    { name: "Name", id: 1 },
    { name: "Name", biography: 1 },
    { name: "Name", biography: "á".repeat(32768) },
  ]) {
    assert.throws(
      () => validateAuthor(body),
      (error) => error.status === 400,
    );
  }
});
test("book author IDs are validated and do not conflict with legacy name input", () => {
  assert.deepEqual(validateAuthorIds([3, 1, 3]), [3, 1]);
  assert.deepEqual(validateBook({ author_ids: [] }), { author_ids: [] });
  for (const ids of [null, [0], [-1], [1.5], ["1"], Array(51).fill(1)])
    assert.throws(() => validateBook({ author_ids: ids }));
  assert.throws(() =>
    validateBook({ author_ids: [1], author_names: ["Name"] }),
  );
});
