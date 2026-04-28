// leave — joiner only: notify the relay we're leaving and clear session.

import { readSession, clearSession } from '../state.mjs';
import { info, warn } from '../util/log.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'joiner') {
    info('not joined; nothing to do.');
    return 0;
  }
  try {
    await fetch(`${s.relayUrl}/leaves`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${s.memberToken}` },
    });
  } catch (e) {
    warn(`could not notify relay: ${e.message}`);
  }
  clearSession();
  info('left the room.');
  return 0;
}
