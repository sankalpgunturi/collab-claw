// post-stop — host-only: read a Stop hook input on stdin and post the last
// assistant message to /events as a `response` event so joiners see it.
//
// Resolution order, fast-to-robust:
//   1. `input.last_assistant_message` — Claude Code provides this directly
//      in the Stop hook input as of recent versions. When present, this is
//      the cheapest, most reliable source of truth.
//   2. Parse the JSONL transcript at `input.transcript_path` (tail-read,
//      handle several transcript shapes seen in Claude Code 2.x). This
//      stays as a fallback for older Claude Code builds and for any case
//      where (1) is missing/empty.
//
// Fail-open: any error → exit 0. Never block the host's Claude turn.

import { readSession, readConfig } from '../state.mjs';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';

const MAX_BYTES_TO_READ = 4 * 1024 * 1024; // 4 MB tail of transcript

export async function run(args) {
  const s = readSession();
  if (!s || s.mode !== 'host') return 0;

  const raw = await readStdin();
  let input;
  try { input = JSON.parse(raw); } catch { return 0; }

  let text = '';

  if (input && typeof input.last_assistant_message === 'string') {
    text = input.last_assistant_message.trim();
  } else if (input && input.last_assistant_message && typeof input.last_assistant_message === 'object') {
    text = pickAssistantText({ role: 'assistant', content: input.last_assistant_message.content ?? input.last_assistant_message });
  }

  if (!text) {
    const tp = input && input.transcript_path;
    if (tp && existsSync(tp)) {
      text = extractLastAssistantText(tp);
    }
  }

  if (!text) return 0;

  const cfg = readConfig();
  const name = s.hostName || cfg.name || 'host';

  try {
    await fetch(`${s.relayUrl}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.hostToken}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ kind: 'response', name, text }),
    });
  } catch {}
  return 0;
}

function extractLastAssistantText(path) {
  try {
    const stat = statSync(path);
    let buf;
    if (stat.size <= MAX_BYTES_TO_READ) {
      buf = readFileSync(path, 'utf8');
    } else {
      const fd = openSync(path, 'r');
      const sliceLen = MAX_BYTES_TO_READ;
      const start = stat.size - sliceLen;
      const tmp = Buffer.alloc(sliceLen);
      readSync(fd, tmp, 0, sliceLen, start);
      closeSync(fd);
      buf = tmp.toString('utf8');
      buf = buf.slice(buf.indexOf('\n') + 1);
    }
    const lines = buf.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const text = pickAssistantText(obj);
      if (text) return text;
    }
  } catch {}
  return '';
}

/**
 * Robust against several transcript shapes seen in Claude Code 2.x:
 *   - { type: "assistant", message: { content: [{type:"text", text:"..."}] } }
 *   - { role: "assistant", content: [{type:"text", text:"..."}] }
 *   - { role: "assistant", content: "..." }
 *   - older shapes with .text directly
 */
function pickAssistantText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const role = obj.role || (obj.message && obj.message.role) || obj.type || '';
  if (role !== 'assistant') return '';
  const content = (obj.message && obj.message.content) ?? obj.content ?? obj.text ?? '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(p => p && (p.type === 'text' || typeof p.text === 'string'))
      .map(p => p.text || '')
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text.trim();
  }
  return '';
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
