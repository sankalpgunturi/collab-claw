# collab-claw — Pre-build Spikes

Three short experiments. Each is one evening's work. **None of `PLAN.md` §10 (build order) starts until all three pass.**

The point is to falsify the riskiest assumptions before writing the rest of the plugin.

The CLI-joiner pivot collapsed the original Spike A and Spike C significantly: joiners no longer use Claude Code at all, so we don't need to verify that `UserPromptSubmit` returning `block` from a marketplace plugin really suppresses local Claude. The remaining risks are all on the host side or in the CLI itself.

---

## Spike A — Host-side `UserPromptSubmit` hook from a marketplace-installed plugin

### Question
Can a plugin distributed via the public plugin marketplace register a `UserPromptSubmit` hook that POSTs the prompt body to a local HTTP endpoint and exits 0, with the model still processing the prompt normally?

### Why it matters
The host's "broadcast my prompt to teammates" path runs through `UserPromptSubmit`. If the hook stdin shape (`{ prompt, session_id, ... }`) differs from what the docs say, or if marketplace-distributed hooks have any silent restrictions, we need to know now.

### Setup
1. Throwaway plugin repo `collab-claw-spike-a` matching the **production marketplace layout exactly** (this is what we'll ship in v1, so we want parity for the spike):
   ```
   collab-claw-spike-a/
   ├── .claude-plugin/
   │   └── marketplace.json     # catalog with one entry pointing at ./plugin/
   └── plugin/
       ├── .claude-plugin/
       │   └── plugin.json      # minimal manifest (author as object, userConfig.title set)
       ├── hooks/hooks.json
       └── bin/echo-prompt
   ```
2. `plugin/hooks/hooks.json` registers one `UserPromptSubmit` command hook in the corrected shape:
   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         { "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/echo-prompt" } ] }
       ]
     }
   }
   ```
3. `plugin/bin/echo-prompt` is a shell script that reads the JSON event from stdin, parses `.prompt`, POSTs it to `http://127.0.0.1:9999/test`, then exits 0.
4. Run a tiny `nc -l 9999` listener (or a 5-line Node server) on the host.
5. Push the plugin repo to GitHub.
6. From Claude Code: `/plugin marketplace add <user>/collab-claw-spike-a && /plugin install collab-claw-spike-a@collab-claw-spike-a && /reload-plugins`.

### Test cases
1. Type a normal prompt. Expect: listener receives the prompt body verbatim within ~1s, Claude processes the prompt and responds normally.
2. Type a multi-line prompt. Expect: prompt body is preserved (newlines escaped properly in JSON).
3. Type a prompt with shell-injection-y characters (`"`, `$()`, backticks). Expect: hook still runs, listener receives intact body.
4. Disable the listener and type a prompt. Expect: hook fails open (logs an error somewhere, exits 0), Claude still processes the prompt.

### Pass criteria
- All four test cases behave as expected.
- The plugin loads successfully from the marketplace install (no schema errors in `/plugin` Errors tab).

### If it fails
- If hook fires but stdin is empty or differently shaped: read `hooks.json` reference docs more carefully and adjust the entry script.
- If hook doesn't fire at all from a marketplace install: install via `--plugin-dir` to localize the issue.
- If `/plugin` Errors tab shows manifest schema problems: confirm `userConfig.title` and `author` object shapes are required (they are, per the docs).

---

## Spike B — Production-path host monitor wakes idle Claude  ✅ PASSED 2026-04-26

**Question (the only one that mattered):** does an idle Claude session wake on a `[Name]: …` line emitted by a plugin monitor and treat it as a new user prompt?

**Answer:** yes. Confirmed end-to-end in Claude Code 2.1.119 with a synthetic emit and an idle session — Claude wrote the requested hello-world Python script in response. See `SPIKE_B_RESULTS.md` for the full write-up, the v0.0.2 vs v0.0.3 iteration history, and the three findings (F1 `on-skill-invoke:<skill>` silently broken, F3 monitor env vars unset, F5 `monitors` must be top-level inside `plugin.json`).

**Architectural carry-over to `PLAN.md`:** monitor declared inline in `plugin.json` (top-level `monitors` array), `when` field omitted (defaults to `always`), gating done in-process via `~/.collab-claw/session.json`, no reliance on `$CLAUDE_PLUGIN_DATA` or `$CLAUDE_PLUGIN_ROOT` in the monitor child. See `PLAN.md` §5.6 and §5.9.

