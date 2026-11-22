# AgentOffice

A private, local-only 3D office floating in the sky, where every current **Claude Code** session, **Codex** thread, **Claude chat** and **ChatGPT** chat (plus their subagents) is a character with his own name. Characters ride up the glass elevator in the middle of the office, walk to the room that matches their work, sit at a desk and type, and tell you what they are doing in speech bubbles. When they are idle they get coffee, chat with each other, play ping-pong or sit on the sofa. A side dashboard tracks status, activity, analytics and which projects need you.

It **reads** local files to draw the office. It only starts, continues or stops a session when you ask it to (missions, replies, stop), and it never leaves your computer.

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

- **Characters** are all men, modelled in detail: faces with eyes that blink, eyebrows, nose, ears and a mouth that moves while they talk, hands with fingers, shaped torsos, belts and shoes. They turn their heads toward whoever they talk to. Clothes show the type: Claude Code orange, Codex blue, Claude chat gold, ChatGPT teal. Subagents wear a cap and a lanyard badge; selecting one shows his parent session.
- **Names** come from `config/names.txt` (or **Settings → Character names** in the dashboard). A new agent gets a name nobody is using; when every name is taken, a new male name is invented. A name is freed 30 minutes after its agent leaves.
- **Needs you**: an agent blocked on a question or an approval stands up and waves under a bouncing `!`. The browser tab title shows how many are waiting.
- **Day and night** follow your clock: dusk colours in the evening, lamps and lit screens at night.

## Camera and controls

The **Office chat** in the top-left corner merges everyone's actions with what the characters say and think, newest first, ten lines at most; **Work** shows only real session activity, **Talk** only office small talk. Click a name to open that worker.

What characters say: a session's real messages are said **once** each. When a job finishes the worker says its final words once, then only makes small talk. Idle workers hold real multi-line conversations built from the office itself (projects, files, tokens, providers, who is busy, what is on the Neo screen, the time of day, new arrivals, tech debates, ping-pong banter, meeting syncs and retros), and the same topic or line does not come back for a while.


- **Orbit** (default): drag to rotate, right-drag to pan, scroll to zoom exactly where the cursor points (the point under the cursor stays put, all the way up to a desk, a wall or a character, stopping just before it), double-click to reset, **Follow** keeps the camera on the selected worker. **Drag: camera / office** switches the drag direction (camera moves the way you drag; office drags the office like a map).
- **Replay**: scrub back through the day (play at ×1 to ×300), with the chat feed and the lighting of that time. **Back to live** returns to now.
- **Free cam** (`C`): fly anywhere with `Z` `Q` `S` `D` (AZERTY), `A`/`E` down/up, `Shift` to go faster, right click to hide the cursor and look with the mouse (or drag), scroll to move forward. Arrow keys work too. `Esc` leaves it.
- **Idle tour** (`I`): the camera glides around the office forever, visiting random rooms and each worker in turn. It only stops when you click **Idle tour** again; clicking a worker meanwhile makes the camera visit him. With **Auto idle** on, it starts by itself after 3 minutes without any input.
- **Be the boss** (👔): you ride the elevator up from below the island and walk around the office like in a game. Everything is on the keyboard and the toolbar hides while you play:
  - `Z` `Q` `S` `D` walk (`W`/`A` and the arrows work too); `Shift` or a double tap on `Z` sprints, with a wider view; `Space` jumps (about 1.75 m high). If you ever get lost or wedged between furniture, the **↺ Back to the elevator** button (bottom left, the only button in boss mode) puts you back in front of the elevator; you also slide out of tight spots between chairs and desks by walking away.
  - **Right click** (and only right click) hides or shows the cursor: hidden, the mouse turns your head. Dragging also looks around while the cursor is visible.
  - `V` switches first person (FPV) and third person (TPV, over your shoulder; scroll changes the distance).
  - `E` talks to the worker in front of you (or the nearest one) and opens his page in the dashboard.
  - `C` sits on the nearest chair, sofa, bench or beanbag, or on the floor anywhere; walking stands you up.
  - Just for fun, `R` slaps the worker in front of you (you step in, your hand sweeps across at face height and his head snaps aside) and `F` kicks him: he falls on his back, lies there dazed, gets up and goes back to what he was doing. Nothing about the real sessions changes. Right click never attacks: it only shows or hides the cursor.
  - `T` opens or closes the dashboard, `M` turns the sound on or off and `L` leaves: you walk back to the elevator and ride down. (Full screen is on `F` outside boss mode only, since `F` kicks here.)
  - Workers talk to you when you come close: news about their work, their question if they are waiting for you, small talk when idle.
