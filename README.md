# Agent Office

A walkable 3D office where every running AI coding agent (Claude Code, Codex,
and anything else you write a feeder for) is a person at a desk. Watch their
monitors, walk up and ask what they're working on, and spend the coins your
commits and merged PRs earn on more desks, so the office grows with the work
you actually ship.

- **Live agents, real state.** Each agent's pose, monitor and status come from
  its own transcript: typing while it works, waving when it needs you, asleep
  when its session goes quiet.
- **Talk to them.** Ask any agent a question; a short, cheap model call reads
  its session log and answers in character, without interrupting it.
- **One team per table.** Each pod belongs to one repository, and git
  worktrees count as their parent repo. Teams without a table wait in the lobby.
- **Build to grow.** Coins buy pods (four desks each), a lounge, a meeting room,
  a server room and decor.
- **Ambience.** A lo-fi loop generated live with Web Audio, day and night
  lighting, and short lines from agents grounded in what they're really doing.

## How it fits together

```
 machine with agents                    anywhere                 browser
┌───────────────────────┐   snapshots   ┌──────────────┐   ws    ┌──────────────┐
│ feeder/feeder.py      │ ────────────▶ │ server/hub   │ ──────▶ │ React Three  │
│ reads ~/.claude,      │ ◀──────────── │ seats agents │ ◀────── │ Fiber client │
│ ~/.codex (read-only)  │   ask jobs    │ runs the shop│         │              │
└───────────────────────┘               └──────────────┘         └──────────────┘
```

- **`feeder/feeder.py`** runs on each machine that has agents. It reads Claude
  Code transcripts (`~/.claude/projects`) and Codex rollouts (`~/.codex/sessions`)
  read-only and posts a snapshot to the hub every few seconds. Standard library
  only; install `zstandard` to read compressed Codex rollouts.
- **`server/hub.mjs`** serves the client, merges snapshots from every feeder,
  decides who sits where, runs the shop and relays questions back to the feeder
  that can read the agent's transcript. Its only dependency is `ws`.
- **`src/`** is the client: React Three Fiber, drei and three.js with
  procedural characters, so there are no third-party art assets to license.

## Quick start

```bash
npm install
npm run build
OFFICE_TOKEN=dev OFFICE_HOST=127.0.0.1 node server/hub.mjs      # http://127.0.0.1:8825/office/

# in another terminal, on the machine running your agents
OFFICE_HUB_URL=http://127.0.0.1:8825/office OFFICE_TOKEN=dev python3 feeder/feeder.py

# no agents yet? see it with simulated ones
OFFICE_HUB_URL=http://127.0.0.1:8825/office OFFICE_TOKEN=dev python3 feeder/feeder.py --demo
```

`npm run dev` serves the client with hot reload and proxies to a hub on 8825.
Add `#lineup` to the URL to see the characters side by side.

### Docker

```bash
cp office.env.example office.env    # set OFFICE_TOKEN and OFFICE_ALLOWED_ORIGINS
docker compose up -d --build        # binds 127.0.0.1:8835 by default (OFFICE_BIND to change)
```

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `OFFICE_TOKEN` | hub, feeders | Shared secret feeders use to post snapshots |
| `OFFICE_ALLOWED_ORIGINS` | hub | Comma-separated origins allowed to open the websocket; `localhost` is always allowed |
| `OFFICE_BASE_PATH` | hub | URL prefix, default `/office` (the client is built for it) |
| `OFFICE_DATA` | hub | Where the office layout, coins and conversations are saved |
| `OFFICE_HUB_URL` | feeder | The hub, including its base path |
| `OFFICE_MACHINE` | feeder | Name shown for this machine, default the hostname |
| `OFFICE_ASK_MODEL` | feeder | Model for answering questions through `claude -p`, default `sonnet` |

Feeders also read `~/.config/agent-office/feeder.env` (`KEY=value` lines).

## Writing your own feeder

A feeder is anything that POSTs JSON to `{hub}/api/ingest` with
`Authorization: Bearer $OFFICE_TOKEN`, and long-polls `{hub}/api/jobs?machine=…`
to answer questions. The snapshot looks like this:

```json
{
  "machine": "laptop",
  "agents": [{
    "id": "session id", "agent": "claude", "title": "Add pagination", "project": "web-app",
    "state": "working | waiting | idle | done | asleep | blocked", "lastActive": 1793890000,
    "now": "$ npm test", "lastPrompt": "…", "lastSaid": "…", "files": ["src/api.ts"],
    "activity": [{ "kind": "tool | ask | say", "text": "…" }], "helpers": ["subagent task"],
    "pane": false
  }],
  "economy": { "commits": [{ "key": "sha", "title": "…", "at": 0 }], "prs": [], "runs": [] },
  "usage": { "claude": { "windows": { "five_hour": { "used": 12, "resetsAt": 0 } } } },
  "capabilities": { "send": false, "hire": false }
}
```

The bundled feeder only reads. A feeder that can type into a live session can
set `capabilities.send` and `pane: true` on those agents and handle `send` jobs;
one that can start new sessions sets `capabilities.hire` and handles `hire`
jobs (`agent`, `project`, `task`). The office shows those controls only when a
feeder offers them.

## Security

The hub trusts the network it's on. Serve it on localhost or a private network
(Tailscale, WireGuard, a VPN), not the open internet. Feeders authenticate with
`OFFICE_TOKEN`; browsers are checked by origin. Snapshots carry your agents'
prompts and replies, so treat the hub like the transcripts it reads.

## License

MIT
