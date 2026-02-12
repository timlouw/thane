/**
 * Thane Bundle Analyzer — Type Definitions
 * @internal
 */

export interface AnalyzerOptions {
  /** Entry points for the build */
  entryPoints: string[];
  /** Output directory */
  outDir: string;
  /** Production mode */
  isProd: boolean;
  /** Compare dev and prod side-by-side */
  compare: boolean;
  /** Port for the analyzer server */
  port: number;
  /** HTML template path */
  inputHTMLFilePath: string;
  /** Assets input directory */
  assetsInputDir?: string | undefined;
}

export interface AnalyzerReport {
  /** Project name (derived from cwd) */
  projectName: string;
  /** When the analysis was run */
  timestamp: number;
  /** Build analyses (dev, prod, or both) */
  builds: {
    dev?: BuildAnalysis | undefined;
    prod?: BuildAnalysis | undefined;
  };
  /** Component dependency tree */
  componentTree: ComponentNode[];
}

export interface BuildAnalysis {
  mode: 'dev' | 'prod';
  buildTimeMs: number;
  totalSize: number;
  totalGzipSize: number;
  moduleCount: number;
  chunks: ChunkAnalysis[];
  modules: ModuleAnalysis[];
  dependencies: DependencyEdge[];
}

export interface ChunkAnalysis {
  name: string;
  size: number;
  gzipSize: number;
  isEntry: boolean;
  entryPoint?: string | undefined;
  modules: { path: string; size: number }[];
}

export interface ModuleAnalysis {
  path: string;
  /** Bytes this module contributes to the output */
  size: number;
  /** Original source file size */
  originalSize: number;
  /** Modules this imports */
  imports: string[];
  /** Modules that import this */
  importedBy: string[];
  /** Which chunk this module belongs to */
  chunk: string;
  /** Category for color-coding */
  category: ModuleCategory;
}

export type ModuleCategory = 'component' | 'style' | 'route' | 'library' | 'runtime' | 'signal' | 'other';

export interface DependencyEdge {
  source: string;
  target: string;
}

export interface ComponentNode {
  /** PascalCase component name */
  name: string;
  /** kebab-case selector */
  selector: string;
  /** Source file path */
  filePath: string;
  /** Size in output (bytes) */
  size: number;
  /** Selectors of components this depends on */
  dependencies: string[];
  /** Selectors of components that depend on this */
  dependents: string[];
}
