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

## Camera and controls

The **Office chat** in the top-left corner merges everyone's actions with what the characters say and think, newest first, ten lines at most. Click a name to open that worker.


- **Orbit** (default): drag to rotate, right-drag to pan, scroll to zoom toward the cursor (all the way up to a desk, a wall or a character, stopping just before it), double-click to reset, **Follow** keeps the camera on the selected worker.
- **Free cam** (`C`): fly anywhere with `Z` `Q` `S` `D` (AZERTY), `A`/`E` down/up, `Shift` to go faster, drag to look around, scroll to move forward. Arrow keys work too. `Esc` leaves it.
- **Idle tour** (`I`): the camera glides around the office forever, visiting random rooms and each worker in turn. It only stops when you click **Idle tour** again; clicking a worker meanwhile makes the camera visit him. With **Auto idle** on, it starts by itself after 3 minutes without any input.
- **Full screen** (`F`): the office fills the screen; the dashboard comes back when you leave it.
- Click a character (or his name tag) to see his details; the dashboard reopens if it was hidden. Click the **BrowserOS neo wall screen** (or the dashboard's *In Neo · tabs* tile) to browse every tab the agents opened, with Neo's screenshots.

The office keeps running smoothly when its window is not in front: a background worker clock keeps the simulation and drawing going when the browser slows animation frames, the resolution adapts to the machine's load, and after a full pause everything catches up instantly.

## Managing the office

These only change what AgentOffice shows. The real sessions and project folders are never touched.

- **Rename** a character from his detail panel (✎ next to his name).
- **Fire** a worker: he takes the elevator out (with his helpers). He comes back if his session gets a new task, or with **Re-hire** in the *Fired workers* list.
- **Remove** a project (🗑 in the Projects tab): it disappears from the office and comes back when a worker starts new work there, or with **Restore**.

These choices are stored in `data/` (ignored by Git).

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
- Everything is read-only except AgentOffice's own state (names list, character names, fired workers, removed projects), which only accepts same-origin JSON requests carrying a custom header.
- No outbound network requests. Fonts and the 3D engine are bundled, and there is no telemetry.
- Only short snippets reach the browser, never full transcripts, and common secrets (API keys, tokens, passwords, private keys) are masked. Neo screenshots are served only from Neo's own screenshot folder.
- Git status uses `git --no-optional-locks status`, so it never takes repository locks.
