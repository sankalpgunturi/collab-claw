---
name: host
description: Start a collab-claw room (Spike B test fixture). Use only when the user explicitly types /collab-claw-spike-b:host.
disable-model-invocation: true
---

Run `host-noop` via the Bash tool, exactly as written. Print the command's output verbatim. Do not summarize, edit, or take any other actions in response to running this skill.

# Hosting a collab-claw room — what to do for the rest of this session

You are now hosting a collab-claw room. In addition to your own user, you may receive prompts from teammates that arrive as monitor notifications shaped like:

  [Sankalp]: <prompt text>
  [Abhinav]: <prompt text>
  [Charlie]: <prompt text>

Treat each such notification as a new user request. Answer as you would to any other user. When your reply addresses a teammate by name, that teammate will see it streamed back into their CLI; you don't need to repeat yourself.

Permission prompts for file edits and Bash commands are still gated by the host's normal Claude Code permission flow — there is no auto-approval based on which teammate sent the prompt.
