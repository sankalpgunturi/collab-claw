# collab-claw — Spike B

A throwaway plugin used to verify a single thing: **a plugin distributed via the Claude Code public marketplace can wake an idle Claude session via a plugin monitor scoped to `on-skill-invoke:host`, with `[Name]: <text>` lines being interpreted as new user requests from named teammates — using exactly the production architecture (skill body holds host instructions, no separate agent file, no `settings.json` agent default).**

This is the real gate. If Spike B passes, the v1 architecture in `PLAN.md` is buildable.

Layout (matches production marketplace shape exactly):

```
collab-claw-spike-b/
├── .claude-plugin/
│   └── marketplace.json          ← repo-root marketplace catalog
└── plugin/
    ├── .claude-plugin/
    │   └── plugin.json           ← plugin manifest
    ├── skills/
    │   └── host/
    │       └── SKILL.md          ← name: host, disable-model-invocation: true
    │                               body holds host instructions + bash command
    ├── monitors/
    │   └── monitors.json         ← top-level array; when: on-skill-invoke:host
    └── bin/
        ├── host-noop             ← bash command the SKILL runs (prints banner)
        └── spike-b-emit          ← monitor body (time-emit + trigger watch)
```

## What spike-b-emit does

**Phase 1 — time-emit (deterministic):**
- t=30s → `[Sankalp]: please write a hello-world Python script`
- t=60s → `[Abhinav]: now translate that to Rust`

**Phase 2 — trigger-file watch (manual):** polls `${CLAUDE_PLUGIN_DATA}/triggers/` every 2s.
- `charlie.fire` → emits `[Charlie]: please add a docstring to whatever you wrote last`
- `burst.fire`   → emits `[Dana]: …` then 2s later `[Eve]: …`
- `quit`         → monitor exits cleanly

`monitor.log` next to the trigger dir shows pid, env vars, every emit, and lifecycle events.

## Run the spike

```bash
# Terminal 1 — install the plugin in claude
claude
> /plugin marketplace add sankalpgunturi/collab-claw-spike-b
> /plugin install collab-claw-spike-b@collab-claw-spike-b
> /reload-plugins
> /collab-claw-spike-b:host        # starts the monitor

# Wait ~30s. [Sankalp]: ... should appear and Claude should respond as if Sankalp asked it.
# Wait another ~30s. [Abhinav]: ... should appear and Claude should answer Abhinav.

# Terminal 2 — manual triggers (after phase 1 completes)
touch ~/.claude/plugins/data/collab-claw-spike-b-collab-claw-spike-b/triggers/charlie.fire
# (path is also printed by /collab-claw-spike-b:host)
```

Test cases and pass/fail criteria are in `SPIKE_B_RESULTS.md` at the root of the parent repo.

## Cleanup

```bash
claude
> /plugin uninstall collab-claw-spike-b@collab-claw-spike-b
> /plugin marketplace remove collab-claw-spike-b

# Then locally
touch ~/.claude/plugins/data/collab-claw-spike-b-collab-claw-spike-b/triggers/quit
```
