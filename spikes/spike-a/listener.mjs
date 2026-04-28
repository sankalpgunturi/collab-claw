#!/usr/bin/env node
// Spike A — local HTTP listener.
//
// Receives every UserPromptSubmit hook fire from the spike plugin,
// extracts `.prompt` from the JSON body, logs both raw and parsed forms.
//
// Run with: node listener.mjs
// Stop with: Ctrl+C

import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 9999);
const LOG_PATH = new URL('./spike-a-listener.log', import.meta.url).pathname;

writeFileSync(LOG_PATH, `# Spike A listener log — started ${new Date().toISOString()}\n`);

let count = 0;

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, count }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/test') {
    res.statusCode = 404;
    res.end('not found\n');
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    count += 1;
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed = null;
    let parseError = null;
    let prompt = null;
    try {
      parsed = JSON.parse(raw);
      prompt = parsed?.prompt ?? null;
    } catch (e) {
      parseError = String(e);
    }

    const banner = `\n=== hook fire #${count} @ ${new Date().toISOString()} ===`;
    console.log(banner);
    console.log('content-length:', raw.length);
    if (parseError) {
      console.log('JSON parse error:', parseError);
      console.log('raw body:', raw);
    } else {
      console.log('event keys:', Object.keys(parsed ?? {}));
      console.log('event.prompt:', JSON.stringify(prompt));
      console.log('event.session_id:', JSON.stringify(parsed?.session_id ?? null));
      console.log('full event JSON:', JSON.stringify(parsed, null, 2));
    }

    appendFileSync(
      LOG_PATH,
      `${banner}\nlength: ${raw.length}\nparseError: ${parseError ?? 'none'}\nprompt: ${JSON.stringify(prompt)}\nfullEvent: ${raw}\n`,
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        count,
        parsed: !parseError,
        prompt_length: prompt?.length ?? 0,
      }),
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `spike-a listener on http://127.0.0.1:${PORT}/test  (healthz: /healthz, log: ${LOG_PATH})`,
  );
  console.log('Ready. Type a prompt in claude to see hook fires here.');
});

process.on('SIGINT', () => {
  console.log(`\nshutting down — total fires: ${count}`);
  server.close(() => process.exit(0));
});
