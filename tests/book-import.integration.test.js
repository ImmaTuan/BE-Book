import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import ExcelJS from "exceljs";
import { pool } from "../src/config/db.js";
import { app } from "../src/app.js";
import * as imports from "../src/models/book-import.model.js";
import { normalizeImportRow, parseWorkbook } from "../src/services/book-workbook.js";

test("Excel import with real MySQL, isolated fixtures and outer rollback",{
  skip:process.env.RUN_BOOK_IMPORT_MYSQL_TEST!=="1",
},async t=>{
  const savedExecute=pool.execute,savedGetConnection=pool.getConnection,oldSecret=process.env.JWT_SECRET;
  const db=await pool.getConnection();
  let server,injectBook=null;
  await db.beginTransaction();
  const execute=async(sql,args=[])=>{
    if(injectBook&&sql.startsWith("UPDATE books SET stock_quantity = stock_quantity +")&&Number(args[1])===injectBook)
      throw Object.assign(new Error("Simulated second-row failure"),{status:400});
    return db.execute(sql,args);
  };
  pool.execute=execute;
  pool.getConnection=async()=>({
    execute,
    beginTransaction:()=>db.query("SAVEPOINT excel_import_inner"),
    commit:()=>db.query("RELEASE SAVEPOINT excel_import_inner"),
    rollback:async()=>{await db.query("ROLLBACK TO SAVEPOINT excel_import_inner");await db.query("RELEASE SAVEPOINT excel_import_inner");},
    release(){},
  });
  t.after(async()=>{
    if(server)await new Promise(resolve=>server.close(resolve));
    pool.execute=savedExecute;pool.getConnection=savedGetConnection;
    await db.rollback();db.release();await pool.end();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });
  const tag=randomUUID().slice(0,8);
  const [[admin]]=await db.execute("SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 1");
  const [[customer]]=await db.execute("SELECT id FROM users WHERE role='customer' AND is_active=1 LIMIT 1");
  assert.ok(admin&&customer,"Need seeded admin and customer accounts");
  const [category]=await db.execute("INSERT INTO categories(name) VALUES(?)",["IMPORT-CATEGORY-"+tag]);
  const makeBook=async title=>{
    const [result]=await db.execute("INSERT INTO books(category_id,title,price,stock_quantity,weight_grams,is_active) VALUES(?,?,50000,10,300,0)",[category.insertId,title]);
    return result.insertId;
  };
  const existingTitle="IMPORT-EXISTING-"+tag, existingId=await makeBook(existingTitle);
  const secondId=await makeBook("IMPORT-SECOND-"+tag);
  await db.execute("UPDATE books SET publication_year=2020,cover_url=? WHERE id=?",["https://example.com/old.jpg",existingId]);
  const stock=async id=>Number((await db.execute("SELECT stock_quantity FROM books WHERE id=?",[id]))[0][0].stock_quantity);
  const row=(line,raw,mode="books")=>({line,raw,data:normalizeImportRow(raw,mode),errors:[]});
  const newTitle="IMPORT-NEW-"+tag,newCategory="IMPORT-NEW-CATEGORY-"+tag;
  const author="IMPORT-AUTHOR-"+tag,publisher="IMPORT-PUBLISHER-"+tag;
  const input=[
    row(2,{title:newTitle,authors:author,publishers:publisher,category:newCategory,price:85000,quantity:5,weight_grams:350}),
    row(3,{title:existingTitle,category:"IMPORT-CATEGORY-"+tag,price:99999,quantity:3,weight_grams:800,publication_year:2025,cover_url:"https://example.com/new.jpg"}),
  ];
  let batch,reviewed;
  await t.test("preview writes no books or stock and unresolved names block commit",async()=>{
    batch=await imports.createImport(admin.id,"books","fixture.xlsx",Buffer.from("fixture-"+tag),input);
    assert.equal(batch.preview.summary.errors,1);
    assert.equal(await stock(existingId),10);
    assert.equal((await db.execute("SELECT id FROM books WHERE title=?",[newTitle]))[0].length,0);
    await assert.rejects(()=>imports.commitImport(batch.id,admin.id,batch.preview.hash),e=>e.status===409);
    assert.equal(await stock(existingId),10);
  });
  await t.test("explicit mappings create catalogs and update matching book metadata while preserving visibility and weight",async()=>{
    const selections={};
    for(const ref of batch.preview.references)if(!ref.selected)selections[ref.key]={name:ref.input};
    reviewed=await imports.reviewImport(batch.id,admin.id,selections);
    assert.equal(reviewed.preview.summary.errors,0);
    assert.equal(reviewed.preview.summary.created,1);
    assert.equal(reviewed.preview.summary.stock_added,1);
    const done=await imports.commitImport(batch.id,admin.id,reviewed.preview.hash);
    assert.equal(done.status,"completed");assert.equal(done.result.quantity,8);
    const [[created]]=await db.execute("SELECT * FROM books WHERE title=?",[newTitle]);
    assert.equal(created.stock_quantity,5);
    const [[linkedAuthor]]=await db.execute("SELECT a.name FROM authors a JOIN book_authors ba ON a.id=ba.author_id WHERE ba.book_id=?",[created.id]);
    const [[linkedPublisher]]=await db.execute("SELECT p.name FROM publisher p JOIN book_publisher bp ON p.id=bp.publisher_id WHERE bp.book_id=?",[created.id]);
    assert.equal(linkedAuthor.name,author);assert.equal(linkedPublisher.name,publisher);
    const [[existing]]=await db.execute("SELECT * FROM books WHERE id=?",[existingId]);
    assert.equal(existing.stock_quantity,13);assert.equal(existing.price,99999);
    assert.equal(existing.publication_year,2025);assert.equal(existing.cover_url,"https://example.com/new.jpg");
    assert.equal(done.result.updated,1);
    assert.deepEqual(done.result.rows.find(row=>row.book_id===existingId).changes.map(change=>change.field),["price","publication_year","cover_url"]);
    assert.equal(existing.weight_grams,300);assert.equal(existing.is_active,0);
  });
  await t.test("retry, reopening and uploading identical file never add stock twice",async()=>{
    assert.equal((await imports.commitImport(batch.id,admin.id,reviewed.preview.hash)).status,"completed");
    const duplicate=await imports.createImport(admin.id,"books","renamed.xlsx",Buffer.from("fixture-"+tag),input);
    assert.equal(duplicate.id,batch.id);assert.equal(duplicate.status,"completed");
    assert.equal((await imports.getImport(batch.id,admin.id)).result.rows.length,2);
    assert.equal(await stock(existingId),13);
    await assert.rejects(()=>imports.getImport(batch.id,customer.id),e=>e.status===404);
    await assert.rejects(()=>imports.commitImport(batch.id,customer.id,reviewed.preview.hash),e=>e.status===404);
  });
  await t.test("second-row failure rolls back every stock update and permits safe retry",async()=>{
    const input=[row(2,{book_id:existingId,quantity:2},"stock"),row(3,{book_id:secondId,quantity:4},"stock")];
    const pending=await imports.createImport(admin.id,"stock","stock.xlsx",Buffer.from("stock-"+tag),input);
    injectBook=secondId;
    await assert.rejects(()=>imports.commitImport(pending.id,admin.id,pending.preview.hash),/second-row/);
    injectBook=null;
    assert.equal(await stock(existingId),13);assert.equal(await stock(secondId),10);
    assert.equal((await imports.getImport(pending.id,admin.id)).status,"preview");
    const done=await imports.commitImport(pending.id,admin.id,pending.preview.hash);
    assert.equal(done.status,"completed");
    assert.equal(await stock(existingId),15);assert.equal(await stock(secondId),14);
    assert.deepEqual(done.result.rows.map(r=>[r.stock_before,r.stock_after]),[[13,15],[10,14]]);
  });
  await t.test("duplicate rows, stale preview and expiry are blocked until review",async()=>{
    const dupeRows=[row(2,{book_id:existingId,quantity:1},"stock"),row(3,{book_id:existingId,quantity:1},"stock")];
    const duplicate=await imports.createImport(admin.id,"stock","duplicate.xlsx",Buffer.from("dupe-"+tag),dupeRows);
    assert.equal(duplicate.preview.summary.errors,1);
    const fresh=await imports.createImport(admin.id,"stock","fresh.xlsx",Buffer.from("fresh-"+tag),[row(2,{book_id:existingId,quantity:1},"stock")]);
    await assert.rejects(()=>imports.commitImport(fresh.id,admin.id,"0".repeat(64)),e=>e.status===409);
    await db.execute("UPDATE book_imports SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?",[fresh.id]);
    await assert.rejects(()=>imports.commitImport(fresh.id,admin.id,fresh.preview.hash),e=>e.status===409);
    const renewed=await imports.reviewImport(fresh.id,admin.id,{});
    assert.equal((await imports.commitImport(fresh.id,admin.id,renewed.preview.hash)).status,"completed");
  });
  await t.test("failure after creating a book also rolls back its new category, author and publisher",async()=>{
    const title="IMPORT-ROLLBACK-BOOK-"+tag,categoryName="IMPORT-ROLLBACK-CAT-"+tag;
    const authorName="IMPORT-ROLLBACK-AUTHOR-"+tag,publisherName="IMPORT-ROLLBACK-PUB-"+tag;
    const input=[
      row(2,{title,authors:authorName,publishers:publisherName,category:categoryName,price:100,quantity:1,weight_grams:100}),
      row(3,{title:existingTitle,category:"IMPORT-CATEGORY-"+tag,price:99999,quantity:1,weight_grams:100}),
    ];
    const pending=await imports.createImport(admin.id,"books","rollback.xlsx",Buffer.from("rollback-"+tag),input);
    const selections=Object.fromEntries(pending.preview.references.filter(ref=>!ref.selected).map(ref=>[ref.key,{name:ref.input}]));
    const approved=await imports.reviewImport(pending.id,admin.id,selections);
    const before=await stock(existingId);injectBook=existingId;
    await assert.rejects(()=>imports.commitImport(pending.id,admin.id,approved.preview.hash),/second-row/);
    injectBook=null;
    assert.equal(await stock(existingId),before);
    for(const [table,column,value]of [["books","title",title],["categories","name",categoryName],["authors","name",authorName],["publisher","name",publisherName]]){
      assert.equal((await db.execute("SELECT id FROM "+table+" WHERE "+column+"=?",[value]))[0].length,0,table);
    }
    assert.equal((await imports.getImport(pending.id,admin.id)).status,"preview");
  });
  await t.test("catalog changes invalidate reviewed decisions without adding stock",async()=>{
    const pending=await imports.createImport(admin.id,"stock","changed.xlsx",Buffer.from("changed-"+tag),[row(2,{book_id:existingId,quantity:1},"stock")]);
    const before=await stock(existingId);
    await db.execute("UPDATE books SET price=50001 WHERE id=?",[existingId]);
    await assert.rejects(()=>imports.commitImport(pending.id,admin.id,pending.preview.hash),e=>e.status===409);
    assert.equal(await stock(existingId),before);
    await db.execute("UPDATE books SET price=99999 WHERE id=?",[existingId]);
  });
  await t.test("later row failure rolls back metadata updates together with stock",async()=>{
    const before=await stock(existingId);
    const pending=await imports.createImport(admin.id,"books","rollback-metadata.xlsx",Buffer.from("rollback-metadata-"+tag),[
      row(2,{title:existingTitle,category:"IMPORT-CATEGORY-"+tag,price:12345,quantity:1,weight_grams:300,publication_year:2026,cover_url:"https://example.com/rollback.jpg"}),
      row(3,{title:"IMPORT-SECOND-"+tag,category:"IMPORT-CATEGORY-"+tag,price:50000,quantity:1,weight_grams:300}),
    ]);
    assert.equal(pending.preview.summary.errors,0);
    injectBook=secondId;
    await assert.rejects(()=>imports.commitImport(pending.id,admin.id,pending.preview.hash),/second-row/);
    injectBook=null;
    const [[book]]=await db.execute("SELECT price,publication_year,cover_url,stock_quantity FROM books WHERE id=?",[existingId]);
    assert.equal(Number(book.stock_quantity),before);
    assert.equal(book.price,99999);assert.equal(book.publication_year,2025);
    assert.equal(book.cover_url,"https://example.com/new.jpg");
    assert.equal((await imports.getImport(pending.id,admin.id)).status,"preview");
  });
  await t.test("different category blocks updates; empty optional cells preserve year and cover",async()=>{
    const mismatch=await imports.createImport(admin.id,"books","category-mismatch.xlsx",Buffer.from("mismatch-"+tag),[
      row(2,{title:existingTitle,category:newCategory,price:1,quantity:1,weight_grams:300}),
    ]);
    assert.equal(mismatch.preview.summary.errors,1);
    assert.ok(mismatch.preview.rows[0].errors.some(message=>message.includes("khác thể loại")));
    const before=await stock(existingId);
    await assert.rejects(()=>imports.commitImport(mismatch.id,admin.id,mismatch.preview.hash),e=>e.status===409);
    assert.equal(await stock(existingId),before);
    const pending=await imports.createImport(admin.id,"books","blank-optional.xlsx",Buffer.from("blank-"+tag),[
      row(2,{title:existingTitle,category:"IMPORT-CATEGORY-"+tag,price:88000,quantity:1,weight_grams:300,publication_year:"",cover_url:""}),
    ]);
    assert.deepEqual(pending.preview.rows[0].changes.map(change=>change.field),["price"]);
    await imports.commitImport(pending.id,admin.id,pending.preview.hash);
    const [[updated]]=await db.execute("SELECT price,publication_year,cover_url FROM books WHERE id=?",[existingId]);
    assert.equal(updated.price,88000);assert.equal(updated.publication_year,2025);
    assert.equal(updated.cover_url,"https://example.com/new.jpg");
    const unchanged=await imports.createImport(admin.id,"books","unchanged.xlsx",Buffer.from("unchanged-"+tag),[
      row(2,{title:existingTitle,category:"IMPORT-CATEGORY-"+tag,price:88000,quantity:1,weight_grams:300,publication_year:2025,cover_url:"https://example.com/new.jpg"}),
    ]);
    assert.equal(unchanged.preview.rows[0].action,"stock_added");
    assert.deepEqual(unchanged.preview.rows[0].changes,[]);
  });
  await t.test("authenticated HTTP template/upload/errors/history endpoints work and enforce admin access",async()=>{
    process.env.JWT_SECRET="excel-import-test-secret-at-least-32-chars";
    server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
    const base="http://127.0.0.1:"+server.address().port+"/api/admin/book-imports";
    const token=id=>jwt.sign({},process.env.JWT_SECRET,{subject:String(id),expiresIn:"5m",issuer:"book-backend",audience:"book-app"});
    const headers=id=>({Authorization:"Bearer "+token(id)});
    assert.equal((await fetch(base)).status,401);
    assert.equal((await fetch(base,{headers:headers(customer.id)})).status,403);
    const template=await fetch(base+"/template?mode=stock",{headers:headers(admin.id)});
    assert.equal(template.status,200);
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await template.arrayBuffer());
    workbook.getWorksheet("NhapKho").addRow(["BK-"+existingId,2,"HTTP test"]);
    workbook.getWorksheet("NhapKho").addRow(["BK-invalid",2,"HTTP error"]);
    const bytes=await workbook.xlsx.writeBuffer();
    const form=new FormData();form.append("mode","stock");form.append("file",new Blob([bytes]),"http.xlsx");
    const upload=await fetch(base+"/preview",{method:"POST",headers:headers(admin.id),body:form});
    assert.equal(upload.status,200);
    const uploaded=(await upload.json()).data;assert.equal(uploaded.preview.summary.errors,1);
    const report=await fetch(base+"/"+uploaded.id+"/errors",{headers:headers(admin.id)});
    assert.equal(report.status,200);
    const errors=new ExcelJS.Workbook();await errors.xlsx.load(await report.arrayBuffer());
    assert.equal(errors.worksheets[0].getCell("A2").value,3);
    assert.equal((await fetch(base+"/"+uploaded.id,{headers:headers(customer.id)})).status,403);
    const bad=new FormData();bad.append("mode","stock");bad.append("file",new Blob(["not excel"]),"bad.xlsx");
    assert.equal((await fetch(base+"/preview",{method:"POST",headers:headers(admin.id),body:bad})).status,400);
    assert.ok((await (await fetch(base,{headers:headers(admin.id)})).json()).data.length>=4);
  });
});
