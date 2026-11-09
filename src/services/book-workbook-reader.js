import { Worker } from "node:worker_threads";
import { checkWorkbookZip } from "./book-workbook.js";
export function readWorkbook(buffer,mode) {
  checkWorkbookZip(buffer);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./book-workbook-worker.js",import.meta.url),{
      workerData:{buffer,mode}, resourceLimits:{maxOldGenerationSizeMb:128},
    });
    let settled=false;
    function finish(error,rows){
      if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();
      if(error)reject(error);else resolve(rows);
    }
    const timer=setTimeout(()=>finish(Object.assign(new Error("Đọc Excel quá thời gian. Hãy chia nhỏ file."),{status:400})),15000);
    worker.once("message",result=>finish(result.error?Object.assign(new Error(result.error),{status:result.status}):null,result.rows));
    worker.once("error",()=>finish(Object.assign(new Error("Không đọc được Excel. File quá lớn hoặc không hợp lệ."),{status:400})));
    worker.once("exit",()=>{if(!settled)finish(Object.assign(new Error("Tiến trình đọc Excel đã dừng"),{status:400}));});
  });
}
