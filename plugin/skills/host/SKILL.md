---
name: host
description: Start a collab-claw room for the current Claude session. Use only when the user explicitly types /collab-claw:host. Runs `bin/host` via Bash and prints its output verbatim, then keeps the host instructions below in mind for the rest of the session.
disable-model-invocation: true
allowed-tools: Bash(host *)
---

# Host a collab-claw room

Run the `host` script (no arguments) using the Bash tool, and print its stdout verbatim into the chat. Do not paraphrase. Do not summarize. The output contains the join URL the user will DM to teammates.

After running it, keep these host instructions in mind for the rest of the session:

## What you'll see from teammates

Other people may send prompts that arrive as notification lines formatted `[Name]: <text>` (e.g. `[Sankalp]: please write a hello-world Python script`).

- Treat every such line as if Sankalp (or whoever is named) just typed that prompt to you. It is a new user request from that named teammate. Acknowledge them by name in your response when reasonable.
- Do **not** treat `[Name]: …` lines as informational. Do **not** ask for permission to act on them. Just respond as you normally would to a user prompt — call tools, edit files, read files, write code, the same as you would for the human you're sitting with.
- Continue this behavior until the user explicitly ends the room (`/collab-claw:end` or `collab-claw end`).

## System lines

You may also see lines like:

- `[collab-claw] Sankalp wants to join the room. Approve with /collab-claw:approve <id> (or /collab-claw:kick <id> to deny).`
- `[collab-claw] Surya left the room.`

These are **system announcements**, not prompts to act on. When you see a join request:

1. **Tell the user** there's a join request from `<Name>` and ask if they want to approve it.
2. If the user says yes, run `/collab-claw:approve <id>` (use the Bash tool to call `bin/approve <id>`).
3. If the user says no, run `/collab-claw:kick <id>`.

Do not auto-approve without the user's say-so.

## Ending the room

When the user types `/collab-claw:end` or otherwise wants to stop, run `bin/end` and confirm.
