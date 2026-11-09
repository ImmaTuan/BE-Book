import test from "node:test";
import assert from "node:assert/strict";
import { parseOrderTimeFilter } from "../src/order-time-filter.js";
const range=(unit,value)=>parseOrderTimeFilter({time_unit:unit,time_value:value}).filters;
test("month/day/hour boundaries use exclusive end times and handle leap/year rollover",()=>{
  assert.deepEqual(range("month","2026-12"),{createdFrom:"2026-12-01 00:00:00",createdTo:"2027-01-01 00:00:00"});
  assert.deepEqual(range("day","2024-02-29"),{createdFrom:"2024-02-29 00:00:00",createdTo:"2024-03-01 00:00:00"});
  assert.deepEqual(range("hour","2026-11-09T23:00"),{createdFrom:"2026-11-09 23:00:00",createdTo:"2026-11-10 00:00:00"});
  assert.deepEqual(range("hour","2026-11-09T15"),{createdFrom:"2026-11-09 15:00:00",createdTo:"2026-11-09 16:00:00"});
});
test("ISO weeks run Monday to Monday and can cross calendar years",()=>{
  assert.deepEqual(range("week","2026-W46"),{createdFrom:"2026-11-09 00:00:00",createdTo:"2026-11-16 00:00:00"});
  assert.deepEqual(range("week","2020-W53"),{createdFrom:"2020-12-28 00:00:00",createdTo:"2021-01-04 00:00:00"});
  assert.deepEqual(range("week","2026-W01"),{createdFrom:"2025-12-29 00:00:00",createdTo:"2026-01-05 00:00:00"});
});
test("no filter preserves all-time behavior; malformed and impossible dates are rejected",()=>{
  assert.deepEqual(parseOrderTimeFilter({}),{filters:{},range:null});
  for(const [unit,value]of [["year","2026"],["day","2026-02-29"],["day","2026-11-31"],["month","2026-13"],["week","2021-W53"],["week","2026-W00"],["hour","2026-11-09T24"],["hour","2026-11-09T15:30"],["day","2026-11-09' OR 1=1"]]){
    assert.throws(()=>range(unit,value),e=>e.status===400);
  }
  for(const query of [{time_unit:"day"},{time_value:"2026-11-09"},{time_unit:["day"],time_value:"2026-11-09"}])
    assert.throws(()=>parseOrderTimeFilter(query),e=>e.status===400);
});
