import ExcelJS from "exceljs";
import { fail, validateBook, id } from "../validation.js";
import { normalizeCategoryName } from "../category-resolver.js";

export const MAX_ROWS = 500;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const COLUMNS = [
  ["book_id","Mã sách"], ["title","Tên sách"], ["authors","Tác giả"],
  ["publishers","Nhà xuất bản"], ["category","Thể loại"], ["price","Giá bán"],
  ["quantity","Số lượng nhập"], ["weight_grams","Khối lượng (g)"],
  ["publication_year","Năm xuất bản"], ["cover_url","URL ảnh bìa"],
  ["description","Mô tả"], ["note","Ghi chú"],
];
const headerMap = new Map(COLUMNS.flatMap(([key,label]) => [
  [normalizeCategoryName(key),key], [normalizeCategoryName(label),key],
]));

// Inspect the ZIP directory before inflating any XML. ZIP64/encrypted workbooks are unsupported.
export function checkWorkbookZip(buffer) {
  if (buffer.length > MAX_FILE_BYTES) fail("File tối đa 5 MB");
  let eocd = -1;
  for (let i=buffer.length-22; i>=Math.max(0,buffer.length-65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i+22+buffer.readUInt16LE(i+20)===buffer.length) { eocd=i; break; }
  }
  if (eocd < 0) fail("File không phải Excel .xlsx hợp lệ");
  const count=buffer.readUInt16LE(eocd+10), size=buffer.readUInt32LE(eocd+12);
  let offset=buffer.readUInt32LE(eocd+16), unpacked=0;
  if (!count || count>500 || offset+size>eocd || buffer.readUInt16LE(eocd+4)!==0 || buffer.readUInt16LE(eocd+6)!==0)
    fail("Cấu trúc file Excel không được hỗ trợ");
  const end=offset+size;
  for(let i=0;i<count;i++){
    if(offset+46>end || buffer.readUInt32LE(offset)!==0x02014b50) fail("Cấu trúc file Excel bị lỗi");
    unpacked+=buffer.readUInt32LE(offset+24);
    if(unpacked>20*1024*1024 || (buffer.readUInt16LE(offset+8)&1)) fail("File Excel quá lớn sau giải nén hoặc có mật khẩu");
    offset+=46+buffer.readUInt16LE(offset+28)+buffer.readUInt16LE(offset+30)+buffer.readUInt16LE(offset+32);
  }
  if(offset!==end)fail("Cấu trúc file Excel bị lỗi");
}
function cellValue(cell) {
  const v=cell.value;
  if(v===null || v===undefined)return "";
  if(typeof v==="string" || typeof v==="number")return v;
  if(v.richText)return v.richText.map(part=>part.text).join("");
  if(v.hyperlink && typeof v.text==="string")return v.text;
  fail("Không nhận công thức, ngày tháng hoặc kiểu dữ liệu đặc biệt");
}
function number(value,label,{optional=false}={}) {
  if(value==="" || value===undefined){if(optional)return null;fail("Thiếu "+label);}
  if(typeof value==="string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    fail(label+" phải là số, không có dấu phân cách hàng nghìn hoặc đơn vị");
  const n=Number(value);
  if(!Number.isFinite(n))fail(label+" không hợp lệ");
  return n;
}
export function normalizeImportRow(raw, mode) {
  const quantity=number(raw.quantity,"Số lượng nhập");
  if(!Number.isInteger(quantity)||quantity<1||quantity>2147483647)fail("Số lượng nhập phải là số nguyên dương");
  const note=String(raw.note??"").trim();
  if(note.length>1000)fail("Ghi chú tối đa 1000 ký tự");
  if(mode==="stock"){
    const value=String(raw.book_id??"").trim().replace(/^BK-/i,"");
    if(!/^\d+$/.test(value))fail("Mã sách phải có dạng BK-0001 hoặc ID số");
    return {book_id:id(value),quantity,note};
  }
  const split=value=>String(value??"").split(";").map(name=>name.trim()).filter(Boolean);
  const category=String(raw.category??"").trim();
  if(!category||category.length>255)fail("Thể loại bắt buộc và tối đa 255 ký tự");
  const book=validateBook({
    title:String(raw.title??"").trim(), category_id:1,
    author_names:split(raw.authors), publisher_names:split(raw.publishers),
    price:number(raw.price,"Giá bán"), stock_quantity:quantity,
    weight_grams:number(raw.weight_grams,"Khối lượng"),
    publication_year:number(raw.publication_year,"Năm xuất bản",{optional:true}),
    cover_url:String(raw.cover_url??"").trim()||null,
    description:String(raw.description??"")||null,
  },true);
  return { ...book, category, quantity, note };
}
export async function parseWorkbook(buffer,mode) {
  if(!["books","stock"].includes(mode))fail("Chọn chế độ books hoặc stock");
  checkWorkbookZip(buffer);
  const workbook=new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { fail("Không đọc được file Excel .xlsx"); }
  const sheet=workbook.getWorksheet(mode==="stock"?"NhapKho":"Sach") || workbook.worksheets[0];
  if(!sheet || sheet.rowCount>10000 || sheet.columnCount>30)fail("Sheet dữ liệu không hợp lệ hoặc quá lớn");
  const columns=new Map();
  sheet.getRow(1).eachCell((cell,index)=>{
    const label=String(cellValue(cell)).trim();
    const key=headerMap.get(normalizeCategoryName(label));
    if(!key)fail("Cột không hỗ trợ: "+label+". Hãy dùng file mẫu.");
    if([...columns.values()].includes(key))fail("Trùng cột "+label);
    columns.set(index,key);
  });
  const required=mode==="stock"?["book_id","quantity"]:["title","category","price","quantity","weight_grams"];
  for(const key of required)if(![...columns.values()].includes(key))fail("Thiếu cột "+COLUMNS.find(([k])=>k===key)[1]);
  const rows=[];
  sheet.eachRow((row,line)=>{
    if(line===1)return;
    if(!row.hasValues)return;
    const raw={}, errors=[];
    for(const [index,key]of columns) {
      try {raw[key]=cellValue(row.getCell(index));}
      catch(e){errors.push(COLUMNS.find(([k])=>k===key)[1]+": "+e.message);}
    }
    row.eachCell((cell,index)=>{ if(!columns.has(index) && cell.value!==null)errors.push("Có dữ liệu ở cột chưa có tiêu đề"); });
    if(!errors.length && Object.values(raw).every(value=>String(value).trim()===""))return;
    let data=null;
    if(!errors.length)try {data=normalizeImportRow(raw,mode);}catch(e){errors.push(e.message);}
    rows.push({line,raw,data,errors});
    if(rows.length>MAX_ROWS)fail("Tối đa 500 dòng dữ liệu mỗi lần nhập");
  });
  if(!rows.length)fail("File chưa có dòng dữ liệu");
  if(Buffer.byteLength(JSON.stringify(rows))>4*1024*1024)fail("Nội dung dữ liệu quá lớn. Hãy chia nhỏ file hoặc rút ngắn mô tả.");
  return rows;
}
function styleSheet(sheet,headers) {
  sheet.addRow(headers);
  sheet.views=[{state:"frozen",ySplit:1}];
  sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
  sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF8560A8"}};
  sheet.columns.forEach(column=>{column.width=24;});
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};
}
export async function createTemplate(mode,categories) {
  if(!["books","stock"].includes(mode))fail("Chọn chế độ books hoặc stock");
  const workbook=new ExcelJS.Workbook();
  const columns=mode==="stock"?COLUMNS.filter(([key])=>["book_id","quantity","note"].includes(key)):COLUMNS.filter(([key])=>key!=="book_id");
  const sheet=workbook.addWorksheet(mode==="stock"?"NhapKho":"Sach");
  styleSheet(sheet,columns.map(([,label])=>label));
  const guide=workbook.addWorksheet("HuongDan");
  const lines=[
    ["HƯỚNG DẪN","Nội dung"],
    ["Giới hạn","500 dòng, 5 MB, chỉ nhận .xlsx. Điền dữ liệu vào sheet đầu tiên."],
    ["Số lượng","Là số lượng cộng thêm, không ghi đè tồn kho. Phải là số nguyên dương."],
    ["Giá / Khối lượng","Giá bán tối thiểu 1000₫; dùng số như 85000 và 350, không kèm đ hay dấu phân cách hàng nghìn."],
    ["Nhiều tác giả / NXB","Ngăn cách bằng dấu ; (không dùng dấu phẩy)."],
    ["Thể loại","Nhận tên Anh/Việt đã khai báo. Danh mục tham khảo trong sheet TheLoai."],
    ["Danh mục mới","Phải chọn tạo mới hoặc liên kết bản ghi đã có trong màn hình xem trước."],
    ["Sách trùng","Cùng tên + tập tác giả + tập NXB + thể loại: cộng kho và cập nhật giá/năm xuất bản/URL ảnh nếu thay đổi. Năm/ảnh trống giữ nguyên."],
    ["Dòng trùng trong file","Gộp số lượng thành một dòng trước khi upload."],
    ["Công thức","Không nhận công thức. Dán giá trị trước khi upload."],
    ["File đã nhập","File giống hệt đã hoàn tất sẽ trả lại kết quả cũ, không cộng kho lần nữa."],
    ["Ghi chú","Có thể ghi mã phiếu nhập hoặc ngày nhập để phân biệt các đợt nhập khác nhau."],
    ["Ví dụ sách","Tên sách: Sách thử; Tác giả: Tác giả A; Thể loại: Science; Giá: 85000; Số lượng: 10; Khối lượng: 350."],
    ["Ví dụ kho","Mã sách: BK-0001; Số lượng nhập: 10."],
  ];
  lines.forEach(row=>guide.addRow(row));guide.getColumn(1).width=28;guide.getColumn(2).width=110;
  const catalog=workbook.addWorksheet("TheLoai");
  styleSheet(catalog,["ID","Tên lưu trong hệ thống"]);
  for(const row of categories)catalog.addRow([row.id,row.name]);
  return workbook.xlsx.writeBuffer();
}
export async function createErrorWorkbook(rows) {
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("Loi");
  styleSheet(sheet,["Dòng Excel",...COLUMNS.map(([,label])=>label),"Lỗi"]);
  for(const row of rows.filter(row=>row.errors.length))
    sheet.addRow([row.line,...COLUMNS.map(([key])=>String(row.raw?.[key]??"")),row.errors.join("; ")]);
  return workbook.xlsx.writeBuffer();
}
