// cli.mjs — top-level dispatcher.
//
// Subcommands:
//
//   collab-claw set-name <name>        — store your display name
//   collab-claw host                   — start a room (used by plugin's bin/collab-claw-host)
//   collab-claw end                    — end your hosted room
//   collab-claw join <url>             — join a room as a teammate (TUI)
//   collab-claw leave                  — leave the current room
//   collab-claw status                 — show room state
//   collab-claw approve <requestId>    — approve a pending join (host)
//   collab-claw deny <requestId>       — deny a pending join    (host)
//   collab-claw kick <name>            — remove a member        (host)
//   collab-claw post-prompt <text>     — host-only: post a hook prompt event
//   collab-claw post-event <kind> <text>  — host-only: post an arbitrary event
//   collab-claw post-tool <pre|post> <json>  — host-only: post tool event
//   collab-claw post-stop              — host-only: read transcript_path from
//                                        stdin JSON, post last assistant text
//   collab-claw monitor                — host-only: long-running session-gated
//                                        SSE consumer that prints `[Name]: text`
//                                        lines to stdout for Claude to wake on
//   collab-claw version                — print version
//   collab-claw help                   — print this help

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { error, info } from './util/log.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg  = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'));

const HELP = `collab-claw v${pkg.version}

Usage:
  collab-claw set-name <name>
  collab-claw host
  collab-claw end
  collab-claw join <url>
  collab-claw leave
  collab-claw status
  collab-claw approve <requestId>
  collab-claw deny <requestId>
  collab-claw kick <name>

Plugin-internal (don't run directly unless you know why):
  collab-claw monitor
  collab-claw post-prompt <text>
  collab-claw post-event <kind> <text>
  collab-claw post-tool <pre|post>
  collab-claw post-stop

Other:
  collab-claw version
  collab-claw help

Set your display name once, then your friends host or join rooms with:

  $ collab-claw set-name Sankalp                # one-time
  $ claude /collab-claw:host                    # if hosting
  $ collab-claw join http://10.0.0.42:7474#secret=...   # if joining
`;

export async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    info(HELP); return 0;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    info(`collab-claw v${pkg.version}`); return 0;
  }

  try {
    switch (cmd) {
      case 'set-name': {
        const { run } = await import('./commands/set-name.mjs');
        return run(args);
      }
      case 'host': {
        const { run } = await import('./commands/host.mjs');
        return run(args);
      }
      case 'end': {
        const { run } = await import('./commands/end.mjs');
        return run(args);
      }
      case 'join': {
        const { run } = await import('./commands/join.mjs');
        return run(args);
      }
      case 'leave': {
        const { run } = await import('./commands/leave.mjs');
        return run(args);
      }
      case 'status': {
        const { run } = await import('./commands/status.mjs');
        return run(args);
      }
      case 'approve': {
        const { run } = await import('./commands/approve.mjs');
        return run(args);
      }
      case 'deny': {
        const { run } = await import('./commands/deny.mjs');
        return run(args);
      }
      case 'kick': {
        const { run } = await import('./commands/kick.mjs');
        return run(args);
      }
      case 'monitor': {
        const { run } = await import('./commands/monitor.mjs');
        return run(args);
      }
      case 'post-prompt': {
        const { run } = await import('./commands/post-prompt.mjs');
        return run(args);
      }
      case 'post-event': {
        const { run } = await import('./commands/post-event.mjs');
        return run(args);
      }
      case 'post-tool': {
        const { run } = await import('./commands/post-tool.mjs');
        return run(args);
      }
      case 'post-stop': {
        const { run } = await import('./commands/post-stop.mjs');
        return run(args);
      }
      default:
        error(`unknown command: ${cmd}`);
        info(HELP);
        return 2;
    }
  } catch (e) {
    error(e && e.message || String(e));
    if (process.env.COLLAB_CLAW_DEBUG) {
      console.error(e && e.stack || e);
    }
    return 1;
  }
}
