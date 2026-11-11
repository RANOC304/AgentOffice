# AgentOffice

A private, local-only pixel-art office for your AI agents. Every current **Claude Code** session, **Codex** thread, **ChatGPT app** thread and subagent becomes a character. Each character walks to the room that matches its work, sits at a desk and shows what it is doing in a speech bubble. A side dashboard tracks status, activity and which projects need you.

It only **reads** local session files. It never starts, controls or messages a session, and it never leaves your computer.

## Run it

```bash
npm install
npm start
```

Open http://127.0.0.1:4317. For development with hot reload:

```bash
npm run dev
```

Then open http://127.0.0.1:5173. Add `?demo` to either URL for a busy office with synthetic agents.

## What you see

| Room | Who goes there |
|---|---|
| Web & Frontend, Backend & APIs, Data & AI Lab, DevOps & Cloud, Apps & Mobile, Security Lab, Systems & Tooling, Research Library | Computing work, picked from the files, commands, tools and skills each agent uses |
| Game Studio, 3D & Animation, Video & Audio, Design Studio, Writing & Docs | Creative work |
| **BrowserOS Neo Hub** | Any agent using BrowserOS neo right now |
| Café Lounge | Idle sessions waiting for their next task |
| Open Space | Entrance and hot desks for general work |

- **Characters**: shirt colour shows the provider (Claude orange, Codex blue, ChatGPT green). Subagents wear a cap and a badge, and a dashed line links them to their parent session when selected. There are no chiefs: each session leads itself.
- **Bubbles** come from real activity: the agent's latest messages, its current tool action and, when idle, a few light-hearted lines.
- **Needs you**: an agent blocked on a question or an approval stands up with a bouncing `!`. The browser tab title shows how many are waiting.
- **Dashboard**: agent list with nested helpers, agent detail (tokens, tool mix, files changed, timeline), projects ranked by attention (waiting agents, errors, uncommitted or unpushed Git changes), analytics and a live feed.

Controls: drag to pan, scroll to zoom, double-click to fit, click a character or card to select. `Esc` clears the selection.

## Data sources

| Provider | Read from | "Current" means |
|---|---|---|
| Claude Code (desktop, CLI, IDE) | `~/.claude/sessions/*.json`, `~/.claude/projects/**` | Process is alive, plus headless runs still writing |
| Codex CLI / IDE / ACP | `~/.codex/sessions/**/rollout-*.jsonl` | Updated within the recent window |
| ChatGPT desktop app (Codex threads) | same as Codex, originator `Codex Desktop` | Updated within the recent window |

Regular ChatGPT chats are stored in the cloud, not on disk, so they cannot appear yet.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `AGENTOFFICE_PORT` | `4317` | Local port |
| `AGENTOFFICE_RECENT_MIN` | `120` | Minutes an idle Codex/ChatGPT thread stays in the office |
| `AGENTOFFICE_DONE_LINGER_MIN` | `6` | Minutes a finished session or subagent lingers before leaving |
| `AGENTOFFICE_STALL_MIN` | `8` | Open turn with no writes for this long counts as idle |
| `AGENTOFFICE_WINDOW_MIN` | `180` | Analytics timeline length |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME` | `~/.claude`, `~/.codex` | Data folders |

## Privacy and safety

- The server binds to `127.0.0.1` only, rejects foreign `Host`/`Origin` headers (DNS-rebinding protection), serves GET only and sends a strict Content-Security-Policy.
- No outbound network requests. Fonts are bundled, and there is no telemetry.
- Only short snippets reach the browser, never full transcripts, and common secrets (API keys, tokens, passwords, private keys) are masked.
- Git status uses `git --no-optional-locks status`, so it never takes repository locks.
