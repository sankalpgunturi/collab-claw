// expose — opt-in cross-network tunnel via cloudflared.
//
// Starts `cloudflared tunnel --url http://127.0.0.1:<port>` as a managed
// detached process by default. Parses the public https URL out of
// cloudflared's output and stores it in session.json so `status` and `end`
// know about it. `--foreground` keeps the old terminal-held behavior.
//
// Managed mode returns after the public URL is available; `collab-claw end`
// kills the tunnel. Foreground mode keeps running until Ctrl-C.
//
// Requirements:
//   - You must be hosting a room (session.json mode=host).
//   - `cloudflared` must be on PATH. If not, we print install hints and exit 1.
//
// Why a wrapper at all? Cloudflare's "Quick Tunnel" mode (no account, no
// config) is the lowest-friction way for teammates on different networks
// to reach the host.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { readSession, writeSession, CONFIG_DIR } from '../state.mjs';
import { info, error, dim, bold, cyan } from '../util/log.mjs';

const PUBLIC_URL_RE = /https:\/\/[A-Za-z0-9.-]+\.trycloudflare\.com/;

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

  const foreground = args.includes('--foreground') || args.includes('-f');
  const cloudflared = findCloudflared();
  if (!cloudflared) {
    error('cloudflared is not installed or not on PATH.');
    info('');
    info(dim('Install it with one of:'));
    info(dim('  brew install cloudflared                 # macOS'));
    info(dim('  https://github.com/cloudflare/cloudflared/releases  # all platforms'));
    info('');
    info(dim('Once installed, retry `collab-claw expose`.'));
    return 1;
  }

  if (!foreground && s.tunnelPid && s.publicJoinUrl && isProcessAlive(s.tunnelPid)) {
    info(dim('# tunnel already running; re-printing public URL'));
    printBanner(s.publicTunnelUrl || publicUrlFromJoinUrl(s.publicJoinUrl), s, { managed: true });
    return 0;
  }

  return foreground
    ? runForeground({ session: s, port, cloudflared })
    : runManaged({ session: s, port, cloudflared });
}

function findCloudflared() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which',
                          ['cloudflared'], { encoding: 'utf8' });
  if (which.status !== 0 || !which.stdout.trim()) return null;
  return which.stdout.trim().split(/\r?\n/)[0];
}

async function runManaged({ session, port, cloudflared }) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const logFile = join(CONFIG_DIR, `cloudflared-${session.roomId}.log`);
  writeFileSync(logFile, '', { mode: 0o600 });
  chmodSync(logFile, 0o600);
  const fd = openSync(logFile, 'a');

  info(dim(`starting managed cloudflared quick tunnel → http://127.0.0.1:${port} ...`));
  info(dim('(this may take a few seconds)'));

  let child;
  try {
    child = spawn(cloudflared, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      detached: true,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  child.unref();

  const timeoutMs = Number(process.env.COLLAB_CLAW_TUNNEL_TIMEOUT_MS || 20000);
  const publicUrl = await waitForPublicUrl(logFile, child.pid, timeoutMs);
  if (!publicUrl) {
    killPidGroup(child.pid, 'SIGTERM');
    error(`cloudflared did not print a trycloudflare URL within ${timeoutMs}ms.`);
    info(dim(`log: ${logFile}`));
    return 1;
  }

  const publicJoinUrl = `${publicUrl}#secret=${session.roomSecret}`;
  const next = writeSession({
    ...session,
    publicTunnelUrl: publicUrl,
    publicJoinUrl,
    tunnelProvider: 'cloudflared',
    tunnelPid: child.pid,
    tunnelLog: logFile,
    tunnelStartedAt: new Date().toISOString(),
  });
  printBanner(publicUrl, next, { managed: true });
  return 0;
}

async function runForeground({ session, port, cloudflared }) {
  info(dim(`starting cloudflared quick tunnel → http://127.0.0.1:${port} ...`));
  info(dim('(this may take a few seconds)'));

  const child = spawn(cloudflared, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
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
      const m = buf.match(PUBLIC_URL_RE);
      if (m) {
        publicUrl = m[0];
        printBanner(publicUrl, session, { managed: false });
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

async function waitForPublicUrl(logFile, pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let txt = '';
    try { txt = readFileSync(logFile, 'utf8'); } catch {}
    const m = txt.match(PUBLIC_URL_RE);
    if (m) return m[0];
    if (pid && !isProcessAlive(pid)) return null;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPidGroup(pid, sig) {
  if (!pid) return;
  try { process.kill(-pid, sig); return; } catch {}
  try { process.kill(pid, sig); } catch {}
}

function publicUrlFromJoinUrl(joinUrl) {
  try {
    const u = new URL(joinUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function printBanner(publicUrl, session, { managed }) {
  const joinUrl = session.publicJoinUrl || `${publicUrl}#secret=${session.roomSecret}`;
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
  if (managed) {
    info(`  ${dim('The tunnel is running in the background and will stop when you end the room.')}`);
  } else {
    info(`  ${dim('Keep this terminal open. Ctrl-C tears the tunnel down.')}`);
  }
  info(`  ${dim('Your LAN URL ' + session.relayUrl + ' still works for local teammates.')}`);
  info('');
}
