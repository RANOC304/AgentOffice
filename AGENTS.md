# Repository instructions

## Shared instructions

Read and follow the shared instructions at C:/Users/aubin/.codex/AGENTS.md. Apply global rules and folder scopes matching this repository's actual absolute path.

## Assigned author

- Account: personal
- Author name: RANOC304
- Author email: aubinsprinter@gmail.com

## Repository description

AgentOffice is a private, local-only web app that shows the owner's AI agents and projects as a pixel-art office. Every current Claude Code session, Codex thread, ChatGPT-app (Codex desktop) thread and subagent is its own character; characters walk to the sub-office matching their work, sit at desks, say what they are doing in speech bubbles and gather in the lounge when idle. A side dashboard shows status, activity, analytics and which projects need attention. It runs only on the owner's computer.

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

- `server/collectors/claude.ts` – live sessions from `~/.claude/sessions/<pid>.json`, transcripts and subagents from `~/.claude/projects`.
- `server/collectors/codex.ts` – rollouts from `~/.codex/sessions`; originator `Codex Desktop` maps to provider `chatgpt`, CLI/IDE/ACP to `codex`.
- `server/classify.ts` – maps files, commands, MCP servers and skills to rooms; BrowserOS neo use sends agents to the Neo hub.
- `shared/` – types and room definitions used by both sides.
- `web/src/office/` – isometric renderer, procedural sprites, path finding and character simulation (canvas, no image assets).
- `web/src/dashboard/` – React side panel (agents, projects, analytics, live feed).

## Assigned skills

Only shared skills from C:/Users/aubin/.agents/skills may be assigned here. Read relevant assigned skills before use. Leave this list empty until skills are assigned.
