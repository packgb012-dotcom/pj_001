import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthCells,shiftMonth,eventsOnDate,seoulToday} from '../public/calendar.js';
test('윤년 2월, 일요일 시작 월, 빈 날짜 정렬',()=>{
 const leap=monthCells(2024,1);assert.equal(leap.filter(Boolean).length,29);assert.equal(leap.indexOf('2024-02-01'),4);assert.equal(leap.length%7,0);
 assert.equal(monthCells(2026,1).filter(Boolean).length,28);assert.equal(monthCells(2026,1)[0],'2026-02-01');
});
test('연도 경계 이동과 한국 날짜',()=>{
 assert.deepEqual(shiftMonth(2026,0,-1),[2025,11]);assert.deepEqual(shiftMonth(2026,11,1),[2027,0]);
 assert.equal(seoulToday(new Date('2026-12-31T16:00:00Z')),'2027-01-01');
});
test('같은 날 여러 대회는 시간순, 다른 날짜와 잘못된 항목 제외',()=>{
 const events=[{id:1,date:'2026-10-27T18:00'},{id:2,date:'2026-10-27T09:00'},{id:3,date:'2026-11-27T10:00'},{id:4}];
 assert.deepEqual(eventsOnDate(events,'2026-10-27').map(r=>r.id),[2,1]);assert.equal(eventsOnDate(events,'2026-10-28').length,0);
});
