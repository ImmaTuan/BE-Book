import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {app} from '../src/app.js';
import {pool} from '../src/config/db.js';
process.env.JWT_SECRET='test-auth-secret-at-least-32-characters';
test('admin login, customer 403, missing/expired token 401 and immediate role revocation',async()=>{
 const hash=await bcrypt.hash('Test123456!',4);let active=1,adminRole='admin';
 pool.execute=async(sql,args=[])=>{
  if(sql==='SELECT * FROM users WHERE email = ?')return [[args[0]==='admin@test.local'?{id:1,full_name:'Admin',email:args[0],password_hash:hash,role:adminRole,is_active:active}:args[0]==='user@test.local'?{id:2,full_name:'User',email:args[0],password_hash:hash,role:'customer',is_active:1}:undefined].filter(Boolean),[]];
  if(sql.includes('FROM users WHERE id = ?'))return [[{id:args[0],full_name:'Account',role:args[0]===1?adminRole:'customer',is_active:args[0]===1?active:1}],[]];
  if(sql.startsWith('SELECT COUNT(*)'))return [[{total:0}],[]];
  if(sql.includes('FROM books'))return [[],[]];
  throw Error('Unexpected SQL: '+sql);
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api';
 const call=async(path,body,token)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
 try{
  assert.equal((await call('/admin/books'))[0],401);
  assert.equal((await call('/auth/admin/login',{email:'admin@test.local',password:'wrong'}))[0],401);
  assert.equal((await call('/auth/admin/login',{email:'user@test.local',password:'Test123456!'}))[0],403);
  const [s,d]=await call('/auth/admin/login',{email:'admin@test.local',password:'Test123456!'});assert.equal(s,200);assert.equal(d.data.user.role,'admin');assert.ok(!('password_hash' in d.data.user));const token=d.data.token;
  assert.equal((await call('/admin/books',null,token))[0],200);
  const user=(await call('/auth/login',{email:'user@test.local',password:'Test123456!'}))[1].data.token;
  assert.equal((await call('/admin/books',null,user))[0],403);
  assert.equal((await call('/auth/me',null,user))[0],200);
  const expired=jwt.sign({},process.env.JWT_SECRET,{subject:'1',issuer:'book-backend',audience:'book-app',expiresIn:-1});assert.equal((await call('/admin/books',null,expired))[0],401);
  const forged=jwt.sign({},'wrong-secret',{subject:'1',issuer:'book-backend',audience:'book-app'});assert.equal((await call('/admin/books',null,forged))[0],401);
  adminRole='customer';assert.equal((await call('/admin/books',null,token))[0],403);
  adminRole='admin';active=0;assert.equal((await call('/admin/books',null,token))[0],401);
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
