// test/tui-plain.mjs — verify the joiner TUI runs in plain mode (non-TTY).
//
// Spawns relay + join CLI. Pairs the joiner via the host token (which we
// have because we control the relay env). Posts a host response. Verifies
// the join CLI's stdout shows it.
//
// This exercises the same `tui/join.mjs` code as `collab-claw join`, but
// in non-TTY mode (since stdin is piped). Confirms the full path works
// without ANSI rendering errors.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CLI  = join(ROOT, 'bin', 'collab-claw');
const RELAY = join(ROOT, 'src', 'relay', 'server.mjs');

const TMP = join(tmpdir(), 'collab-claw-tui-' + process.pid);
mkdirSync(TMP, { recursive: true });
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const PORT = 7878;
const URL_ = `http://127.0.0.1:${PORT}`;
const HOST_TOKEN  = 'tui-host-token';
const ROOM_SECRET = 'tui-room-secret';

let pass = 0, fail = 0;
function check(n, ok, info='') {
  if (ok) { console.log(`  ✓ ${n}${info?'  '+info:''}`); pass++; }
  else    { console.log(`  ✗ ${n}${info?'  '+info:''}`); fail++; }
}

async function poll(fn, ms=3000, step=50) {
  const s = Date.now();
  while (Date.now() - s < ms) { try { if (await fn()) return true; } catch {} await wait(step); }
  return false;
}

async function main() {
  const relay = spawn(process.execPath, [RELAY], {
    env: {
      ...process.env, COLLAB_CLAW_PORT: String(PORT), COLLAB_CLAW_BIND: '127.0.0.1',
      COLLAB_CLAW_HOST_TOKEN: HOST_TOKEN, COLLAB_CLAW_ROOM_SECRET: ROOM_SECRET,
      COLLAB_CLAW_ROOM_ID: 'tui-room', COLLAB_CLAW_HOST_NAME: 'TuiHost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relay.stderr.on('data', d => process.stderr.write('  [relay-err] ' + d));
  process.on('exit', () => { try { relay.kill(); } catch {} });
  await poll(async () => (await fetch(`${URL_}/healthz`)).ok);

  // joiner needs a name
  spawnSync(process.execPath, [CLI, 'set-name', 'TuiJoiner'],
    { env: { ...process.env, HOME: TMP }, stdio: 'ignore' });

  // Spawn join CLI (non-TTY because stdio is piped)
  const joinUrl = `${URL_}#secret=${ROOM_SECRET}`;
  const join = spawn(process.execPath, [CLI, 'join', joinUrl], {
    env: { ...process.env, HOME: TMP, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let joinStdout = '';
  let joinStderr = '';
  join.stdout.on('data', d => { joinStdout += d; });
  join.stderr.on('data', d => { joinStderr += d; });

  // Watch relay stdout for the join-request id
  let reqId = null;
  let relayBuf = '';
  relay.stdout.on('data', d => {
    relayBuf += d;
    const m = relayBuf.match(/join-request id=([A-Za-z0-9_-]+)/);
    if (m && !reqId) reqId = m[1];
  });

  await poll(() => !!reqId, 5000);
  check('join request reached relay', !!reqId);
  if (!reqId) { join.kill(); relay.kill(); process.exit(1); }

  // The relay log truncates the id with `…` after 8 chars. We don't have the full
  // id from logs. Workaround: look up pending requests via `/members` (no help)
  // or expose a debug listing. Simpler: just approve EVERY plausible id by trying
  // a list — but we only have the prefix. So we add a tiny endpoint... no, too
  // invasive. Let's instead derive: pair a *second* request with the same secret
  // and approve THAT, which gives us a valid memberToken; the existing TuiJoiner
  // will time out. That test what we want.
  //
  // Actually the easiest fix: monkey patch the relay log to print the FULL id
  // for the test. But that's a code smell. Let me instead add a /debug/requests
  // route gated on host token. That's clean.
  //
  // For now, simplest correctness fix: parse the *full* id from the relay log
  // line, which DOES have it because the truncation is `id=<full>…`. Hmm wait,
  // the log says `id=${id.slice(0, 8)}…`. So we only get 8 chars. We need full.

  // Approve via a host-token /debug/requests lookup — let me just add that.
  // (See below for the relay change.)

  let approved = null;
  try {
    const r = await fetch(`${URL_}/debug/requests`, {
      headers: { 'Authorization': `Bearer ${HOST_TOKEN}` },
    });
    if (r.ok) {
      const j = await r.json();
      const pending = (j.requests || []).find(x => x.status === 'pending');
      if (pending) {
        const a = await fetch(`${URL_}/approvals`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: pending.id }),
        });
        approved = a.ok;
      }
    }
  } catch (e) {}
  check('debug-listed and approved pending request', approved === true,
    approved === null ? '(no /debug/requests endpoint yet)' : '');

  if (!approved) { join.kill(); relay.kill(); process.exit(1); }

  // Wait for the joiner to receive approval and start streaming
  await wait(500);

  // Post a host response
  await fetch(`${URL_}/events`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'response', name: 'TuiHost', text: 'plain mode rendering ok' }),
  });

  await poll(() => /plain mode rendering ok/.test(joinStdout), 3000);
  check('join CLI rendered host response in plain mode',
    /plain mode rendering ok/.test(joinStdout),
    joinStdout.split('\n').slice(-3).join(' | '));

  join.kill('SIGTERM');
  relay.kill('SIGTERM');
  await wait(300);

  console.log(`\n# ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
