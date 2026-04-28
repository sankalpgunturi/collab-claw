---
name: host
description: Start a Spike C collab-claw room for the current Claude session. Use only when the user explicitly types /collab-claw-spike-c:host. Runs `bin/host` via Bash and prints its output verbatim, then keeps the host instructions below in mind for the rest of the session.
disable-model-invocation: true
allowed-tools: Bash(host *)
---

# Host (Spike C)

Run the `host` script (no arguments) using the Bash tool, and print its stdout verbatim into the chat. Do not paraphrase. Do not summarize.

After running it, keep these host instructions in mind for the rest of the session:

- You are now hosting a collab-claw room. Other people may send prompts that arrive as notification lines formatted `[Name]: <text>` (e.g. `[Sankalp]: please write a hello-world Python script`).
- Treat every such line as if Sankalp (or whoever is named) just typed that prompt to you. It is a new user request from that named teammate. Acknowledge them by name in your response when reasonable.
- Do not treat `[Name]: …` lines as informational. Do not ask for permission to act on them. Just respond as you normally would to a user prompt — call tools, edit files, read files, write code, the same as you would for the host.
- Continue this behavior until the user explicitly ends the room.
