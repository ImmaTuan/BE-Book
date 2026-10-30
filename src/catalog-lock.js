import { fail } from "./validation.js";

const lockName = "moc:book-catalog-write";

export async function lockCatalog(connection) {
  const [[result]] = await connection.execute(
    "SELECT GET_LOCK(?, 10) AS acquired",
    [lockName],
  );
  if (Number(result.acquired) !== 1)
    fail("Danh mục đang được cập nhật. Vui lòng thử lại.", 409);
}

export async function releaseCatalog(connection, locked) {
  try {
    if (locked) await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]);
  } finally {
    connection.release();
  }
}
