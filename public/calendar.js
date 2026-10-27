// Use civil dates so event times never shift with the viewer's time zone.
export function seoulToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const count = Math.ceil((first.getUTCDay() + length) / 7) * 7;
  return Array.from({length: count}, (_, i) => {
    const day = i - first.getUTCDay() + 1;
    if (day < 1 || day > length) return null;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
}
export function shiftMonth(year, month, offset) {
  const date = new Date(Date.UTC(year, month + offset, 1));
  return [date.getUTCFullYear(), date.getUTCMonth()];
}
export function eventsOnDate(events, date) {
  return events.filter(event => event.date?.slice(0, 10) === date)
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
}
