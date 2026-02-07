/**
 * Post-Build Processor — Compression utilities
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { consoleColors } from '../../utils/index.js';

export const gzipDistFiles = async (distDir: string, isProd?: boolean): Promise<void> => {
  const brotliQuality = isProd ? 11 : 4;

  const compressFile = async (filePath: string): Promise<void> => {
    const gzipPath = filePath + '.gz';
    const brotliPath = filePath + '.br';
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(gzipPath);
      const gzip = zlib.createGzip({ level: 9 });

      readStream
        .pipe(gzip)
        .pipe(writeStream)
        .on('finish', () => resolve())
        .on('error', reject);
    });
    const content = await fs.promises.readFile(filePath);
    await new Promise<void>((resolve, reject) => {
      zlib.brotliCompress(content, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
          [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
          [zlib.constants.BROTLI_PARAM_LGBLOCK]: 0,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length,
        },
      }, (err: unknown, result: Uint8Array) => {
        if (err) return reject(err);
        fs.promises.writeFile(brotliPath, result).then(resolve, reject);
      });
    });
  };

  const processDirectory = async (dir: string): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await processDirectory(fullPath);
      } else if (entry.isFile() && !entry.name.endsWith('.gz') && !entry.name.endsWith('.br')) {
        const ext = path.extname(entry.name).toLowerCase();
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
