// relay/server.mjs — collab-claw v1 relay.
//
// Single-room HTTP+SSE server. Spawned by `collab-claw host` as a subprocess.
// Lives only as long as the host's session does.
//
// Routes (all under "/" — no /rooms/:room/ prefix in v1 since each relay
// hosts exactly one room):
//
//   GET  /healthz                       — liveness
//   GET  /info                          — public room metadata (name/secret check)
//
//   POST /join-requests                 — join request from CLI (auth: roomSecret)
//   GET  /join-requests/:id/wait        — long-poll for approval (auth: request_id)
//   POST /approvals                     — host approves a join (auth: hostToken)
//   POST /denials                       — host rejects a join   (auth: hostToken)
//
//   POST /prompts                       — joiner prompt (auth: memberToken)
//   GET  /prompt-stream                 — SSE: joiner prompts → host monitor (auth: hostToken)
//
//   POST /events                        — host hook events (auth: hostToken)
//   GET  /transcript-stream             — SSE: events → joiner TUI (auth: memberToken)
//
//   GET  /recent                        — last 200 events for backfill (auth: memberToken)
//   GET  /members                       — current member list (auth: any token)
//   POST /leaves                        — joiner leaves (auth: memberToken)
//   POST /kicks                         — host kicks a member (auth: hostToken)
//   POST /shutdown                      — host ends the room (auth: hostToken)
//
// Twelve user-facing routes plus /healthz + /info. Tracks the architecture
// in PLAN.md §6.
//
// Tokens are minted by this process and stored in memory only. Host token
// comes in from env at startup (so the host CLI knows it without IPC).
// Member tokens are minted at approval time and returned only to the joiner
// CLI's long-poll wait — never echoed through the host plugin.

import http from 'node:http';
import { URL } from 'node:url';
import { token32 } from '../util/crypto.mjs';
import { ts } from '../util/log.mjs';

const PORT       = Number(process.env.COLLAB_CLAW_PORT  || 7474);
const HOST       = process.env.COLLAB_CLAW_BIND        || '0.0.0.0';
const HOST_TOKEN = process.env.COLLAB_CLAW_HOST_TOKEN  || '';
const ROOM_SECRET = process.env.COLLAB_CLAW_ROOM_SECRET || '';
const ROOM_ID    = process.env.COLLAB_CLAW_ROOM_ID    || 'default-room';
const HOST_NAME  = process.env.COLLAB_CLAW_HOST_NAME  || 'host';
const RING_SIZE  = Number(process.env.COLLAB_CLAW_RING || 200);

if (!HOST_TOKEN || !ROOM_SECRET) {
  console.error('relay: COLLAB_CLAW_HOST_TOKEN and COLLAB_CLAW_ROOM_SECRET env vars are required');
  process.exit(2);
}

// ---------- in-memory state ----------

/** members: memberId -> { id, name, token, joinedAt } */
const members = new Map();
/** memberTokens: token -> memberId */
const memberTokens = new Map();
/** joinRequests: id -> { id, name, secret, status, memberToken?, memberId?, waiters: [res, ...], createdAt } */
const joinRequests = new Map();

const promptSubs     = new Set(); // SSE responses for /prompt-stream
const transcriptSubs = new Set(); // SSE responses for /transcript-stream

const ring = []; // last RING_SIZE transcript events for backfill

// ---------- utilities ----------

const log = (...a) => console.log(`[${ts()}]`, ...a);

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

