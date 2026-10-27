export function createLessonService({db,rows,row,fail,transaction}) {
 db.exec(`CREATE TABLE IF NOT EXISTS lesson_slots(id INTEGER PRIMARY KEY AUTOINCREMENT,coach_id INTEGER NOT NULL,weekday INTEGER NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS lesson_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,slot_id INTEGER NOT NULL,member_id INTEGER NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_lesson ON lesson_requests(slot_id) WHERE status IN ('pending','accepted');`);
 if(!db.prepare('PRAGMA table_info(lesson_slots)').all().some(c=>c.name==='enabled'))db.exec('ALTER TABLE lesson_slots ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
 const active=r=>['pending','accepted'].includes(r.status);
 const slots=()=>db.prepare('SELECT * FROM lesson_slots ORDER BY weekday,start,id').all();
 const requests=()=>db.prepare('SELECT * FROM lesson_requests ORDER BY id DESC').all();
 const coach=id=>{const m=row('members',id);if(m.type!=='코치')fail('회원구분이 코치인 회원을 선택해주세요.');return m;};
 const slot=id=>{const s=db.prepare('SELECT * FROM lesson_slots WHERE id=?').get(id);if(!s)fail('레슨 시간을 찾을 수 없습니다.',404);return s;};
 const owner=(auth,s)=>{if(auth.role!=='admin'&&auth.member_id!==s.coach_id)fail('담당 코치만 관리할 수 있습니다.',403);if(auth.role!=='admin')coach(auth.member_id);};
 const overlap=(a,b)=>a.weekday===b.weekday&&a.start<b.end&&b.start<a.end;
 function snapshot(auth){
 const members=rows('members'),byId=new Map(members.map(m=>[m.id,m]));
 const isCoach=auth.role==='member'&&byId.get(auth.member_id)?.type==='코치';
 const all=requests(),allSlots=slots();
 return {isCoach,coaches:members.filter(m=>m.type==='코치').map(m=>({id:m.id,name:m.name})),
 slots:allSlots.filter(s=>byId.get(s.coach_id)?.type==='코치').map(s=>{const booking=all.find(r=>r.slot_id===s.id&&active(r));return {id:s.id,coachId:s.coach_id,coachName:byId.get(s.coach_id)?.name||'삭제된 코치',weekday:s.weekday,start:s.start,end:s.end,enabled:!!s.enabled,availability:booking?booking.status:'available'};}),
 requests:all.filter(r=>auth.role==='admin'||r.member_id===auth.member_id||(isCoach&&allSlots.find(s=>s.id===r.slot_id)?.coach_id===auth.member_id)).map(r=>{const s=slot(r.slot_id);return {id:r.id,slotId:r.slot_id,memberId:r.member_id,memberName:byId.get(r.member_id)?.name||'삭제된 회원',coachId:s.coach_id,coachName:byId.get(s.coach_id)?.name||'삭제된 코치',weekday:s.weekday,start:s.start,end:s.end,status:r.status,created:r.created};})};
 }
 function guardMemberChange(id,nextType,remove=false){
 const owned=slots().filter(s=>s.coach_id===id);
 if(remove&&owned.some(s=>requests().some(r=>r.slot_id===s.id&&active(r))))fail('진행 중인 신청을 먼저 취소한 후 코치를 삭제해주세요.');
 if(!remove&&nextType!=='코치'&&owned.some(s=>s.enabled))fail('코치 시간표의 모집을 먼저 중지한 후 회원구분을 변경해주세요.');
 }
 function removeMember(id){
 db.prepare("UPDATE lesson_requests SET status='cancelled',updated=? WHERE member_id=? AND status IN ('pending','accepted')").run(new Date().toISOString(),id);
 // Historical coach slots and their requests are kept for records; the UI excludes removed coaches from booking.
 }
 async function handle(req,path,auth,body,json,res){
 const portal=path.startsWith('/api/portal/');
 if(path==='/api/scheduling'||path==='/api/portal/scheduling'){
 if(portal&&auth.role!=='member')fail('회원 계정으로 로그인해주세요.',403);
 if(!portal&&auth.role!=='admin')fail('관리자만 사용할 수 있습니다.',403);
 if(req.method!=='GET')fail('허용되지 않는 요청입니다.',405);
 return json(res,200,snapshot(auth));
 }
 const m=path.match(/^\/api\/(portal\/)?lesson-(slots|requests)(?:\/(\d+))?$/);if(!m)return false;
 if(portal&&auth.role!=='member')fail('회원 계정으로 로그인해주세요.',403);
 if(!portal&&auth.role!=='admin')fail('관리자만 사용할 수 있습니다.',403);
 const id=m[3]?Number(m[3]):null;
 if(m[2]==='slots'){
 if(!['POST','PUT','DELETE'].includes(req.method))fail('허용되지 않는 요청입니다.',405);
 const old=id?slot(id):null;if(old)owner(auth,old);
 if(req.method==='DELETE'){
 if(!old)fail('시간을 선택해주세요.');if(requests().some(r=>r.slot_id===id))fail('신청 이력이 있는 시간은 삭제할 수 없습니다. 진행 중인 신청은 취소하고 기존 시간은 유지해주세요.');
 db.prepare('DELETE FROM lesson_slots WHERE id=?').run(id);return json(res,200,{});
 }
 const b=await body(req),coachId=auth.role==='admin'?Number(b.coachId):auth.member_id;coach(coachId);
 const next={coach_id:coachId,weekday:Number(b.weekday),start:b.start,end:b.end};
 if(!Number.isInteger(next.weekday)||next.weekday<0||next.weekday>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.start||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.end||'')||next.start>=next.end)fail('요일과 시작·종료 시간을 확인해주세요. 종료는 시작보다 늦어야 합니다.');
 if(req.method==='PUT'&&!old)fail('시간을 선택해주세요.');
 if(old&&requests().some(r=>r.slot_id===id)&&(old.coach_id!==coachId||old.weekday!==next.weekday||old.start!==next.start||old.end!==next.end))fail('신청 이력이 있는 시간은 변경할 수 없습니다. 다른 시간을 새로 등록해주세요.');
 const enabled=b.enabled===false?0:1;if(!enabled&&old&&requests().some(r=>r.slot_id===id&&active(r)))fail('진행 중인 신청을 먼저 취소한 후 모집을 중지해주세요.');
 transaction(()=>{if(slots().some(s=>s.id!==id&&s.coach_id===coachId&&overlap(s,next)))fail('이 코치의 다른 시간과 겹칩니다.',409);
 if(old)db.prepare('UPDATE lesson_slots SET coach_id=?,weekday=?,start=?,end=?,enabled=? WHERE id=?').run(coachId,next.weekday,next.start,next.end,enabled,id);
 else db.prepare('INSERT INTO lesson_slots(coach_id,weekday,start,end,enabled) VALUES (?,?,?,?,?)').run(coachId,next.weekday,next.start,next.end,enabled);});
 return json(res,old?200:201,{});
 }
 if(req.method==='POST'&&!id){
 const b=await body(req),s=slot(Number(b.slotId)),memberId=auth.role==='admin'?Number(b.memberId):auth.member_id;
 row('members',memberId);coach(s.coach_id);if(!s.enabled)fail('모집이 중지된 시간입니다.',409);if(s.coach_id===memberId)fail('본인의 코치 시간에 신청할 수 없습니다.');
 const saved=transaction(()=>{
 if(requests().some(r=>r.slot_id===s.id&&active(r)))fail('이미 신청되었거나 수락된 시간입니다.',409);
 if(requests().some(r=>r.member_id===memberId&&active(r)&&overlap(slot(r.slot_id),s)))fail('회원의 다른 레슨 신청 시간과 겹칩니다.',409);
 const now=new Date().toISOString();return Number(db.prepare("INSERT INTO lesson_requests(slot_id,member_id,status,created,updated) VALUES (?,?,'pending',?,?)").run(s.id,memberId,now,now).lastInsertRowid);
 });return json(res,201,{id:saved,status:'pending'});
 }
 if(req.method==='PUT'&&id){
 const b=await body(req);const r=db.prepare('SELECT * FROM lesson_requests WHERE id=?').get(id);if(!r)fail('신청을 찾을 수 없습니다.',404);const s=slot(r.slot_id);
 if(b.status==='cancelled'){
 if(auth.role!=='admin'&&auth.member_id!==r.member_id){owner(auth,s);}
 if(!active(r))fail('대기 또는 수락된 신청만 취소할 수 있습니다.',409);
 }else if(['accepted','rejected'].includes(b.status)){
 if(auth.role==='admin')fail('수락·거절은 담당 코치가 로그인하여 처리해야 합니다.',403);
 owner(auth,s);if(r.status!=='pending')fail('대기 중인 신청만 수락·거절할 수 있습니다.',409);
 }else fail('올바른 신청 상태를 선택해주세요.');
 db.prepare('UPDATE lesson_requests SET status=?,updated=? WHERE id=?').run(b.status,new Date().toISOString(),id);return json(res,200,{});
 }
 fail('허용되지 않는 요청입니다.',405);
 }
 return {handle,snapshot,guardMemberChange,removeMember};
}
