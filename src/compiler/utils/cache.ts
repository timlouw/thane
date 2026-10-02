import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { safeReadFile } from './file-utils.js';

interface CachedFile {
  source: string;
  sourceFile: ts.SourceFile;
  /** File modification time at the point of caching (ms since epoch) */
  mtimeMs: number;
  /** The type check's parse options it was made with (see getSync), or undefined for the build's own parse */
  key?: string | undefined;
}

/** Default maximum number of entries before the oldest is evicted. */
const DEFAULT_MAX_SIZE = 2000;

/**
 * Each project source as read and parsed once, while it is unchanged on disk. The build reads its files
 * here, and so does the type check (getSync), which runs first: the build then reads the type check's parses.
 * Files are keyed by their absolute path.
 */
class SourceFileCache {
  private cache = new Map<string, CachedFile>();
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /** The cached entry of `file` if it is still the file on disk, as the most recently used */
  private fresh(file: string, mtimeMs: number): CachedFile | undefined {
    const cached = this.cache.get(file);
    if (!cached || cached.mtimeMs !== mtimeMs) return undefined;
    this.cache.delete(file);
    this.cache.set(file, cached);
    return cached;
  }

  private store(file: string, entry: CachedFile): void {
    this.cache.delete(file);
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(file, entry);
  }

  /** A file's text and parse, whichever options it was parsed with */
  async get(filePath: string): Promise<{ source: string; sourceFile: ts.SourceFile } | null> {
    const file = path.resolve(filePath);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    } catch {
      return null;
    }
    const cached = this.fresh(file, mtimeMs);
    if (cached) return cached;

    const source = await safeReadFile(file);
    if (!source) return null;
    const sourceFile = this.parse(filePath, source);
    this.store(file, { source, sourceFile, mtimeMs });
    return { source, sourceFile };
  }

  /**
   * The type check's read of a file, synchronous as a compiler host's: the cached parse when it was made with
   * the options `key` stands for, else `parse` of the text, which is cached for the build to read too.
   */
  getSync(
    filePath: string,
    key: string,
    parse: (source: string) => ts.SourceFile,
  ): { source: string; sourceFile: ts.SourceFile } | null {
    const file = path.resolve(filePath);
    let mtimeMs: number;
    let source: string;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
      const cached = this.fresh(file, mtimeMs);
      if (cached?.key === key) return cached;
      source = cached?.source ?? fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    const sourceFile = parse(source);
    this.store(file, { source, sourceFile, mtimeMs, key });
    return { source, sourceFile };
  }

  parse(filePath: string, source: string): ts.SourceFile {
    return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const sourceCache = new SourceFileCache();
