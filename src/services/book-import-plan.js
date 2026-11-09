import { bookImportChanges } from "../book-import-changes.js";
import { fail } from "../validation.js";
import { normalizeBookText } from "../book-identity.js";
import { resolveCategoryNames } from "../category-resolver.js";
import { findBook, findMatchingBook } from "../models/book.model.js";
import { createHash } from "node:crypto";

export async function importCatalog(db) {
  const [categories]=await db.execute("SELECT id,name FROM categories ORDER BY name");
  const [authors]=await db.execute("SELECT id,name FROM authors ORDER BY id");
  const [publishers]=await db.execute("SELECT id,name FROM publisher ORDER BY id");
  return {categories,authors,publishers};
}
export function validateSelections(selections) {
  if(!selections||typeof selections!=="object"||Array.isArray(selections)||Object.keys(selections).length>1500)
    fail("Danh sách ánh xạ không hợp lệ");
  for(const value of Object.values(selections)){
    if(value===null)continue;
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==1||
      !(Object.hasOwn(value,"id")||Object.hasOwn(value,"name")))fail("Chỉ chọn ID có sẵn hoặc tên tạo mới");
    if(Object.hasOwn(value,"id")&&(!Number.isInteger(value.id)||value.id<1))fail("ID ánh xạ không hợp lệ");
    if(Object.hasOwn(value,"name")&&(typeof value.name!=="string"||!value.name.trim()||value.name.length>255))
      fail("Tên tạo mới phải từ 1 đến 255 ký tự");
  }
  return selections;
}
function reference(kind,input,catalog,selection) {
  const rows=catalog[{category:"categories",author:"authors",publisher:"publishers"}[kind]];
  const key=kind+":"+normalizeBookText(input);
  const match=name=>kind==="category"
    ? resolveCategoryNames([name],rows)[0]
    : (()=>{const candidates=rows.filter(row=>normalizeBookText(row.name)===normalizeBookText(name));
      return {status:candidates.length===1?"matched":candidates.length?"ambiguous":"unmatched",category:candidates.length===1?candidates[0]:null,candidates};})();
  const result=match(input);
  let selected=result.category?{id:result.category.id,name:result.category.name,is_new:false}:null;
  if(selection!==undefined){
    selected=null;
    if(selection?.id){
      const row=rows.find(row=>Number(row.id)===selection.id);
      if(!row)fail("Bản ghi được chọn không tồn tại: "+input,409);
      selected={id:row.id,name:row.name,is_new:false};
    }else if(selection?.name){
      const name=selection.name.normalize("NFC").trim();
      const current=match(name);
      if(current.status==="ambiguous")fail("Tên tạo mới đang trùng nhiều bản ghi: "+name,409);
      selected=current.category
        ?{id:current.category.id,name:current.category.name,is_new:false}
        :{id:null,name,is_new:true};
    }
  }
  return {key,kind,input,status:result.status,selected,candidates:result.candidates||[]};
}
export async function buildImportPlan(db,mode,sourceRows,selections={}) {
  validateSelections(selections);
  const catalog=await importCatalog(db), references=new Map(),seen=new Map();
  function resolve(kind,name){
    const key=kind+":"+normalizeBookText(name);
    if(!references.has(key))references.set(key,reference(kind,name,catalog,selections[key]));
    return references.get(key);
  }
  const rows=[];
  for(const source of sourceRows) {
    const row={line:source.line,raw:source.raw,errors:[...source.errors],action:null,book_id:null,title:source.data?.title||String(source.raw.title??""),quantity:source.data?.quantity??null};
    rows.push(row);
    if(row.errors.length||!source.data)continue;
    const data=structuredClone(source.data);
    let book;
    if(mode==="stock"){
      book=await findBook(data.book_id,db);
      if(!book){row.errors.push("Không tìm thấy mã sách");continue;}
      row.action="stock_added";row.book_id=book.id;row.title=book.title;
      row.data={book_id:book.id,quantity:data.quantity,note:data.note};
    }else{
      const category=resolve("category",data.category);
      const authors=data.author_names.map(name=>resolve("author",name));
      const publishers=data.publisher_names.map(name=>resolve("publisher",name));
      for(const ref of [category,...authors,...publishers])if(!ref.selected)row.errors.push("Cần chọn hoặc xác nhận tạo "+({category:"thể loại",author:"tác giả",publisher:"NXB"}[ref.kind])+": "+ref.input);
      if(row.errors.length)continue;
      const payload={...data,author_names:authors.map(ref=>ref.selected.name),publisher_names:publishers.map(ref=>ref.selected.name)};
      delete payload.category;delete payload.quantity;delete payload.note;
      payload.category_id=category.selected.id;
      book=await findMatchingBook(payload,db);
      row.action=book?"stock_added":"created";row.book_id=book?.id??null;
      if(book){
        if(Number(category.selected.id)!==Number(book.category_id))row.errors.push("Sách trùng tên, tác giả và NXB nhưng khác thể loại. Hãy chọn đúng thể loại của sách hiện có.");
        row.changes=bookImportChanges(book,payload);
        if(row.changes.length)row.action="stock_updated";
      }
      row.data=payload;
      row.category=category.selected;
      row.note=data.note;
    }
    const key=book?"id:"+book.id:JSON.stringify([
      normalizeBookText(row.data.title),
      [...new Set(row.data.author_names.map(normalizeBookText))].sort(),
      [...new Set(row.data.publisher_names.map(normalizeBookText))].sort(),
    ]);
    if(seen.has(key))row.errors.push("Trùng sách với dòng "+seen.get(key)+". Hãy gộp số lượng thành một dòng.");
    else seen.set(key,row.line);
    if(book) {
      row.current_stock=Number(book.stock_quantity);
      row.stock_after=row.current_stock+row.quantity;
      row.kept_price=Number(book.price);row.hidden=!Number(book.is_active);
      if(row.stock_after>2147483647)row.errors.push("Tồn kho sau nhập vượt giới hạn");
    }else row.stock_after=row.quantity;
  }
  if(references.size>1500)fail("Quá nhiều danh mục khác nhau. Hãy chia nhỏ file.");
  for(const key of Object.keys(selections))if(!references.has(key))fail("Ánh xạ không thuộc dữ liệu file");
  const summary={
    total:rows.length, errors:rows.filter(row=>row.errors.length).length,
    created:rows.filter(row=>!row.errors.length&&row.action==="created").length,
    stock_added:rows.filter(row=>!row.errors.length&&["stock_added","stock_updated"].includes(row.action)).length,
    updated:rows.filter(row=>!row.errors.length&&row.action==="stock_updated").length,
    quantity:rows.filter(row=>!row.errors.length).reduce((sum,row)=>sum+row.quantity,0),
    new_references:[...references.values()].filter(ref=>ref.selected?.is_new).length,
  };
  const plan={mode,rows,references:[...references.values()],catalog,summary};
  // Stock can change through sales; IDs, actions and displayed kept prices must still match.
  const hash=createHash("sha256").update(JSON.stringify({
    rows:rows.map(({current_stock,stock_after,...row})=>row),
    references:plan.references.map(({candidates,...ref})=>ref),
  })).digest("hex");
  return {...plan,hash};
}
