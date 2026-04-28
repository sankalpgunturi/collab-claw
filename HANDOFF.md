# HANDOFF — collab-claw v0.1.2

Status: **shipped + hardened twice**. v1 is live at
`github.com/sankalpgunturi/collab-claw`. All five test suites pass (77
cases). The marketplace install path is verified. The eight findings
from the first v1 review are resolved (see "Review fixes (v0.1.1)") and
the three follow-up findings from the second review are resolved (see
"Review fixes (v0.1.2)").

## What you can do right now

### As a host (with Claude Code)

```bash
# 1. Install the CLI globally (from your local checkout)
cd ~/Repositories/collab-claw
npm link

# 2. Install the plugin in Claude Code
claude
> /plugin marketplace add sankalpgunturi/collab-claw
> /plugin install collab-claw

# 3. Restart claude, set your name, host
collab-claw set-name Surya
claude
> /collab-claw:host
```

You'll get a join URL like `http://10.0.0.42:7474#secret=...`. DM it to
teammates and keep working with Claude as usual.

### As a joiner (no Claude Code needed)

```bash
cd ~/Repositories/collab-claw   # or wherever your teammate cloned
npm link                         # one-time
collab-claw set-name Sankalp     # one-time
collab-claw join <URL Surya DMd you>
```

Surya will see `[collab-claw] Sankalp wants to join...` and run
`/collab-claw:approve <id>`. Then your TUI lights up.

### Other commands (any time)

```bash
collab-claw status     # show current room state
collab-claw leave      # joiner leaves
collab-claw end        # host tears down the room
collab-claw kick Eve   # host removes a member
```

## Review fixes (v0.1.1)

Eight findings, all addressed:

1. **Joiner prompts no longer drop during monitor reconnect windows.**
   The relay queues prompts with monotonic seq numbers, and the host
   monitor uses standard SSE `Last-Event-ID` to resume from where it
   left off. Prompts that arrive while no monitor is connected are
   replayed as soon as one connects. (`#1` in `test/regressions.mjs`)

