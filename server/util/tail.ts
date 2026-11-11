import fs from 'node:fs';

/**
 * Incrementally reads appended JSON lines from a growing file.
 * The first read starts at most `maxInitialBytes` from the end so huge transcripts stay cheap.
 */
export class JsonlTail {
  readonly file: string;
  size = 0;
  mtimeMs = 0;
  /** True when the first read skipped the beginning of a very large file. */
  skippedStart = false;
  private offset = 0;
  private remainder = '';
  private readonly maxInitialBytes: number;

  constructor(file: string, maxInitialBytes: number) {
    this.file = file;
    this.maxInitialBytes = maxInitialBytes;
  }

  /** Returns records appended since the previous call, or null when the file is unchanged or missing. */
  read(): unknown[] | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.file);
    } catch {
      return null;
    }
    if (stat.size === this.size && stat.mtimeMs === this.mtimeMs) return null;

    let dropFirstLine = false;
    if (stat.size < this.offset) {
      // File was rewritten: start over.
      this.offset = 0;
      this.remainder = '';
    }
    if (this.offset === 0 && stat.size > this.maxInitialBytes) {
      this.offset = stat.size - this.maxInitialBytes;
      this.skippedStart = true;
      dropFirstLine = true;
    }
    this.size = stat.size;
    this.mtimeMs = stat.mtimeMs;
    const length = stat.size - this.offset;
    if (length <= 0) return [];

    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(this.file, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, this.offset);
    } finally {
      fs.closeSync(fd);
    }
    this.offset = stat.size;

    const lines = (this.remainder + buffer.toString('utf8')).split('\n');
    this.remainder = lines.pop() ?? '';
    if (dropFirstLine) lines.shift();

    const records: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // Partial or corrupt line: ignore.
      }
    }
    return records;
  }
}
