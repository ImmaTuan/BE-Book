import { parentPort, workerData } from "node:worker_threads";
import { parseWorkbook } from "./book-workbook.js";
try { parentPort.postMessage({rows:await parseWorkbook(Buffer.from(workerData.buffer),workerData.mode)}); }
catch(error){parentPort.postMessage({error:error.message,status:error.status||400});}
