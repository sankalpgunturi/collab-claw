// test/regressions.mjs — regression coverage for the high-priority fixes
// uncovered in the v1 review:
//
//   #1  Queue + Last-Event-ID replay: a prompt posted while no host monitor
//       is connected must be delivered to the next monitor that connects.
//   #2  Singleton host monitor: only one /prompt-stream subscriber at a
//       time. A new connection evicts the old one (last-writer-wins).
//   #3  Kicked transcript SSE: when /kicks runs, the kicked member's
//       transcript SSE response must close (no continued mirroring until
//       socket happens to die).
//   #4a Server-side name validation: bad names rejected (no prompt-injection
//       via brackets/newlines/length).
//   #4b System event format: kind=system events render as `[collab-claw]
//       <text>`, not `[[collab-claw]]: ...`.
//   #5  Multiline encoding: monitor escapes `\n` so Claude Code's monitor
//       framework gets one notification line per joiner prompt.
//
// All tests use an isolated $HOME and an in-memory relay on 127.0.0.1.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CLI  = join(ROOT, 'bin', 'collab-claw');
const RELAY = join(ROOT, 'src', 'relay', 'server.mjs');

const PORT = 7878;
const URL_ = `http://127.0.0.1:${PORT}`;
const HOST_TOKEN  = 'reg-host-token-' + Math.random().toString(36).slice(2);
const ROOM_SECRET = 'reg-room-secret-' + Math.random().toString(36).slice(2);
const ROOM_ID     = 'reg-room';

