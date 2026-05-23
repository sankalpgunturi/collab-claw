# Testing

CollabClaw has 102 test cases across six scenario files. Everything
runs locally — no external services, no network calls. The full
suite finishes in well under a minute.

## Running

```bash
npm test                    # everything
npm run test:smoke          # relay-only (no CLI)
npm run test:e2e            # CLI host + simulated joiner + hooks
npm run test:gate           # monitor session-state gate (negative + positive)
npm run test:tui            # joiner TUI in plain mode
npm run test:regressions    # locked-in fixes from v0.1.1 + v0.1.2 reviews
npm run test:v11            # v0.2.0 feature coverage
```

## What each file covers

| File | Cases | Focus |
| --- | --- | --- |
| `test/smoke.mjs` | 21 | Relay routing end-to-end: pairing, prompt POST, transcript SSE, kicks, shutdown. |
| `test/e2e-cli.mjs` | 18 | Real `bin/collab-claw` subprocess driving a real relay; Stop-hook → transcript parse → post. |
| `test/monitor-gate.mjs` | 6 | Session-state gate (the Spike C finding): prompts go through ↔ session.json presence. |
| `test/tui-plain.mjs` | 3 | Plain-mode joiner TUI when stdin/stdout aren't TTYs. |
| `test/regressions.mjs` | 29 | Every review finding from v0.1.1 + v0.1.2 — queue replay, singleton, kicked SSE close, name validation, system format, stale-system filter, backpressure delivery counting. |
| `test/v1.1.mjs` | 25 | v0.2.0 features — persistence, history, expose guards, reconnect UX, markdown renderer, log-off. |

## CI

GitHub Actions runs `npm test` on every push to `main` and every PR,
against Node 20 + Node 22 × Ubuntu + macOS. See
[`.github/workflows/test.yml`](../.github/workflows/test.yml) and the
[badge on the README](../README.md).

## Adding a test

The existing files are good templates. They all use the same
pattern:

```js
let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) { console.log(`  ✓ ${name}${info ? '  ' + info : ''}`); pass++; }
  else    { console.log(`  ✗ ${name}${info ? '  ' + info : ''}`); fail++; }
}
```

Spawn the relay as a subprocess with the test fixture env vars,
fetch against `127.0.0.1:<port>`, and assert with `check()`.
Cleanup via `process.on('exit', ...)`.

For tests that restart the relay on the same port, use the
`killAndWaitExit` helper in `test/v1.1.mjs` — naive
`SIGTERM + setTimeout` races against EADDRINUSE on slow CI runners.
