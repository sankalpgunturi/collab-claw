---
name: approve
description: Approve a pending collab-claw join request. Use only when the user explicitly types /collab-claw:approve <id> or after the user agrees to admit a teammate whose request was announced as `[collab-claw] Sankalp wants to join...`. Runs `collab-claw-approve <id>` via Bash.
disable-model-invocation: true
allowed-tools: Bash(collab-claw-approve:*)
---

# Approve

Run `collab-claw-approve <id>` using the Bash tool with the request id the user provided (or the id from the most recent `[collab-claw] ... wants to join ...` system line). Print its stdout verbatim.
