# Contributing to CollabClaw

Thanks for considering a contribution! Bug reports, feature ideas,
docs fixes, and PRs are all welcome.

## Quick start

```bash
git clone https://github.com/sankalpgunturi/collab-claw.git
cd collab-claw
npm install            # no runtime deps; this is currently a no-op
npm test               # should pass 105/105 in ~30s
```

There are zero runtime dependencies. The full test suite spawns the
relay and CLI as subprocesses against `127.0.0.1`, so you don't need
a network connection or any external services to develop or run tests.

## Where the interesting code lives

- `src/relay/server.mjs` — the HTTP+SSE relay. Routes, pairing,
  prompt-queue replay, SSE fan-out. Most "did the wire format break?"
  bugs live here.
- `src/tui/join.mjs` — the raw-ANSI joiner TUI. Tricky non-obvious code
  for scroll regions, anchored prompt input, and reconnect state.
- `src/commands/monitor.mjs` — the always-on host monitor. The
  session-state gate is the safety-critical bit (see
  `test/monitor-gate.mjs`).
- `plugin/.claude-plugin/plugin.json` — the top-level `monitors`
  array. **Don't** add a `when: on-skill-invoke:*` clause; that
  variant is silently broken in Claude Code 2.1.119 (see
  `SPIKE_B_RESULTS.md`).

## Workflow

1. **Open an issue first** for anything bigger than a typo or a
   one-liner. It saves both of us doing duplicate work, and lets us
   discuss the API surface before you write code.
2. **Fork + branch** off `main`. Branch name doesn't matter; we squash
   on merge.
3. **Add a test** in `test/` that fails without your change and passes
   with it. The existing files are good templates — most use a small
   pass/fail counter and spawn the relay in-process.
4. **Run `npm test`** locally. CI re-runs on Node 18, 20, and 22.
5. **Open a PR** against `main`. Keep the description focused on the
   "why" — the diff already shows the "what".
6. **Code review** will look at correctness, tests, and whether the
   change fits the project's "small, hackable, no runtime deps" ethos.

## Style

- ES modules (`.mjs`), Node ≥ 18 features OK (top-level await, native
  `fetch`, etc.).
- Comments explain *why*, not *what*. Lean toward fewer comments,
  better names.
- No runtime dependencies. Dev-only deps are OK if they pay for
  themselves.
- Prefer composition over abstraction; this is a small codebase and
  early indirection costs more than it saves.

## Commit messages

Following the existing style (loosely
[Conventional Commits](https://www.conventionalcommits.org/)):

```
<type>(<scope>): <one-line summary>

<body explaining why the change is needed and what tradeoffs were made>
```

`type` is one of: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`.
`scope` is usually a directory or feature area (`relay`, `tui`, `cli`,
`bin`, `plugin`).

## Branch protection

`main` is protected. PRs must:

- Pass the `test` CI workflow on all supported Node versions.
- Get at least one approving review (the maintainer counts).
- Be up to date with `main` before merge (squash-merge preferred).

Direct pushes to `main` are blocked by GitHub.

## Reporting security issues

**Do not** open a public issue. See [SECURITY.md](./SECURITY.md) for
the disclosure process.

## Code of conduct

Be excellent to each other. We follow the spirit of the [Contributor
Covenant](https://www.contributor-covenant.org/) — assume good faith,
keep critique technical, and don't be a jerk. The maintainer reserves
the right to remove comments, commits, code, wiki edits, issues, and
contributions that aren't aligned with this policy, and to ban
contributors for behaviors deemed inappropriate.
