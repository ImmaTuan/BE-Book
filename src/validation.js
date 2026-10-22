export function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
export function id(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>2147483647)fail('ID phải là số nguyên dương');return n;}
export function pagination(query){const page=Number(query.page??1),limit=Number(query.limit??20);if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('page >= 1, limit từ 1 đến 100');return {page,limit,offset:(page-1)*limit};}
const fields=['category_id','title','description','cover_url','price','stock_quantity','publisher','publication_year','is_active','weight_grams'];
const nullable=['description','cover_url','publisher','publication_year'];
export function validateBook(body,create=false){if(!body||typeof body!=='object'||Array.isArray(body))fail('Body phải là JSON object');for(const f of Object.keys(body))if(!fields.includes(f))fail('Trường không được phép: '+f);if(create)for(const f of ['category_id','title','price','weight_grams'])if(body[f]===undefined)fail('Thiếu trường '+f);const out={};
for(const [f,v] of Object.entries(body)){if(v===null){if(!nullable.includes(f))fail(f+' không được null');out[f]=null;continue;}
if(['category_id','stock_quantity','publication_year','weight_grams'].includes(f)){if(typeof v!=='number'||!Number.isInteger(v)||v<(['category_id','weight_grams'].includes(f)?1:0)||v>2147483647)fail(f+' không hợp lệ');if(f==='publication_year'&&(v<1||v>9999))fail('publication_year từ 1 đến 9999');out[f]=v;}
else if(f==='price'){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e12)fail('price phải từ 0 đến 1.000 tỷ');out[f]=v;}
else if(f==='is_active'){if(![true,false,0,1].includes(v))fail('is_active phải là boolean hoặc 0/1');out[f]=Number(v);}
else {if(typeof v!=='string')fail(f+' phải là chuỗi');if(f==='description'){if(Buffer.byteLength(v)>65535)fail('description quá dài');out[f]=v;continue;}const max=f==='cover_url'?2048:255;if(v.length>max)fail(f+' tối đa '+max+' ký tự');if(f==='title'&&!v.trim())fail('title không được trống');if(f==='cover_url'&&v){try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol))fail('cover_url phải là URL http/https');}catch{fail('cover_url phải là URL http/https');}}out[f]=v.trim();}}
if(!Object.keys(out).length)fail('Không có dữ liệu để cập nhật');return out;}
