import test from "node:test";
import assert from "node:assert/strict";
import { resolveCategoryNames, categoryAliases } from "../src/category-resolver.js";
const categories = [
  {id:1,name:"Science"}, {id:2,name:"Science Fiction"},
  {id:3,name:"Children's"}, {id:4,name:"Fiction"},
  {id:5,name:"Contemporary"}, {id:6,name:"Sequential Art"},
];
test("English, Vietnamese, unaccented and Unicode forms resolve to existing IDs", () => {
  const names=["  KHOA HỌC  ","khoa hoc","Khoa học".normalize("NFD"),"Science","Khoa học viễn tưởng","Sách thiếu nhi","Children’s Books","Truyện tranh"];
  assert.deepEqual(resolveCategoryNames(names,categories).map(item=>item.category?.id),[1,1,1,1,2,3,3,6]);
});
test("all declared aliases resolve without creating records", () => {
  for (const group of categoryAliases) {
    const rows=[{id:91,name:group.name}];
    const results=resolveCategoryNames([group.name,...group.aliases],rows);
    assert.ok(results.every(result=>result.status==="matched"&&result.category.id===91),group.name);
    assert.deepEqual(rows,[{id:91,name:group.name}]);
  }
});
test("unknown and broad names need confirmation; only actual database categories match", () => {
  const results=resolveCategoryNames(["Lịch sử","Tiểu thuyết","Văn học","Khoa học vũ trụ",""],categories);
  assert.ok(results.every(result=>result.status==="unmatched"&&result.category===null));
  assert.ok(results[3].candidates.some(category=>category.id===1));
  assert.equal(results[0].candidates.length,0);
});
test("translated stored names work; equivalent duplicates are ambiguous even for exact input", () => {
  assert.equal(resolveCategoryNames(["Science"],[{id:9,name:"Khoa học"}])[0].category.id,9);
  const duplicates=[{id:1,name:"Science"},{id:9,name:"Khoa học"}];
  for(const result of resolveCategoryNames(["Science","khoa hoc"],duplicates)){
    assert.equal(result.status,"ambiguous");
    assert.equal(result.category,null);
    assert.deepEqual(result.candidates.map(item=>item.id),[1,9]);
  }
});
