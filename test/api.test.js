import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('관리자·회원 인증, 참가 신청과 데이터 보존 통합 검증',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'center-test-'));let child,base,admin,alice,bob,memberA,memberB,event;
 async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});const ready=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('server failed');})]);base='http://127.0.0.1:'+ready[0].toString().match(/포트 (\d+)/)[1];}
 async function stop(){child.kill();await once(child,'exit');}
 async function request(path,method='GET',value,cookie){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(value?{body:JSON.stringify(value)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function login(role,phone,password){const r=await request('auth/login','POST',{role,phone,password});assert.equal(r.status,200);return r.cookie;}
 try{
 await start();
 await t.test('최초 설정과 미인증 요청 차단',async()=>{
 assert.equal((await request('members')).status,401);assert.equal((await request('auth/status')).body.setupRequired,true);
 const setup=await request('auth/setup','POST',{password:'admin-test-123'});assert.equal(setup.status,201);admin=setup.cookie;
 assert.equal((await request('auth/setup','POST',{password:'another-123'})).status,409);
 assert.equal((await request('auth/login','POST',{role:'admin',password:'wrong'})).status,401);
 });
 await t.test('기존 관리 기능 CRUD 및 비밀번호 비노출',async()=>{
 for(const kind of ['members','fees','lessons','events','notices','messages','business','settlements']){
 const fixture=kind==='events'?{name:'검증 대회',date:'2099-10-27T09:00',place:'탁구장',capacity:10,eligibility:'회원'}:{name:'검증 항목',body:'<script>문자열</script>'};
 const saved=await request(kind,'POST',fixture,admin);assert.equal(saved.status,201);const id=saved.body.id;
 assert.equal((await request(kind,'GET',null,admin)).body[0].name,fixture.name);
 assert.equal((await request(kind+'/'+id,'PUT',{...fixture,name:'수정 완료'},admin)).status,200);
 assert.equal((await request(kind,'GET',null,admin)).body[0].name,'수정 완료');
 assert.equal((await request(kind+'/'+id,'DELETE',null,admin)).status,200);
 }
 memberA=(await request('members','POST',{name:'회원 가',phone:'010-1111-1111',birth:'1990-01-01',loginPassword:'alice-pass-123'},admin)).body;
 memberB=(await request('members','POST',{name:'회원 나',phone:'01022222222',loginPassword:'bob-pass-123'},admin)).body;
 assert.equal(memberA.loginPassword,undefined);assert.equal((await request('members','GET',null,admin)).body.some(r=>r.loginPassword),false);
 assert.equal((await request('members','POST',{name:'중복',phone:'01011111111'},admin)).status,400);
 alice=await login('member','01011111111','alice-pass-123');bob=await login('member','01022222222','bob-pass-123');
 });
 await t.test('회원 권한과 개인정보 분리',async()=>{
 assert.equal((await request('members','GET',null,alice)).status,403);assert.equal((await request('events','POST',{name:'무단'},alice)).status,403);assert.equal((await request('registrations','GET',null,alice)).status,403);
 const me=await request('portal/me','GET',null,alice);assert.equal(me.body.name,'회원 가');assert.equal(me.body.phone,undefined);
 });
 await t.test('중복 신청·정원·본인 취소·관리자 명단',async()=>{
 event=(await request('events','POST',{name:'신청 대회',date:'2099-10-27T09:00',place:'센터',capacity:1,eligibility:'회원'},admin)).body;
 const path=`portal/events/${event.id}/registration`;
 assert.equal((await request(path,'POST',{memberId:memberB.id},alice)).status,201);
 assert.equal((await request(path,'POST',{},alice)).status,409);assert.equal((await request(path,'POST',{},bob)).status,409);
 assert.equal((await request('portal/events','GET',null,alice)).body[0].applied,true);assert.equal((await request('portal/events','GET',null,bob)).body[0].applied,false);
 const registrations=(await request('registrations','GET',null,admin)).body;assert.equal(registrations[0].memberId,memberA.id);assert.equal(registrations[0].memberName,'회원 가');
 await request(path,'DELETE',null,bob);assert.equal((await request('registrations','GET',null,admin)).body.length,1);
 await request(path,'DELETE',null,alice);assert.equal((await request('portal/events','GET',null,alice)).body[0].applied,false);
 const results=await Promise.all([request(path,'POST',{},alice),request(path,'POST',{},bob)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 });
 await t.test('참가자격과 과거 대회 신청 제한',async()=>{
 const past=(await request('events','POST',{name:'지난 대회',date:'2020-01-01T09:00',place:'센터',capacity:5,eligibility:'회원'},admin)).body;
 assert.equal((await request(`portal/events/${past.id}/registration`,'POST',{},alice)).status,400);
 const student=(await request('events','POST',{name:'학생 대회',date:'2099-01-01T09:00',place:'센터',capacity:5,eligibility:'학생'},admin)).body;
 assert.equal((await request(`portal/events/${student.id}/registration`,'POST',{},alice)).status,400);
 });
 await t.test('관리자의 대리 신청·수정·취소와 중복·정원 보호',async()=>{
 const extra=(await request('events','POST',{name:'관리자 대리 신청 대회',date:'2020-03-01T10:00',place:'센터',capacity:2,eligibility:'회원'},admin)).body;
 const created=await request('registrations','POST',{eventId:extra.id,memberId:memberA.id},admin);assert.equal(created.status,201);
 assert.equal((await request('registrations','POST',{eventId:extra.id,memberId:memberA.id},admin)).status,409);
 assert.equal((await request('registrations/'+created.body.id,'PUT',{eventId:extra.id,memberId:memberB.id},admin)).status,200);
 const listed=(await request('registrations','GET',null,admin)).body.find(r=>r.id===created.body.id);assert.equal(listed.memberId,memberB.id);assert.equal(listed.eventName,extra.name);
 assert.equal((await request('registrations','POST',{eventId:extra.id,memberId:memberA.id},alice)).status,403);
 const full=(await request('events','POST',{name:'정원 보호 대회',date:'2099-12-01T10:00',place:'센터',capacity:1,eligibility:'회원'},admin)).body;
 const fullEntry=await request('registrations','POST',{eventId:full.id,memberId:memberA.id},admin);
 assert.equal((await request('registrations/'+created.body.id,'PUT',{eventId:full.id,memberId:memberB.id},admin)).status,409);
 assert.equal((await request('registrations','GET',null,admin)).body.find(r=>r.id===created.body.id).eventId,extra.id);
 assert.equal((await request('events/'+full.id,'PUT',{...full,capacity:0},admin)).status,400);
 await request('registrations/'+created.body.id,'DELETE',null,admin);await request('registrations/'+fullEntry.body.id,'DELETE',null,admin);
 assert.equal((await request('registrations','GET',null,admin)).body.length,1);
 });
 await t.test('서버 재시작 후 계정·신청 보존 및 회원 삭제 정리',async()=>{
 await stop();await start();assert.equal((await request('auth/status','GET',null,admin)).body.role,'admin');
 assert.equal((await request('registrations','GET',null,admin)).body.length,1);
 assert.equal((await request('portal/events','GET',null,alice)).status,200);
 await request('members/'+memberA.id,'DELETE',null,admin);assert.equal((await request('portal/me','GET',null,alice)).status,401);
 await request('events/'+event.id,'DELETE',null,admin);assert.equal((await request('registrations','GET',null,admin)).body.length,0);
 const html=await fetch(base+'/member');assert.match(await html.text(),/내 신청 캘린더/);
 await request('auth/logout','POST',{},admin);assert.equal((await request('members','GET',null,admin)).status,401);
 });
 }finally{if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