- **Full screen** (`F`): the office fills the screen; the dashboard comes back when you leave it.
- **Dashboard** (`T`): opens or closes the side panel anywhere in the app, except while you type in a field. It floats over the right side of the office, so opening or closing it never resizes the 3D view.
- Click a character (or his name tag) to see his details; the dashboard reopens if it was hidden. Click the **BrowserOS neo wall screen** (or the dashboard's *In Neo · tabs* tile) to browse every tab the agents opened, with Neo's screenshots.

The office keeps running smoothly when its window is not in front: a background worker clock keeps the simulation and drawing going when the browser slows animation frames, the resolution adapts to the machine's load, and after a full pause everything catches up instantly.

## Music, sounds and voices

Everything is synthesised in the browser (no audio files, nothing downloaded) and starts after your first click:

- **Music**: generative lo-fi (electric piano chords, bass, a swung beat, a little melody, vinyl crackle) that changes every few bars; a calm ambient pad late at night.
- **Sounds**, placed in 3D around the camera: the elevator hum, doors and bell, footsteps, keyboards, the coffee machine, ping-pong, wind, birds by day and crickets at night, and the slaps and kicks.
- **Voices**: every character has his own voice. Close to the camera (or to you in boss mode) characters read their lines aloud with this computer's own text-to-speech voices; further away they babble. Online voices are never used, so the text stays on the computer.

The 🔊 button in the office toolbar has the volumes (all, music, sounds, voices) and the voice style (speak nearby, babble only, silent). Characters stay quiet while the office is in a background tab.

## Managing the office

These only change what AgentOffice shows. The real sessions and project folders are never touched.

- **Rename** a character from his detail panel (✎ next to his name).
- **Fire** a worker: he takes the elevator out (with his helpers). He comes back if his session gets a new task, or with **Re-hire** in the *Fired workers* list.
- **Remove** a project (🗑 in the Projects tab): it disappears from the office and comes back when a worker starts new work there, or with **Restore**.
- **Pin** a project to a room (📌 in the Projects tab): its working sessions sit there, and the room sign shows the project.

## Working with sessions

These act on real sessions, and only when you click them.

- **Missions** tab: a board per project (to do → in progress → done). A mission runs `claude -p` or `codex exec` headlessly in the project folder, with a permission level you choose: **read-only** (default: Claude `dontAsk`, Codex `read-only` sandbox), **edit** (Claude `acceptEdits`, Codex `workspace-write`) or **full** (Claude `bypassPermissions`, Codex `danger-full-access`, with a confirmation). The new worker rides up the elevator. A mission can also be given to an idle worker, which continues his session. The final answer and the cost (Claude) are shown on the card.
- **Reply** from a worker's detail panel. Sessions that are not open anywhere else (headless runs, finished missions, idle Codex threads) are continued from the office. Sessions open live in the Claude or Codex app get the reply copied and their app opened on that session.
- **Open**: in the Claude app (`claude://`), the Codex app (`codex://threads/…`), a terminal that resumes the session, or the project folder.
- **Stop**: a running mission, or a Claude Code session running in a terminal, after a confirmation. Sessions hosted by the Claude desktop app are stopped from the app.
- **Hand off**: send a worker's result to another worker (for example Claude Code writes, Codex reviews). The giver walks over to the receiver's desk and they talk it through.

Missions are stored in `data/missions.json`, with each run's output in `data/missions/`. The CLIs are found on `PATH`, in `~/.local/bin`, or (Codex) in the installed ChatGPT/Codex app; set `AGENTOFFICE_CLAUDE` / `AGENTOFFICE_CODEX` to override.

## Usage, alerts and standup

- **Usage** tab: Claude 5-hour and weekly plan usage (from the Claude app's local usage history) and Codex 5-hour and weekly rate limits (from Codex's own logs), with reset times. A warning chip appears in the header from 80%.
- **Alerts** (Settings tab): a chime and/or desktop notification when someone needs you, a session finishes, a worker hits an error, a mission ends or a limit passes 80% / 95%. In-app toasts open the worker.
- **Standup** tab: per project for any recorded day: workers and their hours, commits (`git log`), edits, commands, pull-request actions, errors, missions and files. **Copy** or **Download .md**.

The office records compact frames and short, redacted events for the replay and the standup in `data/history/` (kept 7 days).

## Other computers

To see the agents of another computer (even on another network), share a folder between both computers with any sync tool (OneDrive, Google Drive, Dropbox, Syncthing, a network share):

1. On the other computer, get this project and run `npm install`, then:

   ```bash
   npm run peer -- --dir "C:\Users\you\OneDrive\AgentOffice"
   ```

   It reads that computer's sessions with the same collectors and writes a small redacted summary (no transcripts, no screenshots) into the folder every 10 seconds.
2. On this computer, set the same synced folder in **Settings → Other computers** (or `AGENTOFFICE_PEERS_DIR`).

**Always on (Linux), one command:** run this once on the other computer. It installs the peer and Syncthing as systemd user services that start at boot, restart whenever they stop and survive Node upgrades, and it pairs the folder with your main computer (use that computer's Syncthing device ID, shown in its Syncthing page under Actions → Show ID):

```bash
npm run peer:setup -- --dir "$HOME/AgentOffice-sync" --main-id <device ID of the main computer>
npm run peer:status      # is everything running, and is the shared file fresh?
npm run peer:uninstall
```

`--name "Laptop"` renames the computer in the office. `npm run peer:install` sets up only the peer service (no Syncthing). Re-running `peer:setup` is safe.

The sync tool must run on **both** computers. If a computer stops sharing, or the shared folder cannot be read, the dashboard shows an amber warning under its title (click it to open Settings). On Windows, keep the sync tool's data folder outside `AppData` if you start it from an app that redirects `AppData`.

Remote workers appear with their computer's name on their tag; a computer that stops writing for 3 minutes goes offline and its workers leave. AgentOffice itself still opens no network connection: the sync tool moves the file.

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
| `AGENTOFFICE_PEERS_DIR` | Settings tab | Shared folder for other computers |
| `AGENTOFFICE_CLAUDE`, `AGENTOFFICE_CODEX` | auto | Paths of the CLIs used for missions |

## Privacy and safety

- The server binds to `127.0.0.1` only, rejects foreign `Host`/`Origin` headers (DNS-rebinding protection) and sends a strict Content-Security-Policy.
- Collectors only read. Writes are AgentOffice's own state (names, fired workers, removed or pinned projects, missions, settings) plus the session actions you click (missions, replies, stop, open). All of them only accept same-origin JSON requests carrying a custom header, and commands are built from server-side data and run without a shell.
- No outbound network requests. Fonts and the 3D engine are bundled, and there is no telemetry.
- Only short snippets reach the browser, never full transcripts, and common secrets (API keys, tokens, passwords, private keys) are masked. Neo screenshots are served only from Neo's own screenshot folder.
- Git status uses `git --no-optional-locks status`, so it never takes repository locks.
