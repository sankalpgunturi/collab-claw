// post-prompt — host-only: forward a host's typed prompt to the relay so
// joiners see it in their transcript stream.
//
// Called from the UserPromptSubmit hook with the prompt text on argv (or
// stdin). The hook itself is fail-open: errors here exit 0 so we never
// block the host's local Claude.

import { readSession, readConfig } from '../state.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') return 0; // not hosting, no-op

  let text = '';
  if (args.length > 0) {
    text = args.join(' ');
  } else {
    text = await readStdin();
  }
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
      body: JSON.stringify({ kind: 'prompt', name, text }),
    });
  } catch {} // fail-open
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
