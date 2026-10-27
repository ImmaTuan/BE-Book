import * as model from '../models/category.model.js';
import {id,fail} from '../validation.js';

function validateCategory(body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('Body phải là JSON object');
 if(Object.keys(body).some(key=>key!=='name'))fail('Chỉ nhận trường name');
 if(!Object.hasOwn(body,'name'))fail('Thiếu trường name');
 if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>255)fail('name là bắt buộc và tối đa 255 ký tự');
 return body.name.trim();
}

export async function list(req,res){res.json({data:await model.listCategories()});}
export async function detail(req,res){
 const category=await model.findCategory(id(req.params.id));
 if(!category)fail('Không tìm thấy thể loại',404);
 res.json({data:category});
}
export async function create(req,res){
 const category=await model.createCategory(validateCategory(req.body));
 res.status(201).json({message:'Đã thêm thể loại',data:category});
}
export async function update(req,res){
 const category=await model.updateCategory(id(req.params.id),validateCategory(req.body));
 res.json({message:'Đã cập nhật thể loại',data:category});
}
export async function remove(req,res){
 await model.deleteCategory(id(req.params.id));
 res.status(204).end();
}
