// Office rooms. Each domain of computing or creative work gets its own sub-office,
// plus the BrowserOS neo hub, the lounge and the open-space lobby.

export type RoomId =
  | 'web'
  | 'backend'
  | 'data'
  | 'devops'
  | 'mobile'
  | 'browser'
  | 'security'
  | 'systems'
  | 'gamedev'
  | 'research'
  | 'lounge'
  | 'writing'
  | 'threed'
  | 'media'
  | 'design'
  | 'lobby';

export type RoomGroup = 'computing' | 'creative' | 'special';

export interface RoomDef {
  id: RoomId;
  label: string;
  short: string;
  icon: string;
  group: RoomGroup;
  blurb: string;
  /** Grid cell (column, row) in the 4x4 office layout. */
  cell: [number, number];
  floor: string;
  floorAlt: string;
  wall: string;
  accent: string;
}

export const ROOMS: RoomDef[] = [
  { id: 'web', label: 'Web & Frontend', short: 'Web', icon: '🌐', group: 'computing', blurb: 'Sites, React, CSS and UI code', cell: [0, 0], floor: '#cfe9f2', floorAlt: '#c2e0ec', wall: '#5fb3d0', accent: '#2f8db3' },
  { id: 'backend', label: 'Backend & APIs', short: 'Backend', icon: '🧩', group: 'computing', blurb: 'Servers, APIs and databases', cell: [1, 0], floor: '#d9e4f5', floorAlt: '#ccd9ee', wall: '#6f8fcf', accent: '#4a6bb5' },
  { id: 'data', label: 'Data & AI Lab', short: 'Data & AI', icon: '🧠', group: 'computing', blurb: 'ML, notebooks, LLMs, vision, quantum', cell: [2, 0], floor: '#e6dcf5', floorAlt: '#dccff0', wall: '#9a7fd1', accent: '#7656b8' },
  { id: 'devops', label: 'DevOps & Cloud', short: 'DevOps', icon: '🚀', group: 'computing', blurb: 'CI, deploys, Git, containers', cell: [3, 0], floor: '#dfeedd', floorAlt: '#d2e6cf', wall: '#6fb36a', accent: '#3f8f3a' },
  { id: 'mobile', label: 'Apps & Mobile', short: 'Apps', icon: '📱', group: 'computing', blurb: 'Android, iOS and desktop apps', cell: [0, 1], floor: '#f5e3d6', floorAlt: '#efd6c5', wall: '#d99a6c', accent: '#b8703f' },
  { id: 'browser', label: 'BrowserOS Neo Hub', short: 'Neo Hub', icon: '🛰️', group: 'special', blurb: 'Agents driving BrowserOS neo right now', cell: [1, 1], floor: '#d8f3ee', floorAlt: '#c6ece5', wall: '#2bb5a0', accent: '#13897a' },
  { id: 'security', label: 'Security Lab', short: 'Security', icon: '🛡️', group: 'computing', blurb: 'Audits, hardening, cyber coursework', cell: [2, 1], floor: '#e3e0ea', floorAlt: '#d6d2e0', wall: '#6d6488', accent: '#4b4366' },
  { id: 'systems', label: 'Systems & Tooling', short: 'Systems', icon: '⚙️', group: 'computing', blurb: 'Scripts, config, C/C++, Rust, networks', cell: [3, 1], floor: '#ece6da', floorAlt: '#e3dccc', wall: '#a8916b', accent: '#7f6a45' },
  { id: 'gamedev', label: 'Game Studio', short: 'Games', icon: '🎮', group: 'creative', blurb: 'Roblox, Unity, Godot, game logic', cell: [0, 2], floor: '#f6dbe3', floorAlt: '#f0ccd7', wall: '#e0809c', accent: '#c4527a' },
  { id: 'research', label: 'Research Library', short: 'Research', icon: '📚', group: 'computing', blurb: 'Web research, reading, explaining', cell: [1, 2], floor: '#f3ecd5', floorAlt: '#ece2c3', wall: '#c9a85a', accent: '#a07f2e' },
  { id: 'lounge', label: 'Café Lounge', short: 'Lounge', icon: '☕', group: 'special', blurb: 'Idle agents waiting for their next task', cell: [2, 2], floor: '#f2e1cf', floorAlt: '#ead3bc', wall: '#c98b5b', accent: '#9c6236' },
  { id: 'writing', label: 'Writing & Docs', short: 'Docs', icon: '✍️', group: 'creative', blurb: 'Docs, reports, slides, legal pages', cell: [3, 2], floor: '#eef0f3', floorAlt: '#e2e5ea', wall: '#8d99ab', accent: '#5c6a80' },
  { id: 'threed', label: '3D & Animation', short: '3D', icon: '🧊', group: 'creative', blurb: 'Blender, models, renders', cell: [0, 3], floor: '#ffe9cc', floorAlt: '#fbdcb3', wall: '#f0a446', accent: '#c87a17' },
  { id: 'media', label: 'Video & Audio', short: 'Media', icon: '🎬', group: 'creative', blurb: 'Shorts, edits, voice and sound', cell: [1, 3], floor: '#fbd9d4', floorAlt: '#f6c8c1', wall: '#e2705f', accent: '#b8483a' },
  { id: 'design', label: 'Design Studio', short: 'Design', icon: '🎨', group: 'creative', blurb: 'UI/UX, Figma, Canva, images, brand', cell: [2, 3], floor: '#fde6f3', floorAlt: '#f8d6ea', wall: '#d77fb8', accent: '#b04f92' },
  { id: 'lobby', label: 'Open Space', short: 'Open Space', icon: '🚪', group: 'special', blurb: 'Entrance and hot desks for general work', cell: [3, 3], floor: '#e9efe6', floorAlt: '#dde6d8', wall: '#8fae86', accent: '#5e8455' },
];

export const ROOM_BY_ID: Record<RoomId, RoomDef> = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<
  RoomId,
  RoomDef
>;

export const PROVIDER_META = {
  // Chart-validated categorical order: Claude, Codex, ChatGPT (OKLCH L inside the dark band, CVD-separated).
  claude: { label: 'Claude', color: '#d4704f', shade: '#b4583b', light: '#f1b59a' },
  codex: { label: 'Codex', color: '#5b7cfa', shade: '#3f5bd0', light: '#a9bafc' },
  chatgpt: { label: 'ChatGPT', color: '#19a37f', shade: '#0f7d60', light: '#86d8c0' },
} as const;
