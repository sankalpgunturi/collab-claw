# Security policy

**CollabClaw** brokers prompts and responses between humans and a
running Claude Code session. Treat security reports seriously — the
host's machine is implicitly trusted by everyone in the room.

## Supported versions

Only the latest minor release line gets security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | ✅ |
| 0.1.x   | ❌ (please upgrade) |

## Reporting a vulnerability

**Please don't open a public GitHub issue for security problems.**

Open a private security advisory:

> <https://github.com/sankalpgunturi/collab-claw/security/advisories/new>

Or, if you'd rather email, reach the maintainer through the address on
the GitHub profile linked from the `package.json` `author` /
`repository` URL.

Please include:

- A short description of the issue.
- Reproduction steps or a proof-of-concept (CLI commands or HTTP requests
  against the relay are usually enough).
- What you tried before reporting and the version you tested against
  (`collab-claw version`).
- Any suggested fix or mitigation.

You'll get an acknowledgement within a few days. Disclosure timeline is
case-by-case — we'll publish a fix and credit you (unless you'd rather
stay anonymous) once a patched release is out.

## Threat model

**In scope**

- Keep room contents (prompts, Claude responses, tool calls) confined
  to the host and approved joiners.
- Prevent unapproved joiners from reading or writing the room.
- Prevent kicked joiners from continuing to receive the transcript.
- Make joiner display names un-spoofable in the host's notification
  format (`[Name]: <text>`).
- Avoid leaking the room secret or host token via predictable paths
  (proxy logs, transcripts, the Claude Code session).

**Out of scope**

- The host's Claude Code session is fully trusted — CollabClaw doesn't
  sandbox what Claude can do on the host's machine. Joiner prompts get
  delivered to the host's Claude as user requests; Claude's reaction
  to those prompts is governed by the same Claude Code permission
  policies and skills the host has configured. Run Claude with the
  permission settings you'd run it with in a solo session.
- Network-layer adversaries on the LAN can already read unencrypted
  HTTP between the host and joiners; if you don't trust the network,
  use `collab-claw expose` (Cloudflare quick tunnel terminates TLS) or
  front the relay with your own TLS-terminating tunnel. End-to-end
  encryption of payloads is on the roadmap.
- DoS resistance on the relay is best-effort. The relay enforces body
  size limits and a bounded prompt queue, but isn't designed to
  withstand sustained attack from a hostile joiner — the host can
  always `/collab-claw:kick` and the relay revokes their tokens.

## Controls in v0.2.x

- **Room secret in URL fragment** — never sent to the relay except as
  a `Bearer` header on `POST /join-requests`. Browsers and curl strip
  fragments from logs.
- **Host token** stays on the host's machine in `session.json` (mode
  0600). It authorizes host hooks and admin endpoints. Joiners never
  see it.
- **Member tokens** are minted by the relay at approval time and
  returned only to the joiner's long-poll wait. They never traverse
  Claude Code, the plugin, or the host transcript. Revoked on
  `/leaves` or `/kicks`; active SSE streams are closed server-side on
  kick.
- **Display name validation** runs both client- and server-side
  (1–32 chars, alphanumeric/space/dash/underscore). Names are stripped
  of newlines and brackets before they reach the host's monitor stdout,
  so a hostile joiner can't injection-impersonate the system
  (`[collab-claw]`) or another teammate.
- **Single-subscriber `/prompt-stream`** prevents stale monitors
  (e.g. from `/plugin reload`) from double-delivering joiner prompts
  to Claude.
- **Per-event size caps**: 8 KB per prompt; 1 MB per `/events` body.
- **Loopback option**: set `COLLAB_CLAW_BIND=127.0.0.1` to restrict the
  relay to loopback (recommended when fronting with a tunnel).
