# Configuration

Environment variables, local files, and what's stored where.

## Environment variables

Set on the host before `/collab-claw:host`:

| Var | Default | Meaning |
| --- | --- | --- |
| `COLLAB_CLAW_PORT` | `7474` | Relay port |
| `COLLAB_CLAW_BIND` | `0.0.0.0` | Bind interface. Set to `127.0.0.1` when fronting with a tunnel. |
| `COLLAB_CLAW_LOG` | `on` | Set `off` to skip persisting transcript events to disk. |
| `COLLAB_CLAW_LOG_DIR` | `~/.collab-claw/log` | Override the persistence directory. |
| `COLLAB_CLAW_RING` | `200` | In-memory event ring buffer size (for `/recent` backfill). |
| `COLLAB_CLAW_PROMPT_QUEUE` | `200` | Sequenced prompt queue size (for `Last-Event-ID` replay). |
| `COLLAB_CLAW_DEBUG` | unset | If set, prints stack traces on errors. |

## Local files

| Path | Mode | Purpose |
| --- | --- | --- |
| `~/.collab-claw/config.json` | 0644 | Display name, default port. Survives across rooms. |
| `~/.collab-claw/session.json` | 0600 | Active host or joiner state. Deleted on `end`/`leave`. |
| `~/.collab-claw/log/<roomId>.jsonl` | 0600 | Persisted transcript (one event per line). |
| `~/.claude/data/collab-claw/monitor.log` | 0644 | Monitor's debug log. |

The host's `session.json` contains the host token; `mode 0600` is
enforced on every write. Member tokens never land on disk anywhere
(joiner `session.json` carries only the joiner's own member token).

## What's in a persisted log line?

Each line of `~/.collab-claw/log/<roomId>.jsonl` is a self-contained
JSON event. The four kinds you'll see:

```json
{"kind":"prompt",    "name":"Bob",       "text":"add tests for the auth route", "ts":"2026-05-23T17:00:01Z"}
{"kind":"response",  "name":"Alice",     "text":"Done — see auth/test.mjs",     "ts":"2026-05-23T17:00:42Z"}
{"kind":"tool_pre",  "name":"Alice",     "text":"Write: auth/test.mjs",         "ts":"2026-05-23T17:00:30Z"}
{"kind":"tool_post", "name":"Alice",     "text":"Write: auth/test.mjs",         "ts":"2026-05-23T17:00:31Z"}
{"kind":"system",                        "text":"Bob left the room.",           "ts":"2026-05-23T17:05:00Z"}
```

For pretty rendering, use `collab-claw history <roomId>`. For raw
piping into `jq`/`grep`/whatever, use `collab-claw history <roomId>
--json`.
