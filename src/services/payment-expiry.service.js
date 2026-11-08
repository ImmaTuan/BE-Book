import { pool } from '../config/db.js';
import { queryVnpayTransaction } from './vnpay.service.js';
import * as payments from '../models/vnpay-payment.model.js';
import * as orders from '../models/promotional-order.model.js';
import { recordOrderEvent } from '../models/order-event.model.js';

export async function expirePaymentOrder(orderId) {
 const [[order]]=await pool.execute("SELECT * FROM orders WHERE id=? AND payment_method='vnpay' AND status='pending' AND payment_status IN ('unpaid','failed') AND payment_expires_at<=NOW() AND ghn_order_code IS NULL",[orderId]);
 if(!order)return {state:'skipped'};
 await pool.execute('UPDATE orders SET expiration_checked_at=NOW() WHERE id=?',[orderId]);
 const [attempts]=await pool.execute("SELECT * FROM vnpay_payments WHERE order_id=? AND status IN ('pending','review') ORDER BY id",[orderId]);
 let unresolved=false;
 for(const attempt of attempts){
  try{
   const result=await queryVnpayTransaction(attempt,'127.0.0.1');
   if(result.params)await payments.settleVnpayPayment(result.params);
   else if(result.code==='91')await payments.expireMissingVnpayPayment(attempt);
   else unresolved=true;
  }catch{unresolved=true;}
 }
 const current=await orders.findOrder(orderId);
 if(current.payment_status==='paid')return {state:'paid'};
 if(['refund_required','review_required'].includes(current.payment_status))return {state:'review'};
 if(unresolved){
  const db=await pool.getConnection();
  try{await db.beginTransaction();const [[locked]]=await db.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId]);
   if(locked?.status==='pending'&&['unpaid','failed'].includes(locked.payment_status))await recordOrderEvent(db,locked,{type:'expiry_review',source:'system',detail:'Đã quá thời hạn giữ đơn nhưng chưa đối soát được VNPAY. Nếu đã thanh toán, không thanh toán lại; vui lòng quay về website từ trang kết quả VNPAY hoặc liên hệ cửa hàng.',key:'expiry_review'});
   await db.commit();
  }catch(error){await db.rollback();throw error;}finally{db.release();}
  return {state:'review'};
 }
 try{await orders.updateOrderStatus(orderId,'cancelled',{source:'system',expire:true});return {state:'expired'};}
 catch(error){if(error.status===409)return {state:'skipped'};throw error;}
}

export async function sweepExpiredPayments() {
 const lock=await pool.getConnection();
 let acquired=false;
 try{
  const [[result]]=await lock.execute("SELECT GET_LOCK('bookstore:payment-expiry',0) AS acquired");acquired=Number(result.acquired)===1;
  if(!acquired)return [];
  const [rows]=await pool.execute("SELECT id FROM orders WHERE payment_method='vnpay' AND status='pending' AND payment_status IN ('unpaid','failed') AND payment_expires_at<=NOW() AND ghn_order_code IS NULL AND (expiration_checked_at IS NULL OR expiration_checked_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE)) ORDER BY payment_expires_at LIMIT 10");
  const results=[];
  for(const row of rows)results.push({id:row.id,...await expirePaymentOrder(row.id)});
  return results;
 }finally{if(acquired)await lock.execute("SELECT RELEASE_LOCK('bookstore:payment-expiry')");lock.release();}
}
export function startPaymentExpiryWorker(){
 let running=false,stopped=false;
 const tick=async()=>{if(running||stopped)return;running=true;try{await sweepExpiredPayments();}catch(error){console.error('Payment expiry failed:',error.message);}finally{running=false;}};
 const first=setTimeout(tick,10000);first.unref();
 const timer=setInterval(tick,60000);timer.unref();
 return ()=>{stopped=true;clearTimeout(first);clearInterval(timer);};
}
