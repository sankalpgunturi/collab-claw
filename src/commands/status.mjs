// status — report current session state. Useful from any shell.

import { readSession, readConfig } from '../state.mjs';
import { info, dim, bold, cyan } from '../util/log.mjs';

export async function run(args) {
  const cfg = readConfig();
  const s = readSession();

  info(`${dim('name:')}    ${cfg.name || dim('(not set; run `collab-claw set-name <name>`)')}`);
  if (!s) {
    info(`${dim('session:')} ${dim('(none)')}`);
    return 0;
  }

  info(`${dim('mode:')}    ${bold(s.mode)}`);
  info(`${dim('roomId:')}  ${s.roomId}`);
  info(`${dim('relay:')}   ${cyan(s.relayUrl)}`);

  if (s.mode === 'host') {
    info(`${dim('joinUrl:')} ${cyan(s.joinUrl || `${s.relayUrl}#secret=${s.roomSecret}`)}`);
    try {
      const r = await fetch(`${s.relayUrl}/members`, {
        headers: { 'Authorization': `Bearer ${s.hostToken}` },
      });
      if (r.ok) {
        const j = await r.json();
        info(`${dim('members:')}  ${j.members.length}`);
        for (const m of j.members) info(`  - ${m.name} ${dim(`(joined ${m.joinedAt})`)}`);
      }
    } catch {}
  } else if (s.mode === 'joiner') {
    info(`${dim('me:')}      ${s.name}`);
    try {
      const r = await fetch(`${s.relayUrl}/members`, {
        headers: { 'Authorization': `Bearer ${s.memberToken}` },
      });
      if (r.ok) {
        const j = await r.json();
        info(`${dim('host:')}    ${j.host}`);
        info(`${dim('members:')}  ${j.members.length}`);
        for (const m of j.members) info(`  - ${m.name}`);
      }
    } catch {}
  }
  return 0;
}
