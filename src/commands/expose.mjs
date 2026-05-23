// expose — opt-in cross-network tunnel via cloudflared.
//
// Wraps `cloudflared tunnel --url http://localhost:<port>` as a foreground
// process. Parses the public https URL out of cloudflared's stderr and
// prints a new join URL using that public host, with the same #secret as
// the current room.
//
// Keep running until Ctrl-C; on exit, kill cloudflared.
//
// Requirements:
//   - You must be hosting a room (session.json mode=host).
//   - `cloudflared` must be on PATH. If not, we print install hints and exit 1.
//
// Why a wrapper at all? Cloudflare's "Quick Tunnel" mode (no account, no
// config) is the lowest-friction way for teammates on different networks
// to reach the host. We don't store the tunnel in the host session.json —
// it's a transient overlay you can rerun whenever you need it.

import { spawn, spawnSync } from 'node:child_process';
import { readSession } from '../state.mjs';
import { info, error, warn, dim, bold, cyan } from '../util/log.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') {
    error('not hosting; run `/collab-claw:host` (or `collab-claw host`) first.');
    return 2;
  }

  // Parse host:port out of relayUrl
  let port;
  try {
    const u = new URL(s.relayUrl);
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch (e) {
    error(`bad relayUrl in session: ${s.relayUrl}`);
    return 1;
  }

  // Check cloudflared availability
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which',
                          ['cloudflared'], { encoding: 'utf8' });
  if (which.status !== 0 || !which.stdout.trim()) {
    error('cloudflared is not installed or not on PATH.');
    info('');
    info(dim('Install it with one of:'));
    info(dim('  brew install cloudflared                 # macOS'));
    info(dim('  https://github.com/cloudflare/cloudflared/releases  # all platforms'));
    info('');
    info(dim('Once installed, retry `collab-claw expose`.'));
    return 1;
  }

  info(dim(`starting cloudflared quick tunnel → http://localhost:${port} ...`));
  info(dim('(this may take a few seconds)'));

  const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let publicUrl = null;
  let printed = false;
  let buf = '';

  const onChunk = chunk => {
    buf += chunk;
    if (!publicUrl) {
      // cloudflared prints a banner like:
      //   |  https://random-words-here.trycloudflare.com
      const m = buf.match(/https:\/\/[A-Za-z0-9.-]+\.trycloudflare\.com/);
      if (m) {
        publicUrl = m[0];
        printBanner(publicUrl, s);
        printed = true;
      }
    }
    // Keep the buffer bounded — only the last 8KB matters for parsing.
    if (buf.length > 16 * 1024) buf = buf.slice(-8 * 1024);
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  child.on('exit', (code, sig) => {
    if (!printed) {
      error(`cloudflared exited (code=${code}, sig=${sig}) before a tunnel URL was detected.`);
      if (process.env.COLLAB_CLAW_DEBUG) {
        console.error('--- cloudflared output ---');
        console.error(buf);
      }
    }
    process.exit(code ?? 1);
  });

  child.on('error', e => {
    error(`cloudflared spawn error: ${e.message}`);
    process.exit(1);
  });

  // Relay SIGINT/SIGTERM through to cloudflared so it shuts down cleanly.
  const forward = sig => () => {
    info('');
    info(dim(`# stopping tunnel (${sig})`));
    try { child.kill(sig); } catch {}
  };
  process.on('SIGINT',  forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  // Block until the child exits.
  await new Promise(() => {});
}

function printBanner(publicUrl, session) {
  const joinUrl = `${publicUrl}#secret=${session.roomSecret}`;
  info('');
  info(bold('cross-network tunnel is up.'));
  info('');
  info(`  ${dim('public:')}   ${publicUrl}`);
  info(`  ${dim('roomId:')}   ${session.roomId}`);
  info('');
  info(`  ${bold('join URL (DM this to teammates on other networks):')}`);
  info(`  ${cyan(joinUrl)}`);
  info('');
  info(`  ${dim('Teammates run:')}`);
  info(`     ${dim(`collab-claw join ${joinUrl}`)}`);
  info('');
  info(`  ${dim('Keep this terminal open. Ctrl-C tears the tunnel down.')}`);
  info(`  ${dim('Your LAN URL ' + session.relayUrl + ' still works for local teammates.')}`);
  info('');
}
