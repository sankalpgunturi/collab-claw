# collab-claw — Vision

## The problem

A team is building something. Each engineer is pair-programming with Claude in their own Claude Code session. The agents are powerful. The agents are also lonely — they have no idea what their teammates' agents are doing, or what their humans are typing into them.

So the humans pay a coordination tax:

- "Wait, don't have your Claude touch `auth/` — mine just edited it."
- "Can you ask your Claude to add tests for the route I just shipped?"
- "Hold on, let me describe to my Claude what your Claude did."

The agents got good enough that teams want to pair with them on the same project simultaneously. The defaults — "everyone runs their own agent on their own copy of the code" — get visibly painful the moment three people try it.

## The insight

The fix isn't three coordinated agents. The fix is **one Claude, multiple humans**.

Claude Code on the host's side has every primitive needed to make this real:

- **`UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` hooks** — the host's plugin broadcasts each prompt, each tool call, and each response to a small local relay.
- **A single host-side background monitor** — feeds joiner prompts arriving over the relay back into the host's Claude as `[Name]: …` notifications, so Claude treats them as fresh user requests.
- **Plugins** — packaged distribution via the official Claude Code marketplace, no fork, no patches.

The joiner side never runs Claude. They install our small CLI, run `collab-claw join <url>`, and get a Claude-Code-flavored TUI: scrolling transcript above, prompt at the bottom. Typed prompts go to the relay; transcript events stream back over SSE.

## The vision

> A team is starting a project together. Somebody runs `claude` and types `/collab-claw:host`. They DM the room URL to their teammates. The teammates run `collab-claw join <url>` from their own terminal — no Claude Code installation needed on the joiner side, just our small CLI. From that moment onward they are *in the same session*. Every prompt anyone sends gets prefixed with their name and reaches the same Claude. Every tool call appears in everyone's terminal as it starts and as it completes; the final assistant response shows up in everyone's terminal when the turn ends.
>
> It feels like everyone walked over to one laptop and is watching the same Claude work — except they're each at their own desk, on their own laptop, and Claude knows who's asking.

A year from now, this is what people mean when they say "let's pair on this with Claude" — and they assume it's their whole team, not one person.

## What "great" looks like

- **Install in about a minute.** Hosts: `npm install -g collab-claw`, then inside `claude` run `/plugin marketplace add collab-claw/collab-claw` followed by `/plugin install collab-claw@collab-claw` (which prompts once for your display name). Joiners: `npm install -g collab-claw && collab-claw set-name <you>`. Two commands on each side once the marketplace is added.
- **Joiners don't need Claude Code.** They install one CLI tool and run `collab-claw join <url>`. No marketplace, no plugin, no Claude Code at all on their machine.
- **Works for any `claude` user.** No Pro requirement. No Max requirement. No `--dangerously-*` flags. No `claude.ai` login requirement. If `claude` runs on your machine, you can host. If Node runs on your machine, you can join.
- **Local-first by default.** The relay runs on the host's laptop. On the same Wi-Fi, joiners connect over LAN. Cross-network needs an opt-in tunnel via `/collab-claw:expose`. Nothing leaves the host's machine unless the host explicitly chooses.
- **Host in one slash command.** `/collab-claw:host` prints a room URL.
- **Join in one CLI command.** `collab-claw join <url>` opens a Claude-Code-flavored TUI: scrolling transcript above, prompt at the bottom.
- **Type as yourself.** Every prompt you send is auto-prefixed with your name; the host's Claude sees `Sankalp: ...` and acts on it.
- **One bill, structurally.** There is no Claude on the joiner side, so there are no joiner tokens to consume. The "one bill" guarantee is a property of the architecture, not a hope.
- **Invisible when off.** No room joined? The plugin is a no-op for the host. The CLI is just a binary on disk for the joiner.
- **CLI-native end to end.** Both surfaces are terminals. No browser tab, no IDE switch, no out-of-band tool.

