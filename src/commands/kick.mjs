// kick — host-only: remove a member by name.

import { readSession } from '../state.mjs';
import { info, error } from '../util/log.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') {
    error('not hosting; only the host can kick members');
    return 2;
  }
  const name = args.join(' ').trim();
  if (!name) {
    error('usage: collab-claw kick <name>');
    return 2;
  }
  const r = await fetch(`${s.relayUrl}/kicks`, {
    method : 'POST',
    headers: {
      'Authorization': `Bearer ${s.hostToken}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    error(`kick failed: ${r.status} ${body}`);
    return 1;
  }
  const j = await r.json();
  info(`kicked ${j.name}`);
  return 0;
}
