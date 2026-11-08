import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from '../src/config/db.js';
import {app} from '../src/app.js';
import {expirePaymentOrder} from '../src/services/payment-expiry.service.js';
import {recordOrderEvent} from '../src/models/order-event.model.js';
import {updateGhnStatusByCode} from '../src/models/promotional-order.model.js';
import {QUERY_RESPONSE_FIELDS} from '../src/services/vnpay.service.js';

test('expiry, history, notifications, wishlist and verified reviews with MySQL rollback',{skip:process.env.RUN_CUSTOMER_FEATURES_MYSQL_TEST!=='1'},async(t)=>{
 const originalExecute=pool.execute,originalConnection=pool.getConnection,originalFetch=globalThis.fetch,oldEnv={...process.env};
 Object.assign(process.env,{JWT_SECRET:'customer-feature-test-secret-32-characters',VNP_TMN_CODE:'TESTCODE',VNP_HASH_SECRET:'test-secret-only',VNP_URL:'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'});
 const db=await pool.getConnection();await db.beginTransaction();
 pool.execute=db.execute.bind(db);pool.getConnection=async()=>({execute:db.execute.bind(db),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;pool.execute=originalExecute;pool.getConnection=originalConnection;await db.rollback();db.release();await pool.end();for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);});
 const [customers]=await db.execute("SELECT id FROM users WHERE role='customer' AND is_active=1 LIMIT 2");
 const [[admin]]=await db.execute("SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 1");
 const [[category]]=await db.execute('SELECT id FROM categories LIMIT 1');
 assert.equal(customers.length,2);assert.ok(admin&&category);
 const owner=customers[0].id,other=customers[1].id;
 const [book]=await db.execute("INSERT INTO books(category_id,title,price,stock_quantity,weight_grams,is_active) VALUES(?, ?,50000,100,300,1)",[category.id,'FEATURES-'+randomBytes(7).toString('hex')]);
 const bookId=book.insertId;
 const token=id=>jwt.sign({},process.env.JWT_SECRET,{subject:String(id),expiresIn:'5m',issuer:'book-backend',audience:'book-app'});
 const base='http://127.0.0.1:'+server.address().port;
 async function request(method,path,body,userId=owner){const response=await originalFetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(userId?{Authorization:'Bearer '+token(userId)}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:response.status===204?null:await response.json()};}
 async function makeOrder({method='vnpay',payment='unpaid',status='pending',userId=owner,code=null}={}){
  const [r]=await db.execute("INSERT INTO orders(user_id,order_code,recipient_name,recipient_phone,shipping_address,subtotal,total_amount,shipping_fee,discount_amount,direct_discount_amount,status,payment_method,payment_status,payment_expires_at,ghn_order_code) VALUES(?,?,'Test','0900000000','Test',100000,100000,0,0,0,?,?,?,DATE_SUB(NOW(),INTERVAL 1 MINUTE),?)",[userId,'FEATURE-ORDER-'+randomBytes(7).toString('hex'),status,method,payment,code]);
  const [item]=await db.execute("INSERT INTO order_items(order_id,book_id,book_title,unit_price,original_unit_price,quantity,weight_grams) VALUES(?,?,'Feature book',50000,50000,2,300)",[r.insertId,bookId]);
  return{id:r.insertId,itemId:item.insertId,user_id:userId,order_code:'Feature order'};
 }
 async function attempt(order){const reference='FEATURE'+order.id;await db.execute("INSERT INTO vnpay_payments(order_id,reference,amount,payment_url,create_date,expires_at) VALUES(?,?,100000,'https://sandbox.vnpayment.vn/test','20261108120000',DATE_SUB(NOW(),INTERVAL 3 MINUTE))",[order.id,reference]);return reference;}
 const row=async(id)=>(await db.execute('SELECT * FROM orders WHERE id=?',[id]))[0][0];
 const stock=async()=>(await db.execute('SELECT stock_quantity FROM books WHERE id=?',[bookId]))[0][0].stock_quantity;
 let expired;
 await t.test('expires unattempted unpaid orders once and restores stock/coupon reservations',async()=>{
  expired=await makeOrder();
  const [[coupon]]=await db.execute('SELECT id,usage_count,code,name FROM promotions LIMIT 1');
  let usageBefore;
  if(coupon){
   usageBefore=Number(coupon.usage_count);
   await db.execute('UPDATE promotions SET usage_count=usage_count+1 WHERE id=?',[coupon.id]);
   await db.execute("INSERT INTO promotion_usages(promotion_id,order_id,user_id,code_snapshot,name_snapshot,discount_amount,status) VALUES(?,?,?,?,?,1000,'reserved')",[coupon.id,expired.id,owner,coupon.code,coupon.name]);
  }
  const before=await stock();
  assert.equal((await expirePaymentOrder(expired.id)).state,'expired');
  assert.equal((await row(expired.id)).payment_status,'expired');
  assert.equal((await row(expired.id)).status,'cancelled');
  assert.equal(await stock(),before+2);
  assert.equal((await expirePaymentOrder(expired.id)).state,'skipped');
  assert.equal(await stock(),before+2);
  if(coupon){
   const [[after]]=await db.execute('SELECT usage_count FROM promotions WHERE id=?',[coupon.id]);
   assert.equal(Number(after.usage_count),usageBefore);
   const [[usage]]=await db.execute('SELECT status FROM promotion_usages WHERE order_id=?',[expired.id]);assert.equal(usage.status,'released');
  }
  assert.equal((await request('GET','/orders/'+expired.id+'/history')).body.data.at(-1).event_type,'payment_expired');
 });
 await t.test('unknown provider response keeps the reservation and only notifies once',async()=>{
  const order=await makeOrder();await attempt(order);
  globalThis.fetch=async()=>({ok:true,json:async()=>({vnp_ResponseCode:'99',vnp_Message:'Unexpected error'})});
  const before=await stock();
  assert.equal((await expirePaymentOrder(order.id)).state,'review');
  assert.equal((await expirePaymentOrder(order.id)).state,'review');
  assert.equal((await row(order.id)).status,'pending');assert.equal(await stock(),before);
  const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM notifications WHERE order_id=?',[order.id]);assert.equal(Number(count.n),1);
 });
 await t.test('confirmed missing transactions expire, while a verified successful payment never expires',async()=>{
  const missing=await makeOrder();await attempt(missing);
  globalThis.fetch=async()=>({ok:true,json:async()=>({vnp_ResponseCode:'91'})});
  assert.equal((await expirePaymentOrder(missing.id)).state,'expired');
  const paid=await makeOrder();const ref=await attempt(paid);
  const params={vnp_ResponseId:'response123',vnp_Command:'querydr',vnp_ResponseCode:'00',vnp_Message:'Success',vnp_TmnCode:'TESTCODE',vnp_TxnRef:ref,vnp_Amount:'10000000',vnp_BankCode:'NCB',vnp_PayDate:'20261108120100',vnp_TransactionNo:String(500000000+paid.id),vnp_TransactionType:'01',vnp_TransactionStatus:'00',vnp_OrderInfo:'Test',vnp_PromotionCode:'',vnp_PromotionAmount:''};
  params.vnp_SecureHash=createHmac('sha512','test-secret-only').update(QUERY_RESPONSE_FIELDS.map(k=>params[k]??'').join('|')).digest('hex');
  globalThis.fetch=async()=>({ok:true,json:async()=>params});
  const before=await stock();assert.equal((await expirePaymentOrder(paid.id)).state,'paid');assert.equal((await row(paid.id)).payment_status,'paid');assert.equal(await stock(),before);
  const cod=await makeOrder({method:'cod'});assert.equal((await expirePaymentOrder(cod.id)).state,'skipped');
 });
 await t.test('notifications and history are private; read operations are idempotent',async()=>{
  const own=await request('GET','/notifications?limit=100');assert.equal(own.status,200);
  const note=own.body.data.find(x=>x.order_id===expired.id);assert.ok(note);
  assert.equal((await request('PATCH','/notifications/'+note.id+'/read',null,other)).status,404);
  assert.equal((await request('GET','/orders/'+expired.id+'/history',null,other)).status,404);
  assert.equal((await request('GET','/admin/orders/'+expired.id+'/history',null,admin.id)).status,200);
  assert.equal((await request('PATCH','/notifications/'+note.id+'/read')).status,204);
  assert.equal((await request('PATCH','/notifications/'+note.id+'/read')).status,204);
  assert.equal((await request('PATCH','/notifications/read-all')).status,204);
  assert.equal((await request('GET','/notifications')).body.meta.unread,0);
 });
 await t.test('wishlist persists per user, ignores duplicate adds and removes cleanly',async()=>{
  assert.equal((await request('PUT','/wishlist/'+bookId)).status,200);
  assert.equal((await request('PUT','/wishlist/'+bookId)).status,200);
  assert.equal((await request('GET','/wishlist/'+bookId)).body.data.saved,true);
  assert.equal((await request('GET','/wishlist/'+bookId,null,other)).body.data.saved,false);
  const list=await request('GET','/wishlist?limit=100');assert.equal(list.body.data.filter(x=>x.id===bookId).length,1);
  assert.equal((await request('DELETE','/wishlist/'+bookId)).status,204);
  assert.equal((await request('GET','/wishlist/'+bookId)).body.data.saved,false);
  assert.equal((await request('PUT','/wishlist/'+bookId,null,admin.id)).status,403);
 });
 await t.test('reviews require own paid delivered purchase and allow one editable review per book',async()=>{
  assert.equal((await request('PUT','/books/'+bookId+'/review',{rating:5,comment:'not purchased'})).status,403);
  const delivered=await makeOrder({method:'cod',payment:'paid',status:'delivered'});
  assert.equal((await request('GET','/books/'+bookId+'/review-eligibility')).body.data.eligible,true);
  assert.equal((await request('PUT','/books/'+bookId+'/review',{rating:6})).status,400);
  assert.equal((await request('PUT','/books/'+bookId+'/review',{rating:5,user_id:other})).status,400);
  assert.equal((await request('PUT','/books/'+bookId+'/review',{rating:5,comment:'Great book'})).status,200);
  const edit=await request('PUT','/books/'+bookId+'/review',{rating:4,comment:'Updated review'});assert.equal(edit.status,200);
  const publicReviews=await request('GET','/books/'+bookId+'/reviews',null,null);
  assert.equal(publicReviews.body.meta.total,1);assert.equal(publicReviews.body.meta.average,4);
  assert.equal(publicReviews.body.data[0].verified_purchase,true);assert.equal('user_id' in publicReviews.body.data[0],false);
  assert.equal((await request('PUT','/books/'+bookId+'/review',{rating:5},other)).status,403);
  await request('DELETE','/books/'+bookId+'/review',null,other);
  assert.equal((await request('GET','/books/'+bookId+'/reviews',null,null)).body.meta.total,1);
  assert.equal((await request('DELETE','/books/'+bookId+'/review')).status,204);
 });
 await t.test('GHN delivery history and COD payment notification are not duplicated by repeated callbacks',async()=>{
  const code='FEATUREGHN'+Date.now();const order=await makeOrder({method:'cod',status:'shipped',code});
  await updateGhnStatusByCode(code,'delivered');await updateGhnStatusByCode(code,'delivered');
  assert.equal((await row(order.id)).payment_status,'paid');
  const [[n]]=await db.execute('SELECT COUNT(*) AS n FROM order_events WHERE order_id=?',[order.id]);assert.equal(Number(n.n),2);
  const [[notes]]=await db.execute('SELECT COUNT(*) AS n FROM notifications WHERE order_id=?',[order.id]);assert.equal(Number(notes.n),2);
 });
});
