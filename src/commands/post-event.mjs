// post-event — host-only: post a generic event to /events.
//
//   collab-claw post-event <kind> <text>
//   collab-claw post-event <kind>          # text from stdin

import { readSession, readConfig } from '../state.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') return 0;

  const kind = (args.shift() || 'note').trim();
  let text = args.length ? args.join(' ') : await readStdin();
  text = String(text || '').trim();
  if (!text) return 0;

  const cfg = readConfig();
  const name = s.hostName || cfg.name || 'host';

  try {
    await fetch(`${s.relayUrl}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.hostToken}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ kind, name, text }),
    });
  } catch {}
  return 0;
}

function readStdin() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    let timer = setTimeout(() => resolve(buf), 200);
    process.stdin.on('data', c => { buf += c; clearTimeout(timer); timer = setTimeout(() => resolve(buf), 50); });
    process.stdin.on('end',  () => { clearTimeout(timer); resolve(buf); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(buf); });
  });
}
