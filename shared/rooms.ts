// Office zones. Each domain of computing or creative work has its own sub-office;
// the central spine holds the BrowserOS neo open space, the elevator atrium and the café.

export type RoomId =
  | 'web'
  | 'backend'
  | 'data'
  | 'devops'
  | 'mobile'
  | 'security'
  | 'systems'
  | 'research'
  | 'gamedev'
  | 'threed'
  | 'design'
  | 'media'
  | 'writing'
  | 'general'
  | 'browser'
  | 'atrium'
  | 'cafe'
  | 'meeting'
  | 'chill';

export type RoomKind = 'desks' | 'neo' | 'atrium' | 'cafe' | 'meeting' | 'chill';
export type RoomGroup = 'computing' | 'creative' | 'special';

export interface RoomDef {
  id: RoomId;
  label: string;
  short: string;
  icon: string;
  group: RoomGroup;
  kind: RoomKind;
  blurb: string;
  /** Grid cell (column, row) in the 5 × 4 floor plan; rowSpan for the atrium. */
  cell: [number, number];
  rowSpan?: number;
  /** Floor finish and accent colours (muted so characters stand out). */
  floor: 'wood' | 'carpet' | 'concrete' | 'tile' | 'terrazzo';
  floorColor: string;
  accent: string;
}

export const GRID = { cols: 5, rows: 4, cellW: 7, cellD: 6.5 } as const;

