import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('각 관리 항목 CRUD와 영구 저장',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'center-test-'));const port=34179;let child;
 async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('server failed');})]);}
 async function stop(){child.kill();await once(child,'exit');}
 const call=async(k,method='GET',body,id='')=>{const r=await fetch(`http://127.0.0.1:${port}/api/${k}${id?'/'+id:''}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
 try{await start();for(const kind of ['members','fees','lessons','events','notices','messages','business','settlements']){const saved=await call(kind,'POST',{name:'검증 항목',body:'<script>문자열</script>'});assert.ok(saved.id);assert.equal((await call(kind))[0].name,'검증 항목');await call(kind,'PUT',{name:'수정 완료'},saved.id);assert.equal((await call(kind))[0].name,'수정 완료');await call(kind,'DELETE',null,saved.id);assert.equal((await call(kind)).length,0);}await call('members','POST',{name:'영구 저장 회원'});await stop();await start();assert.equal((await call('members'))[0].name,'영구 저장 회원');const html=await fetch(`http://127.0.0.1:${port}/`);assert.match(await html.text(),/탁구센터/);assert.equal((await fetch(`http://127.0.0.1:${port}/api/unknown`)).status,404);
 }finally{if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
