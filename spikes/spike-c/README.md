# Spike C — Plumbing proof for the relay/CLI loop

**Status:** ready to execute. Plumbing has been verified standalone (without Claude in the loop) and all three internal tests pass. The remaining test is the full round-trip through a real Claude Code session.

**What this proves (and only this):**

1. ✅ A real Node HTTP+SSE relay with the four production routes (`/prompts`, `/prompt-stream`, `/events`, `/transcript-stream`) under bearer auth.
2. ✅ The production-shape `bin/monitor-prompts` (always-on, session-state-gated, SSE consumer with bearer auth, no reliance on `$CLAUDE_PLUGIN_DATA`).
3. ✅ The session-state gate works as a negative control — if `session.json` is absent or `mode != "host"`, **nothing reaches Claude**, even when prompts are flying through the relay.
4. **(Pending the runbook below)** The full round-trip: joiner POSTs a prompt → relay → host monitor stdout → Claude wakes & responds → host's `Stop` hook POSTs the response → joiner sees it on `/transcript-stream`.

**What this explicitly does NOT prove (out of scope):**

- The TUI (joiner just `console.log`s — pure plumbing).
- Pairing / approvals / per-member tokens (single shared `COLLAB_CLAW_TOKEN`).
- `PreToolUse` / `PostToolUse` (Spike A confirmed the four hook events fire correctly).
- Skills beyond `host`.
- Cross-network via Cloudflared.

**Pass criterion:** `joiner.mjs --send "<prompt>"` causes Claude on the host to respond, and the response shows up on the joiner's stdout. Sub-3s end-to-end on localhost.

---

## Files

```
spikes/spike-c/
├── .claude-plugin/marketplace.json     # marketplace catalog
├── plugin/
│   ├── .claude-plugin/plugin.json      # manifest with top-level `monitors` (Spike B F5)
│   ├── hooks/hooks.json                # Stop hook only
│   ├── skills/host/SKILL.md            # /collab-claw-spike-c:host (disable-model-invocation)
│   └── bin/
│       ├── host                        # writes ~/.collab-claw/session.json (opens the gate)
│       ├── monitor-prompts             # production-shape session-gated SSE consumer
│       └── stop                        # POSTs last assistant message to /events
├── relay/server.mjs                    # 4-route HTTP+SSE relay
└── joiner.mjs                          # Node CLI: send prompt + watch transcript
```

---

## Prereqs

- macOS or Linux
- Claude Code 2.1.105+ (we tested on 2.1.119)
- `node` 18+
- `jq`, `curl` on PATH

```bash
node --version    # v18+
jq --version
curl --version | head -1
```

---

## Runbook

You'll need **three terminals**.

### Terminal A — relay

```bash
cd spikes/spike-c
node relay/server.mjs
# logs:
#   [...] spike-c relay listening on http://127.0.0.1:7475
```

Leave this running. Watch its log throughout.

### Terminal B — install + run Claude Code as the host

```bash
# 1. Install the plugin
claude
> /plugin marketplace add sankalpgunturi/collab-claw-spike-c
> /plugin install collab-claw-spike-c@collab-claw-spike-c
> /reload-plugins

# 2. Verify the always-on monitor started (session.json absent, gate closed)
> /exit
$ tail ~/.claude/data/collab-claw-spike-c/monitor.log
# expect lines:
#   [...] gate=closed (session.json absent or mode!=host); idling 5s

# 3. Open a fresh Claude session and host
$ claude
> /collab-claw-spike-c:host
# claude prints the verbatim banner from bin/host

# At this point session.json is written. Within ~5 seconds the monitor
# log should flip:
#   [...] gate=open relay=http://127.0.0.1:7475 connecting SSE (max 30s)

# 4. Verify with healthz
$ curl -s http://127.0.0.1:7475/healthz
# {"ok":true,"promptSubscribers":1,"transcriptSubscribers":0}

# Leave this Claude session IDLE. Don't type anything.
```

### Terminal C — the joiner

#### Test 1 — Negative control (gate closed before T-host)

