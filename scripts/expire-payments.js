import { sweepExpiredPayments } from '../src/services/payment-expiry.service.js';
import { pool } from '../src/config/db.js';
try{console.log(await sweepExpiredPayments());}finally{await pool.end();}
