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
// gate re-checks even if the relay is quiet. The relay queues events while
// we're disconnected and replays them via `Last-Event-ID` on reconnect, so
// these gaps don't drop prompts.
//
// Emit format:
//
//   kind=prompt → `[Name]: <text>`
//                 (multiline text gets newlines replaced with `\n` literal
//                  so the entire prompt arrives as one notification line)
//   kind=system → `[collab-claw] <text>`
//                 (matches what the host SKILL teaches Claude to recognize
//                  as a control announcement, not a teammate prompt)
//
// Singleton: a small PID-file lock at ~/.collab-claw/monitor.pid prevents
// duplicate monitor processes from emitting prompts to Claude twice. The
// relay also enforces single-subscriber on /prompt-stream as defense in
// depth.

import { readSession } from '../state.mjs';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const COLLAB_DIR = join(homedir(), '.collab-claw');
const PID_FILE   = join(COLLAB_DIR, 'monitor.pid');
const STATE_FILE = join(COLLAB_DIR, 'monitor-state.json');
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

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // EPERM means process exists but we don't own it
}

/** Acquire a PID-file lock. Returns true if we're the singleton. False
 *  otherwise (caller should exit). Stale PID files (process gone) are
 *  reclaimed automatically. */
function acquirePidLock() {
  try { mkdirSync(COLLAB_DIR, { recursive: true, mode: 0o700 }); } catch {}
  if (existsSync(PID_FILE)) {
    try {
      const txt = readFileSync(PID_FILE, 'utf8').trim();
      const other = Number(txt);
      if (pidAlive(other) && other !== process.pid) {
        log(`PID lock held by pid=${other}; this monitor exiting (defense in depth — relay also enforces singleton)`);
        return false;
      }
      log(`reclaiming stale PID file (was pid=${other})`);
    } catch {}
  }
  try {
    writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 });
    return true;
  } catch (e) {
    log(`could not write PID file: ${e.message} (continuing anyway; relay enforces singleton)`);
    return true;
  }
}

function releasePidLock() {
  try {
    if (existsSync(PID_FILE)) {
      const txt = readFileSync(PID_FILE, 'utf8').trim();
      if (Number(txt) === process.pid) unlinkSync(PID_FILE);
    }
  } catch {}
}

// Key the seq cursor on a hash of the host token. Each `collab-claw host`
// run mints a fresh hostToken, so a previous room's lastSeq doesn't bleed
// into a new room's seq sequence (which restarts at 1 with every relay
// process).
function tokenHash(t) {
  return createHash('sha256').update(String(t)).digest('hex').slice(0, 16);
}

function readLastSeq(hostToken) {
  try {
    const j = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (j.tokenHash === tokenHash(hostToken)) return Number(j.lastSeq) || 0;
  } catch {}
  return 0;
}

function writeLastSeq(hostToken, seq) {
  try {
    mkdirSync(COLLAB_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ v: 1, tokenHash: tokenHash(hostToken), lastSeq: seq }),
      { mode: 0o600 },
    );
  } catch {}
}

/**
 * Render an event for stdout. Returns null if the event should be skipped.
 *
 * - Newlines are escaped to `\n` so Claude Code's monitor framework, which
 *   delivers each stdout line as a separate notification, can attribute the
 *   whole multiline prompt to one named teammate.
 * - Other control characters are stripped (the relay also does this; this
 *   is belt-and-suspenders).
 */
export function renderEventLine(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const text = String(ev.text || '');
  if (!text) return null;
  const safe = text
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');

  if (ev.kind === 'system') {
    return `[collab-claw] ${safe}`;
  }
  if (ev.kind === 'prompt') {
    const name = String(ev.name || '').replace(/[\x00-\x1F\x7F\[\]]/g, '');
    if (!name) return null;
    return `[${name}]: ${safe}`;
  }
  return null;
}

function emit(line) {
  try { process.stdout.write(line + '\n'); } catch {}
}

async function consumeOnce() {
  const s = readSession();
  if (!s || s.mode !== 'host') return;
  const url = `${s.relayUrl}/prompt-stream`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    log('SSE max-time reached; closing for re-gate');
    try { ctrl.abort(); } catch {}
  }, MAX_CONN_MS);

  const lastSeq = readLastSeq(s.hostToken);

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        'Authorization' : `Bearer ${s.hostToken}`,
        'Accept'        : 'text/event-stream',
        'Last-Event-ID' : String(lastSeq),
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

  log(`SSE connected url=${url} since_seq=${lastSeq}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let curSeq = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);

        if (line.startsWith('id:')) {
          const seqStr = line.slice(3).trim();
          if (/^\d+$/.test(seqStr)) curSeq = Number(seqStr);
          continue;
        }
        if (!line.startsWith('data:')) continue;

        if (!gateOpen()) {
          log(`DROP: gate closed mid-stream (seq=${curSeq})`);
          continue;
        }

        const payload = line.slice(5).trimStart();
        let ev;
        try { ev = JSON.parse(payload); } catch {
          log(`drop malformed sse line: ${payload.slice(0, 200)}`);
          continue;
        }

        const out = renderEventLine(ev);
        if (out == null) {
          log(`drop unrenderable event: ${JSON.stringify(ev).slice(0, 200)}`);
          continue;
        }

        emit(out);
        log(`EMIT seq=${curSeq} ${out.slice(0, 160)}${out.length > 160 ? '…' : ''}`);
        if (curSeq != null) writeLastSeq(s.hostToken, curSeq);
      }
    }
  } catch (e) {
    log(`SSE read error: ${e.message}`);
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch {}
    try { resp.body && resp.body.cancel && resp.body.cancel(); } catch {}
    log('SSE disconnected');
  }
}

export async function run(args) {
  log(`========== monitor started pid=${process.pid} ==========`);

  if (!acquirePidLock()) {
    process.exit(0);
  }

  const cleanup = () => { releasePidLock(); };
  process.on('exit',    cleanup);
  process.on('SIGINT',  () => { log('SIGINT');  releasePidLock(); process.exit(0); });
  process.on('SIGTERM', () => { log('SIGTERM'); releasePidLock(); process.exit(0); });

  let alive = true;
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
