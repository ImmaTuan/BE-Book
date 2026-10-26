import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {pool} from '../config/db.js';
import {secret} from '../config/auth.js';
import {fail} from '../validation.js';
const registrationFields=['full_name','email','password'];
export async function register(req,res){
 const b=req.body;
 if(!b||typeof b!=='object'||Array.isArray(b))fail('Body phải là JSON object');
 if(Object.keys(b).some(k=>!registrationFields.includes(k)))fail('Chỉ nhận full_name, email và password');
 const full_name=typeof b.full_name==='string'?b.full_name.trim():'';
 const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!full_name||full_name.length>255)fail('full_name là bắt buộc và tối đa 255 ký tự');
 if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email không hợp lệ');
 if(typeof b.password!=='string'||b.password.length<8||b.password.length>200)fail('Mật khẩu phải có từ 8 đến 200 ký tự');
 const password_hash=await bcrypt.hash(b.password,12);
 const connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const [result]=await connection.execute("INSERT INTO users (full_name,email,password_hash,role,is_active) VALUES (?,?,?,'customer',1)",[full_name,email,password_hash]);
  await connection.execute('INSERT INTO profiles (user_id) VALUES (?)',[result.insertId]);
  await connection.commit();
  res.status(201).json({message:'Đăng ký thành công',data:{user:{id:result.insertId,full_name,email,role:'customer'}}});
 }catch(e){await connection.rollback();if(e.code==='ER_DUP_ENTRY')fail('Email đã được sử dụng',409);throw e;}finally{connection.release();}
}
// Valid fallback hash makes unknown-account checks run bcrypt too.
const fallbackHash=await bcrypt.hash('not-a-real-account-password',12);
export async function login(req,res){const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))fail('Body phải là JSON object');if(Object.keys(b).some(k=>!['email','password'].includes(k)))fail('Chỉ nhận email và password');if(typeof b.email!=='string'||b.email.length>254||typeof b.password!=='string'||!b.password||b.password.length>200)fail('Nhập email và mật khẩu hợp lệ');
 const [rows]=await pool.execute('SELECT * FROM users WHERE email = ?',[b.email.trim()]);const user=rows[0];const correct=await bcrypt.compare(b.password,user?.password_hash||fallbackHash);
 if(!user||!user.is_active||!correct)fail('Email hoặc mật khẩu không đúng',401);
 if(req.path==='/admin/login'&&user.role!=='admin')fail('Bạn không có quyền truy cập trang Admin',403);
 const token=jwt.sign({},secret(),{subject:String(user.id),algorithm:'HS256',expiresIn:'2h',issuer:'book-backend',audience:'book-app'});
 res.json({message:'Đăng nhập thành công',data:{token,token_type:'Bearer',expires_in:7200,user:{id:user.id,full_name:user.full_name,email:user.email,role:user.role}}});
}
export function me(req,res){res.json({data:req.user});}
