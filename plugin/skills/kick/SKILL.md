---
name: kick
description: Remove a teammate from the collab-claw room. Use only when the user explicitly types /collab-claw:kick <name>. Runs `bin/kick <name>` via Bash.
disable-model-invocation: true
allowed-tools: Bash(kick *)
---

# Kick

Run `kick <name>` using the Bash tool with the name (or request id, for denying a pending request) the user provided. Print its stdout verbatim.
