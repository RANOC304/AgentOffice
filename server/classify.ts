import type { RoomId } from '../shared/rooms.ts';

export type DomainId = Exclude<RoomId, 'browser' | 'lounge'>;
export type Hints = Partial<Record<DomainId, number>>;

const EXTENSIONS: Array<[RegExp, Hints]> = [
  [/\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html?)$/i, { web: 1 }],
  [/\.(ts|js|mjs|cjs)$/i, { web: 0.5, backend: 0.4 }],
  [/\.(sql|prisma|graphql|proto)$/i, { backend: 1 }],
  [/\.(go|java|php|rb|ex|exs|scala)$/i, { backend: 1 }],
  [/\.py$/i, { data: 0.5, backend: 0.4, systems: 0.2 }],
  [/\.(ipynb|csv|parquet|onnx|pt|pth|safetensors|h5|npz?)$/i, { data: 1.2 }],
  [/(dockerfile|docker-compose[^/\\]*|\.tf|\.tfvars|vercel\.json|netlify\.toml)$/i, { devops: 1.2 }],
  [/[/\\]\.github[/\\]workflows[/\\]/i, { devops: 1.2 }],
  [/\.(kt|kts|swift|dart|gradle|xcodeproj|plist)$/i, { mobile: 1.2 }],
  [/androidmanifest\.xml$/i, { mobile: 1.2 }],
  [/\.(c|h|cpp|hpp|cc|rs|zig|asm|s)$/i, { systems: 1 }],
  [/(makefile|cmakelists\.txt)$/i, { systems: 1 }],
  [/\.(ps1|psm1|sh|bash|bat|cmd|toml|ini|reg)$/i, { systems: 0.9 }],
  [/\.(lua|luau|gd|unity|prefab|uasset)$/i, { gamedev: 1.3 }],
  [/\.(blend|glb|gltf|fbx|obj|stl|usdz?)$/i, { threed: 1.3 }],
  [/\.(mp4|mov|webm|mkv|wav|mp3|ogg|flac|srt|vtt)$/i, { media: 1.3 }],
  [/\.(svg|png|jpe?g|webp|gif|psd|fig|ai|ico)$/i, { design: 0.8 }],
  [/\.(md|mdx|txt|docx?|pdf|pptx?|tex|rst|odt)$/i, { writing: 0.8 }],
];

const KEYWORDS: Array<[RegExp, Hints]> = [
  [/\b(react|next\.?js|vite|tailwind|css|frontend|landing page|website|webpage|site web|html|dom|svelte|vue)\b/i, { web: 1 }],
  [/\b(api|endpoint|server|backend|database|postgres|mysql|sqlite|supabase|prisma|express|fastapi|flask|django|graphql|rest)\b/i, { backend: 1 }],
  [/\b(machine learning|ml|model training|neural|dataset|pandas|numpy|torch|pytorch|tensorflow|sklearn|llm|embedding|computer ?vision|opencv|cv2|qiskit|quantum|qaoa|notebook|jupyter|statistic)/i, { data: 1 }],
  [/\b(docker|kubernetes|k8s|terraform|ci\/cd|github actions|workflow|deploy|vercel|netlify|release|pipeline|git push|pull request|merge|rebase|cloud)\b/i, { devops: 1 }],
  [/\b(security|secur|vuln|cve|pentest|exploit|owasp|hardening|audit|malware|forensic|cyber|ctf|crime|encryption|firewall)/i, { security: 1.2 }],
  [/\b(android|ios|iphone|kotlin|swift|flutter|react native|expo|electron|tauri|desktop app|mobile|apk|scooter)/i, { mobile: 1 }],
  [/\b(powershell|bash|script|config|registry|driver|kernel|socket|network|tcp|udp|ssh|rust|c\+\+|compiler|embedded|wake.?on.?lan|setup|install|skill|agents\.md|mcp)\b/i, { systems: 0.8 }],
  [/\b(roblox|rojo|luau|unity|godot|unreal|game|gameplay|level design|sprite|npc|player)\b/i, { gamedev: 1.2 }],
  [/\b(research|explain|what is|why|compare|summar|learn|course|lecture|study|homework|presentation topic|analy[sz]e|investigate)/i, { research: 0.8 }],
  [/\b(blender|3d|three\.js|mesh|render|rig|modeling|modelling|sculpt|uv|shader|geometry nodes)/i, { threed: 1.2 }],
  [/\b(video|audio|tiktok|youtube|shorts|reels|ffmpeg|voiceover|podcast|music|sound|subtitle|caption|animation|remotion|animated)/i, { media: 1.1 }],
  [/\b(design|figma|canva|ui\/ux|ux|mockup|wireframe|logo|brand|palette|typography|illustration|icon|poster|pixel art)/i, { design: 1 }],
  [/\b(doc|docs|documentation|readme|report|essay|write|writing|draft|letter|email|slides|deck|legal|terms|privacy policy|cv|resume|blog)/i, { writing: 0.8 }],
];

