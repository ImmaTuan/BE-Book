import * as features from '../models/customer-feature.model.js';
import * as orders from '../models/promotional-order.model.js';
import { listOrderEvents } from '../models/order-event.model.js';
import { fail,id,pagination } from '../validation.js';
function emptyBody(req){if(req.body&&Object.keys(req.body).length)fail('API này không nhận dữ liệu bổ sung');}
export async function listNotifications(req,res){res.json(await features.notifications(req.user.id,pagination(req.query)));}
export async function readNotification(req,res){emptyBody(req);await features.markNotification(req.user.id,id(req.params.id));res.sendStatus(204);}
export async function readAllNotifications(req,res){emptyBody(req);await features.markNotification(req.user.id);res.sendStatus(204);}
export async function listWishlist(req,res){res.json(await features.wishlist(req.user.id,pagination(req.query)));}
export async function wishlistState(req,res){res.json({data:{saved:await features.wishlistState(req.user.id,id(req.params.bookId))}});}
export async function addWishlist(req,res){emptyBody(req);await features.setWishlist(req.user.id,id(req.params.bookId),true);res.json({data:{saved:true}});}
export async function removeWishlist(req,res){emptyBody(req);await features.setWishlist(req.user.id,id(req.params.bookId),false);res.sendStatus(204);}
export async function listReviews(req,res){res.json(await features.listReviews(id(req.params.bookId),pagination(req.query)));}
export async function eligibility(req,res){res.json({data:await features.reviewEligibility(req.user.id,id(req.params.bookId))});}
export async function saveReview(req,res){
 const b=req.body;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['rating','comment'].includes(k)))fail('Đánh giá chỉ nhận rating và comment');
 if(!Number.isInteger(b.rating)||b.rating<1||b.rating>5)fail('Số sao phải từ 1 đến 5');
 if(b.comment!==undefined&&typeof b.comment!=='string')fail('Nội dung đánh giá phải là chuỗi');
 const comment=(b.comment||'').trim();if(comment.length>2000)fail('Đánh giá tối đa 2000 ký tự');
 await features.saveReview(req.user.id,id(req.params.bookId),{rating:b.rating,comment});
 res.json({message:'Đã lưu đánh giá',data:await features.reviewEligibility(req.user.id,id(req.params.bookId))});
}
export async function removeReview(req,res){emptyBody(req);await features.removeReview(req.user.id,id(req.params.bookId));res.sendStatus(204);}
export async function history(req,res){
 const order=await orders.findOrder(id(req.params.id));
 if(!order||(req.user.role!=='admin'&&order.user_id!==req.user.id))fail('Không tìm thấy đơn hàng',404);
 res.json({data:await listOrderEvents(order.id)});
}
