# Repository instructions

## Shared instructions

Read and follow the shared instructions at C:/Users/aubin/.codex/AGENTS.md on Windows, or /home/aubin/.codex/AGENTS.md on Linux. Apply global rules and folder scopes matching this repository's actual absolute path.

## Assigned author

- Account: personal
- Author name: RANOC304
- Author email: aubinsprinter@gmail.com

## Repository description

AgentOffice is a private, local-only web app that shows the owner's AI agents and projects as a realistic 3D office on a floating island. Every current Claude Code session, Codex thread, Claude chat and ChatGPT chat (and every subagent, including those of the owner's other computers) is a named male character: he arrives by the central elevator, walks to the room matching his work, sits and types, speaks in bubbles, and holds conversations, takes coffee or plays ping-pong when idle. The BrowserOS neo hub's wall screen shows the pages agents have open. A side dashboard shows status, activity, usage limits, analytics, a daily standup and which projects need attention, and lets the owner launch missions, reply to, open, stop and hand off sessions. It runs only on the owner's computer.

## Custom instructions

- BrowserOS neo profile: `Aubin-Automation`.

### Critical rules

- Collectors only read local files. Sessions are created, continued or stopped only by explicit user actions in the dashboard (missions, replies, stop, hand-off), as the owner requested; never automatically. Missions default to read-only permissions, and full access needs a confirmation.
- Session commands are built from server-side data (validated UUIDs, existing folders) and spawned without a shell; never pass browser-provided text to a shell.
- Local only: the server binds to 127.0.0.1, rejects foreign Host/Origin headers and makes no outbound network requests. Do not add CDNs, telemetry or remote fonts (fonts are bundled via @fontsource).
- Never send raw transcripts to the browser: only short, redacted snippets (see `server/util/text.ts`).
- No sessions are configured as "chiefs": each session is its own lead; subagents link to their parent session.

### Commands

- `npm install` – install dependencies (Node 22.18+ runs the TypeScript server directly).
- `npm run dev` – API on http://127.0.0.1:4317 plus Vite on http://127.0.0.1:5173 (open the Vite URL).
- `npm start` – build the UI and serve everything at http://127.0.0.1:4317.
- `npm run check` – TypeScript type-check (must pass before committing).
- `npm run snapshot` – print what the collectors currently see.
- `npm run peer -- --dir "<synced folder>"` – peer mode for another computer: writes its agents into the shared folder. On Linux, `npm run peer:setup -- --dir "<synced folder>" --main-id <Syncthing ID>` installs the peer and Syncthing as always-on systemd user services (`peer:status`, `peer:uninstall`; `scripts/peer-service.mjs`, launcher `scripts/peer-run.sh`).
- Add `?demo` to the URL for synthetic agents.

### Architecture

- `server/collectors/claude.ts` – live sessions from `~/.claude/sessions/<pid>.json`, transcripts and subagents from `~/.claude/projects` (provider `claude-code`).
- `server/collectors/codex.ts` – rollouts from `~/.codex/sessions`; every Codex thread (ChatGPT desktop app, CLI, IDE, ACP) is provider `codex`.
- `server/collectors/neo.ts` – BrowserOS neo's local SQLite log (read-only): pages, screenshots, and `chatgpt` / `claude-chat` characters for cloud chats that drive Neo. `server/office.ts` matches Neo sessions to Claude Code/Codex agents first.
- `server/state.ts` – app-only decisions in `data/office-state.json`: fired workers (back on a new task), removed projects (back on new work) and project room pins. `POST /api/action` applies every dashboard action (see `OfficeAction` in `server/office.ts`).
- `server/missions.ts` – mission board and headless runs (`claude -p --output-format stream-json`, `codex exec --json`), logs in `data/missions/`; `server/launchers.ts` finds the CLIs and opens apps (`claude://code/continue`, `claude://resume`, `codex://threads/<id>`), terminals and folders.
- `server/usage.ts` – Claude plan usage (`%LOCALAPPDATA%\Claude-Data\*\plan-usage-history.json`) and Codex rate limits (rollout `token_count` events).
- `server/history.ts` – day frames/events for the replay and the per-day ledger for `GET /api/standup`; `data/history/`, kept 7 days.
- `server/peers.ts` + `server/peer.ts` – other computers through a synced folder (`*.agentoffice.json`), validated and namespaced `peer:<host>:<id>`.
- `server/names.ts` – character names from `config/names.txt` (user-editable, tracked) with assignments in `data/personas.json` (local, ignored).
- `server/classify.ts` – maps files, commands, MCP servers and skills to rooms.
- `shared/` – types, room definitions and the validated provider palette used by both sides.
- `web/src/office3d/` – three.js office: `layout.ts` (floor plan, seats, spots, nav grid), `environment.ts` (island, garden, walls), `furniture.ts` (merged procedural furniture), `person.ts` + `poses.ts` (jointed male characters), `sim.ts` (behaviours, conversations, hand-offs, say-once speech), `talk.ts` (conversation topics and small talk), `elevator.ts`, `screens.ts` (Neo wall screen, desk monitors), `scene.ts` (renderer, lighting, labels, cursor zoom, frame loop with worker fallback and catch-up, adaptive resolution), `cameraModes.ts` (free camera, idle tour), `player.ts` (boss mode: FPV/TPV walking controller), `ticker.ts` (background worker clock), `ChatFeed.tsx`, `ReplayBar.tsx`.
- `web/src/audio/` – `engine.ts` (Web Audio context, buses, settings, positional panners), `music.ts` (generative lo-fi), `voice.ts` (local text-to-speech and babble voices; never use online voices), `officeSound.ts` (elevator, steps, typing, coffee, ping-pong, ambience, hits, character voices).
- `web/src/dashboard/` – React side panel (agents with controls, missions, projects, usage + analytics, standup, feed, settings with alerts, other computers and names). `web/src/alerts.ts` (notifications and chime), `web/src/replay.ts` (rebuilds the office at a past moment).

## Assigned skills

Only shared skills from C:/Users/aubin/.agents/skills may be assigned here. Read relevant assigned skills before use. Leave this list empty until skills are assigned.
