import fs from 'node:fs';
import path from 'node:path';
import type { BuildContext, ComponentDefinition } from '../types.js';
import { sourceCache } from './cache.js';
import { extractComponentDefinitions } from './ast-utils.js';
import { logger } from './logger.js';

export const safeReadFile = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (err) {
    logger.verbose(`safeReadFile: failed to read "${filePath}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
};

/** Directories that should never be scanned for component sources */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', '.svn', '.hg', 'coverage', '.turbo', '.next', '.nuxt']);

export const collectFilesRecursively = async (
  dir: string,
  filter: (fileName: string) => boolean,
  excludeDirs: Set<string> = EXCLUDED_DIRS,
): Promise<string[]> => {
  const files: string[] = [];

  const collect = async (currentDir: string): Promise<void> => {
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!excludeDirs.has(entry.name)) {
            await collect(fullPath);
          }
        } else if (entry.isFile() && filter(entry.name)) {
          files.push(path.normalize(fullPath));
        }
      }
    } catch (err) {
      // Skip directories that can't be read, but log for diagnostics
      logger.verbose(`collectFilesRecursively: skipping "${currentDir}": ${err instanceof Error ? err.message : err}`);
    }
  };

  await collect(dir);
  return files;
};

export const getContentType = (url: string): string => {
  const ext = url.substring(url.lastIndexOf('.'));
  switch (ext) {
    case '.js':
      return 'text/javascript';
    case '.css':
      return 'text/css';
    case '.html':
      return 'text/html';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'text/plain';
  }
};

/**
 * Create a shared BuildContext by scanning the project root for component files.
 * Both ComponentPrecompiler and HTMLBootstrapInjector use this to avoid
 * duplicate filesystem scans.
 */
export const createBuildContext = async (): Promise<BuildContext> => {
  const workspaceRoot = process.cwd();
  const searchDirs = [workspaceRoot];
  const tsFilter = (name: string) => name.endsWith('.ts') && !name.endsWith('.d.ts');

  const tsFiles: string[] = [];
  const componentsByName = new Map<string, ComponentDefinition>();
  const componentsBySelector = new Map<string, ComponentDefinition>();

  sourceCache.clear();

  for (const dir of searchDirs) {
    const files = await collectFilesRecursively(dir, tsFilter);
    tsFiles.push(...files);

    for (const filePath of files) {
      const cached = await sourceCache.get(filePath);
      if (cached) {
        const definitions = extractComponentDefinitions(cached.sourceFile, filePath);
        for (const def of definitions) {
          componentsByName.set(def.name, def);
          componentsBySelector.set(def.selector, def);
        }
      }
    }
  }

  return { tsFiles, componentsByName, componentsBySelector };
};
