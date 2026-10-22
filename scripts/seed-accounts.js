import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {pool} from '../src/config/db.js';
try{const accounts=[{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD,role:'admin',name:'Admin'},{email:process.env.CUSTOMER_EMAIL,password:process.env.CUSTOMER_PASSWORD,role:'customer',name:'Khách test'}];
 for(const a of accounts){if(!a.email||!a.password||a.password.length<8)throw new Error('Cấu hình email và password >=8 ký tự cho 2 tài khoản trong .env');}
 for(const a of accounts){const [rows]=await pool.execute('SELECT id,role FROM users WHERE email = ?',[a.email]);if(rows.length){console.log('Bỏ qua email đã tồn tại (không đổi mật khẩu/quyền):',a.email,'role:',rows[0].role);continue;}const hash=await bcrypt.hash(a.password,12);await pool.execute('INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,?)',[a.name,a.email,hash,a.role]);console.log('Đã tạo',a.role,a.email);}
}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}
