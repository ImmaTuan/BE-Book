import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBook} from '../src/validation.js';
import {pool} from '../src/config/db.js';
import {app} from '../src/app.js';
import jwt from 'jsonwebtoken';
process.env.JWT_SECRET='test-only-secret-32-characters-or-more';
test('book validation rejects invalid data and unsafe field names',()=>{assert.throws(()=>validateBook({title:'A'},true));assert.throws(()=>validateBook({price:-1}));assert.throws(()=>validateBook({title:' '}));assert.throws(()=>validateBook({cover_url:'javascript:alert(1)'}));assert.throws(()=>validateBook({id:4}));assert.equal(validateBook({is_active:false}).is_active,0);});
test('HTTP book CRUD, missing category, pagination and FK deletion errors',async()=>{
 let book=null,referenced=false,snapshot=null;
 const execute=async(sql,args=[])=>{
  if(sql.startsWith('SELECT id,full_name,email,role,is_active FROM users'))return [[{id:1,role:'admin',is_active:1}],[]];
  if(sql==='SELECT 1')return [[{ok:1}],[]];
  if(sql.startsWith('SELECT id FROM categories WHERE'))return [args[0]===1?[{id:1}]:[],[]];
  if(sql.startsWith('SELECT id, name FROM categories'))return [[{id:1,name:'Demo'}],[]];
  if(sql.startsWith('INSERT INTO books')){const keys=[...sql.split('VALUES')[0].matchAll(/`([a-z_]+)`/g)].map(x=>x[1]);book={id:5,...Object.fromEntries(keys.map((k,i)=>[k,args[i]]))};return [{insertId:5},[]];}
  if(sql.startsWith('SELECT COUNT(*)'))return [[{total:book?1:0}],[]];
  if(sql.startsWith('SELECT b.*'))return [book&&(!sql.includes('WHERE b.id')||args[0]===book.id)?[{...book,category_name:'Demo'}]:[],[]];
  if(sql.startsWith('SELECT id FROM books'))return [book?[{id:book.id}]:[],[]];
  if(sql.startsWith('UPDATE books')){const keys=[...sql.matchAll(/`([a-z_]+)`/g)].map(x=>x[1]);for(let i=0;i<keys.length;i++)book[keys[i]]=args[i];return [{affectedRows:1},[]];}
  if(sql.startsWith('DELETE FROM books')){if(referenced){const e=new Error('FK');e.code='ER_ROW_IS_REFERENCED_2';throw e;}book=null;return [{affectedRows:1},[]];}
  throw Error('Unexpected query: '+sql);
 };
 pool.execute=execute;pool.getConnection=async()=>({execute,beginTransaction:async()=>{snapshot=structuredClone(book);},commit:async()=>{},rollback:async()=>{book=snapshot;},release(){}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 const token=jwt.sign({},process.env.JWT_SECRET,{subject:'1',expiresIn:'1h',issuer:'book-backend',audience:'book-app'});
 const call=async(method,path,body)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});return [r.status,r.status===204?null:await r.json()];};
 try{
  const body={category_id:1,title:"Book ' test",price:100000,weight_grams:300};
  assert.equal((await call('POST','/api/admin/books',{...body,category_id:99}))[0],400);
  const [status,data]=await call('POST','/api/admin/books',body);assert.equal(status,201);assert.equal(data.data.id,5);
  assert.equal((await call('GET','/api/admin/books'))[1].meta.total,1);
  assert.equal((await call('PATCH','/api/admin/books/5',{price:120000}))[1].data.price,120000);
  assert.equal((await call('GET','/api/admin/books?limit=999'))[0],400);
  referenced=true;assert.equal((await call('DELETE','/api/admin/books/5'))[0],409);assert.ok(book);
  referenced=false;assert.equal((await call('DELETE','/api/admin/books/5'))[0],204);
  assert.equal((await call('GET','/api/admin/books/5'))[0],404);
  assert.equal((await call('GET','/api/admin/orders'))[0],404);
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
