# AgentOffice

A private, local-only 3D office floating in the sky, where every current **Claude Code** session, **Codex** thread, **Claude chat** and **ChatGPT** chat (plus their subagents) is a character with his own name. Characters ride up the glass elevator in the middle of the office, walk to the room that matches their work, sit at a desk and type, and tell you what they are doing in speech bubbles. When they are idle they get coffee, chat with each other, play ping-pong or sit on the sofa. A side dashboard tracks status, activity, analytics and which projects need you.

It only **reads** local files. It never starts, controls or messages a session, and it never leaves your computer.

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

## The office

| Area | Who is there |
|---|---|
| Web & Frontend, Backend & APIs, Data & AI Lab, DevOps & Cloud, Apps & Mobile, Security Lab, Systems & Tooling, Research Library, Open Space | Computing work, picked from the files, commands, tools and skills each agent uses |
| Game Studio, 3D & Animation, Video & Audio, Design Studio, Writing & Docs | Creative work |
| **BrowserOS Neo Hub** (top middle) | Agents using BrowserOS neo right now; the giant wall screen shows the pages they have open, with Neo's latest screenshots |
| Elevator atrium (centre) | Every agent arrives from below the island and leaves the same way |
| Café, Meeting Room, Game Lounge | Idle agents: coffee, conversations, ping-pong, arcade, sofas, the window view |

- **Characters** are all men. Clothes show the type: Claude Code orange, Codex blue, Claude chat gold, ChatGPT teal. Subagents wear a cap and a lanyard badge; selecting one shows his parent session.
- **Names** come from `config/names.txt` (or the dashboard **Names** tab). A new agent gets a name nobody is using; when every name is taken, a new male name is invented. A name is freed 30 minutes after its agent leaves.
- **Needs you**: an agent blocked on a question or an approval stands up and waves under a bouncing `!`. The browser tab title shows how many are waiting.
- **Day and night** follow your clock: dusk colours in the evening, lamps and lit screens at night.

Controls: drag to rotate, right-drag to pan, scroll to zoom toward the cursor, double-click to reset, click a character or card to select, **Follow** to keep the camera on him, `Esc` to clear.

## Data sources

| Type | Read from | Shown when |
|---|---|---|
| Claude Code (desktop Code tab, CLI, IDE) | `~/.claude/sessions/*.json`, `~/.claude/projects/**` | The process is alive, or a headless run is still writing |
| Codex (ChatGPT desktop app, CLI, IDE, ACP) | `~/.codex/sessions/**/rollout-*.jsonl` | Updated within the recent window |
| ChatGPT chats, Claude chats | BrowserOS neo's local activity log (`%LOCALAPPDATA%\BrowserClaw\User Data\.browseros\.browserclaw`) | While the chat drives BrowserOS neo, and up to 20 minutes after |

Regular ChatGPT and Claude chats are stored in the cloud, not on your computer, so a chat only appears when it uses BrowserOS neo. Neo sessions that belong to a Claude Code or Codex agent are matched to that agent instead of creating a second character.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `AGENTOFFICE_PORT` | `4317` | Local port |
| `AGENTOFFICE_RECENT_MIN` | `120` | Minutes an idle Codex thread stays in the office |
| `AGENTOFFICE_DONE_LINGER_MIN` | `6` | Minutes a finished session or subagent lingers before riding down |
| `AGENTOFFICE_STALL_MIN` | `8` | Open turn with no writes for this long counts as idle |
| `AGENTOFFICE_WINDOW_MIN` | `180` | Analytics timeline length |
| `AGENTOFFICE_NEO_DIR` | auto | BrowserOS neo data folder |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME` | `~/.claude`, `~/.codex` | Data folders |

## Privacy and safety

- The server binds to `127.0.0.1` only, rejects foreign `Host`/`Origin` headers (DNS-rebinding protection) and sends a strict Content-Security-Policy.
- Everything is read-only except saving the names list, which only accepts same-origin JSON requests carrying a custom header.
- No outbound network requests. Fonts and the 3D engine are bundled, and there is no telemetry.
- Only short snippets reach the browser, never full transcripts, and common secrets (API keys, tokens, passwords, private keys) are masked. Neo screenshots are served only from Neo's own screenshot folder.
- Git status uses `git --no-optional-locks status`, so it never takes repository locks.
