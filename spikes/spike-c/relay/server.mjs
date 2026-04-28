#!/usr/bin/env node
// Spike C relay — minimal HTTP+SSE server proving the four routes from
// PLAN.md §6 work end-to-end:
//
//   POST /prompts            (member token)  -> fans out to /prompt-stream
//   GET  /prompt-stream      (host   token)  -> SSE feed of joiner prompts
//   POST /events             (host   token)  -> fans out to /transcript-stream
//   GET  /transcript-stream  (member token)  -> SSE feed of host events
//
// Auth: a single shared bearer token from $COLLAB_CLAW_TOKEN (default
// "spike-c-shared-token"). Real v1 uses per-member tokens minted at approve
// time; that complexity is out of scope for the plumbing proof.
//
// In-memory ring buffer of last 200 events for /transcript-stream
// reconnect-replay would be nice to have, but Spike C tests live streaming
// only; reconnects are out of scope.

import http from 'node:http';
import { URL } from 'node:url';

const PORT  = Number(process.env.COLLAB_CLAW_PORT  || 7475);
const HOST  = process.env.COLLAB_CLAW_HOST || '127.0.0.1';
const TOKEN = process.env.COLLAB_CLAW_TOKEN || 'spike-c-shared-token';

const promptSubscribers     = new Set(); // host monitor subscribers (SSE responses)
const transcriptSubscribers = new Set(); // joiner subscribers       (SSE responses)

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

function authOk(req) {
  const h = req.headers['authorization'] || '';
  return h === `Bearer ${TOKEN}`;
}

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function openSse(res) {
  res.writeHead(200, {
    'Content-Type'   : 'text/event-stream',
    'Cache-Control'  : 'no-cache, no-transform',
    'Connection'     : 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: connected ${ts()}\n\n`);
  // Keepalive so idle SSE connections don't die in some proxies.
  const keepalive = setInterval(() => {
    try { res.write(`: keepalive ${ts()}\n\n`); } catch {}
  }, 15000);
  res.on('close', () => clearInterval(keepalive));
  return res;
}

function fanout(set, payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  let delivered = 0;
  for (const r of set) {
    try { r.write(line); delivered++; }
    catch { set.delete(r); }
  }
  return delivered;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname;

  // Health
  if (req.method === 'GET' && path === '/healthz') {
    return send(res, 200, {
      ok: true,
      promptSubscribers: promptSubscribers.size,
      transcriptSubscribers: transcriptSubscribers.size,
    });
  }

  if (!authOk(req)) {
    log(req.method, path, 'rejected: bad token');
    return send(res, 401, { error: 'unauthorized' });
  }

  // Joiner posts a prompt; fanned out to the host monitor
  if (req.method === 'POST' && path === '/prompts') {
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }

    const name = String(body.name || '').trim();
    const text = String(body.text || '').trim();
    if (!name || !text) {
      return send(res, 400, { error: 'name and text required' });
    }
    const delivered = fanout(promptSubscribers, { name, text, ts: ts() });
    log(`POST /prompts name="${name}" len=${text.length} delivered=${delivered}`);
    return send(res, 200, { ok: true, delivered });
  }

  // Host monitor consumes joiner prompts as SSE
  if (req.method === 'GET' && path === '/prompt-stream') {
    log('GET /prompt-stream subscribe');
    openSse(res);
    promptSubscribers.add(res);
    res.on('close', () => {
      promptSubscribers.delete(res);
      log('GET /prompt-stream disconnect');
    });
    return;
  }

  // Host hooks post transcript events; fanned out to joiners
  if (req.method === 'POST' && path === '/events') {
    let body;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: 'bad json' }); }

    const event = {
      kind: String(body.kind || 'unknown'),
      name: String(body.name || ''),
      text: String(body.text || ''),
      ts  : ts(),
    };
    const delivered = fanout(transcriptSubscribers, event);
    log(`POST /events kind=${event.kind} name="${event.name}" len=${event.text.length} delivered=${delivered}`);
    return send(res, 200, { ok: true, delivered });
  }

  // Joiner consumes transcript events as SSE
  if (req.method === 'GET' && path === '/transcript-stream') {
    log('GET /transcript-stream subscribe');
    openSse(res);
    transcriptSubscribers.add(res);
    res.on('close', () => {
      transcriptSubscribers.delete(res);
      log('GET /transcript-stream disconnect');
    });
    return;
  }

  return send(res, 404, { error: 'not found', path });
});

server.listen(PORT, HOST, () => {
  log(`spike-c relay listening on http://${HOST}:${PORT}`);
  log(`token in env COLLAB_CLAW_TOKEN; current value: ${TOKEN === 'spike-c-shared-token' ? '(default)' : '(custom)'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`received ${sig}, closing ${promptSubscribers.size + transcriptSubscribers.size} SSE connections`);
    for (const r of [...promptSubscribers, ...transcriptSubscribers]) {
      try { r.end(); } catch {}
    }
    server.close(() => process.exit(0));
  });
}