2. **Single host-monitor subscriber is enforced server-side.** A new
   `/prompt-stream` connect evicts any existing one (last-writer-wins),
   so a stale post-`/plugin reload` monitor can't double-deliver
   prompts to Claude. (Originally also had a client-side PID lock; that
   was removed in v0.1.2 — it caused worse problems than it solved. See
   v0.1.2 fix #1 below.) (`#2`)

3. **Kicked members' transcript SSE is closed by the relay.** The
   transcript-stream subscriber map now stores `(res, memberId)`, so
   `/kicks` and `/leaves` find and end exactly that member's open
   streams. The joiner TUI also detects 401 on reconnect and exits
   cleanly. (`#3`)

4. **Join-request names are validated server-side** with the same
   regex the CLI uses (1–32 chars, alphanumeric/space/_/-). System
   announcements emit `kind=system` with NO `name` field; the monitor
   renders them as `[collab-claw] <text>` (single brackets), matching
   what the host SKILL teaches Claude. The earlier
   `[[collab-claw]]: ...` regression is fixed. (`#4a`, `#4b`)

5. **Multiline joiner prompts arrive as one notification.** The
   monitor escapes `\n` to a literal `\n` sequence before writing to
   stdout, so Claude Code's monitor framework attributes the whole
   prompt to one named teammate. (`#5`)

6. **Plugin shims renamed to unique names** (`collab-claw-host`,
   `collab-claw-end`, etc.) so they don't collide with system
   binaries like `host` (DNS). SKILLs and `allowed-tools:
   Bash(collab-claw-X:*)` updated accordingly.

7. **Stop hook prefers `last_assistant_message` from the hook input**
   when present, falling back to JSONL transcript parsing only when
   needed.

8. **`prompt-submit` no longer depends on jq/sed.** The hook pipes
   stdin straight into `collab-claw post-prompt --from-hook`, which
   uses `JSON.parse` to extract the prompt. Robust on multiline and
   quote-escaped input.

## Review fixes (v0.1.2)

Three follow-up findings, all addressed:

1. **Removed the global monitor PID lock.** Earlier defense-in-depth
   actually caused the bug it was meant to prevent: every Claude Code
   session spawns a monitor (because `when: always`), so in a
   multi-session setup the first idle monitor would grab
   `~/.collab-claw/monitor.pid` and starve the actually-hosting
   session's monitor. Worse, that idle monitor would later see
   `session.json` flip to host mode and start emitting joiner prompts
   to its own (idle) Claude window. The fix:

   - Drop the PID file entirely. Relay-side single-subscriber on
     `/prompt-stream` (last-writer-wins) is the only enforcement.
   - Add a `process.stdout.on('error', …)` handler so monitors whose
     parent Claude session has closed the stdout pipe exit cleanly on
     EPIPE — the next live monitor naturally takes over via the
     relay's eviction logic.

   `test/monitor-gate.mjs` now asserts no `monitor.pid` is created.

2. **Backpressure no longer counted as non-delivery.** Node's
   `res.write()` returns `false` when its internal buffer is full but
   the data is still queued for delivery. Old code only counted writes
   that returned `true`, so a slow monitor could leave
   `lastDeliveredPromptSeq` stuck and trigger duplicate replays on the
   next reconnect. `fanoutMap()` and the `/prompt-stream` replay loop
   now count any non-throwing write as delivered.

   Covered by `test/regressions.mjs` `#7` (lastDeliveredPromptSeq
   advances for a live subscriber).

3. **Stale join announcements no longer replay after approval/denial.**
   `/join-requests` enqueues a `kind=system` "X wants to join" event
   into the prompt queue so reconnecting monitors don't miss it. But
   if the request was already approved or denied by the time the
   monitor connects, replaying that announcement would prompt Claude
   to try to approve a no-longer-pending request. The replay path now
   filters those out by checking `joinRequests.get(requestId).status`.

   Covered by `test/regressions.mjs` `#6`.

## What's known to work (verified by tests)

- **Relay**: 12 user-facing routes plus `/healthz`, `/info`, and a
  test-only `/debug/requests`. Bearer auth (host token / member
  token / request-id / room secret), SSE keepalives, ring buffer for
  backfill, prompt queue with `Last-Event-ID` replay,
  single-subscriber `/prompt-stream`, backpressure-tolerant delivery
  counting, stale-system-event filtering on replay, proper 401/404/409
  handling. (`test/smoke.mjs` 21 cases + `test/regressions.mjs` 29
  cases)

- **Pairing handshake**: joiner POSTs `/join-requests` with the room
  secret → long-polls `/wait` → host approves via host token →
  joiner's `wait` resolves with their member token. Member tokens never
  pass through the host's plugin or Claude Code transcript.
  (`test/smoke.mjs`)

- **CLI host/join/approve/end loop**: full local round-trip including
  the Stop hook reading a fake transcript and posting the response.
  (`test/e2e-cli.mjs`, 18 cases)

- **Tool call mirroring**: `PreToolUse` and `PostToolUse` hooks render
  `▸ wants to run Bash: <cmd>` and `✓ Bash: <cmd>` lines that joiners
  see live. (`test/e2e-cli.mjs`)

- **Monitor session-state gate** (the critical Spike B/C finding):
  - **Negative control**: gate closed (no session.json) → prompts
    posted to relay are NOT delivered to monitor stdout.
  - **Positive control**: gate open → monitor opens SSE, emits
    `[Name]: <text>` lines that wake an idle Claude.
  - **Mid-stream close**: deleting session.json while events are in
    flight drops them before they reach stdout.
  - **No client-side singleton**: the monitor must not write
    `~/.collab-claw/monitor.pid` (removed in v0.1.2; see v0.1.2 fix
    #1).
    (`test/monitor-gate.mjs`, 6 cases)

- **TUI plain mode**: when stdin/stdout aren't TTYs, the joiner CLI
  falls back to readline prompts and plain-text event rendering.
  (`test/tui-plain.mjs`, 3 cases)

- **Regression coverage** for both review rounds — queue replay,
  singleton, kicked SSE close, name validation, system format,
  multiline encoding, stale-system-event skip on replay, and
  delivery counting under backpressure. (`test/regressions.mjs`,
  29 cases)

- **Marketplace install path**: a fresh `git clone` of the published
  repo has the right layout, executable bits on all bin/ scripts, and
  `npm test` passes clean.

## What's known to be rough (deferred to v1.1)

- **Cross-network**: the relay binds 0.0.0.0 so it's reachable on the
  LAN, but if your teammates are on different networks you need to
  manually tunnel (Cloudflared, ngrok, etc). A `collab-claw expose`
  subcommand that wraps `cloudflared tunnel --url` is on the roadmap.

- **Persistence**: transcripts only live in the relay's in-memory ring
  buffer (last 200 events). Restarting the host loses everything.
  v1.1 will optionally write `~/.collab-claw/log/<roomId>.jsonl`.

- **Markdown rendering**: the TUI shows event text verbatim. Code
  blocks come through as raw triple-backticks. Want a tasteful subset
  (bold, inline-code highlight, code-block fencing) — not the full
  CommonMark.

- **Reconnection**: if the host's laptop sleeps or the relay dies, the
  joiner CLIs see the SSE close and silently retry. They don't notify
  the user clearly. v1.1 needs a "host went offline" state in the
  status bar.

- **Multi-room / multi-host**: each `collab-claw host` starts one
  relay listening on one port. If the host wants to run two parallel
  rooms, they'd need to manually set `COLLAB_CLAW_PORT`. Not designed
  for it; one room per machine is fine.

- **The TUI status bar**: shows member count and last round-trip
  latency, but not who's currently typing or who joined recently.
  Would be nice to have presence indicators.

- **No automated full-Claude integration test**. We've validated every
  layer except the actual `[Name]: <text>` → idle Claude wakeup, but
  Spike B already proved that path works (see `SPIKE_B_RESULTS.md`).
  When you wake up, give it a real spin: host with Claude, join from
  another terminal, send a prompt, confirm Claude wakes and responds.

## Critical files (in order of complexity)

1. `src/relay/server.mjs` — the 12-route relay. Most product logic
   lives here. ~480 lines.

2. `src/tui/join.mjs` — raw-ANSI joiner TUI with scroll region +
   anchored prompt. ~360 lines. The trickiest non-relay code.

3. `src/commands/monitor.mjs` — the always-on, session-gated SSE
   consumer that emits `[Name]: <text>` to stdout for Claude. ~150
   lines. Watch the gate logic carefully if you ever modify it; the
   negative-control test is your safety net.

4. `src/commands/post-stop.mjs` — parses the Claude Code transcript
   JSONL to extract the last assistant message. Robust against the
   three known transcript shapes (`message.content[]`,
   `content[]`, `content` string). If Claude Code changes its
   transcript format, this is the file to update.

5. `plugin/.claude-plugin/plugin.json` — the top-level `monitors`
   array. Spike B's central finding: if you ever set `when:
   on-skill-invoke:host`, the monitor silently never starts. Leave
   it as a top-level `monitors` array with no `when` field.

## How to verify everything works (5-min sanity check)

```bash
cd ~/Repositories/collab-claw
npm test                 # 77/77 should pass

# Manual sanity:
npm link                 # ensure global `collab-claw` is on PATH

# Terminal A (the would-be Claude session — we'll fake it with curl)
collab-claw set-name TestHost
node ./bin/collab-claw host
# Note the join URL printed.

# Terminal B (joiner)
collab-claw set-name TestJoiner
collab-claw join "http://...#secret=..."
# It says "Waiting for host approval".

# Terminal A (approve)
collab-claw status         # see the pending request id
# OR: tail the relay log via /healthz, then:
collab-claw approve <requestId>

# Terminal B should now show "Joined" and a TUI.
# Type a prompt and hit Enter. (No Claude is listening, so no response,
# but you can verify the prompt POST succeeded via curl /recent.)

# Terminal A:
collab-claw end
```

For the full Claude-in-loop test, install the plugin in Claude Code and
do `/collab-claw:host` — Spike C's manual runbook lives in
`spikes/spike-c/README.md` if you want a step-by-step.

## Where the code is

- Repo: https://github.com/sankalpgunturi/collab-claw
- Latest commit: `1f3eaba feat: v1 collab-claw — relay, CLI, joiner TUI, host plugin`
- All on `main`. No release tag yet — when you're satisfied, run:
  ```bash
  git tag v0.1.0 && git push --tags
  ```

## Roadmap suggestions (what I'd build next)

1. `collab-claw expose` — wrap `cloudflared tunnel --url
   http://localhost:7474` so cross-network works without telling users
   to install Cloudflared themselves.

2. `collab-claw recent --since=10m` — replay the last N minutes of a
   room into the joiner's TUI on join (currently we only replay the
   ring buffer, which has no time filter).

3. Persist transcripts to `~/.collab-claw/log/<roomId>.jsonl` and add
   a `collab-claw history` command.

4. NPM publish: `npm publish` (requires user's npm credentials).
   Until then, install is git-clone + npm-link.

5. Homebrew tap: `brew tap collab-claw/tap && brew install
   collab-claw`. Tap repo can be a sibling repo with a single
   `Formula/collab-claw.rb`.

6. Markdown rendering subset in TUI (bold, italic, inline code,
   fenced code blocks). Avoid heavy deps — write ~150 lines of regex.

## Last words

The architecture survived contact with reality. Spikes A, B, and C
caught the three things I would have built wrong: marketplace layout,
monitor activation trigger, and the session-state gate. The v1 build
went smoothly because of that — every test passed on the first or
second iteration.

Pour yourself a coffee in the morning, run through the 5-min sanity
check, and if `[Sankalp]: hello` wakes Claude up on your end, ship it
to your friends.

— claude