**Tests we did not run, and why we don't need them for the verdict:**

- Cold-session "monitor stays off" — replaced by the in-process session-state gate; the monitor process runs but is inert when no room exists.
- Long-session priming drift — defer to dogfooding; if observed, mitigation is `bin/prompt-submit` re-injecting host instructions as `additionalContext` on every host turn (trivially additive).
- Mid-turn arrival, burst — both belong to Spike C now (real prompts via the relay) and to the v1 polish phase, not to the architectural gate.

---

## Spike C — CLI joiner end-to-end

### Question
Does `collab-claw join <url>` work as a thin client that connects to a relay, joins a room, sends prompts that arrive on the host within ~1s on the same Wi-Fi, and renders streamed transcript events back through SSE — all with no Claude Code on the joiner side?

### Why it matters
Validates the entire post-pivot joiner architecture. The win is no joiner Claude at all (zero tokens, structural). We need to confirm the CLI UX is acceptable and the network round-trip is snappy.

### Setup
1. **Laptop X (the "host")** runs a 50-line stripped-down `relay.mjs` exposing `/prompts`, `/events`, `/transcript-stream`, `/recent`, no auth, hard-coded room `test`. Bind to `0.0.0.0:7474`.
2. **Laptop X also** runs a manual host loop in another terminal: tail `/prompt-stream` with `curl -N`, let the human type responses that POST to `/events`. (No real Claude needed for this spike — we're testing transport.)
3. **Laptop Y (the "joiner")** runs `node ./prototype-cli.mjs join http://X:7474/r/test`. The prototype CLI:
   - Subscribes to `/transcript-stream` via fetch+stream parsing.
   - Renders incoming events to stdout (just `console.log`-style for the spike; real TUI lives in build phase).
   - Reads stdin via readline; on each line, POSTs to `/prompts`.
   - Calls `/recent` on connect for backfill.

### Test cases
1. **Round trip:** type "hello world" on Y, see `[Sankalp]: hello world` on X within 1s. Type a response on X, see it on Y within 1s.
2. **Backfill:** Ctrl+C the CLI on Y mid-session, restart it 30s later. Expect: `/recent` returns missed events, they render before live streaming resumes.
3. **Network drop:** disconnect Y's wifi for 30s, reconnect. Expect: SSE reconnects, `/recent` re-syncs, no events lost.
4. **Two joiners:** laptop Z also runs the prototype CLI for the same room. Expect: both Y and Z type prompts independently; both see all events; transcript stays consistent across all three machines.
5. **Clean exit:** Ctrl+C on Y. Expect: alternate screen buffer (if used) restored, leave event posted, process exits cleanly.

### Pass criteria
- All five test cases work.
- Joiner laptop Y has no Claude Code installed throughout the spike (verifies the no-CC requirement).
- Round-trip latency feels instantaneous (≤1s) on the same Wi-Fi.

### If it fails
- If round trip latency is >2s on the same Wi-Fi: profile the relay; usually a sign of a buffering issue in SSE — flush after every event.
- If `/recent` backfill misses events: tighten the ring buffer write/read order; expand from 200 to 500 if needed.
- If the SSE stream silently dies after long idle: add periodic heartbeat events from the relay (e.g. comment lines every 15s).

---

## What we deliberately do NOT spike

- **`UserPromptSubmit` block from a marketplace plugin.** Joiners no longer use Claude Code, so this code path is unused in v1. Skip.
- **Live transcript inside joiner Claude Code via a plugin monitor.** Same reason. Confirmed in docs that monitors are model input; not worth running.
- **Channels mode.** Out of v1 scope.
- **Cross-network without `cloudflared`.** Out of v1 scope; NAT-traversal spikes happen later if users push for it.
- **TUI library bake-off.** v1 uses raw ANSI + readline. If the experience is bad enough to warrant `ink`/`blessed`, that's a v1.1 polish pass.

## Output of the spike phase

A short markdown file per spike (`SPIKE_A_RESULTS.md`, etc.) with:
- Each test case ticked or marked failed.
- Any unexpected behavior (especially: things that worked but with rough edges).
- A "ready to build" or "design needs revision" verdict.

If any spike returns "design needs revision," the relevant section of `PLAN.md` is rewritten before any v1 build code lands.
