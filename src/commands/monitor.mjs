// monitor — host-side, always-on session-gated SSE consumer.
//
// Started by Claude Code at every session start (via the plugin's top-level
// `monitors` array → bin/monitor-prompts shim → us).
//
// Spike B finding: monitors must be `when: always` (the documented
// `when: on-skill-invoke:<skill>` is silently broken in 2.1.119). So we
// gate ourselves with a session-state file: if ~/.collab-claw/session.json
// exists with mode == "host", we open an SSE connection to the relay and
// emit incoming joiner prompts as `[Name]: <text>` lines on stdout. If the
// gate is closed, we idle.
//
// Two-stage gate (negative control from Spike C):
//
//   1. Outer loop: gate check before opening any SSE connection.
//   2. Inner loop: gate check before emitting each event. Catches the case
//      where the user runs `collab-claw end` while events are mid-flight.
//
// SSE connections are also capped at MAX_CONN_MS to force periodic outer
// gate re-checks even if the relay is quiet.

import { readSession } from '../state.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR  = join(homedir(), '.claude', 'data', 'collab-claw');
const LOG_FILE = join(LOG_DIR, 'monitor.log');
const MAX_CONN_MS = 30_000;
const IDLE_RECHECK_MS = 5_000;

function log(msg) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function gateOpen() {
  const s = readSession();
  return !!(s && s.mode === 'host' && typeof s.roomId === 'string' && s.roomId.length > 0);
}

function emit(line) {
  try {
    process.stdout.write(line + '\n');
  } catch {}
}

async function consumeOnce() {
  const s = readSession();
  if (!s || s.mode !== 'host') return;
  const url = `${s.relayUrl}/prompt-stream`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    log(`SSE max-time reached; closing for re-gate`);
    try { ctrl.abort(); } catch {}
  }, MAX_CONN_MS);

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${s.hostToken}`,
        'Accept'       : 'text/event-stream',
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name !== 'AbortError') log(`fetch error: ${e.message}`);
    clearTimeout(timer);
    return;
  }

  if (!resp.ok || !resp.body) {
    log(`SSE bad response status=${resp.status}`);
    clearTimeout(timer);
    try { resp.body && resp.body.cancel && resp.body.cancel(); } catch {}
    return;
  }

  log(`SSE connected url=${url}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;

        // Inner-loop gate check: drop event if room ended mid-stream.
        if (!gateOpen()) {
          log(`DROP: gate closed mid-stream`);
          continue;
        }

        const payload = line.slice(5).trimStart();
        let ev;
        try { ev = JSON.parse(payload); } catch {
          log(`drop malformed sse line: ${payload.slice(0, 200)}`);
          continue;
        }

        const name = String(ev.name || '').trim();
        const text = String(ev.text || '').trim();
        if (!name || !text) {
          log(`drop empty payload: ${JSON.stringify(ev).slice(0, 200)}`);
          continue;
        }

        // Format: `[Name]: <text>` — Spike B confirmed this format wakes Claude.
        emit(`[${name}]: ${text}`);
        log(`EMIT [${name}]: ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`);
      }
    }
  } catch (e) {
    log(`SSE read error: ${e.message}`);
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch {}
    try { resp.body && resp.body.cancel && resp.body.cancel(); } catch {}
    log(`SSE disconnected`);
  }
}

export async function run(args) {
  log(`========== monitor started pid=${process.pid} ==========`);

  // Loop forever. The Claude Code monitor framework treats stdout lines as
  // notifications and trusts us to stay alive. Exits only on SIGINT/SIGTERM.
  let alive = true;
  process.on('SIGINT',  () => { alive = false; log('SIGINT');  process.exit(0); });
  process.on('SIGTERM', () => { alive = false; log('SIGTERM'); process.exit(0); });

  while (alive) {
    if (gateOpen()) {
      await consumeOnce();
    } else {
      log('gate closed; idling');
    }
    await new Promise(r => setTimeout(r, IDLE_RECHECK_MS));
  }
  return 0;
}
