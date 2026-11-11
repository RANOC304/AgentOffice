import path from 'node:path';

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|rk|pk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(bearer\s+)[A-Za-z0-9._~+/-]{16,}/gi,
  /((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)(["']?)[^\s"']{4,}\2/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Removes obvious credentials from text that will be displayed. */
export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, ...groups) => {
      const prefix = typeof groups[0] === 'string' && /^(bearer|password|passwd|pwd|secret|token|api)/i.test(groups[0]) ? groups[0] : '';
      return prefix ? `${prefix}••••` : '••••';
    });
  }
  return out;
}

/** Collapses whitespace, strips markdown noise, redacts and truncates. */
export function clean(text: string | undefined | null, max = 160): string {
  if (!text) return '';
  let out = String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<[^>\n]{1,40}>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  out = redact(out);
  if (out.length > max) out = out.slice(0, max - 1).trimEnd() + '…';
  return out;
}

/** First sentence-ish chunk of a message, good for speech bubbles. */
export function firstSentence(text: string, max = 110): string {
  const cleaned = clean(text, 600);
  const match = cleaned.match(/^(.{12,}?[.!?…])(\s|$)/);
  const sentence = match ? match[1] : cleaned;
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + '…' : sentence;
}

export function baseName(p: string | undefined): string {
  if (!p) return '';
  const normalized = p.replace(/^\\\\\?\\/, '').replace(/^file:\/\/\/?/, '');
  return path.win32.basename(normalized.replace(/\//g, '\\')) || normalized;
}

export function normalizePath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  let out = p.replace(/^\\\\\?\\/, '').replace(/^file:\/\/\/?/, '');
  out = decodeURIComponent(out).replace(/\//g, '\\');
  if (/^[a-z]:/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  return out.replace(/\\+$/, '');
}

/** Turns a shell command into a short human label. */
export function describeCommand(command: string): string {
  let cmd = command.trim();
  // Unwrap common shells: pwsh -Command "...", bash -lc '...'
  const wrapped = cmd.match(/(?:-Command|-c|-lc)\s+["']?([\s\S]+?)["']?$/);
  if (wrapped && /(?:pwsh|powershell|bash|sh|cmd)(?:\.exe)?/i.test(cmd.split(/\s+/)[0] ?? '')) cmd = wrapped[1];
  cmd = cmd.replace(/^cd\s+[^;&|]+(?:&&|;)\s*/i, '');
  const first = cmd.split(/\r?\n/)[0];
  return clean(first, 70);
}

export function projectNameFromPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const base = baseName(p);
  return base || p;
}
