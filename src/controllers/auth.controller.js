import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {pool} from '../config/db.js';
import {secret} from '../config/auth.js';
import {fail} from '../validation.js';
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