const SKILLS: Array<[RegExp, Hints]> = [
  [/blender|geometry-nodes|asset-optimization|camera-cinematography|scene-assembly|set-dressing|environment-artist|vfx|stylized|creature/i, { threed: 2 }],
  [/immersive-website|shadcn|frontend|artifact-design/i, { web: 2 }],
  [/roblox/i, { gamedev: 2 }],
  [/whatif|social-video|shorts/i, { media: 2 }],
  [/security|hardening|legal-audit/i, { security: 2 }],
  [/quantum|dataviz|data:/i, { data: 2 }],
  [/legal-pages|docx|pptx|pdf|docs|writing|xlsx/i, { writing: 2 }],
  [/figma|canva|design|ui-ux/i, { design: 2 }],
  [/founder|research|council|brainstorm/i, { research: 1.5 }],
  [/deploy|vercel|ci/i, { devops: 2 }],
];

/** MCP servers / tool namespaces → domain. BrowserOS neo is handled separately. */
const MCP: Array<[RegExp, Hints]> = [
  [/blender/i, { threed: 2 }],
  [/figma|canva|82ae82d1|48ce0fd9/i, { design: 2 }],
  [/cloudinary|0d3c177c/i, { design: 1, media: 1 }],
  [/visualize/i, { design: 1 }],
  [/supabase|23985401/i, { backend: 2 }],
  [/vercel|959cd67f/i, { devops: 2 }],
  [/github|ccd_pr/i, { devops: 1.2 }],
  [/claude_browser|claude-in-chrome|browser/i, { web: 1, research: 0.4 }],
  [/pdf|docs|1a59c906|google|drive|0c782f7b/i, { writing: 1.5 }],
  [/calendar|7b7b0cfc/i, { research: 0.6 }],
  [/computer-use|computer_use/i, { systems: 1 }],
  [/node_repl/i, { systems: 0.6 }],
  [/tinypages|c82b39cf/i, { web: 1, writing: 0.6 }],
];

function addHints(target: Hints, hints: Hints, weight = 1) {
  for (const [key, value] of Object.entries(hints) as Array<[DomainId, number]>) {
    target[key] = (target[key] ?? 0) + value * weight;
  }
}

export function hintsForPath(p: string): Hints {
  const out: Hints = {};
  for (const [re, hints] of EXTENSIONS) if (re.test(p)) addHints(out, hints);
  if (/roblox|rojo/i.test(p)) addHints(out, { gamedev: 0.8 });
  if (/blender|\.blend/i.test(p)) addHints(out, { threed: 0.8 });
  return out;
}

export function hintsForText(text: string, weight = 1): Hints {
  const out: Hints = {};
  for (const [re, hints] of KEYWORDS) if (re.test(text)) addHints(out, hints, weight);
  return out;
}

