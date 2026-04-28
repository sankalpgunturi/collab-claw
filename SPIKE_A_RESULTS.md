# Spike A — Results

**Goal:** Confirm a marketplace-installed plugin's `UserPromptSubmit` hook fires correctly, receives `.prompt`, and lets Claude process the prompt normally.

**Artifact:** `spikes/spike-a/` in this repo, published to https://github.com/sankalpgunturi/collab-claw-spike-a.

**Tester:** Sankalp
**Date:** 2026-04-26
**Claude Code version:** 2.1.119 (`~/.local/bin/claude`, installed via `claude.ai/install.sh`)
**Plan account:** Claude Max (Opus 4.7, 1M context)
**Host machine:** macOS, Apple Silicon (Sankalps-MacBook-Air-M4)

**Run command sequence (actual):**

```
# Terminal 1 (Cursor agent)
node spikes/spike-a/listener.mjs            # http://127.0.0.1:9999/test

# Terminal 2 (claude)
/plugin marketplace add sankalpgunturi/collab-claw-spike-a
/plugin install collab-claw-spike-a@collab-claw-spike-a
/reload-plugins
```

---

## T0 — Plugin install

| Check                                                                              | Pass / Fail | Notes |
| ---------------------------------------------------------------------------------- | ----------- | ----- |
| `/plugin marketplace add sankalpgunturi/collab-claw-spike-a` succeeds.             | **PASS**    | "Successfully added marketplace: collab-claw-spike-a" |
| `/plugin install collab-claw-spike-a@collab-claw-spike-a` succeeds.                | **PASS**    | "✓ Installed collab-claw-spike-a. Run /reload-plugins to apply." |
| `/plugin` Errors tab is empty for `collab-claw-spike-a`.                           | **PASS**    | No errors observed. |
| `/reload-plugins` confirms hook count.                                             | **PASS**    | "Reloaded: 1 plugin · 0 skills · 5 agents · 1 hook · 0 plugin MCP servers · 0 plugin LSP servers" |

Plugin is installed at `~/.claude/plugins/cache/collab-claw-spike-a/collab-claw-spike-a/0.0.1/`. Hook script's executable bit was preserved through the GitHub round trip.

---

## T1 — Normal prompt

**Action typed:** `hello world from spike-a test 1`

| Check                                                                       | Pass / Fail | Notes |
| --------------------------------------------------------------------------- | ----------- | ----- |
| Hook fired and stdin event was logged on disk.                              | **PASS**    | `~/.claude/plugins/data/collab-claw-spike-a-collab-claw-spike-a/hook.log`, hook fire @ 23:36:31Z. |
| `event.prompt` matches typed text verbatim.                                 | **PASS**    | `"hello world from spike-a test 1"` |
| Claude responds to the prompt normally.                                     | **PASS**    | Claude greeted and asked what to help with. |

---

## T2 — Multi-line prompt

**Action typed (3 lines):**
```
please write a tiny function that
takes a string
and returns its length
```

| Check                                                                                   | Pass / Fail | Notes |
| --------------------------------------------------------------------------------------- | ----------- | ----- |
| Hook fired.                                                                             | **PASS**    | hook fire @ 23:36:39Z. |
| `event.prompt` contains all three lines with `\n` separators preserved.                 | **PASS**    | Recorded as: `"please write a tiny function that\ntakes a string\nand returns its length"`. |
| Claude responds normally and writes the function.                                       | **PASS**    | Created `string_length.py` with `def string_length(s: str) -> int: return len(s)`. |

---

## T3 — Shell-weird characters

**Action typed:** `tell me about $() and "quotes" and \`backticks\` and ${HOME} and 'single' too`

| Check                                                                                | Pass / Fail | Notes |
| ------------------------------------------------------------------------------------ | ----------- | ----- |
| Hook fired.                                                                          | **PASS**    | hook fire @ 23:37:04Z. |
| `event.prompt` preserves `$()`, `"quotes"`, backticks, `${HOME}`, `'single'` literally. | **PASS**    | Recorded verbatim. No host-shell expansion of `$()` or `${HOME}`. |
| Claude responds normally with a shell-expansion explainer.                           | **PASS**    | |

The fact that bash `set -uo pipefail` + capturing stdin into a quoted variable + passing via `--data-binary "$input"` preserves all the special characters means we don't need a Node-based hook script for v1; bash with the discipline already in place is sufficient.

