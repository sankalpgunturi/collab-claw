#!/usr/bin/env node
// Spike C joiner — minimal Node client that proves the relay/CLI loop:
//
//   1. Subscribe to /transcript-stream (SSE) and print events as they arrive.
//   2. Read prompts from stdin (one per line).
//   3. POST each prompt to /prompts with the joiner's name.
//   4. Time the round-trip from POST to first transcript event so we can
//      verify sub-3s on localhost.
//
// Auth: shared bearer token from $COLLAB_CLAW_TOKEN. Real v1 uses per-member
// tokens minted at approve time; that complexity is out of scope here.
//
// Usage:
//   ./joiner.mjs                     # interactive (read prompts from stdin)
//   ./joiner.mjs --send "hello"      # one-shot: POST then watch for 60s
//   ./joiner.mjs --watch             # SSE only, no stdin (for tailing)

import readline from 'node:readline';
import process  from 'node:process';

const RELAY = process.env.COLLAB_CLAW_RELAY || 'http://127.0.0.1:7475';
const TOKEN = process.env.COLLAB_CLAW_TOKEN || 'spike-c-shared-token';
const NAME  = process.env.COLLAB_CLAW_NAME  || 'Sankalp';

const args = process.argv.slice(2);
let mode = 'interactive';
let oneShotText = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--send') {
    mode = 'oneShot';
    oneShotText = args[i + 1] || '';
    i++;
  } else if (args[i] === '--watch') {
    mode = 'watch';
  }
}

const ts    = () => new Date().toISOString();
const dim   = s => `\x1b[2m${s}\x1b[0m`;
const bold  = s => `\x1b[1m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const cyan  = s => `\x1b[36m${s}\x1b[0m`;
const log   = (...a) => console.log(dim(`[${ts()}]`), ...a);

let lastSentAt = null; // for round-trip timing

async function consumeTranscript() {
  log(`subscribing to ${RELAY}/transcript-stream as ${NAME}`);
  while (true) {
    try {
      const resp = await fetch(`${RELAY}/transcript-stream`, {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Accept'       : 'text/event-stream',
        },
      });
      if (!resp.ok) {
        log(`transcript-stream HTTP ${resp.status}; retry in 2s`);
        await sleep(2000);
        continue;
      }
      log(`transcript-stream connected`);
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of resp.body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = frame
            .split('\n')
            .filter(l => l.startsWith('data: '))
            .map(l => l.slice(6));
          if (dataLines.length === 0) continue;
          try {
            const ev = JSON.parse(dataLines.join('\n'));
            renderEvent(ev);
          } catch (e) {
            log(`bad SSE frame: ${frame}`);
          }
        }
      }
      log(`transcript-stream EOF; reconnecting in 1s`);
      await sleep(1000);
    } catch (err) {
      log(`transcript-stream error: ${err.message}; retry in 2s`);
      await sleep(2000);
    }
  }
}

function renderEvent(ev) {
  let label = `${ev.name || 'host'}`;
  if (ev.kind === 'response') label = `${green(ev.name || 'host')} (host)`;
  console.log();
  console.log(`${bold(label)}  ${dim(ev.kind || '')}`);
  console.log(ev.text);
  if (lastSentAt) {
    const dt = Date.now() - lastSentAt;
    console.log(dim(`(round-trip: ${dt} ms)`));
    lastSentAt = null;
  }
}

async function postPrompt(text) {
  const t = text.trim();
  if (!t) return;
  lastSentAt = Date.now();
  console.log(`${bold(cyan(NAME))} (you)`);
  console.log(t);
  try {
    const resp = await fetch(`${RELAY}/prompts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ name: NAME, text: t }),
    });
    const body = await resp.json().catch(() => ({}));
    log(`POST /prompts -> ${resp.status} ${JSON.stringify(body)}`);
    if (body.delivered === 0) {
      log(`!! relay accepted prompt but ZERO subscribers on /prompt-stream — host monitor not connected`);
    }
  } catch (err) {
    log(`POST /prompts failed: ${err.message}`);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  consumeTranscript();
  if (mode === 'watch') {
    await sleep(1 << 30);
    return;
  }
  if (mode === 'oneShot') {
    await sleep(500);
    await postPrompt(oneShotText);
    log(`waiting up to 60s for transcript response...`);
    await sleep(60000);
    process.exit(0);
  }
  console.log(dim(`type a prompt and press Enter. Ctrl-D to exit.`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    if (!line.trim()) continue;
    await postPrompt(line);
  }
  process.exit(0);
}

main();