export function hintsForCommand(cmd: string): Hints {
  const out: Hints = {};
  const lower = cmd.toLowerCase();
  if (/\b(npm|pnpm|yarn|bun|npx|vite|next|astro)\b/.test(lower)) addHints(out, { web: 0.7, backend: 0.3 });
  if (/\b(pip|python|py|pytest|jupyter|conda|uv)\b/.test(lower)) addHints(out, { data: 0.5, backend: 0.3 });
  if (/\b(docker|kubectl|terraform|vercel|gh |git push|git pull|git merge|gssh|gpr|gcheck)\b/.test(lower)) addHints(out, { devops: 1 });
  if (/\b(git)\b/.test(lower)) addHints(out, { devops: 0.3 });
  if (/\b(gradle|adb|xcodebuild|flutter|kotlinc|emulator)\b/.test(lower)) addHints(out, { mobile: 1.2 });
  if (/\b(gcc|g\+\+|clang|make|cmake|cargo|rustc|ping|ipconfig|netsh|ssh|nmap)\b/.test(lower)) addHints(out, { systems: 1 });
  if (/\b(get-|set-|new-item|reg |winget|choco)\b/.test(lower)) addHints(out, { systems: 0.6 });
  if (/\b(rojo|roblox|luau)\b/.test(lower)) addHints(out, { gamedev: 1.5 });
  if (/\b(blender)\b/.test(lower)) addHints(out, { threed: 1.5 });
  if (/\b(ffmpeg|ffprobe|yt-dlp|whisper|sox)\b/.test(lower)) addHints(out, { media: 1.5 });
  if (/\b(pandoc|libreoffice|soffice|pdftotext|latex|pdflatex)\b/.test(lower)) addHints(out, { writing: 1 });
  for (const [re, hints] of EXTENSIONS) if (re.test(lower.split(/\s+/).find((t) => re.test(t)) ?? '')) addHints(out, hints, 0.5);
  return out;
}

export function hintsForSkill(name: string): Hints {
  const out: Hints = {};
  for (const [re, hints] of SKILLS) if (re.test(name)) addHints(out, hints);
  return out;
}

export function hintsForMcp(server: string): Hints {
  const out: Hints = {};
  for (const [re, hints] of MCP) if (re.test(server)) addHints(out, hints);
  return out;
}

export function isBrowserOsNeo(name: string): boolean {
  return /browseros[-_ ]?neo|browseros-neo-bridge/i.test(name);
}

interface WeightedHint {
  at: number;
  hints: Hints;
}

/**
 * Keeps a decaying score per domain so a character walks to the room matching
 * what it has been doing recently, with some stickiness to avoid flip-flopping.
 */
export class DomainTracker {
  private recent: WeightedHint[] = [];
  private prior: Hints = {};
  current: DomainId | null = null;

  setPrior(hints: Hints) {
    this.prior = hints;
  }

  add(at: number, hints: Hints) {
    if (!Object.keys(hints).length) return;
    this.recent.push({ at, hints });
    if (this.recent.length > 60) this.recent.splice(0, this.recent.length - 60);
  }

  resolve(now: number): DomainId {
    const scores: Hints = {};
    addHints(scores, this.prior, 0.6);
    for (const { at, hints } of this.recent) {
      const ageMin = Math.max(0, now - at) / 60_000;
      addHints(scores, hints, Math.exp(-ageMin / 12));
    }
    let best: DomainId | null = null;
    let bestScore = 0;
    for (const [key, value] of Object.entries(scores) as Array<[DomainId, number]>) {
      if (value > bestScore) {
        best = key;
        bestScore = value;
      }
    }
    if (!best || bestScore < 0.25) return this.current ?? 'lobby';
    if (this.current && this.current !== best) {
      const currentScore = scores[this.current] ?? 0;
      if (currentScore > bestScore * 0.8) return this.current;
    }
    this.current = best;
    return best;
  }
}
