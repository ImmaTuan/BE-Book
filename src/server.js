import 'dotenv/config';
import {app} from './app.js';
import {secret} from './config/auth.js';
import {pool} from './config/db.js';
try{secret();await pool.execute('SELECT 1');const port=Number(process.env.PORT||3000);const server=app.listen(port,'127.0.0.1',()=>console.log(`CRUD sách: http://localhost:${port}/api/admin/books`));for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>server.close(async()=>{await pool.end();process.exit(0);}));}catch(e){console.error('Không kết nối được MySQL:',e.message);await pool.end();process.exitCode=1;}
