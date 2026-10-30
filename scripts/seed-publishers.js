import { readFile } from "node:fs/promises";
import { pool } from "../src/config/db.js";

const connection = await pool.getConnection();
let locked = false;
try {
  const [[lock]] = await connection.execute(
    "SELECT GET_LOCK(?, 30) AS acquired",
    ["moc:book-catalog-write"],
  );
  if (Number(lock.acquired) !== 1)
    throw new Error("Danh mục đang được cập nhật. Vui lòng thử lại.");
  locked = true;
  for (const name of ["add_publishers.sql", "seed_publishers.sql"]) {
    const source = await readFile(
      new URL(`../database/${name}`, import.meta.url),
      "utf8",
    );
    // These checked-in SQL files have no stored routines or semicolons inside strings.
    for (const statement of source
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await connection.query(statement);
    }
  }
  const [[summary]] = await connection.execute(
    `SELECT (SELECT COUNT(*) FROM publisher) AS publishers,
      (SELECT COUNT(*) FROM books) AS books,
      (SELECT COUNT(DISTINCT book_id) FROM book_publisher) AS books_with_publishers`,
  );
  if (Number(summary.books) !== Number(summary.books_with_publishers))
    throw new Error("Vẫn còn sách chưa có nhà xuất bản.");
  console.log("Đã tạo bảng và hoàn tất dữ liệu nhà xuất bản:", summary);
} catch (error) {
  await connection.rollback();
  console.error("Không thể thêm dữ liệu nhà xuất bản:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (locked)
      await connection.execute("SELECT RELEASE_LOCK(?)", [
        "moc:book-catalog-write",
      ]);
  } finally {
    connection.release();
    await pool.end();
  }
}
