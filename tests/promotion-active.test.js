import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { pool } from "../src/config/db.js";
import { app } from "../src/app.js";

test("promotion active endpoints require admin, validate input and only change active state",async()=>{
  process.env.JWT_SECRET="bulk-promotion-test-secret-at-least-32";
  const originalExecute=pool.execute,originalConnection=pool.getConnection;
  const state={
    products:{id:1,is_active:1,discount_value:15,quantity_used:9},
    coupons:{id:2,is_active:1,usage_count:8,scope_type:"all",discount_value:10000},
  };
  let writes=0,snapshot;
  const execute=async(sql,args=[])=>{
    if(/^SELECT id,\s*full_name,\s*email,\s*role,\s*is_active FROM users/.test(sql))
      return [[{id:Number(args[0]),role:Number(args[0])===1?"admin":"customer",is_active:1}],[]];
    if(sql==="SELECT id FROM product_promotions WHERE id = ? FOR UPDATE")
      return [Number(args[0])===1?[{id:1}]:[],[]];
    if(sql==="SELECT id FROM promotions WHERE id = ? AND kind = 'order' FOR UPDATE")
      return [Number(args[0])===2?[{id:2}]:[],[]];
    if(sql==="UPDATE product_promotions SET is_active = ? WHERE id = ?"){
      writes++;state.products.is_active=args[0];return [{affectedRows:1},[]];
    }
    if(sql==="UPDATE promotions SET is_active = ? WHERE id = ? AND kind = 'order'"){
      writes++;state.coupons.is_active=args[0];return [{affectedRows:1},[]];
    }
    throw Error("Unexpected query: "+sql);
  };
  pool.execute=execute;
  pool.getConnection=async()=>({execute,beginTransaction:async()=>{snapshot=structuredClone(state);},commit:async()=>{},rollback:async()=>Object.assign(state,snapshot),release(){}});
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const token=id=>jwt.sign({},process.env.JWT_SECRET,{subject:String(id),expiresIn:"5m",issuer:"book-backend",audience:"book-app"});
  const request=async(path,body,user=1)=>{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api/admin/promotions/"+path,{
      method:"PATCH",headers:{"Content-Type":"application/json",...(user?{Authorization:"Bearer "+token(user)}:{})},body:JSON.stringify(body),
    });
    return {status:response.status,body:await response.json()};
  };
  try{
    assert.equal((await request("products/1/active",{is_active:false},0)).status,401);
    assert.equal((await request("products/1/active",{is_active:false},2)).status,403);
    for(const body of [null,[],{}, {is_active:"false"},{is_active:0},{is_active:false,usage_count:0}])
      assert.equal((await request("products/1/active",body)).status,400);
    assert.equal(writes,0);
    assert.equal((await request("products/999/active",{is_active:false})).status,404);
    assert.equal((await request("coupons/999/active",{is_active:false})).status,404);
    assert.equal((await request("products/1/active",{is_active:false})).status,200);
    assert.deepEqual(state.products,{id:1,is_active:0,discount_value:15,quantity_used:9});
    assert.equal((await request("coupons/2/active",{is_active:false})).status,200);
    assert.deepEqual(state.coupons,{id:2,is_active:0,usage_count:8,scope_type:"all",discount_value:10000});
    assert.equal((await request("coupons/2/active",{is_active:true})).status,200);
    assert.equal(state.coupons.is_active,1);assert.equal(state.coupons.usage_count,8);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    pool.execute=originalExecute;pool.getConnection=originalConnection;await pool.end();
  }
});
