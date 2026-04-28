# Spike C — Results

**Goal:** prove the relay/CLI loop end-to-end, plus the negative control of the session-state gate.

**Pass criterion:** `joiner.mjs --send "<prompt>"` causes Claude on the host to respond, and the response shows up on the joiner's stdout, sub-3s on localhost.

**Artifact:** `spikes/spike-c/` in this repo, published to https://github.com/sankalpgunturi/collab-claw-spike-c.

**Tester:** Sankalp
**Date:** _<fill in>_
**Claude Code version:** _<fill in>_
**Host machine:** _<fill in>_

---

## Standalone plumbing tests (run during scaffolding, no Claude in the loop)

These were verified at scaffold time using `bin/monitor-prompts` directly under `bash` and `joiner.mjs --watch`, with the relay running on `127.0.0.1:7475`. The results below are pre-recorded.

### Smoke 0 — bidirectional plumbing

| Check                                                          | Pass / Fail | Evidence (from scaffolding run)                                        |
| -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| Relay starts on `127.0.0.1:7475`, `/healthz` returns ok        | ✅ Pass     | `{"ok":true,"promptSubscribers":0,"transcriptSubscribers":0}`           |
| Bearer auth: missing token → 401, valid token → 200            | ✅ Pass     | `no-token: 401`, `ok-token: 200`                                       |
| Monitor with gate open subscribes to `/prompt-stream`          | ✅ Pass     | `monitor.log: gate=open relay=… connecting SSE (max 30s)`              |
| `POST /prompts` is fanned out to monitor stdout as `[Name]: …` | ✅ Pass     | `monitor.log: EMIT: [Sankalp]: please write a hello-world Python script` |
| Joiner `--watch` consumes `/transcript-stream`                 | ✅ Pass     | `joiner.out: Surya (host) response\nHi Sankalp! Here is your...`        |
| `POST /events` is fanned out to joiner stdout                  | ✅ Pass     | `joiner.out: Surya (host) response`                                    |

### T_neg1 — gate never opened

| Check                                                                     | Pass / Fail | Evidence                                              |
| ------------------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| Monitor starts, never sees `session.json`                                 | ✅ Pass     | `monitor.log: gate=closed … idling 5s` (repeating)    |
| `POST /prompts` → relay returns `delivered: 0` (no subscribers)           | ✅ Pass     | `{"ok":true,"delivered":0}`                           |
| Monitor stdout stays empty                                                | ✅ Pass     | `/tmp/spike-c-mon.stdout` is empty                    |

### T_neg2 — gate closes mid-stream

This is the key regression test. The first version of `bin/monitor-prompts` failed this and was fixed: the inner read loop now re-checks the gate before each emit, and `curl --max-time 30` bounds the SSE connection so a closed gate is noticed quickly.

| Check                                                                                | Pass / Fail | Evidence                                                                                  |
| ------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| Gate open → POST 1 emits to monitor stdout                                          | ✅ Pass     | `monitor.log: EMIT: [Sankalp]: POSITIVE: should reach Claude`                              |
| `rm session.json` mid-stream                                                          | ✅ Pass     | (action)                                                                                  |
| Gate now closed → POST 2 should be DROPPED, not emitted                              | ✅ Pass     | `monitor.log: DROP: gate closed mid-stream; ignoring incoming event`                       |
| Monitor stdout contains POSITIVE only, NOT NEGATIVE-2                                | ✅ Pass     | `/tmp/spike-c-mon.stdout` contains only `[Sankalp]: POSITIVE: should reach Claude`         |

---

## Test 2 — Full round-trip with Claude in the loop (the actual gate)

Action: see `spikes/spike-c/README.md` runbook. This is the test the user runs.

| Check                                                                                          | Pass / Fail | Notes |
| ---------------------------------------------------------------------------------------------- | ----------- | ----- |
| `/plugin install collab-claw-spike-c@collab-claw-spike-c` succeeds                             |             |       |
| `monitor.log` shows always-on monitor started, gate closed                                     |             |       |
| `/collab-claw-spike-c:host` runs the SKILL, prints the `bin/host` banner verbatim              |             |       |
| Within ~5s, monitor.log flips to `gate=open relay=http://127.0.0.1:7475 connecting SSE`        |             |       |
| `curl /healthz` shows `promptSubscribers: 1`                                                   |             |       |
| Joiner runs `--send "..."`, gets `delivered: 1`                                                |             |       |
| **Within ~1s, Claude wakes up on the host** (no host input) and starts responding              |             |       |
| Stop hook fires; `hook.log` shows `POST /events rc=0`                                          |             |       |
| Joiner sees `Surya (host)` event with the full response text                                   |             |       |
| `(round-trip: NNN ms)` shown by joiner. NNN: ___                                               |             |       |
| **Pass criterion met: round-trip < 3000 ms**                                                   |             |       |

---

## Test 3 — Mid-loop negative control with Claude (optional but valuable)

| Check                                                                                          | Pass / Fail | Notes |
| ---------------------------------------------------------------------------------------------- | ----------- | ----- |
| With Test 2 working, `rm ~/.collab-claw/session.json`                                          |             |       |
| Within ~30s, monitor's curl --max-time fires; next iteration logs `gate=closed`                |             |       |
| Send another prompt via joiner. Relay returns `delivered: 0` (no subscriber)                   |             |       |
| Even if briefly delivered, monitor.log shows `DROP: gate closed mid-stream`                    |             |       |
| Claude on host does NOT respond (transcript stays at the previous turn)                        |             |       |
| Joiner times out after 60s with no transcript event                                            |             |       |

---

## Findings

_(fill in after running)_

1. **Round-trip latency on localhost (median of 3 runs):** _<NNN ms>_
2. **Stop hook input format observed:** _<paste hook input JSON, redacted as needed>_
3. **JSONL transcript shape that `bin/stop` extracted text from:** _<note the `.message.content[].text` path or the alternate>_
4. **Anything surprising:** _<fill in>_
5. **TUI shape implications discovered:** _<e.g., "the response arrives as a single block, not streamed; build TUI accordingly">_

---

## Verdict

- [ ] **Pass.** Real relay → plugin monitor → Claude → Stop hook → joiner round-trip works under 3s. Negative control holds. Architecture is fully validated. Proceed to v1 build.
- [ ] **Pass with caveats.** _<list>_
- [ ] **Fail.** _<which link broke; what we changed; whether to retry or revisit architecture>_

---

## Cleanup

```bash
# Stop everything
pkill -f 'spike-c'

# Remove session + plugin state
rm -rf ~/.collab-claw ~/.claude/data/collab-claw-spike-c

# Uninstall plugin (in claude)
/plugin uninstall collab-claw-spike-c@collab-claw-spike-c
/plugin marketplace remove collab-claw-spike-c
```

The `spikes/spike-c/` artifact and the `sankalpgunturi/collab-claw-spike-c` repo are kept as reference implementations of the relay + monitor shape. The v1 build will reuse the relay's route shape, the bin script's gate logic, and the joiner's SSE consumer pattern more or less verbatim, with the additions noted in `PLAN.md`.
