// post-tool — host-only: read a PreToolUse / PostToolUse hook input on
// stdin and forward a compact summary to the relay so joiners see what
// Claude is doing in real time.
//
//   collab-claw post-tool pre   <  hook-input.json
//   collab-claw post-tool post  <  hook-input.json
//
// Hook input shape (per Claude Code docs):
//
//   PreToolUse  : { tool_name, tool_input, ... }
//   PostToolUse : { tool_name, tool_input, tool_response, ... }
//
// We render a single line that's safe to display in any terminal.

import { readSession, readConfig } from '../state.mjs';

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') return 0;
  const phase = (args[0] || 'pre').trim();
  if (phase !== 'pre' && phase !== 'post') return 0;

  const raw = await readStdin();
  let input;
  try { input = JSON.parse(raw); } catch { return 0; }
  const tool  = input.tool_name || input.tool || 'tool';
  const tinp  = input.tool_input || input.input || {};
  const tres  = input.tool_response || input.response || null;

  const summary = renderToolSummary(tool, tinp);
  const status  = phase === 'post' ? renderToolStatus(tool, tres) : '';

  const cfg = readConfig();
  const name = s.hostName || cfg.name || 'host';

  const text = phase === 'pre'
    ? `wants to run ${tool}: ${summary}`
    : `${status} ${tool}: ${summary}`.trim();

  const payload = {
    kind: phase === 'pre' ? 'tool_pre' : 'tool_post',
    name,
    text,
    payload: { tool, summary, status: status || null },
  };

  try {
    await fetch(`${s.relayUrl}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.hostToken}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {}
  return 0;
}

function renderToolSummary(tool, input) {
  if (!input || typeof input !== 'object') return '';
  // Compact, single-line, max ~120 chars per field.
  const trim = s => {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > 200 ? s.slice(0, 197) + '…' : s;
  };
  switch (tool) {
    case 'Bash':       return trim(input.command);
    case 'Read':       return trim(input.file_path);
    case 'Write':      return trim(input.file_path);
    case 'Edit':
    case 'StrReplace': return trim(input.file_path || input.path);
    case 'Glob':       return trim(input.pattern || input.glob_pattern);
    case 'Grep':       return trim(`${input.pattern || ''} ${input.path ? `in ${input.path}` : ''}`);
    case 'WebFetch':   return trim(input.url);
    case 'WebSearch':  return trim(input.search_term || input.query);
    case 'TodoWrite':  return trim(`(${(input.todos || []).length} todos)`);
    default: {
      // Best-effort: stringify the smallest readable shape we can.
      try {
        const keys = Object.keys(input).slice(0, 3);
        const part = keys.map(k => `${k}=${trim(JSON.stringify(input[k]))}`).join(' ');
        return trim(part);
      } catch { return ''; }
    }
  }
}

function renderToolStatus(tool, tres) {
  if (tres == null) return '✓';
  if (typeof tres === 'object') {
    if (tres.is_error || tres.error) return '✗';
    if (tres.success === false) return '✗';
  }
  return '✓';
}

function readStdin() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => buf += c);
    process.stdin.on('end',  () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}
