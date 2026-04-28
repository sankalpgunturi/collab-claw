# collab-claw — Spike A

A throwaway plugin used to verify a single thing: **a plugin distributed via the Claude Code public marketplace can register a `UserPromptSubmit` hook that POSTs the user's prompt to a local HTTP endpoint and exits 0, with Claude still processing the prompt normally.**

Layout matches the production marketplace shape exactly:

```
collab-claw-spike-a/
├── .claude-plugin/
│   └── marketplace.json          ← repo-root marketplace catalog
└── plugin/
    ├── .claude-plugin/
    │   └── plugin.json           ← plugin manifest
    ├── hooks/
    │   └── hooks.json            ← single UserPromptSubmit entry
    └── bin/
        └── echo-prompt           ← bash hook script
```

`listener.mjs` is the local HTTP server that records every hook fire — it's not part of the plugin; it lives outside `plugin/` and is run separately on the host's machine.

## Run the spike

```bash
# Terminal 1 — start the listener
node listener.mjs

# Terminal 2 — install the plugin in claude
claude
> /plugin marketplace add sankalpgunturi/collab-claw-spike-a
> /plugin install collab-claw-spike-a@collab-claw-spike-a
> /reload-plugins

# Then type prompts. Watch terminal 1 for hook fires.
```

Test cases are in `SPIKE_A_RESULTS.md` at the root of the parent repo.

## Cleanup

```bash
claude
> /plugin uninstall collab-claw-spike-a@collab-claw-spike-a
> /plugin marketplace remove collab-claw-spike-a
```
