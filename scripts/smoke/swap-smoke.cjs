// End-to-end shift swaps over simulated Telegram webhooks. Needs the dev
// server started with TELEGRAM_BOT_TOKEN (any value) and Telegram enabled.
// Usage: node scripts/smoke/swap-smoke.cjs <cookie-file>
// Ask -> teammate YES -> manager approves (shifts trade); NO; stale swap; cancel;
// a YES goes to whichever question (offer or swap) was asked last.
const fs = require('fs');
const { execFileSync } = require('child_process');
const COOKIE = fs.readFileSync(process.argv[2], 'utf8').trim();
const BASE = 'http://127.0.0.1:8080';
const ROTA = require('path').resolve(__dirname, '..', '..');
async function call(name, input, method = 'POST') {
  const url = method === 'GET' ? `${BASE}/_agent-native/actions/${name}?` + new URLSearchParams(input) : `${BASE}/_agent-native/actions/${name}`;
  const res = await fetch(url, { method, headers: { cookie: COOKIE, 'content-type': 'application/json', connection: 'close' }, body: method === 'GET' ? undefined : JSON.stringify(input) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
let msgId = 500;
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
// Run an action as a staff member's Telegram identity; the CLI prints a JS object.
function asStaff(principal, action, args) {
  try {
    const out = execFileSync('pnpm', ['-s', 'action', action, ...args], { cwd: ROTA, env: { ...process.env, AGENT_USER_EMAIL: principal }, encoding: 'utf8', timeout: 90000 });
    const start = out.indexOf('{');
    return { ok: true, value: start >= 0 ? new Function(`return (${out.slice(start)})`)() : null, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const principalOf = (id) => (sql(`SELECT telegram_principal FROM staff WHERE id = '${id}'`).match(/staff-[a-z0-9]{32}@staff\.rota\.invalid/) || [])[0];
const swapStatus = (id) => (sql(`SELECT status FROM swap_requests WHERE id = '${id}'`).match(/\b(asked|agreed|approved|declined|rejected|cancelled|closed)\b/) || [])[1];

(async () => {
  const T = (await call('seed-demo-team', { name: 'Swap Test Café', timezone: 'America/Los_Angeles' })).body.id;
  let r = (await call('get-roster', { teamId: T }, 'GET')).body;
  const chat = {}; let n = 5553001;
  for (const person of r.staff) {
    const inv = (await call('create-telegram-invite', { staffId: person.id })).body;
    chat[person.id] = n; await telegram(n++, `/start ${inv.code}`);
  }
  const nextWeek = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  r = (await call('get-roster', { teamId: T, weekStart: nextWeek }, 'GET')).body;
  const W = r.weekStart;
  await call('draft-week', { teamId: T, weekStart: W, preferences: [] });
  r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
  const name = (id) => r.staff.find((p) => p.id === id)?.name;

  // 1. Find options, ask, teammate says YES, manager approves.
  let mine = null; let found = null;
  for (const s of r.shifts.filter((x) => x.staffId)) {
    const res = asStaff(principalOf(s.staffId), 'find-swaps', ['--shiftId', s.id]);
    if (res.ok && res.value?.options?.length) { mine = s; found = res.value; break; }
  }
  ok(Boolean(found), `find-swaps lists options for ${mine && name(mine.staffId)}'s ${mine?.date} ${mine?.role}: ${found?.options.map((o) => `${o.name} ${o.shift}`).slice(0, 3).join(' | ')}`);
  const pick = found.options[0];
  const theirs = r.shifts.find((s) => s.id === pick.theirShiftId);
  const A = mine.staffId; const B = theirs.staffId;
  const req = asStaff(principalOf(A), 'request-swap', ['--myShiftId', mine.id, '--theirShiftId', theirs.id, '--note', 'dentist']);
  ok(req.ok && req.value?.swapId, `request-swap: ${req.value?.summary ?? req.out.slice(-200)}`);
  const S1 = req.value.swapId;
  r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
  ok(r.swaps.some((s) => s.id === S1 && s.status === 'asked') && r.shifts.find((s) => s.id === mine.id).swap?.status === 'asked', 'board shows the swap as asked, with a mark on the shift');
  const again = asStaff(principalOf(A), 'request-swap', ['--myShiftId', mine.id, '--theirShiftId', theirs.id]);
  ok(!again.ok && /already a swap request/.test(again.out), 'a second request for the same shift is refused');
  const early = await call('decide-swap', { swapId: S1, approve: true });
  ok(early.status === 409 && early.body.errorCode === 'waiting_for_teammate', `manager can't approve before the teammate agrees (${early.status} ${early.body.errorCode})`);
  await telegram(chat[B], 'yes');
  ok(swapStatus(S1) === 'agreed', `${name(B)} replies "yes" on Telegram: swap agreed, waiting for the manager`);
  const approve = await call('decide-swap', { swapId: S1, approve: true });
  r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
  const mineAfter = r.shifts.find((s) => s.id === mine.id); const theirsAfter = r.shifts.find((s) => s.id === theirs.id);
  ok(approve.status === 200 && mineAfter.staffId === B && theirsAfter.staffId === A && swapStatus(S1) === 'approved', `manager approves: shifts traded (${approve.body.summary})`);
  ok(!r.swaps.some((s) => s.id === S1) && !mineAfter.swap, 'approved swap leaves the board banner');

  // 2. Teammate says NO.
  let S2 = null; let B2 = null;
  for (const s of r.shifts.filter((x) => x.staffId && !x.swap)) {
    const res = asStaff(principalOf(s.staffId), 'find-swaps', ['--shiftId', s.id]);
    const o = res.ok && res.value?.options?.[0];
    if (!o) continue;
    const q = asStaff(principalOf(s.staffId), 'request-swap', ['--myShiftId', s.id, '--theirShiftId', o.theirShiftId]);
    if (q.ok) { S2 = q.value.swapId; B2 = r.shifts.find((x) => x.id === o.theirShiftId).staffId; break; }
  }
  await telegram(chat[B2], 'nope');
  ok(swapStatus(S2) === 'declined', `${name(B2)} replies "nope": swap declined`);

  // 3. Agreed, then the manager reassigns one of the shifts: approval closes it as stale.
  r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
  let S3 = null; let s3 = null; let B3 = null;
  for (const s of r.shifts.filter((x) => x.staffId && !x.swap)) {
    const res = asStaff(principalOf(s.staffId), 'find-swaps', ['--shiftId', s.id]);
    const o = res.ok && res.value?.options?.[0];
    if (!o) continue;
    const q = asStaff(principalOf(s.staffId), 'request-swap', ['--myShiftId', s.id, '--theirShiftId', o.theirShiftId]);
    if (q.ok) { S3 = q.value.swapId; s3 = s; B3 = r.shifts.find((x) => x.id === o.theirShiftId).staffId; break; }
  }
  await telegram(chat[B3], 'Yes');
  await call('assign-shift', { shiftId: s3.id, staffId: null });
  const stale = await call('decide-swap', { swapId: S3, approve: true });
  ok(stale.status === 200 && stale.body.outcome === 'closed' && swapStatus(S3) === 'closed', `shift changed after agreeing: approval closes it (${stale.body.summary})`);

  // 4. Requester withdraws.
  r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
  let S4 = null; let A4 = null;
  for (const s of r.shifts.filter((x) => x.staffId && !x.swap)) {
    const res = asStaff(principalOf(s.staffId), 'find-swaps', ['--shiftId', s.id]);
    const o = res.ok && res.value?.options?.[0];
    if (!o) continue;
    const q = asStaff(principalOf(s.staffId), 'request-swap', ['--myShiftId', s.id, '--theirShiftId', o.theirShiftId]);
    if (q.ok) { S4 = q.value.swapId; A4 = s.staffId; break; }
  }
  const cancel = asStaff(principalOf(A4), 'cancel-swap', []);
  ok(cancel.ok && swapStatus(S4) === 'cancelled', `requester withdraws: ${cancel.value?.replyToStaff}`);

  // 5. A YES answers the newest question: offer first, then a swap request to the same person.
  r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
  const open = r.shifts.find((s) => s.id === s3.id);
  const offer = (await call('offer-shift', { shiftId: open.id, count: 1 })).body;
  const offered = r.staff.find((p) => p.name === offer.askedOnTelegram?.[0]);
  let S5 = null;
  if (offered) {
    for (const s of r.shifts.filter((x) => x.staffId && x.staffId !== offered.id && !x.swap)) {
      const res = asStaff(principalOf(s.staffId), 'find-swaps', ['--shiftId', s.id]);
      const o = res.ok && res.value?.options?.find((x) => r.shifts.find((y) => y.id === x.theirShiftId)?.staffId === offered.id);
      if (!o) continue;
      const q = asStaff(principalOf(s.staffId), 'request-swap', ['--myShiftId', s.id, '--theirShiftId', o.theirShiftId]);
      if (q.ok) { S5 = q.value.swapId; break; }
    }
  }
  if (S5) {
    await telegram(chat[offered.id], 'yes');
    r = (await call('get-roster', { teamId: T, weekStart: W }, 'GET')).body;
    const stillOpen = !r.shifts.find((s) => s.id === open.id).staffId;
    ok(swapStatus(S5) === 'agreed' && stillOpen, `${offered.name} had an offer, then a swap request: "yes" agreed to the swap (newest), the offer stays open`);
  } else console.log('SKIP no swap partner for the offered person');

  const feed = (await call('list-activity', { teamId: T, limit: 30 }, 'GET')).body.entries.filter((e) => e.kind === 'swap');
  ok(feed.length >= 6, `activity has ${feed.length} swap entries`);
  for (const e of feed.slice(0, 8).reverse()) console.log('    ', e.actorKind.padEnd(7), e.text);
  console.log('team', T);
})().catch((e) => { console.error(e); process.exit(1); });
