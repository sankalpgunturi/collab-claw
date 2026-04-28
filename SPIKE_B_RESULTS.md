# Spike B — Results

**Goal:** Confirm that a marketplace-installed plugin can run a background monitor whose stdout lines (formatted `[Name]: …`) wake an idle Claude Code session and are treated by Claude as new user prompts from named teammates.

**Why this is the real gate:** if idle monitor wakeup fails, the v1 architecture in `PLAN.md` falls apart and we'd have to fall back to a more invasive design (e.g. a hook-based polling loop, or escalating to private `claude/channel` MCP capability).

**Artifact:** `spikes/spike-b/` in this repo, published to https://github.com/sankalpgunturi/collab-claw-spike-b.

**Tester:** Sankalp
**Date:** 2026-04-26
**Claude Code version:** 2.1.119 (`/Users/ltaldoraine/.local/bin/claude`)
**Install path:** `~/.local/bin/claude` (from `claude.ai/install.sh`)
**Plan account:** Pro/Max
**Host machine:** macOS, darwin 25.4.0

---

## Verdict

✅ **Spike B passes.** Plugin monitors deliver `[Name]: …` lines into an idle Claude session and Claude treats them as new user requests. The core architectural premise of `collab-claw` v1 is confirmed.

⚠️ **One architectural change required:** use `"when": "always"` (gated by a session-state file) instead of `"when": "on-skill-invoke:host"`. The `on-skill-invoke` trigger is silently broken in Claude Code 2.1.119 (see Finding F1 below).

✅ **Ready to proceed to Spike C** (CLI joiner end-to-end) and then to v1 build, with `PLAN.md` updated to reflect the trigger-mode change.

---

## What actually happened

### Iteration 1 — `"when": "on-skill-invoke:host"` (v0.0.2)

Per the docs, the host monitor should start when `/collab-claw-spike-b:host` is invoked. We installed v0.0.2 and ran `/collab-claw-spike-b:host` in an interactive session with full `--debug` logging.

**Result:** silent failure.
- No `spike-b-emit` process was spawned.
- No `monitor.log` was created.
- `--debug` log (`/tmp/spike-b-int3.log`, 318 DEBUG lines) contained **zero** mentions of `monitor`, `Skipping plugin monitor`, or `Failed to load monitors` — even though `strings` analysis of the binary confirmed those format strings are compiled in.
- The skill itself loaded and ran (`Loaded 1 skills from plugin collab-claw-spike-b`, `host-noop` printed its banner via Bash tool).
- The monitor was simply never enumerated at any point.

**Conclusion:** the `on-skill-invoke:<skill>` trigger is not honored in 2.1.119, despite being in the docs and in the binary's string table. Likely partial rollout or feature-flagged.

### Iteration 2 — `"when": "always"` (v0.0.3)

Same plugin, only change: the monitor's `when` field flipped to `always`. Reinstalled, `/reload-plugins`, started a fresh session, did **not** invoke the skill, did nothing.

**Result:** ✅ Works.

```
[2026-04-27T00:45:58Z] ========== monitor started ==========
[2026-04-27T00:45:58Z] pid=95931
[2026-04-27T00:45:58Z] CLAUDE_PLUGIN_ROOT=<unset>
[2026-04-27T00:45:58Z] CLAUDE_PLUGIN_DATA=<unset>
[2026-04-27T00:45:58Z] phase 1: scheduled emit in 30s
[2026-04-27T00:46:08Z] ========== monitor started ==========       ← second instance after /reload-plugins
[2026-04-27T00:46:08Z] pid=96328
[2026-04-27T00:46:38Z] EMIT: [Sankalp]: please write a hello-world Python script
```

At `00:46:38`, with the Claude session **idle** (no prior prompts in this session), the monitor emitted the `[Sankalp]: …` line. Claude woke up and **treated it as a new user prompt** — started writing a hello-world Python script.

This is exactly the production behavior `PLAN.md` requires.

---

## Findings

### F1. `"when": "on-skill-invoke:<skill>"` is silently broken in Claude Code 2.1.119

- Manifest validation accepts it (no `/plugin` Errors entry).
- Skill loads and runs.
- Monitor never starts; no debug log entry whatsoever.
- Workaround: use `"when": "always"`.

**Implication for `PLAN.md`:** the host plugin's collab monitor must be `"when": "always"` and gate itself in-process by checking a session-state file (e.g. `~/.collab-claw/session.json`). When no room is active, the monitor sleeps cheaply and emits nothing.

