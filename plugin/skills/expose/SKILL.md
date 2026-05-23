---
name: expose
description: Start a managed Cloudflare quick tunnel for the current collab-claw room. Use only when the user explicitly types /collab-claw:expose. Runs `collab-claw-expose` via Bash and prints output verbatim.
disable-model-invocation: true
allowed-tools: Bash(collab-claw-expose:*)
---

# Expose a collab-claw room

Run the command `collab-claw-expose` (no arguments) using the Bash tool, and print its stdout verbatim into the chat. Do not paraphrase. Do not summarize. The output contains the public Cloudflare join URL the user will DM to teammates.

If the command says `cloudflared` is missing, tell the user to install it on the host machine and retry:

```bash
brew install cloudflared
```