---

## T4 — Listener down (fail-open)

**Action typed:** `spike-a test 4 — listener should be down`

(In practice: the listener had also been down during T1–T3 due to a Cursor terminal lifecycle quirk, so T1–T3 ALSO exercised the fail-open path.)

| Check                                                                              | Pass / Fail | Notes |
| ---------------------------------------------------------------------------------- | ----------- | ----- |
| Claude processes the prompt normally and responds within usual latency.            | **PASS**    | Claude acknowledged the message and continued the conversation. |
| `curl_exit` in `hook.log` is non-zero (listener was down).                         | **PASS**    | All four hook fires recorded `curl_exit=7  curl: (7) Failed to connect to 127.0.0.1 port 9999 after 0 ms: Couldn't connect to server`. |
| Failure was instant (no user-visible delay).                                       | **PASS**    | "after 0 ms" — kernel-level ECONNREFUSED, well under the `--max-time 2` budget. |
| No error notification interrupts the user.                                         | **PASS**    | No errors surfaced in the Claude UI. |

---

## Closing-loop test (listener up)

After a clean listener restart, one additional prompt was fired to verify the full round trip works when the listener is alive: `spike-a closing-loop test — listener should now receive this`.

Listener output:

```
=== hook fire #1 @ 2026-04-26T23:39:47.112Z ===
content-length: 363
event keys: [
  'session_id', 'transcript_path', 'cwd',
  'permission_mode', 'hook_event_name', 'prompt'
]
event.prompt: "spike-a closing-loop test — listener should now receive this"
event.session_id: "f5a8b9f5-89df-4fd2-835c-b12bfeb75819"
```

Latency from prompt submit to listener receive: sub-second (event timestamp lines up with the user's submit).

---

## Verdict

- [x] **Ready to build** — all four test cases passed; design needs no revision.
- [ ] Ready to build with caveats.
- [ ] Design needs revision.

### Findings worth carrying forward

1. **Stdin event shape (canonical).** Claude Code 2.1.119 sends the following keys on stdin to a `UserPromptSubmit` hook: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `prompt`. Our `bin/prompt-submit` should `jq -r '.prompt'` (and read `.session_id`, `.cwd` as needed). The shape matches the public docs exactly.

2. **No expansion / no quoting issues.** Reading stdin into a bash variable and passing via `curl --data-binary "$input"` cleanly preserves multi-line and shell-special characters — no need for a Node hook script in v1.

3. **Fail-open is genuinely instant on `ECONNREFUSED`.** No `--max-time` budget gets consumed when the listener is just down. So if the relay isn't running for any reason, host UX is unaffected.

4. **`CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are both populated in the hook environment.** Production hook script can rely on `CLAUDE_PLUGIN_ROOT` for config locations and `CLAUDE_PLUGIN_DATA` for log/state files.

5. **Permission mode is on the event.** `permission_mode` field showed `"default"` for the first two prompts and `"acceptEdits"` for the next two (the user toggled `⏵⏵ accept edits on` in between). Worth surfacing in the broadcast event so joiners can see when the host is in a permissive mode — that's relevant for collab safety later, but not v1 critical.

### Side observation (not part of Spike A)

While running the closing-loop test, the listener also captured a hit from **Cursor's own hook system** when the user typed "fired" into Cursor's chat: `hook_event_name: "beforeSubmitPrompt"`, with Cursor-shaped fields (`conversation_id`, `generation_id`, `cursor_version`, `composer_mode`, `workspace_roots`, etc.). Cursor and Claude Code share or can re-use the same hook script binaries on this machine. Interesting for v1.3 cross-tool ambitions; ignore for v1.

---

## Cleanup performed

- Listener stopped (port 9999 freed).
- Spike plugin still installed in Claude Code; can be uninstalled with:

```
/plugin uninstall collab-claw-spike-a@collab-claw-spike-a
/plugin marketplace remove collab-claw-spike-a
```

The GitHub repo `sankalpgunturi/collab-claw-spike-a` and the `spikes/spike-a/` artifact in this repo are kept as reference for Spike B and as a published example of the corrected production marketplace layout.

---

## Next

Spike A passes. Per `SPIKES.md` gating, proceed directly to **Spike B** — the production-path host monitor (`on-skill-invoke:host`) waking idle Claude on `[Name]: …` lines. That's the actual gate for v1.
