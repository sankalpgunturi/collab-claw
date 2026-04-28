# collab-claw

> Pair-program with one Claude across multiple laptops.

`collab-claw` lets a group of teammates collaborate inside a **single
Claude Code session**. The host runs Claude as usual; teammates connect
from their own laptops via a small CLI and see the conversation live.
Their prompts get prefixed with their name (`[Sankalp]: ...`) and
delivered to the host's Claude as if they had typed them locally.

- Only the host needs Claude Code installed.
- Only the host pays for tokens — joiners run a thin CLI client.
- Local-first: the host machine runs the relay over your LAN. No accounts,
  no servers, no signup.

```
┌────────────────────────┐                     ┌────────────────────────┐
│  Surya (host)          │                     │ Sankalp / Abhinav      │
│  ─────────────         │                     │ ───────────────        │
│  $ claude              │                     │ $ collab-claw join \   │
│  > /collab-claw:host   │   join-url + DM     │   http://...#secret=…  │
│  ┃ relay :7474         │  ───────────────►   │  ┌──────────────────┐  │
│  ┃ monitor (always-on) │                     │  │  TUI             │  │
│  ┃ hooks (Stop, …)     │  joiner prompts     │  │  status bar      │  │
│  ┗━━━━━━━━━━━━━━━━━━━┓ │  ◄────────────────  │  │  transcript      │  │
│   billed to host    ┃ │   host responses     │  │  prompt          │  │
└─────────────────────┻─┘   ────────────────►  └──┻──────────────────┘──┘
```

## Install

You need **Node.js ≥ 18** on every machine. The host also needs
**Claude Code** (the `claude` CLI).

### 1. Install the CLI everywhere (host + joiners)

```bash
# from a git checkout (works today):
git clone https://github.com/sankalpgunturi/collab-claw.git
cd collab-claw
npm link            # installs `collab-claw` globally

# (npm publish coming; once live: npm install -g collab-claw)
```

### 2. Install the host plugin (host only)

In a Claude Code session on the host's machine:

```
/plugin marketplace add sankalpgunturi/collab-claw
/plugin install collab-claw
```

Restart `claude` (or `/plugin reload`).

### 3. Set your display name (everyone)

```bash
collab-claw set-name Sankalp
```

## Usage

### Hosting

In Claude Code on the host's machine:

```
/collab-claw:host
```

Claude will print your join URL:

```
collab-claw room is live.

  relay:    http://10.0.0.42:7474
  host:     Surya
  roomId:   ab3K9z

  join URL (DM this to teammates):
  http://10.0.0.42:7474#secret=XXXXXXXXXXXXX
```

DM that URL to your teammates. Then keep working with Claude as you
normally would. When a teammate joins, you'll see:

```
[collab-claw] Sankalp wants to join the room. Approve with /collab-claw:approve <id>
```

Run `/collab-claw:approve <id>` (or `/collab-claw:kick <id>` to deny).

When you're done:

```
/collab-claw:end
```

### Joining

In any terminal on a teammate's machine:

```bash
collab-claw set-name Sankalp        # one-time
collab-claw join http://10.0.0.42:7474#secret=XXXXXXXXX
```

You'll see a TUI with the host's transcript scrolling. Type a prompt
and hit Enter — it'll be delivered to the host's Claude as
`[Sankalp]: <your prompt>`. Press **Ctrl-C** to leave.

### Other commands

```bash
collab-claw status                  # show current room state
collab-claw leave                   # leave (joiner)
collab-claw end                     # tear down the room (host)

# All work from /slash inside Claude too:
/collab-claw:host
/collab-claw:end
/collab-claw:status
/collab-claw:approve <id>
/collab-claw:kick <name>
```

## How it works

1. **`/collab-claw:host`** spawns a small Node HTTP+SSE relay on the host's
   LAN (default port 7474), mints a room secret + host token, writes
   `~/.collab-claw/session.json`, and prints a join URL containing the
   secret in the URL fragment.

2. The plugin's **always-on monitor** (started by Claude Code at session
   start) reads `session.json` to decide whether the room is live. If yes,
   it opens an SSE connection to `/prompt-stream` and emits incoming
   joiner prompts as `[Name]: <text>` lines on stdout — Claude treats
   these as user notifications and wakes up to respond.

3. The plugin's **`Stop` hook** runs after each Claude turn, parses the
   transcript JSONL, extracts the last assistant message, and POSTs it to
   `/events`. The relay fans this out to all subscribed joiner CLIs over
   `/transcript-stream`.

4. **`PreToolUse`** and **`PostToolUse`** hooks send compact summaries
   (e.g. `▸ wants to run Bash: npm test` → `✓ Bash: npm test`) so joiners
   can watch what Claude's doing in real time.

5. **`UserPromptSubmit`** hook forwards the host's own typed prompts to
   the relay so joiners see both sides of the conversation.

6. The **joiner CLI** does a pairing handshake (`POST /join-requests` with
   the room secret → long-poll `/join-requests/:id/wait` → host approves
   via `/collab-claw:approve <id>` → joiner gets a member token), then
   streams `/transcript-stream`. Member tokens are minted by the relay
   and returned only to the joiner — they never traverse the host's
   plugin or Claude Code transcript.

