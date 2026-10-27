import {pool} from '../config/db.js';
import {fail} from '../validation.js';

export async function listCategories(){
 const [rows]=await pool.execute('SELECT id,name FROM categories ORDER BY name');
 return rows;
}

export async function findCategory(id,db=pool){
 const [rows]=await db.execute('SELECT id,name FROM categories WHERE id = ?',[id]);
 return rows[0];
}

export async function createCategory(name){
 const [result]=await pool.execute('INSERT INTO categories (name) VALUES (?)',[name]);
 return findCategory(result.insertId);
}

export async function updateCategory(id,name){
 const connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const current=await findCategory(id,connection);
  if(!current)fail('Không tìm thấy thể loại',404);
  await connection.execute('UPDATE categories SET name = ? WHERE id = ?',[name,id]);
  const updated=await findCategory(id,connection);
  await connection.commit();
  return updated;
 }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

export async function deleteCategory(id){
 const connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const current=await findCategory(id,connection);
  if(!current)fail('Không tìm thấy thể loại',404);
  await connection.execute('DELETE FROM categories WHERE id = ?',[id]);
  await connection.commit();
 }catch(error){
  await connection.rollback();
  if(error.code==='ER_ROW_IS_REFERENCED_2')fail('Không thể xóa thể loại đang được sách sử dụng',409);
  throw error;
 }finally{connection.release();}
}
