import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { pool } from "../src/config/db.js";

test("admin order time filters apply to count/list, combine with status and preserve pagination",async()=>{
  process.env.JWT_SECRET="order-time-filter-test-secret-at-least-32";
  const savedExecute=pool.execute,savedConnection=pool.getConnection;
  const dates=["2026-11-08 23:59:59","2026-11-09 00:00:00","2026-11-09 14:59:59","2026-11-09 15:00:00","2026-11-09 15:59:59","2026-11-09 16:00:00","2026-11-10 00:00:00","2026-11-16 00:00:00","2026-10-31 23:59:59","2026-12-01 00:00:00"];
  const rows=dates.map((created_at,index)=>({id:index+1,created_at,order_code:"TEST-"+(index+1),status:index%2===1?"confirmed":"pending"}));
  const queries=[];
  pool.getConnection=async()=>{throw Error("Read-only test must not open write connections");};
  pool.execute=async(sql,args=[])=>{
    if(/^SELECT id,\s*full_name,\s*email,\s*role,\s*is_active FROM users/.test(sql))
      return [[{id:1,role:Number(args[0])===1?"admin":"customer",is_active:1}],[]];
    if(sql.startsWith("SELECT oi.")||sql.startsWith("SELECT order_id, promotion_id"))return [[],[]];
    if(sql.includes("FROM orders")){
      queries.push({sql,args:[...args]});let result=[...rows],index=0;
      if(sql.includes("status = ?")){const status=args[index++];result=result.filter(row=>row.status===status);}
      if(sql.includes("created_at >= ?")){const from=args[index++];result=result.filter(row=>row.created_at>=from);}
      if(sql.includes("created_at < ?")){const to=args[index++];result=result.filter(row=>row.created_at<to);}
      assert.equal(index,args.length);
      if(sql.startsWith("SELECT COUNT(*)"))return [[{total:result.length}],[]];
      result.sort((a,b)=>b.id-a.id);
      const match=/LIMIT (\d+) OFFSET (\d+)/.exec(sql);
      return [result.slice(Number(match[2]),Number(match[2])+Number(match[1])),[]];
    }
    throw Error("Unexpected query: "+sql);
  };
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const token=id=>jwt.sign({},process.env.JWT_SECRET,{subject:String(id),expiresIn:"5m",issuer:"book-backend",audience:"book-app"});
  const request=async(query,user=1)=>{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api/admin/orders?"+query,{headers:user?{Authorization:"Bearer "+token(user)}:{}});
    return {status:response.status,body:await response.json()};
  };
  try{
    assert.equal((await request("",0)).status,401);assert.equal((await request("",2)).status,403);
    const hour=await request("time_unit=hour&time_value=2026-11-09T15:00");
    assert.equal(hour.status,200);assert.equal(hour.body.meta.total,2);
    assert.deepEqual(hour.body.data.map(row=>row.id),[5,4]);
    assert.equal(hour.body.meta.time_range.time_zone,"Asia/Ho_Chi_Minh");
    assert.deepEqual(queries[0].args,queries[1].args);
    assert.ok(queries[0].sql.includes("created_at >= ?")&&queries[0].sql.includes("created_at < ?"));
    assert.equal((await request("time_unit=day&time_value=2026-11-09")).body.meta.total,5);
    assert.equal((await request("time_unit=week&time_value=2026-W46")).body.meta.total,6);
    assert.equal((await request("time_unit=month&time_value=2026-11")).body.meta.total,8);
    const combined=await request("status=confirmed&time_unit=hour&time_value=2026-11-09T15:00");
    assert.equal(combined.body.meta.total,1);assert.equal(combined.body.data[0].id,4);
    const paged=await request("time_unit=hour&time_value=2026-11-09T15:00&limit=1&page=2");
    assert.equal(paged.body.meta.total,2);assert.deepEqual(paged.body.data.map(row=>row.id),[4]);
    const all=await request("");assert.equal(all.body.meta.total,10);assert.equal(all.body.meta.time_range,null);
    const count=queries.length;
    for(const query of ["time_unit=day","time_unit=day&time_value=2026-02-29","time_unit=hour&time_value=2026-11-09T25:00","time_unit=week&time_value=2021-W53"])
      assert.equal((await request(query)).status,400);
    assert.equal(queries.length,count);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    pool.execute=savedExecute;pool.getConnection=savedConnection;await pool.end();
  }
});
