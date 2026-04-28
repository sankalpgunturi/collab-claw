// log.mjs — minimal logging helpers. Plain text so they survive piping into
// Claude Code's hook context lines, monitor stdout, etc. ANSI colors are
// gated on an isatty check so they're auto-disabled when piped.

const isTty = !!process.stdout.isTTY;

const ESC = '\x1b[';
const wrap = code => isTty ? s => `${ESC}${code}m${s}${ESC}0m` : s => s;

export const dim   = wrap('2');
export const bold  = wrap('1');
export const red   = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const blue  = wrap('34');
export const magenta = wrap('35');
export const cyan  = wrap('36');

export function ts() { return new Date().toISOString(); }

export function info(...a)  { console.log(...a); }
export function warn(...a)  { console.error(yellow('warn:'), ...a); }
export function error(...a) { console.error(red('error:'), ...a); }
export function debug(...a) {
  if (process.env.COLLAB_CLAW_DEBUG) console.error(dim('[debug]'), ...a);
}

export function exit(code, message) {
  if (message) error(message);
  process.exit(code);
}