function readJson(req, max = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function authHost(req) { return bearer(req) === HOST_TOKEN; }
function authRoomSecret(req) {
  // Joiners send the room secret in the Authorization header for /join-requests.
  return bearer(req) === ROOM_SECRET;
}
function authMember(req) {
  const t = bearer(req);
  return memberTokens.has(t) ? memberTokens.get(t) : null;
}
function authAnyToken(req) {
  return authHost(req) ? 'host' : (authMember(req) ? 'member' : null);
}

function openSse(res) {
  res.writeHead(200, {
    'Content-Type'    : 'text/event-stream',
    'Cache-Control'   : 'no-cache, no-transform',
    'Connection'      : 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: connected ${ts()}\n\n`);
  const ka = setInterval(() => {
    try { res.write(`: keepalive ${ts()}\n\n`); } catch {}
  }, 15000);
  res.on('close', () => clearInterval(ka));
  return res;
}

function fanout(set, payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  let n = 0;
  for (const r of set) {
    try { r.write(line); n++; } catch { set.delete(r); }
  }
  return n;
}

function pushEvent(ev) {
  ring.push(ev);
  if (ring.length > RING_SIZE) ring.shift();
}

// ---------- request handler ----------

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'bad url' }); }
  const path = u.pathname;
  const method = req.method;

  // Public routes (no auth)

  if (method === 'GET' && path === '/healthz') {
    return send(res, 200, {
      ok: true,
      roomId: ROOM_ID,
      members: members.size,
      promptSubscribers: promptSubs.size,
      transcriptSubscribers: transcriptSubs.size,
    });
  }

  if (method === 'GET' && path === '/info') {
    return send(res, 200, {
      ok: true,
      roomId: ROOM_ID,
      hostName: HOST_NAME,
      version: '0.1.0',
    });
  }

  // ---------- pairing: join requests ----------

  if (method === 'POST' && path === '/join-requests') {
    if (!authRoomSecret(req)) {
      log('POST /join-requests rejected: bad room secret');
      return send(res, 401, { error: 'bad room secret' });
    }
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }
    const name = String(body.name || '').trim().slice(0, 32);
    if (!name) return send(res, 400, { error: 'name required' });

    // Reject duplicate names (in members or in pending requests)
    const dupeMember = [...members.values()].some(m => m.name.toLowerCase() === name.toLowerCase());
    const dupePending = [...joinRequests.values()].some(r => r.status === 'pending' && r.name.toLowerCase() === name.toLowerCase());
    if (dupeMember || dupePending) {
      return send(res, 409, { error: 'name in use' });
    }

    const id = token32();
    const reqRec = {
      id, name,
      status: 'pending',
      waiters: [],
      createdAt: ts(),
    };
    joinRequests.set(id, reqRec);

    log(`join-request id=${id.slice(0, 8)}… name="${name}"`);

    // Surface to host monitor as a system notification line. The SKILL body
    // teaches the host's Claude how to react: it should say "Sankalp wants
    // to join the room. Approve with /collab-claw:approve <id>" or just call
    // the approve skill directly. We send it as a "prompt" event so it
    // travels the same code path as joiner prompts.
    fanout(promptSubs, {
      kind: 'system',
      name: '[collab-claw]',
      text: `${name} wants to join the room. Approve with /collab-claw:approve ${id} (or /collab-claw:kick ${id} to deny).`,
      requestId: id,
      ts: ts(),
    });

    return send(res, 200, { ok: true, requestId: id });
  }

  if (method === 'GET' && path.startsWith('/join-requests/') && path.endsWith('/wait')) {
    const id = path.slice('/join-requests/'.length, -'/wait'.length);
    const rec = joinRequests.get(id);
    if (!rec) return send(res, 404, { error: 'unknown request' });
    // Auth on the request id itself: only the joiner with the id can wait.
    // (Belt-and-suspenders: also accept room secret since the joiner has it.)
    const provided = bearer(req);
    if (provided !== id && provided !== ROOM_SECRET) {
      return send(res, 401, { error: 'unauthorized' });
    }

    if (rec.status === 'approved') {
      return send(res, 200, {
        ok: true,
        approved: true,
        memberToken: rec.memberToken,
        memberId   : rec.memberId,
        roomId     : ROOM_ID,
        name       : rec.name,
      });
    }
    if (rec.status === 'denied') {
      return send(res, 200, { ok: true, approved: false, reason: rec.reason || 'denied' });
    }

    // Long-poll: hold the response. Resolved when host approves/denies.
    rec.waiters.push(res);
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const t = setTimeout(() => {
      const idx = rec.waiters.indexOf(res);
      if (idx >= 0) rec.waiters.splice(idx, 1);
      try { send(res, 200, { ok: true, approved: false, reason: 'timeout' }); } catch {}
    }, TIMEOUT_MS);
    res.on('close', () => {
      clearTimeout(t);
      const idx = rec.waiters.indexOf(res);
      if (idx >= 0) rec.waiters.splice(idx, 1);
    });
    return;
  }

  if (method === 'POST' && path === '/approvals') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }
    const id = String(body.requestId || '').trim();
    if (!id) return send(res, 400, { error: 'requestId required' });
    const rec = joinRequests.get(id);
    if (!rec) return send(res, 404, { error: 'unknown request' });
    if (rec.status !== 'pending') return send(res, 409, { error: `already ${rec.status}` });

    // Mint member token, register member, resolve waiters with the token
    // directly (the host plugin never sees the member token).
    const memberId    = token32();
    const memberToken = token32();
    members.set(memberId, { id: memberId, name: rec.name, token: memberToken, joinedAt: ts() });
    memberTokens.set(memberToken, memberId);

    rec.status      = 'approved';
    rec.memberId    = memberId;
    rec.memberToken = memberToken;

    log(`approved request id=${id.slice(0,8)}… name="${rec.name}" memberId=${memberId.slice(0,8)}…`);

    for (const w of rec.waiters) {
      try {
        send(w, 200, {
          ok: true, approved: true,
          memberToken, memberId,
          roomId: ROOM_ID,
          name: rec.name,
        });
      } catch {}
    }
    rec.waiters.length = 0;

    // Tell the host plugin only the bare minimum (no token).
    return send(res, 200, { ok: true, name: rec.name });
  }

  if (method === 'POST' && path === '/denials') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }
    const id = String(body.requestId || '').trim();
    if (!id) return send(res, 400, { error: 'requestId required' });
    const rec = joinRequests.get(id);
    if (!rec) return send(res, 404, { error: 'unknown request' });
    if (rec.status !== 'pending') return send(res, 409, { error: `already ${rec.status}` });
    rec.status = 'denied';
    rec.reason = String(body.reason || 'denied');
    for (const w of rec.waiters) {
      try { send(w, 200, { ok: true, approved: false, reason: rec.reason }); } catch {}
    }
    rec.waiters.length = 0;
    log(`denied request id=${id.slice(0,8)}… name="${rec.name}"`);
    return send(res, 200, { ok: true, name: rec.name });
  }

  // ---------- live channels ----------

  if (method === 'POST' && path === '/prompts') {
    const memberId = authMember(req);
    if (!memberId) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }
    const member = members.get(memberId);
    const text = String(body.text || '').trim();
    if (!text) return send(res, 400, { error: 'text required' });
    const ev = {
      kind: 'prompt',
      name: member.name,
      text,
      ts  : ts(),
    };
    // Send to host monitor for Claude wakeup
    const delivered = fanout(promptSubs, ev);
    // Also broadcast to other joiners so everyone sees who said what
    fanout(transcriptSubs, ev);
    pushEvent(ev);
    log(`POST /prompts name="${member.name}" len=${text.length} delivered_to_host=${delivered}`);
    return send(res, 200, { ok: true, delivered });
  }

  if (method === 'GET' && path === '/prompt-stream') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    log('GET /prompt-stream subscribe (host monitor)');
    openSse(res);
    promptSubs.add(res);
    res.on('close', () => {
      promptSubs.delete(res);
      log('GET /prompt-stream disconnect');
    });
    return;
  }

  if (method === 'POST' && path === '/events') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }
    const ev = {
      kind   : String(body.kind || 'unknown'),
      name   : String(body.name || HOST_NAME),
      text   : body.text == null ? '' : String(body.text),
      payload: (typeof body.payload === 'object' && body.payload) ? body.payload : null,
      ts     : ts(),
    };
    pushEvent(ev);
    const delivered = fanout(transcriptSubs, ev);
    log(`POST /events kind=${ev.kind} name="${ev.name}" len=${ev.text.length} delivered=${delivered}`);
    return send(res, 200, { ok: true, delivered });
  }

  if (method === 'GET' && path === '/transcript-stream') {
    const memberId = authMember(req);
    if (!memberId) return send(res, 401, { error: 'unauthorized' });
    log(`GET /transcript-stream subscribe (member ${memberId.slice(0,8)}…)`);
    openSse(res);
    transcriptSubs.add(res);
    res.on('close', () => {
      transcriptSubs.delete(res);
      log('GET /transcript-stream disconnect');
    });
    return;
  }

  if (method === 'GET' && path === '/recent') {
    const memberId = authMember(req);
    if (!memberId) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { ok: true, events: ring.slice(-RING_SIZE) });
  }

  if (method === 'GET' && path === '/debug/requests') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    const requests = [...joinRequests.values()].map(r => ({
      id: r.id, name: r.name, status: r.status, createdAt: r.createdAt,
    }));
    return send(res, 200, { ok: true, requests });
  }

  if (method === 'GET' && path === '/members') {
    if (!authAnyToken(req)) return send(res, 401, { error: 'unauthorized' });
    const list = [...members.values()].map(m => ({ id: m.id, name: m.name, joinedAt: m.joinedAt }));
    return send(res, 200, { ok: true, host: HOST_NAME, members: list });
  }

  if (method === 'POST' && path === '/leaves') {
    const memberId = authMember(req);
    if (!memberId) return send(res, 401, { error: 'unauthorized' });
    const m = members.get(memberId);
    if (m) {
      members.delete(memberId);
      memberTokens.delete(m.token);
      log(`leave name="${m.name}"`);
      // Announce leave to others via transcript
      const ev = { kind: 'system', name: '[collab-claw]', text: `${m.name} left the room.`, ts: ts() };
      fanout(transcriptSubs, ev);
      pushEvent(ev);
    }
    return send(res, 200, { ok: true });
  }

  if (method === 'POST' && path === '/kicks') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }
    const target = String(body.name || body.memberId || '').trim();
    if (!target) return send(res, 400, { error: 'name or memberId required' });
    let m = null;
    for (const x of members.values()) {
      if (x.name.toLowerCase() === target.toLowerCase() || x.id === target) { m = x; break; }
    }
    if (!m) return send(res, 404, { error: 'no such member' });
    members.delete(m.id);
    memberTokens.delete(m.token);
    const ev = { kind: 'system', name: '[collab-claw]', text: `${m.name} was removed from the room.`, ts: ts() };
    fanout(transcriptSubs, ev);
    pushEvent(ev);
    log(`kicked name="${m.name}"`);
    return send(res, 200, { ok: true, name: m.name });
  }

  if (method === 'POST' && path === '/shutdown') {
    if (!authHost(req)) return send(res, 401, { error: 'unauthorized' });
    log('shutdown requested by host; closing in 500ms');
    const ev = { kind: 'system', name: '[collab-claw]', text: 'Host ended the room.', ts: ts() };
    fanout(transcriptSubs, ev);
    setTimeout(() => process.exit(0), 500);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'not found', path });
});

server.listen(PORT, HOST, () => {
  log(`collab-claw relay listening on http://${HOST}:${PORT}`);
  log(`roomId=${ROOM_ID} hostName="${HOST_NAME}" ringSize=${RING_SIZE}`);
});

server.on('error', err => {
  console.error('relay listen error:', err.message);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`received ${sig}, closing ${promptSubs.size + transcriptSubs.size} SSE connections`);
    for (const r of [...promptSubs, ...transcriptSubs]) {
      try { r.end(); } catch {}
    }
    server.close(() => process.exit(0));
  });
}
