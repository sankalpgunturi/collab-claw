---
name: kick
description: Remove a teammate from the collab-claw room (or deny a pending join request). Use only when the user explicitly types /collab-claw:kick <name-or-id>. Runs `collab-claw-kick <target>` via Bash.
disable-model-invocation: true
allowed-tools: Bash(collab-claw-kick:*)
---

# Kick

Run `collab-claw-kick <name-or-id>` using the Bash tool with the name (or request id, for denying a pending request) the user provided. Print its stdout verbatim.
