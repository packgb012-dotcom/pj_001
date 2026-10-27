import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
mkdirSync(process.env.DATA_DIR||root+'data',{recursive:true});
const db=new DatabaseSync((process.env.DATA_DIR||root+'data')+'/center.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL)');
const kinds=new Set(['members','fees','lessons','events','notices','messages','business','settlements']);
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 const [, ,kind,id]=url.pathname.split('/');
 if(!kinds.has(kind)){res.writeHead(404);return res.end(JSON.stringify({error:'없는 항목입니다.'}));}
 if(req.method==='GET'){return res.end(JSON.stringify(db.prepare('SELECT id,body FROM records WHERE kind=? ORDER BY id DESC').all(kind).map(r=>({...JSON.parse(r.body),id:r.id}))));}
 if(req.method==='DELETE' && /^\d+$/.test(id)){db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,Number(id));return res.end('{}');}
 if(req.method==='POST'||req.method==='PUT'){
 let raw='';for await(const part of req){raw+=part;if(raw.length>100000){res.writeHead(413);return res.end('{}');}}
 const body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object')throw Error('잘못된 입력입니다.');delete body.id;
 if(!Object.values(body).some(v=>String(v).trim()))throw Error('내용을 입력해주세요.');
 if(req.method==='PUT'){if(!/^\d+$/.test(id))throw Error('잘못된 번호입니다.');db.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(JSON.stringify(body),kind,Number(id));return res.end(JSON.stringify({id:Number(id),...body}));}
 const result=db.prepare('INSERT INTO records(kind,body) VALUES (?,?)').run(kind,JSON.stringify(body));res.writeHead(201);return res.end(JSON.stringify({...body,id:Number(result.lastInsertRowid)}));
 }
 res.writeHead(405);return res.end('{}');
 }
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(readFileSync(root+'public/'+file));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('탁구센터 서버 시작'));
