/**
 * Post-Build Processor — Console reporting utilities
 */

import fs from 'node:fs';
import path from 'node:path';
import { consoleColors } from '../../utils/index.js';

const getSizeColor = (sizeInBytes: number, maxSize: number): string => {
  const ratio = sizeInBytes / maxSize;
  if (ratio < 0.33) return '\x1b[32m'; // green
  if (ratio < 0.66) return '\x1b[33m'; // yellow
  if (ratio < 0.85) return '\x1b[38;5;208m'; // orange
  return '\x1b[31m'; // red
};

export const printAllFileSizes = async (
  fileSizeLog: { fileName: string; sizeInBytes: number }[],
  distDir: string,
  useGzip?: boolean,
): Promise<void> => {
  const maxSize = Math.max(...fileSizeLog.map((f) => f.sizeInBytes));
  const cyanColor = '\x1b[36m';
  const { reset } = consoleColors;

  for (const { fileName, sizeInBytes } of fileSizeLog) {
    const sizeInKilobytes = sizeInBytes / 1024;
    const sizeColor = getSizeColor(sizeInBytes, maxSize);
    let sizeInfo = `${sizeColor}Size: ${sizeInKilobytes.toFixed(2)} KB${reset}`;
    if (useGzip) {
      const gzipPath = path.join(distDir, fileName + '.gz');
      const brotliPath = path.join(distDir, fileName + '.br');
      const greenColor = '\x1b[32m';

      if (fs.existsSync(gzipPath)) {
        const gzipStats = await fs.promises.stat(gzipPath);
        const gzipSizeKB = gzipStats.size / 1024;
        sizeInfo += ` ${greenColor}(gzip: ${gzipSizeKB.toFixed(2)} KB`;

        if (fs.existsSync(brotliPath)) {
          const brotliStats = await fs.promises.stat(brotliPath);
          const brotliSizeKB = brotliStats.size / 1024;
          sizeInfo += `, br: ${brotliSizeKB.toFixed(2)} KB)`;
        } else {
          sizeInfo += `)`;
        }
        sizeInfo += reset;
      }
    }

    console.info(`${cyanColor}${fileName}${reset}  ${sizeInfo}`);
  }
};

export const printTotalSizes = async (
  totalBundleSizeInBytes: number,
  fileSizeLog: { fileName: string; sizeInBytes: number }[],
  distDir: string,
  useGzip?: boolean,
): Promise<void> => {
  const totalSizeInKilobytes = totalBundleSizeInBytes / 1024;
  console.info(consoleColors.green, `=== TOTAL BUNDLE SIZE: ${totalBundleSizeInBytes.toFixed(2)} B (${totalSizeInKilobytes.toFixed(2)} KB) ===`);

  if (useGzip) {
    let totalGzippedSize = 0;
    let totalBrotliSize = 0;
    for (const { fileName } of fileSizeLog) {
      const gzipPath = path.join(distDir, fileName + '.gz');
      const brotliPath = path.join(distDir, fileName + '.br');

      if (fs.existsSync(gzipPath)) {
        const stats = await fs.promises.stat(gzipPath);
        totalGzippedSize += stats.size;
      }

      if (fs.existsSync(brotliPath)) {
        const stats = await fs.promises.stat(brotliPath);
        totalBrotliSize += stats.size;
      }
    }
    const totalGzippedKB = totalGzippedSize / 1024;
    const totalBrotliKB = totalBrotliSize / 1024;
    console.info(consoleColors.green, `=== TOTAL GZIPPED: ${totalGzippedSize.toFixed(2)} B (${totalGzippedKB.toFixed(2)} KB) ===`);
    console.info(consoleColors.green, `=== TOTAL BROTLI: ${totalBrotliSize.toFixed(2)} B (${totalBrotliKB.toFixed(2)} KB) ===`);
  }

  console.info('');
};
