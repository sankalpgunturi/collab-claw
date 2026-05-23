<p align="center">
  <img src="docs/logo.svg" alt="CollabClaw" width="180">
</p>

<h1 align="center">CollabClaw 🦞</h1>

<p align="center">
  <em>Pair-program with one Claude across multiple laptops.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/collab-claw"><img alt="npm" src="https://img.shields.io/npm/v/collab-claw?logo=npm&color=cb3837"></a>
  <a href="https://github.com/sankalpgunturi/homebrew-tap"><img alt="Homebrew" src="https://img.shields.io/badge/homebrew-sankalpgunturi%2Ftap-orange?logo=homebrew"></a>
  <a href="https://github.com/sankalpgunturi/collab-claw/actions/workflows/test.yml"><img alt="tests" src="https://img.shields.io/github/actions/workflow/status/sankalpgunturi/collab-claw/test.yml?branch=main&label=tests&logo=github"></a>
  <a href="https://github.com/sankalpgunturi/collab-claw/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/sankalpgunturi/collab-claw?logo=github&sort=semver"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/github/license/sankalpgunturi/collab-claw?color=blue"></a>
</p>

---

**CollabClaw** is screen-sharing for Claude Code. Three people, one
Claude — everyone types from their own laptop, everyone sees the same
conversation.

```mermaid
flowchart LR
    Alice(["👩 Alice"])
    Bob(["👤 Bob"])
    Carol(["👤 Carol"])
    Claude{{"🤖 Claude<br/>(on Alice's laptop)"}}
    Alice <==> Claude
    Bob <-.-> Claude
    Carol <-.-> Claude
    classDef person fill:#e2eafd,stroke:#2a4dc4,color:#1a1a1a;
    classDef ai fill:#fde9e2,stroke:#c44322,color:#1a1a1a,font-weight:bold;
    class Alice,Bob,Carol person;
    class Claude ai;
```

Alice runs `claude` as usual. Bob and Carol run the `collab-claw` CLI
on their own laptops. When Bob types a prompt, Alice's Claude sees it
as `[Bob]: ...` and responds. Everyone sees every response, in real
time, in their terminal.

- 🦞 **One Claude.** Only Alice's machine runs Claude Code.
- 💸 **One bill.** Joiners don't run Claude at all, so there are no
  joiner tokens to burn.
- 🏠 **Local-first.** The connection is over your LAN by default.
  Cross-network is opt-in (`collab-claw expose`).
- 🔐 **Approval-gated.** Joiners only get in when Alice says so;
  kicks revoke access immediately.

## Quick start

You need **Node.js ≥ 20** everywhere. The host also needs **Claude Code**.

**1. Install** (host + joiners):

```bash
npm install -g collab-claw          # or: brew tap sankalpgunturi/tap && brew install collab-claw
collab-claw set-name Alice
```

**2. Host a room** (in a Claude Code session):

```
/plugin marketplace add sankalpgunturi/collab-claw
/plugin install collab-claw
/collab-claw:host
```

Claude prints a join URL. DM it to your teammates.

**3. Join a room** (any terminal on a teammate's machine):

```bash
collab-claw join http://10.0.0.42:7474#secret=...
```

When the host runs `/collab-claw:approve <id>`, the joiner's TUI
lights up. Type prompts, hit Enter, watch Claude respond — together.

## Docs

The README is the front door. Everything else lives in [`docs/`](./docs/):

- [**docs/commands.md**](./docs/commands.md) — full CLI + slash command reference; cross-network (`expose`); transcript history.
- [**docs/architecture.md**](./docs/architecture.md) — how it works end-to-end, file tree, key design decisions.
- [**docs/configuration.md**](./docs/configuration.md) — environment variables, local files, what's stored where.
- [**docs/testing.md**](./docs/testing.md) — running the test suite.

Standard project files:

- [**CONTRIBUTING.md**](./CONTRIBUTING.md) — dev loop, branch rules, PR checklist.
- [**SECURITY.md**](./SECURITY.md) — threat model and vulnerability disclosure.
- [**CODEOWNERS**](./CODEOWNERS) — who reviews what.
- [**LICENSE**](./LICENSE) — MIT.

## License

MIT. Use it, fork it, ship it. Bugs and feature requests welcome at
[Issues](https://github.com/sankalpgunturi/collab-claw/issues).
