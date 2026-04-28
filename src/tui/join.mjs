// tui/join.mjs — full-screen-ish TUI for joiners.
//
// Layout (no buffering libraries; raw ANSI):
//
//   ┌────────────────────────────────────────────────────────────────┐
//   │ collab-claw  ·  room ABC123 · members: 3 · latency: 412ms      │  status (1 line)
//   ├────────────────────────────────────────────────────────────────┤
//   │ [Surya] please write a hello-world python script               │
//   │ ▸ Surya wants to run Write: hello.py                           │  scroll region
//   │ ✓ Surya: Write hello.py                                        │
//   │ [Surya] Done. Created hello.py with print("hello, world!").    │
//   │                                                                │
//   │ (round-trip: 412ms)                                            │
//   ├────────────────────────────────────────────────────────────────┤
//   │ Sankalp ▸ _                                                    │  prompt (last 2 rows)
//   └────────────────────────────────────────────────────────────────┘
//
// Behavior:
//   - SSE on /transcript-stream → renders one event per arriving line.
//   - readline on stdin (no echo into transcript area) → POST /prompts.
//   - Scroll region is the middle. Prompt is anchored to bottom 2 rows.
//   - On terminal resize: re-clear and re-anchor scroll region.
//   - Ctrl-C: POST /leaves, clear screen, exit clean.
//
// Best-effort: if process.stdout isn't a TTY, fall back to plain mode
// (just append events to stdout, read stdin lines).

import readline from 'node:readline';
import { clearSession } from '../state.mjs';
import { dim, bold, green, cyan, red, yellow, magenta } from '../util/log.mjs';

const ESC = '\x1b[';

const W = () => process.stdout.columns || 80;
const H = () => process.stdout.rows || 24;

// SGR helpers — these are duplicated from log.mjs's wrap helpers but force ANSI on
function inverse(s) { return `${ESC}7m${s}${ESC}0m`; }

function hideCursor() { process.stdout.write(`${ESC}?25l`); }
function showCursor() { process.stdout.write(`${ESC}?25h`); }
function moveTo(row, col) { process.stdout.write(`${ESC}${row};${col}H`); }
function clearScreen() { process.stdout.write(`${ESC}2J${ESC}H`); }
function clearLine() { process.stdout.write(`${ESC}2K`); }
function setScrollRegion(top, bottom) { process.stdout.write(`${ESC}${top};${bottom}r`); }
function resetScrollRegion() { process.stdout.write(`${ESC}r`); }
function saveCursor() { process.stdout.write(`${ESC}s`); }
function restoreCursor() { process.stdout.write(`${ESC}u`); }

const MAX_TRANSCRIPT_LINE = () => Math.max(40, W() - 2);

function wrap(s, width) {
  if (!s) return [''];
  const out = [];
  for (const para of String(s).split('\n')) {
    if (!para) { out.push(''); continue; }
    let i = 0;
    while (i < para.length) {
      out.push(para.slice(i, i + width));
      i += width;
    }
  }
  return out;
}