## What we are *not* building (in v1)

- **Not a multi-Claude coordinator.** There is exactly one Claude per room, on the host's machine. v1 doesn't try to orchestrate multiple agents.
- **Not a filesystem syncer.** The host's working directory is *the* working directory. Joiners don't need a local checkout — they're remote-controlling the host's Claude.
- **Not a chat app.** There is no human-to-human chat channel. The "chat" is the prompt stream into Claude. If humans want to talk to each other, they use Discord or Slack.
- **Not a browser app.** Joiner output is a CLI TUI, not a webview. We picked CLI deliberately — Claude Code is CLI, the joiner experience should match.
- **Not Cursor / OpenCode / Codex (yet).** v1 is Claude-Code-only on the host side. The relay's wire format is the contract that future adapters target.
- **Not hosted infrastructure.** Day one: the host runs the bundled relay locally. If the team isn't on the same network, the host opts into a Cloudflare quick tunnel (free, no account, no data stored). A hosted relay comes later only if users ask for one.
- **Not for Bedrock / Vertex / Foundry hosts.** Those providers don't expose the Monitor tool that's required to deliver remote prompts to a live session. Joiners are unaffected — they don't use Claude Code at all. Only hosts on direct Anthropic API or Claude.ai-backed CLIs (Pro/Max) are supported in v1.

## Why now

1. Claude Code's plugin system now ships hooks for every interesting event in a turn (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) **and** background monitors that feed lines into the model as fresh user requests. The first set lets us broadcast a session out; the second lets remote prompts reach an idle Claude. Until both existed, this wasn't buildable as a plugin.
2. Coding agents got good enough that *teams* of humans want to pair with them on the same repo simultaneously.
3. The defaults of "one human, one agent, one copy of the code" are visibly painful the moment a team tries to pair on it.

## The first version

Two artifacts, one source repo:

A **`collab-claw` CLI** (npm + Homebrew) that joiners install:

- **`collab-claw join <url>`** — full-screen TUI: scrolling transcript, prompt at the bottom, name attribution baked in.
- **`collab-claw watch <url>`** — read-only variant, no input.
- **`collab-claw set-name`**, **`collab-claw status`**, **`collab-claw leave`** — the obvious housekeeping.

A **`collab-claw` Claude Code plugin** (official plugin marketplace) that hosts install:

- **`/collab-claw:host`** — starts a local relay, generates a room URL, registers the current session as host.
- **`/collab-claw:expose`** — optional, opt-in: starts a Cloudflare quick tunnel so out-of-network teammates can join.
- **`/collab-claw:approve`**, **`/collab-claw:kick`**, **`/collab-claw:status`**, **`/collab-claw:end`** — the obvious housekeeping.
- **A single host-side plugin monitor** that delivers joiner prompts into Claude as `[Name]: …` notifications.
- **`UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` hooks** that broadcast each prompt, each tool start, each tool result, and each final response to the local relay so joiner CLIs can render them as they arrive.
- **A small Node relay** with rooms, ring buffer, SSE streaming, token-based auth, in-memory state.

Total v1 surface: one CLI with eight subcommands, one plugin with seven slash commands, four host-side hooks, one host-side monitor, one relay. Small enough to read end-to-end. Big enough to change how a team pair-codes — for any team, on any plan, on any laptop.

## North star

A year from now, the test of whether `collab-claw` succeeded is this:

> A team starts a new project together. Within the first hour, somebody types `/collab-claw:host` and pastes the URL into Slack. The rest of the team runs `collab-claw join <url>` and they're all in. From then on, pair-coding with AI means *team*-coding with AI, and nobody on the team can imagine doing it any other way.

If team-pair-coding becomes the default mental model for AI coding, `collab-claw` was the cheapest possible v0 of that idea — a CLI, a plugin, four hooks, one monitor, a tiny relay. Built on top of Claude Code, not against it.