### F2. `"when": "always"` works exactly as the docs describe

- Monitor process spawned at session start, before any user input.
- Stdout lines are delivered as model input.
- An **idle** Claude session is woken by the line and processes it as a turn.
- Confirmed Claude's response was a real assistant turn (token-billed), not just a notification banner.

### F3. `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are NOT set in the monitor child process

The monitor's bash script logged `CLAUDE_PLUGIN_ROOT=<unset>` and `CLAUDE_PLUGIN_DATA=<unset>` at startup. Despite this, the monitor still launched correctly because the manifest's `command` field is interpolated by Claude Code itself before spawn, not by the shell.

The directory `~/.claude/data/collab-claw-spike-b/` was used as the data root (verified by the `monitor.log` location).

**Implication for `PLAN.md`:** the production monitor script must compute its data dir from `~/.claude/data/<plugin-name>/` directly, not rely on `$CLAUDE_PLUGIN_DATA`. Equivalent approach: pass an absolute path via the manifest's `command` line.

### F4. Two monitor instances ran briefly (PID 95931 then 96328, 10s apart)

Likely caused by the `/reload-plugins` step between them. Production monitor must either tolerate concurrent siblings or implement a flock-based singleton. With session-state gating (F1's workaround), tolerating concurrent siblings is the simpler choice — they both no-op when no room is active, and when a room is active the chat-event SSE consumer is naturally singleton-friendly (the relay coalesces).

### F5. Top-level `monitors` field in `plugin.json` is the correct schema

Confirmed via `~/.claude/cache/changelog.md` (v2.1.105) and direct experiment:
- `monitors/monitors.json` file (older docs reference) → ignored.
- Top-level `monitors: [...]` array in `plugin.json` → loaded correctly.

This matches the build plan's revised plugin layout.

---

## Architectural change to `PLAN.md`

Change the host plugin monitor manifest from:

```json
{
  "monitors": [
    {
      "name": "collab-prompts",
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/collab-monitor",
      "description": "Joiner prompts arriving in this collab-claw room.",
      "when": "on-skill-invoke:host"
    }
  ]
}
```

to:

```json
{
  "monitors": [
    {
      "name": "collab-prompts",
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/collab-monitor",
      "description": "Joiner prompts arriving in the active collab-claw room. Each line is formatted '[Name]: <text>' and should be treated as a new user request from that named teammate."
    }
  ]
}
```

(`when` defaults to `always` when omitted.)

The `bin/collab-monitor` script becomes responsible for:

1. Reading `~/.collab-claw/session.json` on each tick.
2. If no `roomId` field or the room has been torn down → sleep 5s, re-check.
3. If a room is active → open a long-lived SSE connection to `<relay>/prompts-stream` with the host token, and emit each `[Name]: <text>` line to stdout.
4. On SSE drop or session-state change → reconnect or idle.

This is the same monitor we always wanted, just gated in-process instead of by Claude Code's `when` field.

---

## Tests not run (not needed for the verdict)

T0 (install) — implicitly passed (plugin installed and updated cleanly through 0.0.1 → 0.0.2 → 0.0.3).
T1 (cold session: monitor stays off) — moot under the new architecture; replaced by F1's gating-by-session-state requirement.
T3, T4, T5, T6 — sequential / drift / mid-turn / burst behavior. These are now Spike-C territory (real prompts via the relay, not synthetic emits) and v1-build territory (priming durability is mostly a SKILL-body design decision).

The single finding from T2 — idle wake fires, Claude treats it as a new turn — is the only result Spike B needed to either pass or fail.

---

## Cleanup performed

- All `spike-b-emit` processes killed (`pkill -f spike-b-emit`).
- Plugin can be uninstalled with `/plugin uninstall collab-claw-spike-b@collab-claw-spike-b` and `/plugin marketplace remove collab-claw-spike-b` when desired.
- The GitHub repo `sankalpgunturi/collab-claw-spike-b` and the `spikes/spike-b/` artifact in this repo are kept for reference, currently at v0.0.3.

---

## Next

Proceed to **Spike C** — the `collab-claw join <url>` CLI experience: prompts → relay → host monitor injection (now via `when: always` + session.json gate), transcript SSE → joiner CLI TUI rendering, with no Claude Code on the joiner side.
