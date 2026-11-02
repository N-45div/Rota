// End-to-end call-out flow over simulated Telegram webhooks. Needs the dev
// server started with TELEGRAM_BOT_TOKEN (any value) and Telegram enabled.
// Usage: node scripts/callout-smoke.cjs <cookie-file>
// Call-out flow: sick report -> offers -> NO / YES / late YES; decline-all -> next round.
const fs = require('fs');
const { execFileSync } = require('child_process');
const COOKIE = fs.readFileSync(process.argv[2], 'utf8').trim();
const BASE = 'http://127.0.0.1:8080';
const ROTA = '/home/user/rota';
async function call(name, input, method = 'POST') {
  const url = method === 'GET' ? `${BASE}/_agent-native/actions/${name}?` + new URLSearchParams(input) : `${BASE}/_agent-native/actions/${name}`;
  const res = await fetch(url, { method, headers: { cookie: COOKIE, 'content-type': 'application/json', connection: 'close' }, body: method === 'GET' ? undefined : JSON.stringify(input) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
let msgId = 100;
async function telegram(chatId, text) {
  const res = await fetch(`${BASE}/_agent-native/integrations/telegram/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ update_id: Date.now() + msgId, message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), text, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'T' } } }),
  });
  return res.status;
}
function sql(query) {
  return execFileSync('pnpm', ['-s', 'action', 'db-query', '--sql', query], { cwd: ROTA, encoding: 'utf8', timeout: 90000 });
}
function asStaff(principal, action, args) {
  try { return { ok: true, out: execFileSync('pnpm', ['-s', 'action', action, ...args], { cwd: ROTA, env: { ...process.env, AGENT_USER_EMAIL: principal }, encoding: 'utf8', timeout: 90000 }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; }
}
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const T = (await call('seed-demo-team', { name: 'Call-out Test Café', timezone: 'America/Los_Angeles' })).body.id;
  let r = (await call('get-roster', { teamId: T }, 'GET')).body;
  console.log('week', r.weekStart, 'today', r.today);
  const chat = {}; let n = 5552001;
  for (const person of r.staff) {
    const inv = (await call('create-telegram-invite', { staffId: person.id })).body;
    chat[person.name] = n; await telegram(n++, `/start ${inv.code}`);
  }
  r = (await call('get-roster', { teamId: T }, 'GET')).body;
  ok(r.staff.every(p => p.hasTelegram), 'all 7 staff linked on Telegram');

  const maya = r.staff.find(p => p.name.startsWith('Maya'));
  // Next week is open, so most people have hours free: put Maya on Wednesday's barista shift.
  const nextWeek = (await call('get-roster', { teamId: T, weekStart: '2026-11-11' }, 'GET')).body;
  const target = nextWeek.shifts.find(s => s.date === '2026-11-11' && s.role === 'barista' && s.start === '10:00');
  const put = await call('assign-shift', { shiftId: target.id, staffId: maya.id });
  ok(put.status === 200, 'Maya put on Wed Nov 11 barista 10:00-15:00');
  console.log('Maya calls out of:', target.date, target.start, target.end, target.role);
  const principal = (sql(`SELECT telegram_principal FROM staff WHERE id = '${maya.id}'`).match(/staff-[a-z0-9]{32}@staff\.rota\.invalid/) || [])[0];
  const sick = asStaff(principal, 'report-unavailable', ['--date', target.date, '--reason', 'sick']);
  const asked = (sick.out.match(/askedToCover: \[([^\]]*)\]/) || [])[1] || '';
  console.log('  report-unavailable ->', sick.ok ? sick.out.match(/summary: '([^']*)'/)?.[1] : sick.out.slice(-200));
  r = (await call('get-roster', { teamId: T, weekStart: target.date }, 'GET')).body;
  let shift = r.shifts.find(s => s.id === target.id);
  const pending = shift.offers.filter(o => o.status === 'pending');
  ok(shift.staffId === null && pending.length >= 1 && pending.length <= 3, `shift opened and ${pending.length} people asked: ${pending.map(o => o.staffName).join(', ')}`);
  ok(pending.every(o => o.delivery === 'failed'), 'delivery recorded (fails here only because the bot token is a placeholder)');

  const [first, second, third] = pending.map(o => o.staffName);
  if (pending.length >= 2) {
    await telegram(chat[first], 'no');
    r = (await call('get-roster', { teamId: T, weekStart: target.date }, 'GET')).body; shift = r.shifts.find(s => s.id === target.id);
    ok(shift.offers.find(o => o.staffName === first).status === 'declined' && !shift.staffId, `${first} says "no": declined, shift still open`);
    await telegram(chat[second], 'Yes!');
    r = (await call('get-roster', { teamId: T, weekStart: target.date }, 'GET')).body; shift = r.shifts.find(s => s.id === target.id);
    ok(shift.staffName === second && /covered by/.test(shift.note || ''), `${second} says "Yes!": gets the shift, note "${shift.note}"`);
    if (third) {
      ok(shift.offers.find(o => o.staffName === third).status === 'closed', `${third}'s offer closed as no longer needed`);
      await telegram(chat[third], 'yes');
      r = (await call('get-roster', { teamId: T, weekStart: target.date }, 'GET')).body; shift = r.shifts.find(s => s.id === target.id);
      ok(shift.staffName === second, `${third}'s late "yes" doesn't steal it`);
    }
  }

  // Decline-all -> next round, via a manager offer to one person at a time.
  const extra = (await call('create-shifts', { teamId: T, shifts: [{ date: target.date, start: '16:00', end: '20:00', role: 'barista' }] })).body.created[0];
  const o1 = (await call('offer-shift', { shiftId: extra.id, count: 1 })).body;
  ok(o1.askedOnTelegram?.length === 1, `manager "Ask on Telegram" asks one person: ${o1.askedOnTelegram}`);
  await telegram(chat[o1.askedOnTelegram[0]], 'nope');
  r = (await call('get-roster', { teamId: T, weekStart: target.date }, 'GET')).body;
  const ex = r.shifts.find(s => s.id === extra.id);
  const nextPending = ex.offers.filter(o => o.status === 'pending').map(o => o.staffName);
  ok(nextPending.length >= 1 && !nextPending.includes(o1.askedOnTelegram[0]), `after "nope", next people asked automatically: ${nextPending.join(', ')}`);

  const none = await call('offer-shift', { shiftId: target.id });
  ok(none.status === 409, `can't offer a shift that's already covered (status ${none.status})`);
  console.log('team', T);
})().catch(e => { console.error(e); process.exit(1); });
