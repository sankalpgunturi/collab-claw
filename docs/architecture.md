# Architecture

How CollabClaw works end-to-end, file tree, and key design decisions.

## How it works

1. **`/collab-claw:host`** spawns a small Node HTTP+SSE relay on the
   host's LAN (default port 7474), mints a room secret + host token,
   writes `~/.collab-claw/session.json`, and prints a join URL
   containing the secret in the URL fragment.

2. The plugin's **always-on monitor** (started by Claude Code at
   session start) reads `session.json` to decide whether the room is
   live. If yes, it opens an SSE connection to `/prompt-stream` and
   emits incoming joiner prompts as `[Name]: <text>` lines on stdout —
   Claude treats these as user notifications and wakes up to respond.

3. The plugin's **`Stop` hook** runs after each Claude turn, parses
   the transcript JSONL, extracts the last assistant message, and
   POSTs it to `/events`. The relay fans this out to all subscribed
   joiner CLIs over `/transcript-stream`.

4. **`PreToolUse`** and **`PostToolUse`** hooks send compact summaries
   (e.g. `▸ wants to run Bash: npm test` → `✓ Bash: npm test`) so
   joiners can watch what Claude's doing in real time.

5. **`UserPromptSubmit`** hook forwards the host's own typed prompts
   to the relay so joiners see both sides of the conversation.

6. The **joiner CLI** does a pairing handshake (`POST /join-requests`
   with the room secret → long-poll `/join-requests/:id/wait` → host
   approves via `/collab-claw:approve <id>` → joiner gets a member
   token), then streams `/transcript-stream`. Member tokens are
   minted by the relay and returned only to the joiner — they never
   traverse the host's plugin or Claude Code transcript.

7. **Cross-network**: by default the relay binds your LAN only.
   `collab-claw expose` wraps a Cloudflare quick tunnel for teammates
   on different networks. Or run your own tunnel (ngrok, tailscale,
   wireguard, ssh -R, etc.) and DM that URL instead.

## File tree

```
src/
├── cli.mjs                # subcommand dispatcher
├── state.mjs              # ~/.collab-claw/{config,session}.json helpers
├── relay/server.mjs       # HTTP+SSE relay (one room per process)
├── tui/join.mjs           # raw-ANSI TUI for joiners
├── commands/
│   ├── host.mjs           # spawns relay subprocess, writes session.json
│   ├── end.mjs / leave.mjs / status.mjs / approve.mjs / deny.mjs / kick.mjs
│   ├── join.mjs           # pairing handshake → TUI
│   ├── expose.mjs         # cloudflared quick-tunnel wrapper
│   ├── history.mjs        # read persisted ~/.collab-claw/log/*.jsonl
│   ├── set-name.mjs
│   ├── monitor.mjs        # always-on, session-gated SSE consumer
│   └── post-{prompt,event,tool,stop}.mjs   # hook handlers → /events
└── util/{log,crypto,net,markdown}.mjs

plugin/
├── .claude-plugin/plugin.json   # top-level `monitors` array
├── hooks/hooks.json             # SessionStart, UserPromptSubmit, Pre/PostToolUse, Stop
├── skills/{host,end,status,approve,kick}/SKILL.md   # slash commands
└── bin/                         # bash shims that exec collab-claw <subcommand>
```

## Key design decisions

These are the choices that fall out of CollabClaw's "one Claude, many
humans, one bill" architecture and that won't be obvious from reading
the code alone.

### One room per relay process

The relay is single-room by design. Each `/collab-claw:host` spawns
its own relay subprocess on its own port. This keeps tokens
process-isolated and means a relay crash never affects a different
room. Downside: one host machine = one room at a time. If you want
two parallel rooms on the same host, set `COLLAB_CLAW_PORT` to a
different value in the second session.

### Session-state gate on the monitor

The plugin's monitor is `when: always` (it has to be — see
[SPIKE_B_RESULTS](../SPIKE_B_RESULTS.md) for why `when:
on-skill-invoke` is silently broken in Claude Code 2.1.119). To
avoid leaking prompts to idle Claude sessions, the monitor gates
itself on `~/.collab-claw/session.json` having `mode: "host"`. The
gate is checked both before opening any SSE connection and before
emitting each event mid-stream.

### Single-subscriber `/prompt-stream`

A new `/prompt-stream` connection evicts any existing one
(last-writer-wins). This prevents stale monitors (e.g. from `/plugin
reload`) from double-delivering joiner prompts to Claude. An earlier
client-side PID-file lock turned out to starve the actually-hosting
monitor in multi-session setups and was removed in v0.1.2 — the
relay-side enforcement is the only one that's safe.

### Member tokens are out-of-band

When the host approves a join request, the relay mints a member
token and returns it **only** through the joiner's long-poll wait
response. The token never traverses Claude Code, the plugin, or the
host's transcript. This is what makes the "one bill" guarantee
structural rather than aspirational.

### Sequenced prompt queue with `Last-Event-ID` replay

Every prompt gets a monotonic `seq`. The relay keeps a bounded queue
of recent prompts; a reconnecting monitor resumes from where it left
off using the standard SSE `Last-Event-ID` header. This means
prompts posted during the natural reconnect windows of the always-on
monitor aren't dropped.

### LAN-bind by default

The relay binds `0.0.0.0` so teammates on the same Wi-Fi can reach
it. If you're fronting the relay with `collab-claw expose` (or your
own tunnel) and don't want direct LAN exposure, set
`COLLAB_CLAW_BIND=127.0.0.1` before hosting.