export async function startTui(session) {
  const tty = process.stdout.isTTY && process.stdin.isTTY;

  // Track members + latency for status bar
  let memberCount = 0;
  let lastLatencyMs = null;
  // Map: requestId-or-text-prefix → { sentAt } so we can compute round-trip
  // when our own prompt comes back as a response. We use the prompt text +
  // our member name to disambiguate.
  const pending = []; // [{ name, text, ts }]

  // Refresh members periodically
  const refreshMembers = async () => {
    try {
      const r = await fetch(`${session.relayUrl}/members`, {
        headers: { 'Authorization': `Bearer ${session.memberToken}` },
      });
      if (r.ok) {
        const j = await r.json();
        memberCount = (j.members || []).length;
        renderStatus();
      }
    } catch {}
  };
  await refreshMembers();
  const memberTimer = setInterval(refreshMembers, 5000);

  if (tty) startTtyMode();
  else      startPlainMode();

  // ---------- TTY mode ----------

  function startTtyMode() {
    hideCursor();
    clearScreen();
    setScrollRegion(2, H() - 2);
    moveTo(2, 1);

    process.stdout.on('resize', () => {
      clearScreen();
      setScrollRegion(2, H() - 2);
      moveTo(H() - 1, 1);
      renderStatus();
      renderPrompt('');
    });
  }

  function renderStatus() {
    if (!tty) return;
    saveCursor();
    moveTo(1, 1);
    clearLine();
    const left  = ` ${bold('collab-claw')} ${dim('·')} room ${session.roomId} ${dim('·')} members: ${memberCount}`;
    const right = lastLatencyMs == null ? '' : `latency: ${lastLatencyMs}ms `;
    const pad = Math.max(1, W() - stripAnsi(left).length - right.length);
    process.stdout.write(inverse(left + ' '.repeat(pad) + right));
    restoreCursor();
  }

  function renderTranscriptLine(line) {
    if (tty) {
      const lines = wrap(line, MAX_TRANSCRIPT_LINE());
      saveCursor();
      // Move into scroll region's last row, then write — terminal scrolls
      // the region for us.
      moveTo(H() - 2, 1);
      for (const l of lines) {
        process.stdout.write('\n' + l);
      }
      restoreCursor();
    } else {
      console.log(line);
    }
  }

  function renderPrompt(input) {
    if (!tty) return;
    saveCursor();
    moveTo(H() - 1, 1);
    clearLine();
    const prefix = `${bold(green(session.name))} ${dim('▸')} `;
    process.stdout.write(prefix + input);
    moveTo(H(), 1);
    clearLine();
    process.stdout.write(dim('  Ctrl-C to leave  ·  Enter to send'));
    moveTo(H() - 1, stripAnsi(prefix).length + 1 + input.length);
    showCursor();
    restoreCursor();
    // Re-position cursor to end of prompt input so user sees their typing
    moveTo(H() - 1, stripAnsi(prefix).length + 1 + input.length);
    showCursor();
  }

  function startPlainMode() {
    console.log(dim('# plain mode (not a TTY) — events stream below, type prompts to send'));
  }

  // ---------- input ----------

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  if (tty) {
    // Manual prompt rendering — disable readline's own prompt line
    rl.setPrompt('');
    moveTo(H() - 1, 1);
    renderStatus();
    renderPrompt('');
  } else {
    rl.setPrompt(`${session.name} > `);
    rl.prompt();
  }

  let inputBuf = '';
  if (tty) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async chunk => {
      for (const ch of chunk) {
        if (ch === '\u0003') { // Ctrl-C
          await teardown('user pressed Ctrl-C');
          return;
        }
        if (ch === '\r' || ch === '\n') {
          const text = inputBuf;
          inputBuf = '';
          renderPrompt('');
          if (text.trim()) await sendPrompt(text.trim());
          continue;
        }
        if (ch === '\u007f' || ch === '\b') { // backspace
          inputBuf = inputBuf.slice(0, -1);
          renderPrompt(inputBuf);
          continue;
        }
        if (ch === '\u0015') { // Ctrl-U (clear line)
          inputBuf = '';
          renderPrompt(inputBuf);
          continue;
        }
        // Ignore control sequences like arrow keys for v1
        if (ch.charCodeAt(0) < 0x20) continue;
        inputBuf += ch;
        renderPrompt(inputBuf);
      }
    });
  } else {
    rl.on('line', async line => {
      const text = line.trim();
      if (text) await sendPrompt(text);
      rl.prompt();
    });
    rl.on('close', () => teardown('rl close'));
  }

  // ---------- networking ----------

  async function sendPrompt(text) {
    const sentAt = Date.now();
    pending.push({ name: session.name, text, ts: sentAt });
    if (pending.length > 32) pending.shift();
    try {
      await fetch(`${session.relayUrl}/prompts`, {
        method : 'POST',
        headers: {
          'Authorization': `Bearer ${session.memberToken}`,
          'Content-Type' : 'application/json',
        },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      renderTranscriptLine(red(`! send failed: ${e.message}`));
    }
  }

  // SSE consumer for /transcript-stream
  let streamCtrl = new AbortController();
  let streamReader = null;
  async function consumeStream() {
    while (!streamCtrl.signal.aborted) {
      try {
        const r = await fetch(`${session.relayUrl}/transcript-stream`, {
          headers: {
            'Authorization': `Bearer ${session.memberToken}`,
            'Accept': 'text/event-stream',
          },
          signal: streamCtrl.signal,
        });
        if (r.status === 401) {
          // Token was invalidated server-side (kick or shutdown). Bail
          // out cleanly instead of reconnecting in a tight loop.
          renderTranscriptLine(red('! removed from room (auth rejected)'));
          await teardown('kicked');
          return;
        }
        if (!r.ok || !r.body) {
          renderTranscriptLine(red(`! transcript SSE bad status: ${r.status}`));
          await new Promise(rr => setTimeout(rr, 1000));
          continue;
        }
        const reader = r.body.getReader();
        streamReader = reader;
        const dec = new TextDecoder('utf-8');
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5).trimStart());
              renderEvent(ev);
            } catch {}
          }
        }
      } catch (e) {
        if (streamCtrl.signal.aborted) return;
        renderTranscriptLine(red(`! transcript SSE error: ${e.message}`));
        await new Promise(rr => setTimeout(rr, 1000));
      }
    }
  }
  consumeStream();

  function renderEvent(ev) {
    const kind = ev.kind;
    const name = String(ev.name || '');
    const text = String(ev.text || '');
    if (!text && kind !== 'system') return;

    if (kind === 'prompt') {
      renderTranscriptLine(`${bold(magenta(`[${name}]`))} ${text}`);
      return;
    }
    if (kind === 'response') {
      // Compute round-trip if we recently sent a prompt
      let lat = '';
      if (pending.length) {
        const first = pending.shift();
        const ms = Date.now() - first.ts;
        lastLatencyMs = ms;
        lat = ` ${dim(`(round-trip: ${ms}ms)`)}`;
        renderStatus();
      }
      renderTranscriptLine(`${bold(cyan(`[${name}]`))} ${text}${lat}`);
      return;
    }
    if (kind === 'tool_pre') {
      renderTranscriptLine(`${dim('▸')} ${dim(text)}`);
      return;
    }
    if (kind === 'tool_post') {
      renderTranscriptLine(`${dim('✓')} ${dim(text)}`);
      return;
    }
    if (kind === 'system') {
      renderTranscriptLine(`${yellow('[collab-claw]')} ${dim(text)}`);
      return;
    }
    renderTranscriptLine(`${dim(`[${kind}]`)} ${name ? bold(name) + ' ' : ''}${text}`);
  }

  // ---------- teardown ----------

  let toreDown = false;
  async function teardown(why) {
    if (toreDown) return;
    toreDown = true;
    try { streamCtrl.abort(); } catch {}
    try { streamReader && streamReader.cancel && streamReader.cancel(); } catch {}
    clearInterval(memberTimer);
    try {
      await fetch(`${session.relayUrl}/leaves`, {
        method : 'POST',
        headers: { 'Authorization': `Bearer ${session.memberToken}` },
      });
    } catch {}
    clearSession();
    if (tty) {
      resetScrollRegion();
      clearScreen();
      moveTo(1, 1);
      showCursor();
    }
    process.stdout.write(`${dim(`# left room (${why}).`)}\n`);
    process.exit(0);
  }

  process.on('SIGINT',  () => teardown('SIGINT'));
  process.on('SIGTERM', () => teardown('SIGTERM'));

  // Block forever (or until teardown)
  await new Promise(() => {});
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}