Skip this if you already verified the standalone tests passed during scaffolding. The standalone tests exercise the same gate logic with no Claude in the loop, which is what we want for the negative control.

#### Test 2 — Positive: full round-trip with Claude in the loop

```bash
cd spikes/spike-c
COLLAB_CLAW_NAME=Sankalp node joiner.mjs --send "please write a one-line python script that prints the current time"
```

Expected behavior, in order:

1. Joiner prints `Sankalp (you)` and the prompt body, plus `POST /prompts -> 200 {"ok":true,"delivered":1}`.
2. Within ~1s, **Terminal B's Claude** wakes up (no input from the host) and starts responding to `[Sankalp]: please write a one-line python script that prints the current time`. Watch it write the script.
3. When Claude finishes its turn, the `Stop` hook fires. Watch `~/.claude/data/collab-claw-spike-c/hook.log` for a line like `stop: POST /events rc=0 bytes=… resp=…`.
4. Joiner prints `Surya (host)` followed by Claude's full response.
5. Joiner prints `(round-trip: NNN ms)`. **Pass criterion: NNN < 3000 on localhost.**

#### Test 3 — Negative control mid-loop (optional)

After test 2 succeeds:

```bash
# Force-close the gate
rm ~/.collab-claw/session.json

# Send another prompt
COLLAB_CLAW_NAME=Sankalp node joiner.mjs --send "this should be dropped"
```

Expected behavior:

- Within ~30s (next `--max-time` bump), the monitor sees `session.json` is gone and stops emitting.
- Even if SSE is still open, every incoming event is dropped (look for `DROP: gate closed mid-stream` in `monitor.log`).
- Claude does not respond.
- Joiner times out after 60s with no response.

---

## Cleanup

```bash
# Terminal C: ctrl-C any running joiner
# Terminal B: /exit
# Terminal A: ctrl-C the relay

# Remove session state and the plugin
rm -rf ~/.collab-claw ~/.claude/data/collab-claw-spike-c

claude
> /plugin uninstall collab-claw-spike-c@collab-claw-spike-c
> /plugin marketplace remove collab-claw-spike-c
```

---

## Troubleshooting

| Symptom                                                              | Likely cause                                                     | Check                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `monitor.log` doesn't exist after `/reload-plugins`                  | Plugin not loaded                                                | `/plugin` Errors tab; verify v0.0.1 cached at `~/.claude/plugins/cache/...` |
| `monitor.log` shows `gate=closed` forever after `/collab-claw-spike-c:host` | `bin/host` didn't write session.json — likely permissions issue  | `ls -la ~/.collab-claw/session.json` and `cat` it                           |
| `healthz` shows `promptSubscribers: 0` even with gate open           | Monitor ran into a curl error                                    | `tail -50 ~/.claude/data/collab-claw-spike-c/monitor.log` for stderr        |
| Claude doesn't respond to `[Sankalp]: …` line                        | Possibly Spike B regression                                      | `cat /tmp/spike-c-mon.stdout` — does the line appear?                       |
| Joiner sees prompt POST `delivered: 0`                               | Monitor not connected yet (check 30s `--max-time` window)        | Wait 5s and retry, or watch monitor.log                                     |
| Joiner sees prompt POST OK but never sees response                   | Stop hook didn't fire or relay is down                           | `tail ~/.claude/data/collab-claw-spike-c/hook.log`                          |
| Round-trip > 3s                                                      | Monitor's 5s sleep tick caught at a bad time                     | Run again; sub-3s should be the steady state                                |

---

## Why this is the last spike

If Test 2 in the runbook above passes:

- Real relay → real plugin monitor → real Claude → real hook → real joiner round-trip is proven.
- Every component in v1 is independently understood (Spike A: hooks; Spike B: monitor wakeup; Spike C: relay/CLI loop).
- Build is engineering work, not architectural risk.

If Test 2 fails:

- Failure mode tells us exactly which link to investigate first (joiner → relay; relay → monitor; monitor → Claude; Claude → Stop hook → relay; relay → joiner). Each link is independently testable with `curl` and `tail`.
