import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('코치 주간 레슨 신청·수락·권한·시간 충돌 통합 검증',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'center-lesson-'));let child,base,admin,c1,c2,a,b,coach1,coach2,alice,bob,s1,s2,request;
 async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});const [out]=await once(child.stdout,'data');base='http://127.0.0.1:'+out.toString().match(/포트 (\d+)/)[1];}
 async function stop(){child.kill();await once(child,'exit');}
 async function call(path,method='GET',body,cookie=admin){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function member(name,phone,type='월회원'){return (await call('members','POST',{name,phone,type,loginPassword:'lesson-password-123'})).data;}
 async function login(member){const r=await call('auth/login','POST',{role:'member',phone:member.phone,password:'lesson-password-123'});assert.equal(r.status,200);return r.cookie;}
 try{
 await start();admin=(await call('auth/setup','POST',{password:'admin-lesson-123'},null)).cookie;
 coach1=await member('코치 가','01011110001','코치');coach2=await member('코치 나','01011110002','코치');alice=await member('회원 가','01011110003');bob=await member('회원 나','01011110004');
 c1=await login(coach1);c2=await login(coach2);a=await login(alice);b=await login(bob);
 await t.test('코치별 요일·시간 등록과 겹침 방지',async()=>{
 assert.equal((await call('lesson-slots','POST',{coachId:coach1.id,weekday:1,start:'18:00',end:'18:30'})).status,201);
 assert.equal((await call('lesson-slots','POST',{coachId:coach1.id,weekday:1,start:'18:15',end:'18:45'})).status,409);
 assert.equal((await call('lesson-slots','POST',{coachId:coach1.id,weekday:1,start:'19:00',end:'18:00'})).status,400);
 assert.equal((await call('portal/lesson-slots','POST',{coachId:coach2.id,weekday:2,start:'18:00',end:'18:30'},a)).status,400);
 assert.equal((await call('portal/lesson-slots','POST',{coachId:coach1.id,weekday:1,start:'18:00',end:'18:30'},c2)).status,201);
 const slots=(await call('scheduling')).data.slots;s1=slots.find(s=>s.coachId===coach1.id);s2=slots.find(s=>s.coachId===coach2.id);assert.ok(s1&&s2);
 });
 await t.test('본인 신청·대기 예약·중복 시간 차단',async()=>{
 const result=await call('portal/lesson-requests','POST',{slotId:s1.id,memberId:bob.id},a);assert.equal(result.status,201);request=result.data;
 const own=(await call('portal/scheduling','GET',null,a)).data;assert.equal(own.requests[0].memberId,alice.id);assert.equal(own.requests[0].status,'pending');
 assert.equal((await call('portal/lesson-requests','POST',{slotId:s1.id},b)).status,409);
 assert.equal((await call('portal/lesson-requests','POST',{slotId:s2.id},a)).status,409);
 assert.equal((await call('portal/scheduling','GET',null,b)).data.requests.length,0);
 });
 await t.test('담당 코치만 수락·거절, 회원·다른 코치·관리자는 불가',async()=>{
 for(const cookie of [a,b,c2,admin]){const prefix=cookie===admin?'':'portal/';assert.equal((await call(prefix+'lesson-requests/'+request.id,'PUT',{status:'accepted'},cookie)).status,403);}
 assert.equal((await call('portal/lesson-requests/'+request.id,'PUT',{status:'accepted'},c1)).status,200);
 assert.equal((await call('portal/lesson-requests/'+request.id,'PUT',{status:'rejected'},c1)).status,409);
 assert.equal((await call('portal/scheduling','GET',null,c1)).data.requests[0].memberName,alice.name);
 assert.equal((await call('portal/scheduling','GET',null,c2)).data.requests.length,0);
 });
 await t.test('신청 이력 보호와 본인 취소 후 시간 재오픈',async()=>{
 assert.equal((await call('lesson-slots/'+s1.id,'DELETE')).status,400);
 assert.equal((await call('lesson-slots/'+s1.id,'PUT',{coachId:coach1.id,weekday:1,start:'20:00',end:'20:30'})).status,400);
 assert.equal((await call('portal/lesson-requests/'+request.id,'PUT',{status:'cancelled'},b)).status,403);
 assert.equal((await call('portal/lesson-requests/'+request.id,'PUT',{status:'cancelled'},a)).status,200);
 assert.equal((await call('scheduling')).data.slots.find(s=>s.id===s1.id).availability,'available');
 const next=await call('portal/lesson-requests','POST',{slotId:s1.id},b);assert.equal(next.status,201);assert.equal((await call('portal/lesson-requests/'+next.data.id,'PUT',{status:'rejected'},c1)).status,200);
 assert.equal((await call('scheduling')).data.slots.find(s=>s.id===s1.id).availability,'available');
 });
 await t.test('모집 중지와 재개, 관리자 대리 신청도 코치 수락 대기',async()=>{
 assert.equal((await call('lesson-slots/'+s1.id,'PUT',{coachId:coach1.id,weekday:1,start:'18:00',end:'18:30',enabled:false})).status,200);
 assert.equal((await call('portal/lesson-requests','POST',{slotId:s1.id},a)).status,409);
 await call('lesson-slots/'+s1.id,'PUT',{coachId:coach1.id,weekday:1,start:'18:00',end:'18:30',enabled:true});
 const created=await call('lesson-requests','POST',{slotId:s1.id,memberId:alice.id});assert.equal(created.status,201);assert.equal(created.data.status,'pending');
 });
 await t.test('재시작 후 시간표와 수락 대기 보존',async()=>{
 await stop();await start();const model=(await call('scheduling')).data;assert.equal(model.slots.length,2);assert.ok(model.requests.some(r=>r.status==='pending'));assert.equal((await call('portal/me','GET',null,c1)).data.isCoach,true);
 });
 }finally{if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