export const ROOMS: RoomDef[] = [
  { id: 'web', label: 'Web & Frontend', short: 'Web', icon: '🌐', group: 'computing', kind: 'desks', blurb: 'Sites, React, CSS and UI code', cell: [0, 0], floor: 'wood', floorColor: '#c9b49a', accent: '#4f9cc4' },
  { id: 'backend', label: 'Backend & APIs', short: 'Backend', icon: '🧩', group: 'computing', kind: 'desks', blurb: 'Servers, APIs and databases', cell: [1, 0], floor: 'carpet', floorColor: '#8e97a8', accent: '#5b74b8' },
  { id: 'browser', label: 'BrowserOS Neo Hub', short: 'Neo Hub', icon: '🛰️', group: 'special', kind: 'neo', blurb: 'Agents driving BrowserOS neo right now', cell: [2, 0], floor: 'terrazzo', floorColor: '#cfd6d3', accent: '#1f9e8f' },
  { id: 'data', label: 'Data & AI Lab', short: 'Data & AI', icon: '🧠', group: 'computing', kind: 'desks', blurb: 'ML, notebooks, LLMs, vision, quantum', cell: [3, 0], floor: 'carpet', floorColor: '#9c93ab', accent: '#7b5fb5' },
  { id: 'devops', label: 'DevOps & Cloud', short: 'DevOps', icon: '🚀', group: 'computing', kind: 'desks', blurb: 'CI, deploys, Git, containers', cell: [4, 0], floor: 'concrete', floorColor: '#a7aaa4', accent: '#4a9a58' },
  { id: 'mobile', label: 'Apps & Mobile', short: 'Apps', icon: '📱', group: 'computing', kind: 'desks', blurb: 'Android, iOS and desktop apps', cell: [0, 1], floor: 'wood', floorColor: '#bfa486', accent: '#c47a45' },
  { id: 'security', label: 'Security Lab', short: 'Security', icon: '🛡️', group: 'computing', kind: 'desks', blurb: 'Audits, hardening, cyber coursework', cell: [1, 1], floor: 'carpet', floorColor: '#7f8494', accent: '#56607e' },
  { id: 'atrium', label: 'Elevator Atrium', short: 'Atrium', icon: '🛗', group: 'special', kind: 'atrium', blurb: 'Where every agent arrives and leaves', cell: [2, 1], rowSpan: 2, floor: 'terrazzo', floorColor: '#d9d4c9', accent: '#8a7a64' },
  { id: 'systems', label: 'Systems & Tooling', short: 'Systems', icon: '⚙️', group: 'computing', kind: 'desks', blurb: 'Scripts, config, C/C++, Rust, networks', cell: [3, 1], floor: 'concrete', floorColor: '#a39d93', accent: '#9a7a45' },
  { id: 'general', label: 'Open Space', short: 'Open Space', icon: '💼', group: 'special', kind: 'desks', blurb: 'Hot desks for general work', cell: [4, 1], floor: 'wood', floorColor: '#c4ae92', accent: '#6f8f63' },
  { id: 'gamedev', label: 'Game Studio', short: 'Games', icon: '🎮', group: 'creative', kind: 'desks', blurb: 'Roblox, Unity, Godot, game logic', cell: [0, 2], floor: 'carpet', floorColor: '#a08a98', accent: '#c4527a' },
  { id: 'design', label: 'Design Studio', short: 'Design', icon: '🎨', group: 'creative', kind: 'desks', blurb: 'UI/UX, Figma, Canva, images, brand', cell: [1, 2], floor: 'wood', floorColor: '#d0bba2', accent: '#b8558f' },
  { id: 'research', label: 'Research Library', short: 'Research', icon: '📚', group: 'computing', kind: 'desks', blurb: 'Web research, reading, explaining', cell: [3, 2], floor: 'carpet', floorColor: '#a2937c', accent: '#a07f2e' },
  { id: 'meeting', label: 'Meeting Room', short: 'Meeting', icon: '🗣️', group: 'special', kind: 'meeting', blurb: 'Idle agents chatting about their projects', cell: [4, 2], floor: 'carpet', floorColor: '#8f9a96', accent: '#4f7f78' },
  { id: 'threed', label: '3D & Animation', short: '3D', icon: '🧊', group: 'creative', kind: 'desks', blurb: 'Blender, models, renders', cell: [0, 3], floor: 'concrete', floorColor: '#a9a49b', accent: '#d08a2c' },
  { id: 'media', label: 'Video & Audio', short: 'Media', icon: '🎬', group: 'creative', kind: 'desks', blurb: 'Shorts, edits, voice and sound', cell: [1, 3], floor: 'carpet', floorColor: '#8e8186', accent: '#c45a4a' },
  { id: 'cafe', label: 'Café', short: 'Café', icon: '☕', group: 'special', kind: 'cafe', blurb: 'Coffee, sofas and idle agents', cell: [2, 3], floor: 'wood', floorColor: '#b5926e', accent: '#9c6236' },
  { id: 'writing', label: 'Writing & Docs', short: 'Docs', icon: '✍️', group: 'creative', kind: 'desks', blurb: 'Docs, reports, slides, legal pages', cell: [3, 3], floor: 'wood', floorColor: '#cdb99e', accent: '#5c6a80' },
  { id: 'chill', label: 'Game Lounge', short: 'Lounge', icon: '🏓', group: 'special', kind: 'chill', blurb: 'Ping-pong, arcade and sofas', cell: [4, 3], floor: 'carpet', floorColor: '#7f8c9c', accent: '#d07a3c' },
];

export const ROOM_BY_ID: Record<RoomId, RoomDef> = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<RoomId, RoomDef>;

/** Domains a session can be classified into (rooms with work desks). */
export const DOMAIN_ROOMS: RoomId[] = ROOMS.filter((r) => r.kind === 'desks').map((r) => r.id);

/** Fixed categorical order, validated for colour-vision deficiency on the dark dashboard. */
export const PROVIDER_ORDER = ['claude-code', 'codex', 'claude-chat', 'chatgpt'] as const;

export const PROVIDER_META = {
  'claude-code': { label: 'Claude Code', short: 'Claude Code', color: '#d4704f', light: '#f1b59a', cloth: '#c9603f' },
  codex: { label: 'Codex', short: 'Codex', color: '#5b7cfa', light: '#a9bafc', cloth: '#3f63e0' },
  'claude-chat': { label: 'Claude chat', short: 'Claude chat', color: '#b38a2e', light: '#e6cf8f', cloth: '#c9971e' },
  chatgpt: { label: 'ChatGPT', short: 'ChatGPT', color: '#1aa3a0', light: '#8fdcd8', cloth: '#109c96' },
} as const;
