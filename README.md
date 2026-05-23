<p align="center">
  <img src="docs/logo.svg" alt="collab-claw" width="200">
</p>

<h1 align="center">collab-claw 🦞</h1>

<p align="center">
  <em>Pair-program with one Claude across multiple laptops.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/collab-claw"><img alt="npm" src="https://img.shields.io/npm/v/collab-claw?logo=npm&color=cb3837"></a>
  <a href="https://github.com/sankalpgunturi/homebrew-tap"><img alt="Homebrew" src="https://img.shields.io/badge/homebrew-sankalpgunturi%2Ftap-orange?logo=homebrew"></a>
  <a href="https://github.com/sankalpgunturi/collab-claw/actions/workflows/test.yml"><img alt="tests" src="https://img.shields.io/github/actions/workflow/status/sankalpgunturi/collab-claw/test.yml?branch=main&label=tests&logo=github"></a>
  <a href="https://github.com/sankalpgunturi/collab-claw/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/sankalpgunturi/collab-claw?logo=github&sort=semver"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/github/license/sankalpgunturi/collab-claw?color=blue"></a>
  <a href="https://github.com/sankalpgunturi/collab-claw/issues"><img alt="issues" src="https://img.shields.io/github/issues/sankalpgunturi/collab-claw"></a>
</p>

---

`collab-claw` lets a group of teammates collaborate inside a **single
Claude Code session**. The host runs Claude as usual; teammates connect
from their own laptops via a small CLI and see the conversation live.
Their prompts get prefixed with their name (`[Alice]: ...`) and
delivered to the host's Claude as if they had typed them locally.

- ✅ Only the host needs Claude Code installed.
- 💸 Only the host pays for tokens — joiners run a thin CLI client.
- 🏠 Local-first by default: the host machine runs the relay over your
  LAN. No accounts, no servers, no signup. Cross-network is opt-in via
  `collab-claw expose`.
- 🔐 Token-scoped pairing — joiners are explicitly approved by the host.
- 📜 MIT-licensed.

```
┌────────────────────────┐                     ┌────────────────────────┐
│  Alice (host)          │                     │ Bob / Carol            │
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

You need **Node.js ≥ 20** on every machine. The host also needs
**Claude Code** (the `claude` CLI).

### 1. Install the CLI everywhere (host + joiners)

```bash
# npm:
npm install -g collab-claw

# Homebrew (macOS / Linux):
brew tap sankalpgunturi/tap
brew install collab-claw

# Or from source:
git clone https://github.com/sankalpgunturi/collab-claw.git
cd collab-claw && npm link
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
collab-claw set-name Alice
```

Names are 1–32 chars, alphanumeric/space/dash/underscore. The relay
validates server-side too.

## Usage

### Hosting

In Claude Code on the host's machine:

```
/collab-claw:host
```

Claude will print a join URL:

```
collab-claw room is live.

  relay:    http://10.0.0.42:7474
  host:     Alice
  roomId:   ab3K9z

  join URL (DM this to teammates):
  http://10.0.0.42:7474#secret=XXXXXXXXXXXXX
