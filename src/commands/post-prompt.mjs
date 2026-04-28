// post-prompt — host-only: forward a host's typed prompt to the relay so
// joiners see it in their transcript stream.
//
// Two invocation modes:
//   - args:        `collab-claw post-prompt <text words...>` (legacy/manual)
//   - hook stdin:  `collab-claw post-prompt --from-hook` reads stdin as the
//                  raw JSON Claude Code passes to UserPromptSubmit and
//                  extracts `.prompt` via JSON.parse — no jq/sed regex.
//   - bare stdin:  if no args and no flag, treat stdin as raw prompt text.
//
// Fail-open: errors exit 0 so we never block the host's local Claude.

import { readSession, readConfig } from '../state.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') return 0;

  const fromHook = args.includes('--from-hook');
  const positional = args.filter(a => !a.startsWith('--'));

  let text = '';
  if (positional.length > 0) {
    text = positional.join(' ');
  } else if (fromHook) {
    const raw = await readStdin();
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.prompt === 'string') text = obj.prompt;
    } catch {
      // Malformed hook input → fail-open, don't crash.
      return 0;
    }
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
