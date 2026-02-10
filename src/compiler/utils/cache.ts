import fs from 'fs';
import ts from 'typescript';
import { safeReadFile } from './file-utils.js';

interface CachedFile {
  source: string;
  sourceFile: ts.SourceFile;
  /** File modification time at the point of caching (ms since epoch) */
  mtimeMs: number;
}

class SourceFileCache {
  private cache = new Map<string, CachedFile>();

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
      return { source: cached.source, sourceFile: cached.sourceFile };
    }

    // Read and parse file (cache miss or stale)
    const source = await safeReadFile(filePath);
    if (!source) return null;

    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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
