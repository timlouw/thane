/**
 * Thane Bundle Analyzer — Component Dependency Graph Extractor
 *
 * Scans the esbuild metafile to identify Thane component files,
 * reads their source to find export names, and maps inter-component
 * dependencies to produce an NX-style component tree.
 * @internal
 */

import fs from 'fs';
import path from 'path';
import type { Metafile } from 'esbuild';
import type { ComponentNode } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

function shortenPath(filePath: string): string {
  const root = process.cwd().replace(/\\/g, '/');
  return filePath.replace(/\\/g, '/').replace(root + '/', '').replace(root, '');
}

function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

// ============================================================================
// Component Extraction
// ============================================================================

interface RawComponent {
  name: string;
  selector: string;
  filePath: string;
  rawImports: string[];
}

const COMPONENT_REGEX = /export\s+const\s+(\w+)\s*=\s*defineComponent/g;

export async function extractComponentTree(metafile: Metafile): Promise<ComponentNode[]> {
  const rawComponents: RawComponent[] = [];
  const root = process.cwd();

  // 1. Scan every input for defineComponent exports
  for (const inputPath of Object.keys(metafile.inputs)) {
    const normalized = inputPath.replace(/\\/g, '/');
    if (normalized.includes('node_modules')) continue;
    if (!normalized.endsWith('.ts') && !normalized.endsWith('.js')) continue;

    const fullPath = path.resolve(root, inputPath);
    let source: string;
    try {
      source = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    if (!source.includes('defineComponent')) continue;

    const imports = (metafile.inputs[inputPath]?.imports ?? [])
      .map((i) => i.path.replace(/\\/g, '/'))
      .filter((p) => !p.includes('node_modules'));

    COMPONENT_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COMPONENT_REGEX.exec(source)) !== null) {
      rawComponents.push({
        name: match[1]!,
        selector: pascalToKebab(match[1]!),
        filePath: shortenPath(normalized),
        rawImports: imports.map(shortenPath),
      });
    }
  }

  // 2. Map file paths to the component selectors they contain
  const fileToSelectors = new Map<string, string[]>();
  for (const comp of rawComponents) {
    if (!fileToSelectors.has(comp.filePath)) fileToSelectors.set(comp.filePath, []);
    fileToSelectors.get(comp.filePath)!.push(comp.selector);
  }

  // 3. Build dependency / dependent edges
  const depsMap = new Map<string, Set<string>>();
  const deptsMap = new Map<string, Set<string>>();

  for (const comp of rawComponents) {
    depsMap.set(comp.selector, new Set());
    deptsMap.set(comp.selector, new Set());
  }

  for (const comp of rawComponents) {
    for (const imp of comp.rawImports) {
      const targets = fileToSelectors.get(imp);
      if (!targets) continue;
      for (const target of targets) {
        if (target !== comp.selector) {
          depsMap.get(comp.selector)?.add(target);
          deptsMap.get(target)?.add(comp.selector);
        }
      }
    }
  }

  // 4. Calculate output sizes per file from the metafile
  const fileSizes = new Map<string, number>();
  for (const outputInfo of Object.values(metafile.outputs)) {
    if (!outputInfo.inputs) continue;
    for (const [modPath, modInfo] of Object.entries(outputInfo.inputs)) {
      const short = shortenPath(modPath);
      fileSizes.set(short, (fileSizes.get(short) ?? 0) + modInfo.bytesInOutput);
    }
  }

  // 5. Assemble ComponentNode[]
  return rawComponents.map((comp) => ({
    name: comp.name,
    selector: comp.selector,
    filePath: comp.filePath,
    size: fileSizes.get(comp.filePath) ?? 0,
    dependencies: Array.from(depsMap.get(comp.selector) ?? []),
    dependents: Array.from(deptsMap.get(comp.selector) ?? []),
  }));
}
