import { randomUUID, createHash } from "node:crypto";
import { pool } from "../config/db.js";
import { fail } from "../validation.js";
import { lockCatalog, releaseCatalog } from "../catalog-lock.js";
import { createBookInTransaction, incrementStock } from "./book.model.js";
import { buildImportPlan, importCatalog, validateSelections } from "../services/book-import-plan.js";
import { resolveCategoryNames } from "../category-resolver.js";

const decode=value=>typeof value==="string"?JSON.parse(value):value;
function view(batch){
  return {id:batch.id,mode:batch.mode,file_name:batch.file_name,status:batch.status,
    created_at:batch.created_at,completed_at:batch.completed_at,
    selections:decode(batch.selections_json),preview:decode(batch.preview_json),result:batch.result_json?decode(batch.result_json):null};
}
async function ownBatch(db,id,userId,lock=false){
  const [rows]=await db.execute(
    "SELECT *, expires_at <= NOW() AS expired FROM book_imports WHERE id = ? AND user_id = ?"+(lock?" FOR UPDATE":""),[id,userId]);
  if(!rows.length)fail("Không tìm thấy lần nhập",404);
  return rows[0];
}
export async function getImport(id,userId){return view(await ownBatch(pool,id,userId));}
export async function listImports(userId){
  const [rows]=await pool.execute("SELECT id,mode,file_name,status,created_at,completed_at,result_json FROM book_imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",[userId]);
  return rows.map(({result_json,...row})=>({...row,result:result_json?decode(result_json):null}));
}
export async function createImport(userId,mode,fileName,buffer,rows){
  const hash=createHash("sha256").update(buffer).digest("hex");
  const plan=await buildImportPlan(pool,mode,rows);
  const batchId=randomUUID();
  await pool.execute(
    "INSERT INTO book_imports (id,user_id,mode,file_name,file_sha256,rows_json,selections_json,preview_json,preview_hash,expires_at) VALUES (?,?,?,?,?,?,?, ?,?,DATE_ADD(NOW(),INTERVAL 24 HOUR)) ON DUPLICATE KEY UPDATE id=id",
    [batchId,userId,mode,fileName,hash,JSON.stringify(rows),"{}",JSON.stringify(plan),plan.hash]);
  const [[batch]]=await pool.execute("SELECT id FROM book_imports WHERE user_id = ? AND mode = ? AND file_sha256 = ?",[userId,mode,hash]);
  return getImport(batch.id,userId);
}
export async function reviewImport(id,userId,selections){
  validateSelections(selections);
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const batch=await ownBatch(db,id,userId,true);
    if(batch.status==="completed"){await db.commit();return view(batch);}
    const plan=await buildImportPlan(db,batch.mode,decode(batch.rows_json),selections);
    await db.execute("UPDATE book_imports SET selections_json=?,preview_json=?,preview_hash=?,expires_at=DATE_ADD(NOW(),INTERVAL 24 HOUR) WHERE id=?",
      [JSON.stringify(selections),JSON.stringify(plan),plan.hash,id]);
    await db.commit();
    return {id:batch.id,mode:batch.mode,file_name:batch.file_name,status:"preview",selections,preview:plan,result:null};
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}
export async function commitImport(id,userId,expectedHash){
  const db=await pool.getConnection();let locked=false;
  try{
    await lockCatalog(db);locked=true;
    await db.beginTransaction();
    const batch=await ownBatch(db,id,userId,true);
    if(batch.status==="completed"){await db.commit();return view(batch);}
    if(Number(batch.expired))fail("Bản xem trước đã hết hạn. Hãy kiểm tra lại.",409);
    if(expectedHash!==batch.preview_hash)fail("Bản xem trước đã thay đổi. Hãy kiểm tra lại.",409);
    const plan=await buildImportPlan(db,batch.mode,decode(batch.rows_json),decode(batch.selections_json));
    if(plan.summary.errors)fail("Còn dòng lỗi. Hãy sửa file hoặc hoàn tất ánh xạ trước khi nhập.",409);
    if(plan.hash!==expectedHash)fail("Danh mục đã thay đổi. Hãy kiểm tra lại trước khi nhập.",409);
    const categories=(await importCatalog(db)).categories;
    const results=[];
    // Stable lock order for stock-only batches reduces deadlocks with other stock operations.
    const ordered=batch.mode==="stock"?[...plan.rows].sort((a,b)=>a.book_id-b.book_id):plan.rows;
    for(const row of ordered){
      if(batch.mode==="stock" || ["stock_added","stock_updated"].includes(row.action)){
        const change=await incrementStock(db,row.book_id,row.quantity);
        const changes=row.changes||[];
        if(changes.length){
          const allowed=new Set(["price","publication_year","cover_url"]);
          if(changes.some(change=>!allowed.has(change.field)))fail("Trường cập nhật không hợp lệ");
          await db.execute("UPDATE books SET "+changes.map(change=>change.field+" = ?").join(", ")+" WHERE id = ?",[...changes.map(change=>change.after),row.book_id]);
        }
        results.push({line:row.line,book_id:row.book_id,title:row.title,action:row.action,quantity:row.quantity,...change,changes,note:row.data.note??row.note});
      }else{
        let categoryId=row.category.id;
        if(!categoryId){
          const match=resolveCategoryNames([row.category.name],categories)[0];
          if(match.status==="ambiguous")fail("Thể loại bị trùng. Hãy kiểm tra lại.",409);
          if(match.category)categoryId=match.category.id;
          else{
            const [created]=await db.execute("INSERT INTO categories (name) VALUES (?)",[row.category.name]);
            categoryId=created.insertId;categories.push({id:categoryId,name:row.category.name});
          }
        }
        const result=await createBookInTransaction(db,{...row.data,category_id:categoryId});
        results.push({line:row.line,book_id:result.book.id,title:result.book.title,action:result.action,quantity:row.quantity,
          stock_before:Number(result.book.stock_quantity)-row.quantity,stock_after:Number(result.book.stock_quantity),note:row.note});
      }
    }
    results.sort((a,b)=>a.line-b.line);
    const result={...plan.summary,rows:results};
    await db.execute("UPDATE book_imports SET status='completed',result_json=?,completed_at=NOW() WHERE id=?",[JSON.stringify(result),id]);
    await db.commit();
    return {...view(batch),status:"completed",result};
  }catch(error){await db.rollback();throw error;}finally{await releaseCatalog(db,locked);}
}
