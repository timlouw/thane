/**
 * Post-Build Processor — Compression utilities
 */

import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { consoleColors } from '../../utils/index.js';

export const gzipDistFiles = async (distDir: string, isProd?: boolean): Promise<void> => {
  const brotliQuality = isProd ? 11 : 4;

  const compressFile = async (filePath: string): Promise<void> => {
    const gzipPath = filePath + '.gz';
    const brotliPath = filePath + '.br';

    const content = await Bun.file(filePath).bytes();

    // Gzip compression using Bun's native API
    const gzipped = Bun.gzipSync(content, { level: 9 });
    await Bun.write(gzipPath, gzipped);

    // Brotli compression using node:zlib (Bun doesn't have a native brotli API yet)
    const brotlied = brotliCompressSync(content, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality,
        [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
        [zlibConstants.BROTLI_PARAM_LGBLOCK]: 0,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: content.length,
      },
    });
    await Bun.write(brotliPath, brotlied);
  };

  const processDirectory = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await processDirectory(fullPath);
      } else if (entry.isFile() && !entry.name.endsWith('.gz') && !entry.name.endsWith('.br')) {
        const ext = extname(entry.name).toLowerCase();
        const compressibleExtensions = ['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml'];

        if (compressibleExtensions.includes(ext)) {
          await compressFile(fullPath);
        }
      }
    }
  };

  console.info(consoleColors.blue, 'Compressing files with gzip and brotli...');
  await processDirectory(distDir);
  console.info(consoleColors.green, 'Compression complete');
};
