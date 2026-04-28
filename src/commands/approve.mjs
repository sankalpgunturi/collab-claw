// approve — host-only: approve a pending join request by id.

import { readSession } from '../state.mjs';
import { info, error } from '../util/log.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') {
    error('not hosting; only the host can approve join requests');
    return 2;
  }
  const id = (args[0] || '').trim();
  if (!id) {
    error('usage: collab-claw approve <requestId>');
    return 2;
  }
  const r = await fetch(`${s.relayUrl}/approvals`, {
    method : 'POST',
    headers: {
      'Authorization': `Bearer ${s.hostToken}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({ requestId: id }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    error(`approve failed: ${r.status} ${body}`);
    return 1;
  }
  const j = await r.json();
  info(`approved ${j.name}`);
  return 0;
}
