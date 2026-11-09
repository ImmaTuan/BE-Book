import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { fail } from "../validation.js";
import * as imports from "../models/book-import.model.js";
import { listCategories } from "../models/category.model.js";
import { readWorkbook } from "../services/book-workbook-reader.js";
import { createTemplate, createErrorWorkbook, MAX_FILE_BYTES } from "../services/book-workbook.js";

const router=Router();
const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:MAX_FILE_BYTES,files:1,fields:1,parts:2,fieldSize:50},
  fileFilter(req,file,done){
    if(!/\.xlsx$/i.test(file.originalname))return done(Object.assign(new Error("Chỉ nhận file .xlsx"),{status:400}));
    done(null,true);
  },
}).single("file");
const limited=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:"draft-7",legacyHeaders:false,message:{message:"Đã kiểm tra quá nhiều file. Hãy thử lại sau."}});
router.param("batchId",(req,res,next,value)=>{
  if(!/^[a-f0-9-]{36}$/i.test(value))return next(Object.assign(new Error("Mã lần nhập không hợp lệ"),{status:400}));
  next();
});
function body(req,fields){
  if(!req.body||typeof req.body!=="object"||Array.isArray(req.body)||Object.keys(req.body).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(req.body,key)))fail("Body không hợp lệ");
  return req.body;
}
function uploadFileName(name){
  if([...name].some(char=>char.charCodeAt(0)>255))return name.slice(0,255);
  try { return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.from(name,"latin1")).slice(0,255); }
  catch { return name.slice(0,255); }
}
function excel(res,bytes,name){
  res.set("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.set("Content-Disposition",'attachment; filename="'+name+'"');
  res.send(Buffer.from(bytes));
}
router.get("/template",async(req,res)=>{
  excel(res,await createTemplate(req.query.mode||"books",await listCategories()),req.query.mode==="stock"?"mau-nhap-kho.xlsx":"mau-them-sach.xlsx");
});
router.get("/",async(req,res)=>res.json({data:await imports.listImports(req.user.id)}));
router.post("/preview",limited,(req,res,next)=>upload(req,res,error=>{
  if(error){error.status=error.code==="LIMIT_FILE_SIZE"?413:error.status||400;
    if(error.code==="LIMIT_FILE_SIZE")error.message="File tối đa 5 MB";
    return next(error);}
  next();
}),async(req,res)=>{
  if(!req.file)fail("Hãy chọn file Excel");
  const mode=req.body.mode;
  if(!["books","stock"].includes(mode))fail("Chọn chế độ books hoặc stock");
  const rows=await readWorkbook(req.file.buffer,mode);
  res.json({data:await imports.createImport(req.user.id,mode,uploadFileName(req.file.originalname),req.file.buffer,rows)});
});
router.post("/:batchId/review",async(req,res)=>{
  const {selections}=body(req,["selections"]);
  res.json({data:await imports.reviewImport(req.params.batchId,req.user.id,selections)});
});
router.post("/:batchId/commit",async(req,res)=>{
  const {preview_hash}=body(req,["preview_hash"]);
  if(typeof preview_hash!=="string"||!/^[a-f0-9]{64}$/.test(preview_hash))fail("Mã xem trước không hợp lệ");
  res.json({message:"Đã hoàn tất nhập Excel",data:await imports.commitImport(req.params.batchId,req.user.id,preview_hash)});
});
router.get("/:batchId/errors",async(req,res)=>{
  const batch=await imports.getImport(req.params.batchId,req.user.id);
  excel(res,await createErrorWorkbook(batch.preview.rows),"loi-nhap-excel.xlsx");
});
router.get("/:batchId",async(req,res)=>res.json({data:await imports.getImport(req.params.batchId,req.user.id)}));
export default router;
