// test/monitor-gate.mjs — verify the monitor session-state gate.
//
//   Negative control: session.json absent → no event reaches monitor stdout
//                     while the gate is closed. (Prompts may still be queued
//                     by the relay for replay when the gate later opens —
//                     that's intentional and covered by regressions.mjs.)
//   Positive control: write session.json (mode=host) → monitor wakes up,
//                     opens SSE, and emits incoming prompts to stdout.
//   Mid-stream close: delete session.json while a prompt arrives → monitor
//                     drops it (does NOT print it).

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CLI  = join(ROOT, 'bin', 'collab-claw');
const RELAY = join(ROOT, 'src', 'relay', 'server.mjs');

const TMP = join(tmpdir(), 'collab-claw-gate-' + process.pid);
mkdirSync(TMP, { recursive: true });
mkdirSync(join(TMP, '.collab-claw'), { recursive: true });
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const PORT = 7777;
const URL_ = `http://127.0.0.1:${PORT}`;
const HOST_TOKEN = 'gate-host-token';
const ROOM_SECRET = 'gate-room-secret';
const ROOM_ID = 'gate-room';
const SESSION_PATH = join(TMP, '.collab-claw', 'session.json');

const env = {
  ...process.env,
  HOME: TMP,
  COLLAB_CLAW_PORT: String(PORT),
  COLLAB_CLAW_BIND: '127.0.0.1',
  COLLAB_CLAW_HOST_TOKEN: HOST_TOKEN,
  COLLAB_CLAW_ROOM_SECRET: ROOM_SECRET,
  COLLAB_CLAW_ROOM_ID: ROOM_ID,
  COLLAB_CLAW_HOST_NAME: 'GateHost',
};

let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) { console.log(`  ✓ ${name}${info ? '  ' + info : ''}`); pass++; }
  else    { console.log(`  ✗ ${name}${info ? '  ' + info : ''}`); fail++; }
}

async function poll(fn, timeoutMs = 3000, stepMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true; } catch {}
    await wait(stepMs);
  }
  return false;
}

function writeSessionJson(mode = 'host') {
  writeFileSync(SESSION_PATH, JSON.stringify({
    v: 1, mode, roomId: ROOM_ID, relayUrl: URL_, hostToken: HOST_TOKEN, hostName: 'GateHost',
    roomSecret: ROOM_SECRET, createdAt: new Date().toISOString(),
  }, null, 2));
}

async function main() {
  // 1. Spawn relay
  const relay = spawn(process.execPath, [RELAY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  relay.stdout.on('data', d => process.stderr.write('  [relay] ' + d));
  process.on('exit', () => { try { relay.kill(); } catch {} });
  await poll(async () => (await fetch(`${URL_}/healthz`)).ok);

  // 2. Spawn monitor — session.json does NOT exist yet (gate closed)
  if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
  const monitor = spawn(process.execPath, [CLI, 'monitor'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdoutLines = [];
  monitor.stdout.on('data', d => {
    String(d).split('\n').filter(Boolean).forEach(l => {
      stdoutLines.push(l);
      console.error('  [monitor-stdout] ' + l);
    });
  });
  process.on('exit', () => { try { monitor.kill(); } catch {} });

  await wait(800);
  check('monitor running', !monitor.killed && monitor.exitCode == null);

  // 3. NEGATIVE CONTROL: post a prompt while gate is closed
  // First we need a member token. Pair a synthetic joiner.
  let r = await fetch(`${URL_}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ROOM_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'GhostJoiner' }),
  });
  const jr = await r.json();
  const waitProm = fetch(`${URL_}/join-requests/${jr.requestId}/wait`, {
    headers: { 'Authorization': `Bearer ${jr.requestId}` },
  }).then(r => r.json());
  await wait(50);
  await fetch(`${URL_}/approvals`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: jr.requestId }),
  });
  const approved = await waitProm;
  const memberToken = approved.memberToken;
  check('synthetic joiner paired', !!memberToken);

  // Post prompt with gate CLOSED
  await fetch(`${URL_}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'this should never reach claude' }),
  });
  await wait(800);
  const negLeaked = stdoutLines.some(l => l.includes('this should never reach claude'));
  check('NEGATIVE: prompt did NOT leak to monitor stdout while gate closed', !negLeaked);

  // 4. POSITIVE CONTROL: open the gate, post a prompt, expect emit
  writeSessionJson('host');
  // The monitor recheck interval is 5s. Wait up to ~7s for it to notice.
  await wait(6000);

  await fetch(`${URL_}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'positive control payload' }),
  });

  const sawPositive = await poll(() =>
    stdoutLines.some(l => l === '[GhostJoiner]: positive control payload'),
    3000,
  );
  check('POSITIVE: monitor emitted [GhostJoiner]: positive control payload', sawPositive);

  // 5. MID-STREAM GATE CLOSE: delete session.json, post a prompt within a few hundred ms
  unlinkSync(SESSION_PATH);
  await wait(50);
  await fetch(`${URL_}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'mid stream drop check' }),
  });
  await wait(1500);
  const midStreamLeaked = stdoutLines.some(l => l.includes('mid stream drop check'));
  check('MID-STREAM: prompt dropped after session.json deleted', !midStreamLeaked);

  // 6. SINGLETON-LOCK REMOVED: the monitor must NOT create a global
  //    ~/.collab-claw/monitor.pid file. (Earlier versions did, and that
  //    starved the actually-hosting monitor in multi-Claude-session
  //    setups. Relay-side single-subscriber is now the only enforcement.)
  const pidPath = join(TMP, '.collab-claw', 'monitor.pid');
  check('no global monitor.pid created (client-side singleton removed)',
        !existsSync(pidPath));

  // Cleanup
  monitor.kill('SIGTERM');
  relay.kill('SIGTERM');
  await wait(300);

  console.log(`\n# ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
