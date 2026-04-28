// join — joiner side: parse the URL, run pairing handshake, then start the TUI.
//
// URL shape (issued by `collab-claw host`):
//
//    http://10.0.0.42:7474#secret=<base64url>
//
// The fragment never reaches the relay's logs (browsers/curl strip it),
// but we use it as the room secret to prove we got an invite.

import { readConfig } from '../state.mjs';
import { writeSession } from '../state.mjs';
import { isReachable } from '../util/net.mjs';
import { error, info, dim, bold, cyan, yellow } from '../util/log.mjs';
import { startTui } from '../tui/join.mjs';

export async function run(args) {
  const url = (args[0] || '').trim();
  if (!url) {
    error('usage: collab-claw join <url>');
    return 2;
  }

  const cfg = readConfig();
  const name = (cfg.name || '').trim();
  if (!name) {
    error('no display name set. run: collab-claw set-name <YourName>');
    return 2;
  }

  let parsed;
  try { parsed = new URL(url); }
  catch { error(`bad url: ${url}`); return 2; }
  const m = (parsed.hash || '').match(/secret=([^&]+)/);
  if (!m) {
    error('url is missing #secret=...; did your host paste the full URL?');
    return 2;
  }
  const roomSecret = decodeURIComponent(m[1]);
  const relayUrl = `${parsed.protocol}//${parsed.host}`;

  // Probe the relay
  const host = parsed.hostname;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  info(dim(`probing ${relayUrl} ...`));
  const ok = await isReachable(host, port, 3000);
  if (!ok) {
    error(`could not reach ${relayUrl}.\n` +
          `  - is the host's room still running?\n` +
          `  - same wifi/network?\n` +
          `  - host firewall allowing port ${port}?`);
    return 1;
  }

  // Pairing: POST /join-requests
  let reqId;
  try {
    const r = await fetch(`${relayUrl}/join-requests`, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${roomSecret}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      error(`join-request rejected: ${r.status} ${body}`);
      return 1;
    }
    const j = await r.json();
    reqId = j.requestId;
  } catch (e) {
    error(`join-request failed: ${e.message}`);
    return 1;
  }

  info('');
  info(bold(`Asked to join as "${name}".`));
  info(yellow('Waiting for host approval...'));
  info(dim(`(host runs: /collab-claw:approve ${reqId})`));
  info('');

  let approved;
  try {
    const r = await fetch(`${relayUrl}/join-requests/${reqId}/wait`, {
      headers: { 'Authorization': `Bearer ${reqId}` },
    });
    approved = await r.json();
  } catch (e) {
    error(`wait failed: ${e.message}`);
    return 1;
  }

  if (!approved || !approved.approved) {
    error(`not admitted: ${approved && approved.reason || 'unknown'}`);
    return 1;
  }

  const session = {
    v: 1,
    mode: 'joiner',
    roomId: approved.roomId,
    relayUrl,
    memberToken: approved.memberToken,
    memberId   : approved.memberId,
    name       : approved.name || name,
  };
  writeSession(session);

  info(cyan(`Joined ${approved.roomId}. Press Ctrl-C to leave.`));

  // Hand off to the TUI
  await startTui(session);
  return 0;
}
