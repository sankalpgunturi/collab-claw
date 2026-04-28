// set-name — store the user's display name in ~/.collab-claw/config.json
//
//   $ collab-claw set-name Sankalp

import { setName, getName } from '../state.mjs';
import { info } from '../util/log.mjs';

export function run(args) {
  if (args.length === 0) {
    const cur = getName();
    info(cur ? `current name: ${cur}` : 'no name set. usage: collab-claw set-name <name>');
    return cur ? 0 : 2;
  }
  const name = args.join(' ').trim();
  setName(name);
  info(`name set to "${name}"`);
  return 0;
}