```

DM that URL to your teammates. Then keep working with Claude as you
normally would. When a teammate joins, you'll see:

```
[collab-claw] Bob wants to join the room. Approve with /collab-claw:approve <id>
```

Run `/collab-claw:approve <id>` (or `/collab-claw:kick <id>` to deny).

When you're done:

```
/collab-claw:end
```

### Joining

In any terminal on a teammate's machine:

```bash
collab-claw set-name Bob          # one-time
collab-claw join http://10.0.0.42:7474#secret=XXXXXXXXX
```

You'll see a TUI with the host's transcript scrolling. Type a prompt
and hit Enter — it'll be delivered to the host's Claude as
`[Bob]: <your prompt>`. Press **Ctrl-C** to leave.

### Cross-network (opt-in)

If teammates aren't on the same network as the host:

```bash
collab-claw expose
```

This wraps `cloudflared tunnel --url http://localhost:<port>` (install
`cloudflared` first — `brew install cloudflared` on macOS, or from
[cloudflare/cloudflared](https://github.com/cloudflare/cloudflared/releases))
and prints a public `https://<random>.trycloudflare.com#secret=…` URL
you can DM to teammates anywhere. Keep the terminal open for the
duration of the session; Ctrl-C tears the tunnel down. Your LAN URL
still works for local teammates in parallel.

### Transcript history

Every event is appended to `~/.collab-claw/log/<roomId>.jsonl` as it
flows through the relay. Replay or audit a past room:

```bash
collab-claw history                 # list logged rooms (or tail current)
collab-claw history <roomId>        # all events from that room
collab-claw history <roomId> --limit=50
collab-claw history <roomId> --json # raw jsonl for piping
```

Disable persistence with `COLLAB_CLAW_LOG=off`.

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

7. **Cross-network**: by default the relay binds your LAN only.
   `collab-claw expose` wraps a Cloudflare quick tunnel for teammates on
   different networks. Or run your own tunnel (ngrok, tailscale,
   wireguard, ssh -R, etc.) and DM that URL instead.

## Architecture

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

## Security

See [SECURITY.md](./SECURITY.md) for the threat model, the controls in
place, and how to report a vulnerability. tl;dr — the room secret is
an invite, the host token never leaves the host machine, and member
tokens are revoked on kick/leave with active streams closed
server-side.

## Configuration

Environment variables (set on the host before `/collab-claw:host`):

| Var                          | Default              | Meaning                                                  |
| ---------------------------- | -------------------- | -------------------------------------------------------- |
| `COLLAB_CLAW_PORT`           | `7474`               | Relay port                                               |
| `COLLAB_CLAW_BIND`           | `0.0.0.0`            | Bind interface                                           |
| `COLLAB_CLAW_LOG`            | `on`                 | Set `off` to skip persisting transcript events to disk   |
| `COLLAB_CLAW_LOG_DIR`        | `~/.collab-claw/log` | Override the persistence directory                       |
| `COLLAB_CLAW_RING`           | `200`                | In-memory event ring buffer size (for `/recent` backfill)|
| `COLLAB_CLAW_PROMPT_QUEUE`   | `200`                | Sequenced prompt queue size (for Last-Event-ID replay)   |
| `COLLAB_CLAW_DEBUG`          | unset                | If set, prints stack traces on errors                    |

Local files:

| Path                                          | Mode  | Purpose                              |
| --------------------------------------------- | ----- | ------------------------------------ |
| `~/.collab-claw/config.json`                  | 0644  | Display name, default port           |
| `~/.collab-claw/session.json`                 | 0600  | Active host or joiner state          |
| `~/.collab-claw/log/<roomId>.jsonl`           | 0600  | Persisted transcript (one event/line)|
| `~/.claude/data/collab-claw/monitor.log`      | 0644  | Monitor's debug log                  |

## Testing

```bash
npm test               # full suite (six scenarios)
npm run test:smoke     # relay-only (no CLI)
npm run test:e2e       # CLI host + simulated joiner + hooks
npm run test:gate      # monitor session-state gate (negative + positive)
npm run test:tui       # joiner TUI in plain mode
npm run test:regressions
npm run test:v11       # v0.2.0 feature coverage
```

The suite is 102 cases across six files and finishes in under a minute.

## What's new in v0.2.0

- **Cross-network** via `collab-claw expose` — wraps a Cloudflare quick
  tunnel so teammates on other networks can join without you setting up
  Cloudflared by hand.
- **Transcript persistence** — every event is appended to
  `~/.collab-claw/log/<roomId>.jsonl` (set `COLLAB_CLAW_LOG=off` to
  disable). Replay with `collab-claw history [roomId]`.
- **Reconnect UX** — the joiner TUI shows `● live` /
  `● reconnecting…` / `● host offline (last seen Xm ago)` in the
  status bar, with exponential backoff and a one-line "reconnected"
  notice on recovery.
- **Markdown in responses** — prompts and responses get a tasteful
  subset (`**bold**`, `*italic*`, `` `inline code` ``, fenced
  ```` ``` blocks ```` ).

## Known limitations

- **Single relay = single host machine.** If the host's laptop sleeps,
  the room dies (joiners auto-reconnect when it returns).
- **Same Claude Code version.** Hosts running Claude Code older than
  2.1.105 won't have plugin monitors at all (the always-on monitor
  trigger). Upgrade if `/collab-claw:host` says it's hosting but
  joiner prompts never wake Claude.

## Contributing

PRs, issues, and "I tried this with my team, here's what happened"
reports are all welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md)
before sending a PR — it has the dev loop, branch rules, and a
checklist that'll save us both round-trips.

Maintainers and reviewers: see [CODEOWNERS](./CODEOWNERS).

## License

MIT — see [LICENSE](./LICENSE). Use it, fork it, ship it.
