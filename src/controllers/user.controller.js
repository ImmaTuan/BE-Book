import {pool} from '../config/db.js';
import {id,fail} from '../validation.js';

const fields=['first_name','last_name','phone','email','gender','date_of_birth','loyalty_points','membership_tier'];
const customerFields=fields.filter(key=>!['loyalty_points','membership_tier'].includes(key));
const nullable=['first_name','last_name','phone','email','date_of_birth'];
function validateProfile(body,allowedFields=fields){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('Body phải là JSON object');
 for(const key of Object.keys(body))if(!allowedFields.includes(key))fail('Trường không được phép: '+key);
 if(!Object.keys(body).length)fail('Không có dữ liệu để cập nhật');
 const out={};
 for(const [key,value] of Object.entries(body)){
  if(value===null){if(!nullable.includes(key))fail(key+' không được null');out[key]=null;continue;}
  if(['first_name','last_name'].includes(key)){
   if(typeof value!=='string'||value.length>(key==='first_name'?100:155))fail(key+' không hợp lệ');
   out[key]=value.trim()||null;
  }else if(key==='phone'){
   if(typeof value!=='string'||value.length>20||!/^\+?[0-9().\s-]{7,20}$/.test(value))fail('phone không hợp lệ');
   out[key]=value.trim();
  }else if(key==='email'){
   if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))fail('email không hợp lệ');
   out[key]=value.trim().toLowerCase();
  }else if(key==='gender'){
   if(!['male','female','other','undisclosed'].includes(value))fail('gender không hợp lệ');out[key]=value;
  }else if(key==='date_of_birth'){
   if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('date_of_birth phải theo định dạng YYYY-MM-DD');
   const date=new Date(value+'T00:00:00Z');
   if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value||value>new Date().toISOString().slice(0,10))fail('date_of_birth không hợp lệ hoặc ở tương lai');
   out[key]=value;
  }else if(key==='loyalty_points'){
   if(!Number.isInteger(value)||value<0||value>2147483647)fail('loyalty_points phải là số nguyên không âm');out[key]=value;
  }else if(key==='membership_tier'){
   if(!['bronze','silver','gold','platinum'].includes(value))fail('membership_tier không hợp lệ');out[key]=value;
  }
 }
 return out;
}

async function saveCustomerProfile(userId,data){
 const connection=await pool.getConnection();
 try{
  await connection.beginTransaction();
  const [rows]=await connection.execute('SELECT id,role FROM users WHERE id = ? FOR UPDATE',[userId]);
  const user=rows[0];
  if(!user)fail('Không tìm thấy user',404);
  if(user.role!=='customer')fail('Chỉ được thay đổi profile của user có role customer',403);
  const [profiles]=await connection.execute('SELECT user_id FROM profiles WHERE user_id = ? FOR UPDATE',[userId]);
  if(profiles.length){
   await connection.execute('UPDATE profiles SET '+Object.keys(data).map(key=>'`'+key+'` = ?').join(', ')+' WHERE user_id = ?',[...Object.values(data),userId]);
  }else{
   await connection.execute('INSERT INTO profiles (user_id,'+Object.keys(data).map(key=>'`'+key+'`').join(',')+') VALUES ('+Object.keys(data).map(()=>'?').concat('?').join(',')+')',[userId,...Object.values(data)]);
  }
  const [updated]=await connection.execute('SELECT * FROM profiles WHERE user_id = ?',[userId]);
  await connection.commit();
  return updated[0];
 }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}

export async function updateCustomerProfile(req,res){
 const userId=id(req.params.id);
 const data=validateProfile(req.body);
 const profile=await saveCustomerProfile(userId,data);
 res.json({message:'Đã cập nhật profile user',data:{profile}});
}

export async function updateOwnProfile(req,res){
 const data=validateProfile(req.body,customerFields);
 if(req.user.role!=='customer')fail('Chỉ tài khoản customer được tự cập nhật profile',403);
 const profile=await saveCustomerProfile(req.user.id,data);
 res.json({message:'Đã cập nhật profile của bạn',data:{profile}});
}
