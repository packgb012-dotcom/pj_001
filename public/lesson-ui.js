const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const weekdays=['일','월','화','수','목','금','토'];
export const lessonStatus={pending:'수락 대기',accepted:'수락 완료',rejected:'거절',cancelled:'취소'};
export async function mountLessonUI(root,{admin=false,memberId=null,api,onChange=async()=>{}}){
 let model,members=[],selectedCoach='',boardCoach='',busy=false;
 const prefix=admin?'':'portal/';
 async function load(){model=await api(prefix+'scheduling');if(admin)members=await api('members');render();}
 function coachOptions(blank=false){return (blank?'<option value="">전체 코치</option>':'')+model.coaches.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');}
 function schedule(){
 const slots=model.slots.filter(s=>!boardCoach||s.coachId===Number(boardCoach));
 return `<div class="lesson-week">${[1,2,3,4,5,6,0].map(day=>`<section class="lesson-week-day"><h3>${weekdays[day]}요일</h3>${slots.filter(s=>s.weekday===day).sort((a,b)=>a.start.localeCompare(b.start)||a.coachId-b.coachId).map(s=>{const req=model.requests.find(r=>r.slotId===s.id&&['pending','accepted'].includes(r.status));return `<div class="lesson-slot ${s.availability}"><strong>${esc(s.start)}–${esc(s.end)}</strong><span>${esc(s.coachName)}</span><small>${!s.enabled?'모집 중지':s.availability==='available'?'신청 가능':lessonStatus[s.availability]}</small>${req?`<b>${esc(req.memberName)}</b>`:''}${admin||(model.isCoach&&s.coachId===memberId)?`<button class="text-btn" data-toggle-slot="${s.id}">${s.enabled?'모집 중지':'모집 재개'}</button><button class="text-btn" data-remove-slot="${s.id}">시간 삭제</button>`:''}</div>`;}).join('')||'<p>등록 시간 없음</p>'}</section>`).join('')}</div>`;
 }
 function requestRows(){return model.requests.map(r=>`<tr><td>${esc(r.memberName)}</td><td>${esc(r.coachName)}</td><td>${weekdays[r.weekday]}요일 ${r.start}–${r.end}</td><td><span class="badge ${r.status==='pending'?'orange':''}">${lessonStatus[r.status]}</span></td><td>${r.status==='pending'&&model.isCoach&&r.coachId===memberId?`<button class="secondary" data-request="${r.id}" data-status="accepted">수락</button><button class="secondary" data-request="${r.id}" data-status="rejected">거절</button>`:''}${['pending','accepted'].includes(r.status)?`<button class="text-btn" data-request="${r.id}" data-status="cancelled">신청 취소</button>`:'—'}</td></tr>`).join('');}
 function render(){
 if(!model.coaches.some(c=>String(c.id)===selectedCoach))selectedCoach=String(model.coaches[0]?.id||'');
 root.innerHTML=`<div class="lesson-intro"><p>매주 반복되는 1:1 레슨 · 한국 시간 기준 · 신청 → 코치 수락 → 확정${model.coaches.length?'':'<br>회원관리에서 회원구분을 코치로 등록한 후 시간을 추가하세요.'}</p><button class="secondary" data-lesson-refresh>현황 새로고침</button></div><p class="lesson-error" role="alert"></p><div class="lesson-forms"><section class="panel"><div class="panel-top"><h2>${admin?'회원 대신 레슨 신청':'레슨 신청'}</h2></div><form class="lesson-form" id="lesson-request-form">${admin?`<label>신청 회원<select name="memberId" required><option value="">회원 선택</option>${members.map(m=>`<option value="${m.id}">${esc(m.name)} · ${esc(m.phone)}</option>`).join('')}</select></label>`:''}<label>담당 코치<select name="coachId" id="lesson-request-coach" required>${coachOptions()}</select></label><label>가능한 요일·시간<select name="slotId" required></select></label><p>수락 대기 중인 시간도 임시 예약됩니다. 다른 코치의 레슨과 겹치는 시간은 신청할 수 없습니다.</p><button class="primary" type="submit">레슨 신청하기</button></form></section>${admin||model.isCoach?`<section class="panel"><div class="panel-top"><h2>코치 시간 등록</h2></div><form class="lesson-form" id="lesson-slot-form">${admin?`<label>담당 코치<select name="coachId" required>${coachOptions()}</select></label>`:'<p>본인의 코치 시간표를 등록합니다.</p>'}<label>요일<select name="weekday" required>${[1,2,3,4,5,6,0].map(d=>`<option value="${d}">${weekdays[d]}요일</option>`).join('')}</select></label><div class="lesson-time-inputs"><label>시작 시간<input name="start" type="time" required></label><label>종료 시간<input name="end" type="time" required></label></div><button class="primary" type="submit">가능 시간 등록</button></form></section>`:''}</div><section class="panel lesson-section"><div class="panel-top"><div><h2>코치별 주간 시간표</h2><p>요일별·시간순으로 신청 가능 시간, 수락 대기, 확정 레슨을 확인하세요.</p></div><label>코치 선택<select id="lesson-board-coach">${coachOptions(true)}</select></label></div><div id="lesson-week-content">${schedule()}</div></section><section class="panel lesson-section"><div class="panel-top"><h2>${admin?'전체 레슨 신청 현황':model.isCoach?'내 신청 · 담당 레슨 수락 관리':'내 레슨 신청 현황'}</h2></div>${model.requests.length?`<div class="table-wrap"><table><thead><tr><th>회원</th><th>코치</th><th>요일·시간</th><th>상태</th><th>처리</th></tr></thead><tbody>${requestRows()}</tbody></table></div>`:'<div class="empty"><h3>레슨 신청 내역이 없습니다.</h3></div>'}</section>`;
 const coachSelect=root.querySelector('#lesson-request-coach');coachSelect.value=selectedCoach;
 function available(){selectedCoach=coachSelect.value;const options=model.slots.filter(s=>String(s.coachId)===selectedCoach&&s.enabled&&s.availability==='available');const select=root.querySelector('[name=slotId]');select.innerHTML=options.length?options.map(s=>`<option value="${s.id}">매주 ${weekdays[s.weekday]}요일 ${s.start}–${s.end}</option>`).join(''):'<option value="">신청 가능한 시간이 없습니다</option>';root.querySelector('#lesson-request-form button[type=submit]').disabled=!options.length;}
 coachSelect.onchange=available;available();
 const filter=root.querySelector('#lesson-board-coach');filter.value=boardCoach;filter.onchange=()=>{boardCoach=filter.value;root.querySelector('#lesson-week-content').innerHTML=schedule();};
 root.querySelector('#lesson-request-form').onsubmit=e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));mutate(()=>api(prefix+'lesson-requests','POST',b),'레슨을 신청했습니다. 코치 수락 후 확정됩니다.');};
 const sf=root.querySelector('#lesson-slot-form');if(sf)sf.onsubmit=e=>{e.preventDefault();mutate(()=>api(prefix+'lesson-slots','POST',Object.fromEntries(new FormData(e.target))));};
 }
 async function mutate(action,message='처리되었습니다.'){
 if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await action();await load();await onChange();root.querySelector('.lesson-error').textContent=message;}
 catch(e){try{await load();}catch{}root.querySelector('.lesson-error').textContent=e.message;}
 finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);const available=root.querySelector('[name=slotId]')?.value;if(!available)root.querySelector('#lesson-request-form button[type=submit]').disabled=true;}
 }
 root.onclick=e=>{const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-lesson-refresh'))mutate(async()=>{});
 if(b.dataset.request){const status=b.dataset.status;if(status==='cancelled'&&!confirm('이 레슨 신청을 취소하시겠습니까?'))return;mutate(()=>api(prefix+'lesson-requests/'+b.dataset.request,'PUT',{status}));}
 if(b.dataset.toggleSlot){const s=model.slots.find(s=>s.id===Number(b.dataset.toggleSlot));mutate(()=>api(prefix+'lesson-slots/'+s.id,'PUT',{...s,enabled:!s.enabled}));}
 if(b.dataset.removeSlot&&confirm('이 코치 시간을 삭제하시겠습니까?'))mutate(()=>api(prefix+'lesson-slots/'+b.dataset.removeSlot,'DELETE'));
 };
 try{await load();}catch(e){root.textContent=e.message;}
}
