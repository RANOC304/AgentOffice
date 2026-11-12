# Repository instructions

## Shared instructions

Read and follow the shared instructions at C:/Users/aubin/.codex/AGENTS.md. Apply global rules and folder scopes matching this repository's actual absolute path.

## Assigned author

- Account: personal
- Author name: RANOC304
- Author email: aubinsprinter@gmail.com

## Repository description

AgentOffice is a private, local-only web app that shows the owner's AI agents and projects as a realistic 3D office on a floating island. Every current Claude Code session, Codex thread, Claude chat and ChatGPT chat (and every subagent) is a named male character: he arrives by the central elevator, walks to the room matching his work, sits and types, speaks in bubbles, and takes coffee, chats or plays ping-pong when idle. The BrowserOS neo hub's wall screen shows the pages agents have open. A side dashboard shows status, activity, analytics and which projects need attention. It runs only on the owner's computer.

## Custom instructions

### Critical rules

- Visualisation only: never create, control, message or modify Claude/Codex/ChatGPT sessions. Collectors only read local files.
- Local only: the server binds to 127.0.0.1, rejects foreign Host/Origin headers and makes no outbound network requests. Do not add CDNs, telemetry or remote fonts (fonts are bundled via @fontsource).
- Never send raw transcripts to the browser: only short, redacted snippets (see `server/util/text.ts`).
- No sessions are configured as "chiefs": each session is its own lead; subagents link to their parent session.

### Commands

- `npm install` – install dependencies (Node 22.18+ runs the TypeScript server directly).
- `npm run dev` – API on http://127.0.0.1:4317 plus Vite on http://127.0.0.1:5173 (open the Vite URL).
- `npm start` – build the UI and serve everything at http://127.0.0.1:4317.
- `npm run check` – TypeScript type-check (must pass before committing).
- `npm run snapshot` – print what the collectors currently see.
- Add `?demo` to the URL for synthetic agents.

### Architecture

- `server/collectors/claude.ts` – live sessions from `~/.claude/sessions/<pid>.json`, transcripts and subagents from `~/.claude/projects` (provider `claude-code`).
- `server/collectors/codex.ts` – rollouts from `~/.codex/sessions`; every Codex thread (ChatGPT desktop app, CLI, IDE, ACP) is provider `codex`.
- `server/collectors/neo.ts` – BrowserOS neo's local SQLite log (read-only): pages, screenshots, and `chatgpt` / `claude-chat` characters for cloud chats that drive Neo. `server/office.ts` matches Neo sessions to Claude Code/Codex agents first.
- `server/state.ts` – app-only decisions in `data/office-state.json`: fired workers (back on a new task) and removed projects (back on new work). `POST /api/action` applies rename/fire/rehire/removeProject/restoreProject.
- `server/names.ts` – character names from `config/names.txt` (user-editable, tracked) with assignments in `data/personas.json` (local, ignored).
- `server/classify.ts` – maps files, commands, MCP servers and skills to rooms.
- `shared/` – types, room definitions and the validated provider palette used by both sides.
- `web/src/office3d/` – three.js office: `layout.ts` (floor plan, seats, spots, nav grid), `environment.ts` (island, garden, walls), `furniture.ts` (merged procedural furniture), `person.ts` + `poses.ts` (jointed male characters), `sim.ts` (behaviours), `elevator.ts`, `screens.ts` (Neo wall screen, desk monitors), `scene.ts` (renderer, lighting, labels, frame loop with worker fallback and catch-up, adaptive resolution), `cameraModes.ts` (free camera, idle tour), `ticker.ts` (background worker clock).
- `web/src/dashboard/` – React side panel (agents, projects, analytics, feed, names).

## Assigned skills

Only shared skills from C:/Users/aubin/.agents/skills may be assigned here. Read relevant assigned skills before use. Leave this list empty until skills are assigned.