const TMP = join(tmpdir(), 'collab-claw-regressions-' + process.pid);
mkdirSync(join(TMP, '.collab-claw'), { recursive: true });
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const baseEnv = {
  ...process.env,
  HOME: TMP,
  COLLAB_CLAW_PORT: String(PORT),
  COLLAB_CLAW_BIND: '127.0.0.1',
  COLLAB_CLAW_HOST_TOKEN : HOST_TOKEN,
  COLLAB_CLAW_ROOM_SECRET: ROOM_SECRET,
  COLLAB_CLAW_ROOM_ID    : ROOM_ID,
  COLLAB_CLAW_HOST_NAME  : 'RegHost',
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

function spawnRelay() {
  const r = spawn(process.execPath, [RELAY], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  r.stdout.on('data', d => process.stderr.write('  [relay] ' + d));
  r.stderr.on('data', d => process.stderr.write('  [relay-err] ' + d));
  return r;
}

async function pairMember(name) {
  const r1 = await fetch(`${URL_}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ROOM_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const jr = await r1.json();
  const waitProm = fetch(`${URL_}/join-requests/${jr.requestId}/wait`, {
    headers: { 'Authorization': `Bearer ${jr.requestId}` },
  }).then(rr => rr.json());
  await wait(50);
  await fetch(`${URL_}/approvals`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: jr.requestId }),
  });
  const approved = await waitProm;
  return { memberToken: approved.memberToken, memberId: approved.memberId, requestId: jr.requestId };
}

function drainSse(body, onEvent, onClose) {
  const reader = body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  let curSeq = null;
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
          if (line.startsWith('id:')) {
            const v = line.slice(3).trim();
            if (/^\d+$/.test(v)) curSeq = Number(v);
            continue;
          }
          if (!line.startsWith('data:')) continue;
          try { onEvent(JSON.parse(line.slice(5).trimStart()), curSeq); } catch {}
        }
      }
    } catch {}
    if (onClose) onClose();
  })();
}

async function main() {
  const relay = spawnRelay();
  process.on('exit', () => { try { relay.kill('SIGTERM'); } catch {} });
  const up = await poll(async () => (await fetch(`${URL_}/healthz`)).ok);
  check('relay up', up);
  if (!up) { relay.kill(); process.exit(1); }

  const { memberToken } = await pairMember('Sankalp');
  check('test member paired', !!memberToken);

  // ----------------------------------------------------------------
  // #1  Queue + Last-Event-ID replay
  // ----------------------------------------------------------------

  // Post a prompt with no /prompt-stream subscriber: the relay should
  // queue it (delivered_to_host=0) but still respond ok with a seq.
  const postR = await fetch(`${URL_}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'queued-while-no-monitor' }),
  });
  const postJ = await postR.json();
  check('#1 POST /prompts with no monitor → 200 + seq', postR.ok && typeof postJ.seq === 'number');
  check('#1 POST /prompts reports delivered_to_host=0',  postJ.delivered === 0);

  // Now connect a host monitor without Last-Event-ID — relay should
  // replay everything > lastDeliveredPromptSeq (which is 0).
  let monEvents1 = [];
  const monCtrl1 = new AbortController();
  const monResp1 = await fetch(`${URL_}/prompt-stream`, {
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Accept': 'text/event-stream' },
    signal: monCtrl1.signal,
  });
  drainSse(monResp1.body, (ev, seq) => monEvents1.push({ ev, seq }));
  const replayed = await poll(() =>
    monEvents1.some(({ ev }) => ev.kind === 'prompt' && ev.text === 'queued-while-no-monitor'),
  );
  check('#1 monitor receives the queued prompt on connect (no Last-Event-ID)', replayed);
  const replaySeq = monEvents1.find(({ ev }) => ev.text === 'queued-while-no-monitor')?.seq;
  check('#1 replayed prompt carries an `id:` seq line', typeof replaySeq === 'number' && replaySeq > 0);

  // Disconnect this monitor so we can test reconnect behavior.
  monCtrl1.abort();
  await wait(200);

  // Post another prompt with no subscriber.
  await fetch(`${URL_}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'second-queued' }),
  });

  // Reconnect with Last-Event-ID equal to the seq we already delivered.
  // Server should replay only the new prompt, not the first one.
  let monEvents2 = [];
  const monCtrl2 = new AbortController();
  const monResp2 = await fetch(`${URL_}/prompt-stream`, {
    headers: {
      'Authorization' : `Bearer ${HOST_TOKEN}`,
      'Accept'        : 'text/event-stream',
      'Last-Event-ID' : String(replaySeq),
    },
    signal: monCtrl2.signal,
  });
  drainSse(monResp2.body, (ev, seq) => monEvents2.push({ ev, seq }));
  const sawSecond = await poll(() =>
    monEvents2.some(({ ev }) => ev.kind === 'prompt' && ev.text === 'second-queued'),
  );
  check('#1 reconnect with Last-Event-ID delivers new prompts', sawSecond);
  const dupCount = monEvents2.filter(({ ev }) => ev.text === 'queued-while-no-monitor').length;
  check('#1 reconnect with Last-Event-ID does NOT redeliver already-seen prompts', dupCount === 0);

  // ----------------------------------------------------------------
  // #2  Singleton host monitor
  // ----------------------------------------------------------------

  // Connecting a second monitor should evict the first one. The first
  // SSE response will close.
  let firstClosed = false;
  const monEventsA = [];
  const ctrlA = new AbortController();
  const respA = await fetch(`${URL_}/prompt-stream`, {
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Accept': 'text/event-stream' },
    signal: ctrlA.signal,
  });
  // Note: monResp2 is still open from the previous block, so respA is the
  // 2nd subscriber; let's first kill monResp2 to start clean.
  monCtrl2.abort();
  await wait(200);

  // Re-do: monResp2 closed; respA is now the only subscriber.
  drainSse(respA.body, ev => monEventsA.push(ev), () => { firstClosed = true; });
  await wait(150);

  // Connect a second one — this should kick respA.
  const monEventsB = [];
  const ctrlB = new AbortController();
  const respB = await fetch(`${URL_}/prompt-stream`, {
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Accept': 'text/event-stream' },
    signal: ctrlB.signal,
  });
  drainSse(respB.body, ev => monEventsB.push(ev));

  const evicted = await poll(() => firstClosed, 2000);
  check('#2 connecting a second /prompt-stream evicts the first', evicted);

  // Now post a prompt — only respB should see it.
  monEventsA.length = 0;
  monEventsB.length = 0;
  await fetch(`${URL_}/prompts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'singleton-test-payload' }),
  });
  const sawOnB = await poll(() => monEventsB.some(e => e.text === 'singleton-test-payload'));
  check('#2 second (live) subscriber receives the new prompt', sawOnB);
  const leakedToA = monEventsA.some(e => e.text === 'singleton-test-payload');
  check('#2 first (evicted) subscriber does NOT receive the new prompt', !leakedToA);

  ctrlA.abort();
  ctrlB.abort();
  await wait(150);

  // ----------------------------------------------------------------
  // #3  Kicked transcript SSE closes
  // ----------------------------------------------------------------

  const { memberToken: tokKick } = await pairMember('Bob');
  let tClosed = false;
  const tEvents = [];
  const tCtrl = new AbortController();
  const tResp = await fetch(`${URL_}/transcript-stream`, {
    headers: { 'Authorization': `Bearer ${tokKick}`, 'Accept': 'text/event-stream' },
    signal: tCtrl.signal,
  });
  drainSse(tResp.body, ev => tEvents.push(ev), () => { tClosed = true; });
  await wait(200);

  await fetch(`${URL_}/kicks`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bob' }),
  });

  const closedAfterKick = await poll(() => tClosed, 2000);
  check('#3 kicked member SSE response is closed by the relay', closedAfterKick);

  // The kicked token should also be invalidated for new requests.
  const reuseR = await fetch(`${URL_}/transcript-stream`, {
    headers: { 'Authorization': `Bearer ${tokKick}`, 'Accept': 'text/event-stream' },
  });
  check('#3 kicked token rejected on subsequent SSE request', reuseR.status === 401);

  // ----------------------------------------------------------------
  // #4a Name validation (server-side)
  // ----------------------------------------------------------------

  const badNames = [
    '[collab-claw]',
    'X\nY',
    'a'.repeat(33),
    '',
    'has;semicolon',
  ];
  for (const bn of badNames) {
    const rr = await fetch(`${URL_}/join-requests`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ROOM_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bn }),
    });
    check(`#4a relay rejects bad name ${JSON.stringify(bn).slice(0, 40)}`, rr.status === 400);
  }

  // ----------------------------------------------------------------
  // #4b System event format
  // ----------------------------------------------------------------

  // A new monitor should see kind=system events without a `name` field.
  const sysEvents = [];
  const sysCtrl = new AbortController();
  const sysResp = await fetch(`${URL_}/prompt-stream`, {
    headers: { 'Authorization': `Bearer ${HOST_TOKEN}`, 'Accept': 'text/event-stream' },
    signal: sysCtrl.signal,
  });
  drainSse(sysResp.body, ev => sysEvents.push(ev));
  await wait(150);

  // Trigger a join request that broadcasts a system event.
  await fetch(`${URL_}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ROOM_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Charlie' }),
  });

  const sawSys = await poll(() =>
    sysEvents.some(e => e.kind === 'system' && /Charlie wants to join/.test(e.text)),
  );
  check('#4b relay broadcasts kind=system on join request', sawSys);
  const sysEv = sysEvents.find(e => e.kind === 'system' && /Charlie wants to join/.test(e.text));
  check('#4b system event has NO name field (monitor renders [collab-claw] itself)',
        sysEv && (sysEv.name === undefined || sysEv.name === null));

  sysCtrl.abort();
  await wait(150);

  // ----------------------------------------------------------------
  // #5  Multiline rendering in the monitor
  // ----------------------------------------------------------------

  // We don't run the monitor process here (that's covered by
  // monitor-gate.mjs). Instead we exercise the pure render function
  // directly to lock in the encoding.
  const { renderEventLine } = await import('../src/commands/monitor.mjs').catch(() => ({}));
  if (typeof renderEventLine === 'function') {
    const line = renderEventLine({ kind: 'prompt', name: 'Sankalp', text: 'line one\nline two\nline three' });
    check('#5 multiline prompt renders on a single line with `\\n` escapes',
          line === '[Sankalp]: line one\\nline two\\nline three');

    const sysLine = renderEventLine({ kind: 'system', text: 'hello world' });
    check('#5 system event renders as `[collab-claw] <text>`',
          sysLine === '[collab-claw] hello world');

    const evilNameLine = renderEventLine({ kind: 'prompt', name: 'X]bad', text: 'hi' });
    check('#5 monitor strips brackets from names defensively',
          !!evilNameLine && !evilNameLine.includes('X]bad'));
  } else {
    // Skip if the export shape changes — relay-side validation already
    // prevents bad names; the monitor render is pure and small.
    check('#5 renderEventLine export available', false, '(skipped — could not import)');
  }

  // ----------------------------------------------------------------
  // teardown
  // ----------------------------------------------------------------

  relay.kill('SIGTERM');
  await wait(300);

  console.log(`\n# ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
