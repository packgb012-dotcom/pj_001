import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
const root=fileURLToPath(new URL('.',import.meta.url));
mkdirSync(process.env.DATA_DIR||root+'data',{recursive:true});
const db=new DatabaseSync((process.env.DATA_DIR||root+'data')+'/center.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS member_auth (member_id INTEGER PRIMARY KEY, hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, member_id INTEGER, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS registrations (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, member_id INTEGER NOT NULL, created TEXT NOT NULL, UNIQUE(event_id,member_id));`);
const kinds=new Set(['members','fees','lessons','events','notices','messages','business','settlements']);
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=password=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');};
const verify=(password,stored)=>{if(!stored)return false;const [salt,expected]=stored.split(':');const actual=scryptSync(password,salt,64);return timingSafeEqual(Buffer.from(expected,'hex'),actual);};
const validPassword=p=>{if(typeof p!=='string'||p.length<8||p.length>128)fail('비밀번호는 8~128자로 입력해주세요.');};
const phone=v=>String(v||'').replace(/\D/g,'');
const rows=kind=>db.prepare('SELECT id,body FROM records WHERE kind=? ORDER BY id DESC').all(kind).map(r=>({...JSON.parse(r.body),id:r.id}));
const row=(kind,id)=>{const r=db.prepare('SELECT id,body FROM records WHERE kind=? AND id=?').get(kind,id);if(!r)fail('해당 항목을 찾을 수 없습니다.',404);return {...JSON.parse(r.body),id:r.id};};
const count=id=>Number(db.prepare('SELECT count(*) AS n FROM registrations WHERE event_id=?').get(id).n);
const adminExists=()=>!!db.prepare("SELECT value FROM settings WHERE key='admin_hash'").get();
const seoulNow=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(' ','T');
const digest=v=>createHash('sha256').update(v).digest('hex');
function session(req){const match=(req.headers.cookie||'').match(/(?:^|;\s*)center_session=([a-f0-9]{64})(?:;|$)/);if(!match)return null;return db.prepare('SELECT role,member_id FROM sessions WHERE token=? AND expires>?').get(digest(match[1]),Date.now())||null;}
function createSession(res,role,id=null){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token),role,id,Date.now()+8*3600000);res.setHeader('Set-Cookie',`center_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)fail('입력 내용이 너무 큽니다.',413);}let value;try{value=JSON.parse(raw);}catch{fail('올바른 JSON을 입력해주세요.');}if(!value||Array.isArray(value)||typeof value!=='object')fail('잘못된 입력입니다.');return value;}
const attempts=new Map();
function rateLimit(req){const key=req.socket.remoteAddress;const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);let a=attempts.get(key);if(!a){a={n:0,until:now+15*60000};attempts.set(key,a);}if(++a.n>30)fail('로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해주세요.',429);}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 if(path.startsWith('/api/')){
 if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)fail('다른 사이트에서 보낸 요청은 허용되지 않습니다.',403);
 if(path==='/api/auth/status'&&req.method==='GET'){const s=session(req);return json(res,200,{setupRequired:!adminExists(),role:s?.role||null});}
 if(path==='/api/auth/setup'&&req.method==='POST'){
 rateLimit(req);const b=await body(req);validPassword(b.password);
 if(adminExists())fail('이미 관리자 계정이 설정되었습니다.',409);
 db.prepare("INSERT INTO settings VALUES ('admin_hash',?)").run(hash(b.password));createSession(res,'admin');return json(res,201,{role:'admin'});
 }
 if(path==='/api/auth/login'&&req.method==='POST'){
 rateLimit(req);const b=await body(req);if(typeof b.password!=='string'||b.password.length>128)fail('로그인 정보를 확인해주세요.',401);
 if(b.role==='admin'){
 const stored=db.prepare("SELECT value FROM settings WHERE key='admin_hash'").get()?.value;
 if(!verify(b.password,stored))fail('로그인 정보를 확인해주세요.',401);createSession(res,'admin');return json(res,200,{role:'admin'});
 }
 const member=rows('members').find(m=>phone(m.phone)===phone(b.phone)&&phone(b.phone));
 const stored=member&&db.prepare('SELECT hash FROM member_auth WHERE member_id=?').get(member.id)?.hash;
 if(!verify(b.password,stored))fail('전화번호와 비밀번호를 확인해주세요. 관리자에게 계정 등록을 요청할 수 있습니다.',401);
 createSession(res,'member',member.id);return json(res,200,{role:'member'});
 }
 if(path==='/api/auth/logout'&&req.method==='POST'){
 const match=(req.headers.cookie||'').match(/center_session=([a-f0-9]{64})/);if(match)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(match[1]));res.setHeader('Set-Cookie','center_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{});
 }
 const auth=session(req);if(!auth)fail('로그인이 필요합니다.',401);
 if(path.startsWith('/api/portal/')){
 if(auth.role!=='member')fail('회원 계정으로 로그인해주세요.',403);
 const member=row('members',auth.member_id);
 if(path==='/api/portal/me'&&req.method==='GET')return json(res,200,{id:member.id,name:member.name});
 if(path==='/api/portal/events'&&req.method==='GET'){
 const own=new Set(db.prepare('SELECT event_id FROM registrations WHERE member_id=?').all(member.id).map(r=>r.event_id));
 return json(res,200,rows('events').map(r=>({...r,registeredCount:count(r.id),applied:own.has(r.id),started:r.date<=seoulNow()})));
 }
 const match=path.match(/^\/api\/portal\/events\/(\d+)\/registration$/);
 if(match&&['POST','DELETE'].includes(req.method)){
 const id=Number(match[1]);const event=row('events',id);if(!event.date||event.date<=seoulNow())fail('이미 시작한 대회는 신청하거나 취소할 수 없습니다. 관리자에게 문의해주세요.');
 if(req.method==='DELETE'){db.prepare('DELETE FROM registrations WHERE event_id=? AND member_id=?').run(id,member.id);return json(res,200,{});}
 if(event.eligibility==='학생'&&member.student!=='학생')fail('학생 회원만 참가할 수 있습니다. 관리자에게 학생 여부 등록을 요청해주세요.');
 if(event.eligibility==='성인'){
 const today=seoulNow().slice(0,10);const birth=String(member.birth||'');const age=Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||age<19)fail('성인(만 19세 이상) 회원만 참가할 수 있습니다. 생년월일 등록을 확인해주세요.');
 }
 transaction(()=>{if(db.prepare('SELECT id FROM registrations WHERE event_id=? AND member_id=?').get(id,member.id))fail('이미 신청한 대회입니다.',409);if(count(id)>=Number(event.capacity))fail('신청 정원이 마감되었습니다.',409);db.prepare('INSERT INTO registrations(event_id,member_id,created) VALUES (?,?,?)').run(id,member.id,new Date().toISOString());});
 return json(res,201,{applied:true});
 }
 fail('없는 경로입니다.',404);
 }
 if(auth.role!=='admin')fail('관리자만 사용할 수 있습니다.',403);
 if(path==='/api/registrations'&&req.method==='GET'){
 return json(res,200,db.prepare('SELECT * FROM registrations ORDER BY id DESC').all().map(r=>{const m=row('members',r.member_id);return {id:r.id,eventId:r.event_id,memberId:r.member_id,memberName:m.name,eventName:row('events',r.event_id).name,phone:m.phone,created:r.created};}));
 }
 const registrationPath=path.match(/^\/api\/registrations(?:\/(\d+))?$/);
 if(registrationPath&&['POST','PUT','DELETE'].includes(req.method)){
 const id=registrationPath[1]?Number(registrationPath[1]):null;
 const previous=id?db.prepare('SELECT * FROM registrations WHERE id=?').get(id):null;
 if((req.method==='PUT'||req.method==='DELETE')&&!previous)fail('신청 내역을 찾을 수 없습니다.',404);
 if(req.method==='DELETE'){db.prepare('DELETE FROM registrations WHERE id=?').run(id);return json(res,200,{});}
 if(req.method==='POST'&&id)fail('잘못된 경로입니다.',404);
 const b=await body(req);const eventId=Number(b.eventId),memberId=Number(b.memberId);
 if(!Number.isSafeInteger(eventId)||!Number.isSafeInteger(memberId))fail('대회와 회원을 선택해주세요.');
 row('members',memberId);const event=row('events',eventId);
 const savedId=transaction(()=>{
 if(db.prepare('SELECT id FROM registrations WHERE event_id=? AND member_id=? AND id<>?').get(eventId,memberId,id||0))fail('이미 해당 대회에 신청한 회원입니다.',409);
 const occupied=count(eventId)-(previous?.event_id===eventId?1:0);
 if(occupied>=Number(event.capacity))fail('신청 정원이 마감되었습니다.',409);
 if(id){db.prepare('UPDATE registrations SET event_id=?,member_id=? WHERE id=?').run(eventId,memberId,id);return id;}
 return Number(db.prepare('INSERT INTO registrations(event_id,member_id,created) VALUES (?,?,?)').run(eventId,memberId,new Date().toISOString()).lastInsertRowid);
 });return json(res,id?200:201,{id:savedId,eventId,memberId});
 }
 const [, ,kind,id]=path.split('/');if(!kinds.has(kind))fail('없는 항목입니다.',404);
 if(req.method==='GET')return json(res,200,rows(kind).map(r=>kind==='members'?{...r,loginEnabled:!!db.prepare('SELECT member_id FROM member_auth WHERE member_id=?').get(r.id)}:r));
 if(req.method==='DELETE'&&/^\d+$/.test(id)){
 row(kind,Number(id));transaction(()=>{db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,Number(id));if(kind==='events')db.prepare('DELETE FROM registrations WHERE event_id=?').run(Number(id));if(kind==='members'){db.prepare('DELETE FROM registrations WHERE member_id=?').run(Number(id));db.prepare('DELETE FROM member_auth WHERE member_id=?').run(Number(id));db.prepare('DELETE FROM sessions WHERE member_id=?').run(Number(id));}});return json(res,200,{});
 }
 if(req.method==='POST'||req.method==='PUT'){
 const b=await body(req);delete b.id;delete b.loginEnabled;const password=b.loginPassword;delete b.loginPassword;
 if(!Object.values(b).some(v=>String(v).trim()))fail('내용을 입력해주세요.');
 if(req.method==='PUT'){if(!/^\d+$/.test(id))fail('잘못된 번호입니다.');row(kind,Number(id));}
 if(kind==='members'){
 if(password)validPassword(password);
 if(b.phone&&rows('members').some(m=>m.id!==Number(id)&&phone(m.phone)===phone(b.phone)))fail('이미 등록된 전화번호입니다.');
 if(password&&(!b.phone||phone(b.phone).length<9))fail('로그인용 전화번호를 입력해주세요.');
 }
 if(kind==='events'){
 const parsedDate=new Date(String(b.date)+'+09:00');if(!Number.isFinite(parsedDate.getTime())||new Date(parsedDate.getTime()+9*3600000).toISOString().slice(0,16)!==b.date)fail('유효한 대회일시를 입력해주세요.');
 if(!b.name||!b.place||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.date||'')||!Number.isSafeInteger(Number(b.capacity))||Number(b.capacity)<1)fail('대회명·장소·일시와 1명 이상의 정원을 입력해주세요.');
 if(id&&Number(b.capacity)<count(Number(id)))fail('정원은 현재 신청자 수보다 적을 수 없습니다.');
 }
 const savedId=transaction(()=>{let key=Number(id);if(req.method==='PUT')db.prepare('UPDATE records SET body=? WHERE kind=? AND id=?').run(JSON.stringify(b),kind,key);else key=Number(db.prepare('INSERT INTO records(kind,body) VALUES (?,?)').run(kind,JSON.stringify(b)).lastInsertRowid);if(kind==='members'&&password){db.prepare('INSERT OR REPLACE INTO member_auth VALUES (?,?)').run(key,hash(password));db.prepare('DELETE FROM sessions WHERE member_id=?').run(key);}return key;});
 return json(res,req.method==='POST'?201:200,{...b,id:savedId});
 }
 fail('허용되지 않는 요청입니다.',405);
 }
 const files={'/':'index.html','/member':'member.html','/member/':'member.html','/login':'login.html','/app.js':'app.js','/member.js':'member.js','/login.js':'login.js','/calendar.js':'calendar.js','/style.css':'style.css'};
 const file=files[path];if(!file){res.writeHead(404);return res.end('Not found');}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(readFileSync(root+'public/'+file));
 }catch(e){json(res,e.status||400,{error:e.status?e.message:'요청을 처리하지 못했습니다. 입력 내용을 확인해주세요.'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`탁구센터 서버 시작 · 포트 ${server.address().port}`));
