// test/e2e-cli.mjs — end-to-end smoke test exercising the actual CLI binaries.
//
// 1. set-name "TestHost"
// 2. collab-claw host           → spawns relay, writes session.json
// 3. simulate joiner: POST /join-requests, host runs `collab-claw approve <id>`,
//    joiner gets memberToken
// 4. host fakes a Stop hook by piping JSON into `collab-claw post-stop`
//    pointing at a fake transcript file with one assistant message
// 5. verify joiner SSE saw the response
// 6. collab-claw end → relay killed, session cleared
//
// Uses an isolated $HOME so we don't touch the real ~/.collab-claw.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CLI  = join(ROOT, 'bin', 'collab-claw');

const TMP = join(tmpdir(), 'collab-claw-e2e-' + process.pid);
mkdirSync(TMP, { recursive: true });
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const env = {
  ...process.env,
  HOME: TMP,
  COLLAB_CLAW_PORT: '7676',
  // bind 0.0.0.0 (default) so the LAN-IP URL the host CLI advertises is reachable
  COLLAB_CLAW_DEBUG: '1',
};

let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) { console.log(`  ✓ ${name}${info ? '  ' + info : ''}`); pass++; }
  else    { console.log(`  ✗ ${name}${info ? '  ' + info : ''}`); fail++; }
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', ...opts });
}

async function main() {
  // 1. set-name
  let r = runCli(['set-name', 'TestHost']);
  check('set-name TestHost', r.status === 0, r.stdout.trim());

  // 2. host
  r = runCli(['host']);
  check('host succeeded', r.status === 0);
  const session = JSON.parse(readFileSync(join(TMP, '.collab-claw', 'session.json'), 'utf8'));
  check('session.json mode=host', session.mode === 'host');
  const URL_ = session.relayUrl;

  // wait for relay
  let healthy = false;
  for (let i = 0; i < 40 && !healthy; i++) {
    try { healthy = (await fetch(`${URL_}/healthz`)).ok; } catch {}
    if (!healthy) await wait(50);
  }
  check('relay reachable after host', healthy);

  // 3. joiner pairing
  r = await fetch(`${URL_}/join-requests`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.roomSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sankalp' }),
  });
  const jr = await r.json();
  check('join-request created', !!jr.requestId);

  const waitProm = fetch(`${URL_}/join-requests/${jr.requestId}/wait`, {
    headers: { 'Authorization': `Bearer ${jr.requestId}` },
  }).then(r => r.json());

  await wait(100);
  const ar = runCli(['approve', jr.requestId]);
  check('cli approve <id>', ar.status === 0, ar.stdout.trim());
  const approved = await waitProm;
  check('joiner approved', approved.approved && !!approved.memberToken);
  const memberToken = approved.memberToken;

  // Subscribe to transcript stream BEFORE posting the response
  const ctrl = new AbortController();
  const transcript = await fetch(`${URL_}/transcript-stream`, {
    headers: { 'Authorization': `Bearer ${memberToken}`, 'Accept': 'text/event-stream' },
    signal: ctrl.signal,
  });
  check('transcript-stream subscribed', transcript.ok);
  const events = [];
  drainSse(transcript.body, ev => events.push(ev));
  await wait(150);

  // 4. fake Stop hook input
  const fakeTranscript = join(TMP, 'fake-transcript.jsonl');
  writeFileSync(fakeTranscript, [
    JSON.stringify({ role: 'user', content: 'hi' }),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello back from claude' }] },
    }),
  ].join('\n') + '\n');

  const stopInput = JSON.stringify({ transcript_path: fakeTranscript, session_id: 'x', hook_event_name: 'Stop' });
  r = spawnSync(process.execPath, [CLI, 'post-stop'], { env, encoding: 'utf8', input: stopInput });
  check('post-stop succeeded', r.status === 0, r.stderr.trim() || '');

  // 5. transcript stream saw the response
  let saw = false;
  for (let i = 0; i < 30 && !saw; i++) {
    saw = events.some(e => e.kind === 'response' && e.text.includes('hello back from claude'));
    if (!saw) await wait(50);
  }
  check('joiner saw the host response (round-trip via post-stop)', saw);

  // 6. PreToolUse + PostToolUse rendering
  const preInput = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'echo hello world' },
  });
  r = spawnSync(process.execPath, [CLI, 'post-tool', 'pre'], { env, encoding: 'utf8', input: preInput });
  check('post-tool pre succeeded', r.status === 0);

  const postInput = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'echo hello world' },
    tool_response: { stdout: 'hello world\n', exit_code: 0 },
  });
  r = spawnSync(process.execPath, [CLI, 'post-tool', 'post'], { env, encoding: 'utf8', input: postInput });
  check('post-tool post succeeded', r.status === 0);

  await wait(150);
  check('joiner saw tool_pre', events.some(e => e.kind === 'tool_pre' && e.text.includes('Bash')));
  check('joiner saw tool_post', events.some(e => e.kind === 'tool_post' && e.text.includes('Bash')));

  ctrl.abort();

  // 7. status
  r = runCli(['status']);
  check('status reports host mode', r.status === 0 && /mode/.test(r.stdout) && /host/.test(r.stdout));

  // 8. end
  r = runCli(['end']);
  check('end succeeded', r.status === 0);
  await wait(800);
  check('session.json removed', !existsSync(join(TMP, '.collab-claw', 'session.json')));

  let stillUp = false;
  try { stillUp = (await fetch(`${URL_}/healthz`)).ok; } catch {}
  check('relay no longer reachable after end', !stillUp);

  console.log(`\n# ${pass} passed, ${fail} failed`);
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

main().catch(e => { console.error(e); process.exit(1); });
