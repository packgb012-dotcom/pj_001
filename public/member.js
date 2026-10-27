import { mountLessonUI } from './lesson-ui.js';
import {seoulToday,monthCells,shiftMonth,eventsOnDate} from './calendar.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentMember=null;
let events=[],view='events',selectedId=null,busy=false;
let [year,month]=seoulToday().split('-').slice(0,2).map(Number);month--;
async function api(path,method='GET',payload={}){
 const response=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},...(['POST','PUT'].includes(method)?{body:JSON.stringify(payload)}:{})});
 const result=await response.json();if(response.status===401){location.replace('/login');throw Error('다시 로그인해주세요.');}if(!response.ok)throw Error(result.error||'요청에 실패했습니다.');return result;
}
async function refresh(){if(view!=='lessons')events=await api('portal/events');render();}
function status(event){return event.applied?'신청완료':event.started?'신청종료':event.registeredCount>=Number(event.capacity)?'정원마감':'신청가능';}
function render(){
 document.querySelector('.member-main h1').textContent=view==='lessons'?'레슨 신청·시간표':'함께하는 대회·행사';
 document.querySelector('.page-heading p').textContent=view==='lessons'?'코치의 가능한 시간을 선택하고 신청·수락 현황을 확인하세요.':'참가할 대회를 찾아 신청하고, 내 일정을 확인하세요.';
 $('[data-view=lessons]').classList.toggle('selected',view==='lessons');
 if(view==='lessons'){$('[data-view=events]').classList.remove('selected');$('[data-view=mine]').classList.remove('selected');$('#member-content').innerHTML='<div id="member-lesson-workspace"></div>';mountLessonUI($('#member-lesson-workspace'),{api,memberId:currentMember?.id});return;}
 $('[data-view=events]').classList.toggle('selected',view==='events');$('[data-view=mine]').classList.toggle('selected',view==='mine');
 if(view==='mine'){const own=events.filter(e=>e.applied);const visible=own.filter(e=>e.date?.startsWith(`${year}-${String(month+1).padStart(2,'0')}-`));$('#member-content').innerHTML=`<section class="panel calendar-panel"><div class="panel-top calendar-top"><div><h2 id="member-calendar-title" tabindex="-1">내 신청 캘린더 · ${year}년 ${month+1}월</h2><p>이 달의 신청 ${visible.length}건 · 한국 시간 기준</p></div><div class="calendar-controls"><button class="secondary" data-month="-1" aria-label="이전 달">‹</button><button class="secondary" data-today>오늘</button><button class="secondary" data-month="1" aria-label="다음 달">›</button></div></div><div class="calendar-week" aria-hidden="true">${['일','월','화','수','목','금','토'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-grid">${monthCells(year,month).map(date=>date?`<div class="calendar-day ${date===seoulToday()?'is-today':''}" aria-label="${date}"><time datetime="${date}">${Number(date.slice(8))}</time>${eventsOnDate(own,date).map(e=>`<button class="calendar-event" data-event="${e.id}" aria-label="${esc(date+' '+e.name+' 참가 신청 '+e.registeredCount+'명 / 정원 '+e.capacity+'명 상세보기')}"><span>${esc(e.date.slice(11,16))}</span><strong>${esc(e.name)}</strong><small class="calendar-participants">참가 ${e.registeredCount} / ${esc(e.capacity)}명</small></button>`).join('')}</div>`:'<div class="calendar-day outside" aria-hidden="true"></div>').join('')}</div>${visible.length?'':'<p class="calendar-no-events">이번 달에 신청한 대회가 없습니다. 전체 대회에서 신청하거나 다른 달을 확인하세요.</p>'}</section>`;return;}
 const sorted=[...events].sort((a,b)=>Number(a.started)-Number(b.started)||a.date.localeCompare(b.date));
 $('#member-content').innerHTML=sorted.length?`<div class="member-events">${sorted.map(e=>`<article class="panel member-event"><div class="panel-top"><span class="badge ${status(e)==='정원마감'?'orange':''}">${status(e)}</span><span class="event-capacity">${e.registeredCount} / ${esc(e.capacity)}명 신청</span></div><div class="member-event-body"><h2>${esc(e.name)}</h2><p>◷ ${esc(e.date.replace('T',' '))} (한국 시간)</p><p>⚑ ${esc(e.place)}</p><p>참가자격 · ${esc(e.eligibility)}</p><button class="secondary" data-event="${e.id}">상세 보기 · ${e.applied?'내 신청 확인':'참가 신청'}</button></div></article>`).join('')}</div>`:'<div class="panel empty"><h3>등록된 대회·행사가 없습니다.</h3><p>새로운 대회가 등록되면 이곳에서 신청할 수 있습니다.</p></div>';
}
function detail(id){
 selectedId=id;const e=events.find(e=>e.id===id);if(!e){$('#member-detail').close();return;}
 $('#member-detail').innerHTML=`<div class="modal-head"><h2 id="member-detail-title">대회·행사 상세</h2><button class="icon-btn" data-close aria-label="상세보기 닫기">×</button></div><span class="badge">${status(e)}</span><h3 class="event-detail-name">${esc(e.name)}</h3><dl class="event-details">${[['일시',e.date.replace('T',' ')+' (한국 시간)'],['장소',e.place],['참가자격',e.eligibility],['신청현황',`${e.registeredCount} / ${e.capacity}명`]].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${e.note?`<p class="event-note">${esc(e.note)}</p>`:''}<p>${e.started?'이미 시작한 대회입니다. 변경 사항은 관리자에게 문의해주세요.':e.applied?'참가 신청이 완료되었습니다. 대회 시작 전까지 취소할 수 있습니다.':'신청 시 회원님의 이름과 연락처가 관리자 신청자 목록에 표시됩니다.'}</p><p id="action-error" role="alert"></p><div class="form-actions"><button class="secondary" data-close>닫기</button>${!e.started?(e.applied?'<button class="secondary" data-register="cancel">참가 취소</button>':e.registeredCount<Number(e.capacity)?'<button class="primary" data-register="apply">참가 신청하기</button>':'<button class="secondary" disabled>정원 마감</button>'):''}</div>`;
 if(!$('#member-detail').open)$('#member-detail').showModal();
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.view){view=b.dataset.view;try{await refresh();}catch(e){$('#member-error').textContent=e.message;}}
 if(b.dataset.month){[year,month]=shiftMonth(year,month,Number(b.dataset.month));render();$('#member-calendar-title').focus();}
 if(b.hasAttribute('data-today')){[year,month]=seoulToday().split('-').slice(0,2).map(Number);month--;render();$('#member-calendar-title').focus();}
 if(b.dataset.event)detail(Number(b.dataset.event));
 if(b.hasAttribute('data-close'))$('#member-detail').close();
 if(b.dataset.register&&!busy){
 const cancel=b.dataset.register==='cancel';if(cancel&&!confirm('대회 참가 신청을 취소하시겠습니까?'))return;
 busy=true;b.disabled=true;$('#action-error').textContent='';
 try{await api(`portal/events/${selectedId}/registration`,cancel?'DELETE':'POST');await refresh();detail(selectedId);$('#toast').textContent=cancel?'참가 신청을 취소했습니다.':'참가 신청이 완료되었습니다.';$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2500);}
 catch(e){$('#action-error').textContent=e.message;try{await refresh();}catch{}b.disabled=false;}
 finally{busy=false;}
 }
});
$('#logout').onclick=async()=>{try{await api('auth/logout','POST');location.replace('/login');}catch(e){$('#member-error').textContent=e.message;}};
try{
 const s=await api('auth/status');if(s.role==='admin'){$('#member-name').textContent='관리자 접속 중';$('#member-content').innerHTML='<div class="panel empty"><h3>회원 계정으로 로그인해주세요.</h3><p>회원용 접속 주소는 현재 주소의 /member입니다.<br>회원 화면을 테스트하려면 관리자 화면에서 전화번호와 비밀번호를 등록한 뒤 로그아웃하세요.</p><a href="/">관리자 화면으로 돌아가기</a></div>';}
 else if(s.role!=='member')location.replace('/login');
 else{const member=await api('portal/me');currentMember=member;$('#member-name').textContent=member.name+(member.isCoach?' 코치님':'님');if(member.isCoach)$('[data-view=lessons]').textContent='레슨·코치 수락 관리';await refresh();}
}catch(e){$('#member-error').textContent=e.message;}