7. **Cross-network**: `collab-claw` is LAN-first. If your team is on
   different networks, expose the host's port via Cloudflare Tunnel,
   ngrok, or your tool of choice, and pass the public URL instead.
   (A built-in `collab-claw expose` is on the v1.1 roadmap.)

## Architecture

```
src/
├── cli.mjs                # subcommand dispatcher
├── state.mjs              # ~/.collab-claw/{config,session}.json helpers
├── relay/
│   └── server.mjs         # 12-route HTTP+SSE relay (one room per process)
├── tui/
│   └── join.mjs           # raw-ANSI TUI for joiners
├── commands/
│   ├── host.mjs           # spawns relay subprocess, writes session.json
│   ├── end.mjs
│   ├── join.mjs           # pairing handshake → TUI
│   ├── leave.mjs
│   ├── status.mjs
│   ├── approve.mjs
│   ├── deny.mjs
│   ├── kick.mjs
│   ├── set-name.mjs
│   ├── monitor.mjs        # always-on, session-gated SSE consumer
│   ├── post-prompt.mjs    # UserPromptSubmit hook → /events
│   ├── post-event.mjs     # arbitrary event → /events
│   ├── post-tool.mjs      # PreToolUse/PostToolUse → /events
│   └── post-stop.mjs      # Stop hook → /events (parses transcript JSONL)
└── util/{log,crypto,net}.mjs

plugin/
├── .claude-plugin/plugin.json   # top-level `monitors` array
├── hooks/hooks.json             # SessionStart, UserPromptSubmit, Pre/PostToolUse, Stop
├── skills/{host,end,status,approve,kick}/SKILL.md   # slash commands
└── bin/                         # bash shims that exec collab-claw <subcommand>
```

## Security model

- The **room secret** is in the URL fragment — never sent to the relay
  except as a `Bearer` header on `POST /join-requests`. (URL fragments
  don't appear in proxy logs.)
- The **host token** stays on the host's machine, in `session.json` mode
  0600. It authorizes the host's hooks and admin endpoints. Joiners never
  see it.
- **Member tokens** are minted by the relay at approval time and returned
  only to the joiner's long-poll wait. They never traverse Claude Code,
  the plugin, or the host transcript. Revoked on `/leaves` or `/kicks`.
- The relay binds **0.0.0.0** by default (so teammates on your LAN can
  reach it). Override with `COLLAB_CLAW_BIND=127.0.0.1` to restrict to
  loopback (e.g. when you're tunneling through Cloudflared instead).

## Configuration

Environment variables (set on the host before `/collab-claw:host`):

| Var                     | Default     | Meaning                                   |
| ----------------------- | ----------- | ----------------------------------------- |
| `COLLAB_CLAW_PORT`      | `7474`      | Relay port                                |
| `COLLAB_CLAW_BIND`      | `0.0.0.0`   | Bind interface                            |
| `COLLAB_CLAW_DEBUG`     | unset       | If set, prints stack traces on errors     |

Local files:

| Path                              | Owner | Purpose                                   |
| --------------------------------- | ----- | ----------------------------------------- |
| `~/.collab-claw/config.json`      | 0644  | Display name, default port                |
| `~/.collab-claw/session.json`     | 0600  | Active host or joiner state               |
| `~/.claude/data/collab-claw/monitor.log` | 0644  | Monitor's debug log                |

## Testing

```bash
npm test           # full suite (~15s)
npm run test:smoke # relay-only (no CLI)
npm run test:e2e   # CLI host + simulated joiner + hooks
npm run test:gate  # monitor session-state gate (negative + positive)
npm run test:tui   # joiner TUI in plain mode
```

The test suite covers 47 cases across the four scenarios.

## Known limitations (v1)

- **Single relay = single host machine.** If the host's laptop sleeps,
  the room dies. v1.1 will add reconnection.
- **LAN-first.** Cross-network requires manually tunneling the relay
  port. `collab-claw expose` (cloudflared wrapper) is planned.
- **No persistence.** Transcripts aren't saved to disk; only the last
  ~200 events are retained in memory for backfill. v1.1 will add an
  optional `~/.collab-claw/log/` write.
- **Plain-text events.** The TUI doesn't render markdown yet. Code
  blocks come through as their raw text. v1.1 will add a tasteful
  markdown subset.
- **Same Claude Code version.** Hosts running Claude Code older than
  2.1.105 won't have plugin monitors at all (the always-on monitor
  trigger). Upgrade if `/collab-claw:host` says it's hosting but
  joiner prompts never wake Claude.

## Contributing

```bash
git clone https://github.com/sankalpgunturi/collab-claw.git
cd collab-claw
npm test           # should pass clean
```

PRs welcome. The interesting code is `src/relay/server.mjs` (the routing
+ pairing handshake) and `src/tui/join.mjs` (the TUI).

## License

MIT — see [LICENSE](./LICENSE).
