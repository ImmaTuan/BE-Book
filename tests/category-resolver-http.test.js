import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { pool } from "../src/config/db.js";
import { app } from "../src/app.js";

test("admin category resolution validates batches, preserves order and never writes", async () => {
  process.env.JWT_SECRET = "category-resolver-test-secret-32-characters";
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  let categoryReads = 0;
  pool.getConnection = async () => { throw Error("Resolver must not open a write transaction"); };
  pool.execute = async (sql, args = []) => {
    if (/^SELECT id,\s*full_name,\s*email,\s*role,\s*is_active FROM users/.test(sql)) {
      return [[{ id: Number(args[0]), role: Number(args[0]) === 1 ? "admin" : "customer", is_active: 1 }], []];
    }
    if (sql === "SELECT id,name FROM categories ORDER BY name") {
      categoryReads++;
      return [[{id:7,name:"Science"},{id:8,name:"History"}],[]];
    }
    throw Error("Unexpected query: " + sql);
  };
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const token = id => jwt.sign({}, process.env.JWT_SECRET, {
      subject: String(id), expiresIn: "1h", issuer: "book-backend", audience: "book-app",
    });
    const call = async (body, auth = token(1)) => {
      const response = await fetch(base + "/api/admin/categories/resolve", {
        method: "POST",
        headers: {"Content-Type":"application/json", ...(auth ? {Authorization:"Bearer " + auth} : {})},
        body: JSON.stringify(body),
      });
      return {status:response.status, body:await response.json()};
    };
    assert.equal((await call({names:["Science"]}, "")).status, 401);
    assert.equal((await call({names:["Science"]}, token(2))).status, 403);
    assert.equal(categoryReads, 0);
    for (const body of [
      null, [], {}, {names:[]}, {names:"Science"}, {names:[null]}, {names:[{}]},
      {names:[" "]}, {names:["a".repeat(256)]}, {names:Array(501).fill("Science")},
      {names:["Science"], create:true},
    ]) assert.equal((await call(body)).status, 400, JSON.stringify(body));
    assert.equal(categoryReads, 0);
    const result = await call({names:["Khoa học","Missing","Lịch sử","Khoa học"]});
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.map(row=>row.category?.id ?? null),[7,null,8,7]);
    assert.deepEqual(result.body.data.map(row=>row.input),["Khoa học","Missing","Lịch sử","Khoa học"]);
    const max = await call({names:Array(500).fill("khoa hoc")});
    assert.equal(max.status,200);
    assert.equal(max.body.data.length,500);
    assert.equal(categoryReads,2);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
    await pool.end();
  }
});
