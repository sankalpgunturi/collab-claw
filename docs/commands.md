# Commands

Every CollabClaw subcommand and slash command, what it does, and when
to reach for it.

## Hosting (slash commands inside Claude Code)

| Command | What it does |
| --- | --- |
| `/collab-claw:host` | Start a room: spawn the relay, write `session.json`, print the join URL. |
| `/collab-claw:status` | Show current room state (members, latency). |
| `/collab-claw:approve <id>` | Approve a pending join request. |
| `/collab-claw:kick <name>` | Remove a member (also denies pending requests). |
| `/collab-claw:expose` | Start a managed Cloudflare quick tunnel and print a public join URL. |
| `/collab-claw:end` | Tear down the room. |

When a teammate joins, you'll see:

```
[collab-claw] Bob wants to join the room. Approve with /collab-claw:approve <id>
```

## CLI (works from any shell)

```bash
collab-claw set-name Alice              # one-time, host or joiner
collab-claw host                        # alternative to /collab-claw:host
collab-claw join <url>                  # joiner: pair + open TUI
collab-claw leave                       # joiner: leave the room
collab-claw end                         # host: tear down the room
collab-claw status                      # show current room state
collab-claw approve <requestId>         # host: approve a pending join
collab-claw deny <requestId>            # host: deny a pending join
collab-claw kick <name>                 # host: remove a member
collab-claw expose                      # host: opt-in cross-network tunnel
collab-claw history [roomId]            # show events from a persisted log
collab-claw version
collab-claw help
```

## Cross-network: `collab-claw expose`

If your teammates aren't on the same LAN as the host:

```bash
collab-claw expose
```

This starts a managed `cloudflared tunnel --url http://127.0.0.1:<port>`
process in the background, stores the public URL in `session.json`, and
prints a rewritten join URL with the same room secret. You need
`cloudflared` installed first:

```bash
brew install cloudflared    # macOS
# or download from https://github.com/cloudflare/cloudflared/releases
```

`expose` parses the public `https://<random>.trycloudflare.com` URL
out of cloudflared's output. DM that to teammates anywhere. The tunnel
keeps running in the background and is stopped automatically by
`/collab-claw:end` or `collab-claw end`. Your LAN URL still works for
local teammates in parallel.

If you want the old foreground behavior for debugging, run:

```bash
collab-claw expose --foreground
```

If you'd rather use ngrok, tailscale, wireguard, or `ssh -R`, just
expose the relay port however you like and DM the resulting URL
(append `#secret=<roomSecret>` from your local URL).

## Transcript history: `collab-claw history`

Every event flowing through the relay is appended to
`~/.collab-claw/log/<roomId>.jsonl`. Replay or audit any past room:

```bash
collab-claw history                     # list logged rooms (or tail current)
collab-claw history <roomId>            # all events from that room
collab-claw history <roomId> --limit=50
collab-claw history <roomId> --json     # raw jsonl for piping into jq, grep, etc.
```

Disable persistence with `COLLAB_CLAW_LOG=off` before
`/collab-claw:host`.

## Joiner TUI

When you run `collab-claw join <url>`, you get a Claude-Code-flavored
TUI:

- Top bar: room id, connection state (`● live` / `● reconnecting…` /
  `● host offline (last seen Xm ago)`), member count, last round-trip
  latency.
- Middle: scrolling transcript with markdown rendering for the host's
  responses (`**bold**`, `*italic*`, `` `inline code` ``, fenced
  blocks).
- Bottom: prompt input. Hit Enter to send; the prompt arrives in the
  host's Claude as `[Bob]: <your prompt>`.
- Ctrl-C to leave cleanly.

If your terminal isn't a TTY (e.g. you're piping output), the TUI
falls back to plain-text rendering automatically.

## Plugin-internal commands

You normally don't run these directly — they're invoked by the
plugin's hooks and monitor. Listed here for completeness:

```
collab-claw monitor                     # session-gated SSE consumer (always-on)
collab-claw post-prompt <text>          # UserPromptSubmit hook → relay
collab-claw post-event <kind> <text>    # arbitrary event → relay
collab-claw post-tool <pre|post>        # PreToolUse/PostToolUse → relay
collab-claw post-stop                   # Stop hook → relay (parses transcript JSONL)
```
