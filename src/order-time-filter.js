import { fail } from "./validation.js";
const DAY=86400000;
function dateParts(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!match)fail("Ngày lọc phải có dạng YYYY-MM-DD");
  const [year,month,day]=match.slice(1).map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<1000||year>9999||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)
    fail("Ngày lọc không tồn tại");
  return date;
}
function sqlDate(date){
  if(date.getUTCFullYear()>9999)fail("Thời gian lọc vượt giới hạn cho phép");
  return date.toISOString().slice(0,19).replace("T"," ");
}
// These are Vietnam calendar boundaries for the orders.created_at DATETIME column.
// UTC Date arithmetic avoids depending on the Node host's local timezone.
export function parseOrderTimeFilter(query){
  const unit=query.time_unit,value=query.time_value;
  if((unit===undefined||unit==="")&&(value===undefined||value===""))return {filters:{},range:null};
  if(typeof unit!=="string"||!["month","week","day","hour"].includes(unit)||typeof value!=="string"||!value)
    fail("Chọn tháng, tuần, ngày hoặc giờ và mốc thời gian hợp lệ");
  let start,end;
  if(unit==="month"){
    if(!/^\d{4}-\d{2}$/.test(value))fail("Tháng lọc phải có dạng YYYY-MM");
    start=dateParts(value+"-01");
    end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  }else if(unit==="week"){
    const match=/^(\d{4})-W(\d{2})$/.exec(value);
    if(!match)fail("Tuần lọc phải có dạng YYYY-Www");
    const year=Number(match[1]),week=Number(match[2]);
    if(year<1000||year>9999||week<1||week>53)fail("Tuần lọc không hợp lệ");
    const jan4=new Date(Date.UTC(year,0,4));
    start=new Date(jan4.getTime()-((jan4.getUTCDay()+6)%7)*DAY+(week-1)*7*DAY);
    if(new Date(start.getTime()+3*DAY).getUTCFullYear()!==year)fail("Năm này không có tuần được chọn");
    end=new Date(start.getTime()+7*DAY);
  }else if(unit==="day"){
    start=dateParts(value);end=new Date(start.getTime()+DAY);
  }else{
    const match=/^(\d{4}-\d{2}-\d{2})T(\d{2})(?::00)?$/.exec(value);
    if(!match||Number(match[2])>23)fail("Giờ lọc phải có dạng YYYY-MM-DDTHH hoặc YYYY-MM-DDTHH:00");
    start=dateParts(match[1]);start.setUTCHours(Number(match[2]));
    end=new Date(start.getTime()+3600000);
  }
  const from=sqlDate(start),to=sqlDate(end);
  return {filters:{createdFrom:from,createdTo:to},range:{unit,value,from,to,time_zone:"Asia/Ho_Chi_Minh"}};
}
