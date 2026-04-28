// deny — host-only: deny a pending join request.

import { readSession } from '../state.mjs';
import { info, error } from '../util/log.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') {
    error('not hosting; only the host can deny join requests');
    return 2;
  }
  const id = (args[0] || '').trim();
  if (!id) {
    error('usage: collab-claw deny <requestId>');
    return 2;
  }
  const r = await fetch(`${s.relayUrl}/denials`, {
    method : 'POST',
    headers: {
      'Authorization': `Bearer ${s.hostToken}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({ requestId: id, reason: args.slice(1).join(' ') || 'denied' }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    error(`deny failed: ${r.status} ${body}`);
    return 1;
  }
  const j = await r.json();
  info(`denied ${j.name}`);
  return 0;
}
