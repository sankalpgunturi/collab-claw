// host — start a relay subprocess and write session.json (host mode).
//
// Idempotent: if a host session is already active and the relay is alive,
// re-print the current URL.
//
// The relay is spawned as a detached child so it survives this CLI exit.
// PID is recorded in session.json so `end` can clean it up.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { token32, shortRoomId } from '../util/crypto.mjs';
import { lanIp, isReachable } from '../util/net.mjs';
import { readSession, writeSession, readConfig } from '../state.mjs';
import { info, warn, error, dim, bold, cyan } from '../util/log.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RELAY = resolve(here, '..', 'relay', 'server.mjs');

export async function run(args) {
  const cfg = readConfig();
  const hostName = (cfg.name || process.env.USER || 'host').trim();
  const port = Number(process.env.COLLAB_CLAW_PORT || cfg.defaultRelayPort || 7474);
  const bindHost = process.env.COLLAB_CLAW_BIND || '0.0.0.0';

  // Idempotent: if we already have a host session, verify the relay is up
  // and re-print the URL.
  const existing = readSession();
  if (existing && existing.mode === 'host') {
    const alive = await isReachable(existing.relayUrl.replace(/^https?:\/\//, '').split(':')[0],
                                    Number(existing.relayUrl.split(':').pop()));
    if (alive) {
      info(dim('# already hosting; re-printing URL'));
      printBanner(existing);
      return 0;
    } else {
      warn('previous session.json found but relay is unreachable; starting fresh');
    }
  }

  const roomId      = shortRoomId();
  const roomSecret  = token32();
  const hostToken   = token32();
  const ip          = lanIp();
  const relayUrl    = `http://${ip}:${port}`;
  const joinUrl     = `${relayUrl}#secret=${roomSecret}`;

  const env = {
    ...process.env,
    COLLAB_CLAW_PORT       : String(port),
    COLLAB_CLAW_BIND       : bindHost,
    COLLAB_CLAW_HOST_TOKEN : hostToken,
    COLLAB_CLAW_ROOM_SECRET: roomSecret,
    COLLAB_CLAW_ROOM_ID    : roomId,
    COLLAB_CLAW_HOST_NAME  : hostName,
  };

  // Spawn detached: stdout/stderr go to /dev/null (or a log file if we want
  // to debug). The relay logs internally to stdout, but we don't want
  // those lines ending up in the host's terminal.
  const child = spawn(process.execPath, [RELAY], {
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();

  // Wait up to 3s for the relay to come up
  const ok = await waitForReachable('127.0.0.1', port, 3000);
  if (!ok) {
    error(`relay did not become reachable on 127.0.0.1:${port} within 3s.\n` +
          `port may be in use. try a different port:\n` +
          `  COLLAB_CLAW_PORT=7575 ${process.argv.slice(0, 2).join(' ')} host`);
    return 1;
  }

  const session = {
    v: 1,
    mode: 'host',
    roomId,
    roomSecret,
    hostToken,
    relayUrl,
    hostName,
    relayPid: child.pid,
    joinUrl,
  };
  writeSession(session);

  printBanner(session);
  return 0;
}

function printBanner(session) {
  info('');
  info(bold('collab-claw room is live.'));
  info('');
  info(`  ${dim('relay:')}    ${session.relayUrl}`);
  info(`  ${dim('host:')}     ${session.hostName}`);
  info(`  ${dim('roomId:')}   ${session.roomId}`);
  info('');
  info(`  ${bold('join URL (DM this to teammates):')}`);
  info(`  ${cyan(session.joinUrl)}`);
  info('');
  info(`  ${dim('Teammates run:')}`);
  info(`     ${dim(`collab-claw join ${session.joinUrl}`)}`);
  info('');
  info(`  ${dim('You can leave the host Claude session idle. Joiner prompts will arrive')}`);
  info(`  ${dim('as `[Name]: <text>` notifications and Claude will respond. End the room')}`);
  info(`  ${dim('with `/collab-claw:end` (or `collab-claw end` from any shell).')}`);
  info('');
}

async function waitForReachable(host, port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isReachable(host, port, 250)) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
