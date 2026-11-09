import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseWorkbook, createTemplate, createErrorWorkbook, normalizeImportRow, checkWorkbookZip } from "../src/services/book-workbook.js";
import { readWorkbook } from "../src/services/book-workbook-reader.js";
async function workbook(mode,rows){
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet(mode==="stock"?"NhapKho":"Sach");
  for(const row of rows)sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
test("book workbook preserves row numbers, Unicode, multiple authors and reports row errors",async()=>{
  const bytes=await workbook("books",[
    ["Tên sách","Tác giả","Nhà xuất bản","Thể loại","Giá bán","Số lượng nhập","Khối lượng (g)","Năm xuất bản","URL ảnh bìa"],
    ["Khoa học vui","A; B","NXB Trẻ","Khoa học",85000,4,300,2025,"https://example.com/book.jpg"],
    [],
    ["Sai số lượng","","","Science",10000,-1,300],
    ["Có công thức","","","Science",{formula:"1+1",result:2},1,300],
  ]);
  const rows=await readWorkbook(bytes,"books");
  assert.deepEqual(rows.map(row=>row.line),[2,4,5]);
  assert.deepEqual(rows[0].data.author_names,["A","B"]);
  assert.deepEqual(rows[0].data.publisher_names,["NXB Trẻ"]);
  assert.equal(rows[0].data.price,85000);
  assert.ok(rows[1].errors[0].includes("Số lượng"));
  assert.ok(rows[2].errors[0].includes("công thức"));
});
test("stock workbook accepts BK codes and integer quantities; malformed input is rejected",async()=>{
  const rows=await parseWorkbook(await workbook("stock",[
    ["Mã sách","Số lượng nhập","Ghi chú"],["BK-0007",10,"Phiếu nhập 1"],[8,2,""],["BK-x",1,""],[9,1.5,""],
  ]),"stock");
  assert.equal(rows[0].data.book_id,7);assert.equal(rows[0].data.quantity,10);
  assert.equal(rows[1].data.book_id,8);
  assert.equal(rows[2].errors.length,1);assert.equal(rows[3].errors.length,1);
  for(const quantity of ["1.000","1,000","2 cuốn",0,2147483648]){
    assert.throws(()=>normalizeImportRow({book_id:1,quantity},"stock"));
  }
});
test("rejects non-xlsx, unknown/duplicate/missing headers, empty files and more than 500 rows",async()=>{
  assert.throws(()=>checkWorkbookZip(Buffer.from("not xlsx")));
  for(const rows of [
    [["Mã sách","Số lượng nhập","Không hỗ trợ"],[1,1,""]],
    [["Mã sách","Số lượng nhập","quantity"],[1,1,1]],
    [["Mã sách"],[1]],
    [["Mã sách","Số lượng nhập"]],
    [["Mã sách","Số lượng nhập"],...Array.from({length:501},(_,i)=>[i+1,1])],
  ])await assert.rejects(()=>workbook("stock",rows).then(bytes=>parseWorkbook(bytes,"stock")));
});
test("templates include a blank data sheet, instructions and categories; error report contains literal text",async()=>{
  for(const mode of ["books","stock"]){
    const book=new ExcelJS.Workbook();
    await book.xlsx.load(await createTemplate(mode,[{id:1,name:"Science"}]));
    assert.equal(book.worksheets[0].rowCount,1);
    assert.ok(book.getWorksheet("HuongDan"));
    assert.equal(book.getWorksheet("TheLoai").getCell("B2").value,"Science");
  }
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(await createErrorWorkbook([{line:4,raw:{title:"=1+1"},errors:["Sai số lượng"]},{line:2,raw:{},errors:[]}]));
  assert.equal(book.worksheets[0].rowCount,2);
  assert.equal(book.worksheets[0].getCell("C2").value,"=1+1");
});
test("data in columns without headers is reported instead of discarded",async()=>{
  const rows=await parseWorkbook(await workbook("stock",[["Mã sách","Số lượng nhập"],[1,2,"unexpected"]]),"stock");
  assert.ok(rows[0].errors.some(message=>message.includes("chưa có tiêu đề")));
});

test("plain numeric fields and safe URLs are enforced",()=>{
  const base={title:"Title",category:"Science",price:0,quantity:1,weight_grams:100};
  assert.equal(normalizeImportRow(base,"books").price,0);
  for(const patch of [{price:""},{price:"85.000"},{weight_grams:0},{cover_url:"javascript:alert(1)"},{publication_year:10000}]){
    assert.throws(()=>normalizeImportRow({...base,...patch},"books"));
  }
});
