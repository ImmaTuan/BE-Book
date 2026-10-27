import * as model from '../models/book.model.js';
import {id,pagination,validateBook,fail} from '../validation.js';
export async function list(req,res){const p=pagination(req.query);res.json(await model.listBooks({...p,search:req.query.search?String(req.query.search):null,category_id:req.query.category_id?id(req.query.category_id):null}));}
export async function detail(req,res){const row=await model.findBook(id(req.params.id));if(!row)fail('Không tìm thấy sách',404);res.json({data:row});}
export async function create(req,res){res.status(201).json({message:'Đã thêm sách',data:await model.createBook(validateBook(req.body,true))});}
export async function update(req,res){res.json({message:'Đã cập nhật sách',data:await model.updateBook(id(req.params.id),validateBook(req.body))});}
export async function remove(req,res){await model.deleteBook(id(req.params.id));res.status(204).end();}
