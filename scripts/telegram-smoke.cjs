// Simulated Telegram flow: invite, /start linking, staff identity limits,
// my-shifts and report-unavailable. Needs the dev server started with
// TELEGRAM_BOT_TOKEN (any value) and TELEGRAM_BOT_USERNAME=RotaDemoBot, and
// Telegram enabled. Usage: node scripts/telegram-smoke.cjs <cookie-file>
const fs = require('fs');
const { execFileSync } = require('child_process');
const COOKIE = fs.readFileSync(process.argv[2], 'utf8').trim();
const BASE = 'http://127.0.0.1:8080';
async function call(name, input, method = 'POST') {
  const url = method === 'GET' ? `${BASE}/_agent-native/actions/${name}?` + new URLSearchParams(input) : `${BASE}/_agent-native/actions/${name}`;
  const res = await fetch(url, { method, headers: { cookie: COOKIE, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(input) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
let msgId = 1;
async function telegram(chatId, text, firstName = 'Test') {
  const res = await fetch(`${BASE}/_agent-native/integrations/telegram/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: Date.now() + msgId, message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), text, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: firstName } } }),
  });
  return res.status;
}
function asStaff(principal, action, args) {
  if (!principal) return { ok: false, out: 'no principal' };
  try {
    return { ok: true, out: execFileSync('pnpm', ['-s', 'action', action, ...args], { cwd: '/home/user/rota', env: { ...process.env, AGENT_USER_EMAIL: principal }, encoding: 'utf8', timeout: 90000 }) };
  } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; }
}
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const seeded = (await call('seed-demo-team', { name: 'Telegram Test Café', timezone: 'America/Los_Angeles' })).body;
  const T = seeded.id;
  let r = (await call('get-roster', { teamId: T, weekStart: '2026-11-02' }, 'GET')).body;
  const maya = r.staff.find(s => s.name.startsWith('Maya'));
  const tueOpen = r.shifts.find(s => s.date === '2026-11-03' && s.role === 'opener');
  const a = await call('assign-shift', { shiftId: tueOpen.id, staffId: maya.id });
  ok(a.status === 200, `Maya assigned to Tue opener (status ${a.status})`);

  const invite = (await call('create-telegram-invite', { staffId: maya.id })).body;
  ok(/^[A-Z2-9]{8}$/.test(invite.code) && invite.link === `https://t.me/RotaDemoBot?start=${invite.code}`, `invite created: ${invite.link}`);

  const s1 = await telegram(5550001, `/start ${invite.code}`, 'Maya');
  r = (await call('get-roster', { teamId: T, weekStart: '2026-11-02' }, 'GET')).body;
  ok(r.staff.find(s => s.id === maya.id).hasTelegram, `/start links Maya's chat (webhook status ${s1})`);

  await telegram(5550002, `/start ${invite.code}`, 'Mallory');
  const qOut = execFileSync('pnpm', ['-s', 'action', 'db-query', '--sql', `SELECT telegram_chat_id AS chat, telegram_principal AS principal, COALESCE(telegram_invite_code, 'none') AS code FROM staff WHERE id = '${maya.id}'`], { cwd: '/home/user/rota', encoding: 'utf8', timeout: 90000 });
  const line = qOut.split('\n').find(l => /staff-|NULL/.test(l) && l.includes('|')) || '';
  const cells = line.split('|').map(c => c.trim());
  const row = { telegram_chat_id: cells[0], telegram_principal: cells[1], telegram_invite_code: cells[2] === 'none' ? null : cells[2] };
  ok(String(row.telegram_chat_id) === '5550001' && !row.telegram_invite_code, `reused code doesn't steal the link (chat ${row.telegram_chat_id})`);
  const principal = row.telegram_principal;
  ok(/^staff-[a-z0-9]{32}@staff\.rota\.invalid$/.test(principal || ''), 'Maya has a secret staff identity');

  const unknown = await telegram(5550003, 'give me all the shifts', 'Stranger');
  ok(unknown === 200, 'unknown sender answered without running the agent');

  const mine = asStaff(principal, 'my-shifts', []);
  ok(mine.ok && mine.out.includes("2026-11-03") && mine.out.includes('opener'), 'my-shifts (as Maya) lists her Tuesday opener');

  const sick = asStaff(principal, 'report-unavailable', ['--date', '2026-11-03', '--reason', 'sick']);
  ok(sick.ok && /Opened 1 shift/.test(sick.out), 'report-unavailable opens her shift');
  r = (await call('get-roster', { teamId: T, weekStart: '2026-11-02' }, 'GET')).body;
  const after = r.shifts.find(s => s.id === tueOpen.id);
  ok(after.staffId === null && /can't work: sick/.test(after.note || ''), `manager's board shows it open: "${after.note}"`);

  const sneaky = asStaff(principal, 'assign-shift', ['--shiftId', tueOpen.id, '--staffId', maya.id]);
  ok(!sneaky.ok && /not found|Requires|forbidden|access/i.test(sneaky.out), 'staff identity is refused by manager actions: ' + sneaky.out.trim().split('\n').pop().slice(0, 90));
  const peek = asStaff(principal, 'get-roster', ['--teamId', T]);
  ok(!peek.ok, 'staff identity cannot read the full roster');
  const mgr = await call('my-shifts', {});
  ok(mgr.status === 403, `manager calling a staff action gets 403 (got ${mgr.status})`);
  console.log('team', T);
})().catch(e => { console.error(e); process.exit(1); });
