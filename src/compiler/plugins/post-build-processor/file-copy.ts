/**
 * Post-Build Processor — File copying utilities
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/index.js';

type WatchCleanup = () => void;

export const recursivelyCopyAssetsIntoDist = async (src: string, dest: string): Promise<void> => {
  await fs.promises.mkdir(dest, { recursive: true });

  try {
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await recursivelyCopyAssetsIntoDist(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  } catch (error) {
    logger.verbose(`[file-copy] Failed to copy assets from ${src}: ${error instanceof Error ? error.message : error}`);
  }
};

/**
 * Debounce timer map for filesystem watcher events.
 * Cleaned up on process exit to avoid resource leaks in watch mode.
 */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 100;

/** Clear all pending debounce timers — called on process exit. */
export function clearAllDebounceTimers(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

export const watchAndRecursivelyCopyAssetsIntoDist = (
  src: string,
  dest: string,
  onUpdate?: () => void,
): WatchCleanup => {
  if (!fs.existsSync(src)) {
    return () => {};
  }

  recursivelyCopyAssetsIntoDist(src, dest);

  const watcher = fs.watch(src, { recursive: true }, (eventType: string, filename: string | null) => {
    if (!filename) return;

    // Debounce rapid saves to avoid redundant rebuilds
    const existingTimer = debounceTimers.get(filename);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    debounceTimers.set(
      filename,
      setTimeout(async () => {
        debounceTimers.delete(filename);

        const srcPath = path.join(src, filename);
        const destPath = path.join(dest, filename);

        try {
          if (eventType === 'change') {
            const stat = await fs.promises.lstat(srcPath).catch(() => null);
            if (stat?.isDirectory()) {
              await recursivelyCopyAssetsIntoDist(srcPath, destPath);
            } else if (stat) {
              await fs.promises.copyFile(srcPath, destPath);
            }
          } else if (eventType === 'rename') {
            const stat = await fs.promises.lstat(srcPath).catch(() => null);
            if (stat) {
              if (stat.isDirectory()) {
                await recursivelyCopyAssetsIntoDist(srcPath, destPath);
              } else {
                await fs.promises.copyFile(srcPath, destPath);
              }
            } else {
              await fs.promises.rm(destPath, { recursive: true, force: true }).catch(() => {});
            }
          }
          onUpdate?.();
        } catch (error) {
          // Race conditions during rapid file changes
          logger.verbose(
            `[file-copy] Watcher error for ${filename}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }, DEBOUNCE_MS),
    );
  });

  return () => {
    watcher.close();
  };
};

/**
 * Watch a single file for changes with debouncing
 */
export const watchFileForChanges = (filePath: string, onChange: () => void): WatchCleanup => {
  if (!fs.existsSync(filePath)) {
    return () => {};
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = fs.watch(filePath, (eventType: string) => {
    if (eventType !== 'change') return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, DEBOUNCE_MS);
  });

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    watcher.close();
  };
};
