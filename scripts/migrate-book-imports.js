import { readFile } from "node:fs/promises";
import { pool } from "../src/config/db.js";
try {
  await pool.query(await readFile(new URL("../database/add_book_imports.sql", import.meta.url), "utf8"));
  console.log("Book imports schema is ready");
} finally { await pool.end(); }
