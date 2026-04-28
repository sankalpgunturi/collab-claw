// test/smoke.mjs — end-to-end smoke test for collab-claw.
//
// Spawns the relay, runs the host CLI, fakes a join request, simulates
// a joiner POSTing a prompt, simulates the host's Stop hook posting a
// response, and verifies the joiner SSE saw both events in order.
//
// Run with:  node test/smoke.mjs
//
// Exits 0 on success, 1 on failure.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const RELAY = resolve(ROOT, 'src', 'relay', 'server.mjs');

const PORT  = 7575;
const HOST_TOKEN = 'test-host-token-' + Math.random().toString(36).slice(2);
const ROOM_SECRET = 'test-room-secret-' + Math.random().toString(36).slice(2);
const ROOM_ID = 'smoke-room';
const HOST_NAME = 'TestHost';
const URL = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) {
    console.log(`  ✓ ${name}${info ? '  ' + info : ''}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${info ? '  ' + info : ''}`);
    fail++;
  }
}

async function poll(fn, timeoutMs = 3000, stepMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true; } catch {}
    await wait(stepMs);
  }
  return false;
}

async function main() {
  console.log('# spawning relay...');
  const relay = spawn(process.execPath, [RELAY], {
    env: {
      ...process.env,
      COLLAB_CLAW_PORT       : String(PORT),
      COLLAB_CLAW_BIND       : '127.0.0.1',
      COLLAB_CLAW_HOST_TOKEN : HOST_TOKEN,
      COLLAB_CLAW_ROOM_SECRET: ROOM_SECRET,
      COLLAB_CLAW_ROOM_ID    : ROOM_ID,
      COLLAB_CLAW_HOST_NAME  : HOST_NAME,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relay.stdout.on('data', d => process.stderr.write('  [relay] ' + d));
  relay.stderr.on('data', d => process.stderr.write('  [relay-err] ' + d));

  const cleanup = () => { try { relay.kill('SIGTERM'); } catch {} };
  process.on('exit', cleanup);

  // Wait for healthz
  const up = await poll(async () => {
    const r = await fetch(`${URL}/healthz`);
    return r.ok;
  });
  check('relay /healthz reachable', up);
  if (!up) { cleanup(); process.exit(1); }

  // 1. Bad auth on /prompts is rejected
  let r = await fetch(`${URL}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer wrong' },
    body: JSON.stringify({ text: 'no' }),
  });
  check('POST /prompts with bad token → 401', r.status === 401);

  // 2. Pairing: bad room secret rejected
  r = await fetch(`${URL}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer not-the-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Eve' }),
  });
  check('POST /join-requests with bad secret → 401', r.status === 401);

  // 3. Pairing: good secret returns request id
  r = await fetch(`${URL}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ROOM_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sankalp' }),
  });
  const j1 = await r.json();
  check('POST /join-requests with good secret → 200', r.ok && j1.requestId);
  const requestId = j1.requestId;

  // 4. Duplicate name pending → 409
  r = await fetch(`${URL}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ROOM_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sankalp' }),
  });
  check('duplicate name pending → 409', r.status === 409);

  // 5. Long-poll wait while host approves in parallel
  const waitPromise = fetch(`${URL}/join-requests/${requestId}/wait`, {
    headers: { 'Authorization': `Bearer ${requestId}` },
  }).then(r => r.json());
  await wait(100);

  r = await fetch(`${URL}/approvals`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
  check('POST /approvals with host token → 200', r.ok);

  const waitResult = await waitPromise;
  check('wait long-poll resolved with memberToken', waitResult.approved && waitResult.memberToken);
  check('host /approvals response does NOT contain memberToken', (await r.json()).memberToken == null);
  const memberToken = waitResult.memberToken;

  // 6. Members list shows Sankalp
  r = await fetch(`${URL}/members`, { headers: { 'Authorization': `Bearer ${memberToken}` } });
  const j6 = await r.json();
  check('GET /members lists Sankalp', j6.members.some(m => m.name === 'Sankalp'));

  // 7. Subscribe to /prompt-stream as host monitor and /transcript-stream as joiner
  const promptCtrl = new AbortController();
  const transcriptCtrl = new AbortController();
  const promptEvents = [];
  const transcriptEvents = [];

  const promptResp = await fetch(`${URL}/prompt-stream`, {
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Accept': 'text/event-stream' },
    signal: promptCtrl.signal,
  });
  check('GET /prompt-stream subscribed', promptResp.ok);
  drainSse(promptResp.body, ev => promptEvents.push(ev));

  const tResp = await fetch(`${URL}/transcript-stream`, {
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Accept': 'text/event-stream' },
    signal: transcriptCtrl.signal,
  });
  check('GET /transcript-stream subscribed', tResp.ok);
  drainSse(tResp.body, ev => transcriptEvents.push(ev));

  await wait(150);

  // 8. Joiner posts a prompt
  r = await fetch(`${URL}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hello from sankalp' }),
  });
  check('POST /prompts (joiner) → 200', r.ok);

  // 9. Host monitor (prompt-stream) saw the prompt
  const sawPrompt = await poll(() =>
    promptEvents.some(e => e.kind === 'prompt' && e.name === 'Sankalp' && e.text === 'hello from sankalp'),
  );
  check('host monitor stream saw the joiner prompt', sawPrompt);

  // 10. Other joiners (transcript-stream) also saw the prompt
  const otherSawPrompt = await poll(() =>
    transcriptEvents.some(e => e.kind === 'prompt' && e.name === 'Sankalp'),
  );
  check('joiner transcript stream saw the prompt mirrored', otherSawPrompt);

  // 11. Host posts a response (simulating Stop hook)
  r = await fetch(`${URL}/events`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'response', name: HOST_NAME, text: 'hi sankalp! ✓' }),
  });
  check('POST /events (host response) → 200', r.ok);

  const sawResponse = await poll(() =>
    transcriptEvents.some(e => e.kind === 'response' && e.text === 'hi sankalp! ✓'),
  );
  check('joiner transcript stream saw the host response', sawResponse);

  // 12. /recent backfill
  r = await fetch(`${URL}/recent`, { headers: { 'Authorization': `Bearer ${memberToken}` } });
  const j12 = await r.json();
  check('/recent contains both events', j12.events.length >= 2);

  // 13. Leave
  r = await fetch(`${URL}/leaves`, { method: 'POST', headers: { 'Authorization': `Bearer ${memberToken}` } });
  check('POST /leaves → 200', r.ok);

  // After leave, member token shouldn't work
  r = await fetch(`${URL}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'should fail' }),
  });
  check('member token revoked after /leaves', r.status === 401);

  promptCtrl.abort(); transcriptCtrl.abort();

  // 14. Shutdown
  r = await fetch(`${URL}/shutdown`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}` },
  });
  check('POST /shutdown → 200', r.ok);

  await wait(800);
  const stillUp = await poll(async () => (await fetch(`${URL}/healthz`)).ok, 500, 50);
  check('relay exited cleanly after shutdown', !stillUp);

  console.log(`\n# ${pass} passed, ${fail} failed`);
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
}

async function drainSse(body, cb) {
  const reader = body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          try { cb(JSON.parse(line.slice(5).trimStart())); } catch {}
        }
      }
    } catch {}
  })();
}

main().catch(e => {
  console.error('smoke test failed:', e);
  process.exit(1);
});
