// Smoke test for the roster actions over HTTP. Usage:
//   node scripts/smoke/api-smoke.cjs <cookie-file> <teamId>
// Run against a freshly seeded demo team (seed-demo-team).
const fs = require('fs');
const COOKIE = fs.readFileSync(process.argv[2], 'utf8').trim();
const T = process.argv[3];
const base = 'http://127.0.0.1:8080/_agent-native/actions/';
async function call(name, input, method = 'POST') {
  const url = method === 'GET' ? base + name + '?' + new URLSearchParams(input) : base + name;
  const res = await fetch(url, {
    method, headers: { cookie: COOKIE, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const ok = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);
(async () => {
  const r = (await call('get-roster', { teamId: T, weekStart: '2026-11-04' }, 'GET')).body;
  ok(r.weekStart === '2026-11-02' && r.summary.open === 30, `next week normalised to Monday and all 30 open (got ${r.weekStart}, ${r.summary.open} open)`);
  const who = Object.fromEntries(r.staff.map(s => [s.name.split(' ')[0], s.id]));
  const on = (date, role, start) => r.shifts.find(s => s.date === date && s.role === role && (!start || s.start === start));
  const monOpen = on('2026-11-02', 'opener'), monKitchen = on('2026-11-02', 'kitchen'), monBarista = on('2026-11-02', 'barista'), monClose = on('2026-11-02', 'closer'), tueOpen = on('2026-11-03', 'opener');

  const batch = (await call('assign-shifts', { teamId: T, assignments: [
    { shiftId: monOpen.id, staffId: who.Maya },
    { shiftId: monKitchen.id, staffId: who.Leo },
    { shiftId: monBarista.id, staffId: who.Maya },   // overlaps her opener
    { shiftId: monClose.id, staffId: who.Priya },
    { shiftId: tueOpen.id, staffId: who.Priya },     // no opener skill + class
  ] })).body;
  ok(batch.applied?.length === 3 && batch.rejected?.length === 2, `batch: 3 applied, 2 rejected (got ${batch.applied?.length}/${batch.rejected?.length})`);
  for (const x of batch.rejected ?? []) console.log('      rejected:', x.reason);

  const dbl = await call('assign-shift', { shiftId: monBarista.id, staffId: who.Maya, override: true });
  ok(dbl.status === 409 && /already works/.test(JSON.stringify(dbl.body)), `double-booking refused even with override (status ${dbl.status})`);

  const av = (await call('add-availability', { staffId: who.Maya, rules: [{ date: '2026-11-02', note: 'dentist' }] })).body;
  ok(av.conflicts?.length === 1 && av.conflicts[0].id === monOpen.id, `new unavailability reports Maya's Monday opener as a conflict (got ${av.conflicts?.length})`);

  const after = (await call('get-roster', { teamId: T, weekStart: '2026-11-02' }, 'GET')).body;
  const flagged = after.shifts.find(s => s.id === monOpen.id);
  ok(flagged.issues.some(i => i.code === 'unavailable'), 'roster flags that shift as unavailable');

  const cover = (await call('find-cover', { shiftId: monOpen.id }, 'GET')).body;
  console.log('      cover for Mon opener:', cover.candidates.map(c => `${c.name.split(' ')[0]}${c.eligible ? '✓' : '✗'}`).join(' '));
  ok(cover.candidates[0].eligible && cover.candidates[0].name.startsWith('Sam'), 'Sam ranks first for cover (Zoe is weekdays-off, Maya unavailable)');

  const night = (await call('create-shifts', { teamId: T, shifts: [{ date: '2026-11-03', start: '18:00', end: '01:00', role: 'closer', staffId: who.Jonah, note: 'late event' }] })).body;
  const ns = night.created?.[0];
  ok(ns && ns.endsNextDay && ns.hours === 7 && ns.staffId === who.Jonah, `overnight shift created 18:00–01:00, 7h, assigned to Jonah (got ${JSON.stringify(ns && { h: ns.hours, next: ns.endsNextDay, staff: ns.staffId === who.Jonah })})`);

  const bad = await call('create-shifts', { teamId: T, shifts: [{ date: '2026-11-03', start: '9:00', end: '10:00', role: 'barista' }] });
  ok(bad.status >= 400, `malformed time rejected by schema (status ${bad.status})`);
})().catch(e => { console.error(e); process.exit(1); });
