// end — tear down the hosted room.
//
// Sends POST /shutdown to the relay (clean exit) and deletes session.json.
// Falls back to SIGTERM on the relay PID if HTTP shutdown fails.

import { readSession, clearSession } from '../state.mjs';
import { info, warn, error, dim } from '../util/log.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') {
    info('not hosting; nothing to end.');
    return 0;
  }

  let httpOk = false;
  try {
    const r = await fetch(`${s.relayUrl}/shutdown`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${s.hostToken}` },
    });
    httpOk = r.ok;
  } catch (e) {
    warn(`http shutdown failed: ${e.message}; will try signal`);
  }

  if (!httpOk && s.relayPid) {
    try { process.kill(s.relayPid, 'SIGTERM'); }
    catch (e) {
      warn(`SIGTERM to pid ${s.relayPid} failed: ${e.code || e.message}`);
    }
  }

  clearSession();
  info(dim(`room ended (relayPid=${s.relayPid || 'n/a'}).`));
  return 0;
}
