// history — show events from a persisted room log.
//
// Reads ~/.collab-claw/log/<roomId>.jsonl, one JSON event per line.
//
//   collab-claw history                  → tail current room (from session.json)
//                                          or list available rooms if no session
//   collab-claw history <roomId>         → all events from that room
//   collab-claw history --limit=N        → last N lines (default 200)
//   collab-claw history --json           → raw jsonl on stdout

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readSession } from '../state.mjs';
import { info, error, dim, bold, cyan, magenta, yellow } from '../util/log.mjs';

const LOG_DIR = process.env.COLLAB_CLAW_LOG_DIR || join(homedir(), '.collab-claw', 'log');

export async function run(args) {
  let roomId = null;
  let limit  = 200;
  let asJson = false;

  for (const a of args) {
    if (a === '--json') asJson = true;
    else if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isFinite(n) || n <= 0) {
        error('--limit must be a positive integer');
        return 2;
      }
      limit = n;
    } else if (!a.startsWith('-')) {
      roomId = a;
    }
  }

  if (!roomId) {
    const s = readSession();
    if (s && s.roomId) roomId = s.roomId;
  }

  if (!roomId) {
    return listRooms(asJson);
  }

  const path = join(LOG_DIR, `${roomId}.jsonl`);
  if (!existsSync(path)) {
    error(`no log for room "${roomId}". try \`collab-claw history\` to list rooms.`);
    return 1;
  }

  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    error(`could not read ${path}: ${e.message}`);
    return 1;
  }

  const lines = raw.split('\n').filter(Boolean);
  const tail  = lines.slice(-limit);

  if (asJson) {
    for (const line of tail) info(line);
    return 0;
  }

  info(dim(`# ${tail.length} events from ${path} (showing last ${Math.min(limit, lines.length)} of ${lines.length})`));
  info('');
  for (const line of tail) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    info(formatEvent(ev));
  }
  return 0;
}

function listRooms(asJson) {
  if (!existsSync(LOG_DIR)) {
    info(dim('# no rooms logged yet'));
    return 0;
  }
  let entries;
  try { entries = readdirSync(LOG_DIR); }
  catch (e) { error(`could not read ${LOG_DIR}: ${e.message}`); return 1; }

  const rooms = entries
    .filter(n => n.endsWith('.jsonl'))
    .map(n => {
      const p = join(LOG_DIR, n);
      let st = null;
      try { st = statSync(p); } catch {}
      return { roomId: n.slice(0, -'.jsonl'.length), path: p, size: st?.size || 0, mtime: st?.mtime || null };
    })
    .sort((a, b) => (b.mtime?.getTime() || 0) - (a.mtime?.getTime() || 0));

  if (asJson) {
    info(JSON.stringify({ rooms }, null, 2));
    return 0;
  }

  if (rooms.length === 0) {
    info(dim('# no rooms logged yet'));
    return 0;
  }
  info(dim(`# ${rooms.length} room log(s) in ${LOG_DIR}:`));
  info('');
  for (const r of rooms) {
    const when = r.mtime ? r.mtime.toISOString() : '?';
    info(`  ${bold(r.roomId)}  ${dim(`(${r.size}B, last write ${when})`)}`);
  }
  info('');
  info(dim('  collab-claw history <roomId>          # show events'));
  info(dim('  collab-claw history <roomId> --json   # raw jsonl'));
  return 0;
}

function formatEvent(ev) {
  const ts = ev.ts || '';
  const kind = ev.kind || '?';
  const name = ev.name || '';
  const text = String(ev.text || '').replace(/\r/g, '').replace(/\n/g, '\n    ');
  const prefix = `${dim(ts)}  `;
  if (kind === 'prompt') {
    return `${prefix}${magenta(`[${name}]`)} ${text}`;
  }
  if (kind === 'response') {
    return `${prefix}${cyan(`[${name}]`)} ${text}`;
  }
  if (kind === 'tool_pre') {
    return `${prefix}${dim('▸ ' + text)}`;
  }
  if (kind === 'tool_post') {
    return `${prefix}${dim('✓ ' + text)}`;
  }
  if (kind === 'system') {
    return `${prefix}${yellow('[collab-claw]')} ${dim(text)}`;
  }
  return `${prefix}${dim(`[${kind}]`)} ${name ? bold(name) + ' ' : ''}${text}`;
}
