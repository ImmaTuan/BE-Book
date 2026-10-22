import jwt from 'jsonwebtoken';
import {pool} from '../config/db.js';
import {secret} from '../config/auth.js';
export async function authenticate(req,res,next){
 const header=req.headers.authorization||'';if(!header.startsWith('Bearer '))return res.status(401).json({message:'Bạn cần đăng nhập trước'});
 let payload;try{payload=jwt.verify(header.slice(7),secret(),{algorithms:['HS256'],issuer:'book-backend',audience:'book-app'});}catch{return res.status(401).json({message:'Token không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.'});}
 if(typeof payload.sub!=='string'||!/^\d+$/.test(payload.sub))return res.status(401).json({message:'Token không hợp lệ'});
 const [rows]=await pool.execute('SELECT id,full_name,email,role,is_active FROM users WHERE id = ?',[Number(payload.sub)]);const user=rows[0];
 if(!user||!user.is_active)return res.status(401).json({message:'Tài khoản không tồn tại hoặc đã bị khóa'});
 req.user=user;next();
}
export function requireAdmin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({message:'Bạn không có quyền truy cập trang Admin'});next();}
