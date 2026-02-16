import fs from 'node:fs';
import ts from 'typescript';
import { safeReadFile } from './file-utils.js';

interface CachedFile {
  source: string;
  sourceFile: ts.SourceFile;
  /** File modification time at the point of caching (ms since epoch) */
  mtimeMs: number;
}

/** Default maximum number of entries before the oldest is evicted. */
const DEFAULT_MAX_SIZE = 500;

class SourceFileCache {
  private cache = new Map<string, CachedFile>();
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  async get(filePath: string): Promise<{ source: string; sourceFile: ts.SourceFile } | null> {
    // Get current file mtime for staleness check
    let currentMtimeMs: number;
    try {
      const stat = await fs.promises.stat(filePath);
      currentMtimeMs = stat.mtimeMs;
    } catch {
      return null;
    }

    // Check cache — return only if mtime hasn't changed
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === currentMtimeMs) {
      // Move to end (most-recently used) for LRU ordering
      this.cache.delete(filePath);
      this.cache.set(filePath, cached);
      return { source: cached.source, sourceFile: cached.sourceFile };
    }

    // Read and parse file (cache miss or stale)
    const source = await safeReadFile(filePath);
    if (!source) return null;

    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    // Cache it with mtime
    this.cache.set(filePath, {
      source,
      sourceFile,
      mtimeMs: currentMtimeMs,
    });

    return { source, sourceFile };
  }

  parse(filePath: string, source: string): ts.SourceFile {
    return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  stats(): { size: number; files: string[] } {
    return {
      size: this.cache.size,
      files: Array.from(this.cache.keys()),
    };
  }
}

export const sourceCache = new SourceFileCache();
