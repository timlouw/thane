/**
 * CLI Types for Thane Build Tool
 */

export interface CLIOptions {
  /** Command to execute */
  command: 'build' | 'dev' | 'serve' | 'analyze';
  /** Production mode */
  prod: boolean;
  /** Enable gzip/brotli compression */
  gzip: boolean;
  /** Application name */
  app: string;
  /** Entry point file */
  entry?: string | undefined;
  /** Output directory */
  outDir?: string | undefined;
  /** Assets source directory */
  assetsDir?: string | undefined;
  /** HTML template file */
  htmlTemplate?: string | undefined;
  /** Start dev server after build */
  serve: boolean;
  /** Compare dev and prod builds (analyze command) */
  compare: boolean;
  /** Port for analyzer server */
  analyzerPort: number;
}

export interface BuildConfig {
  /** Entry points for the build */
  entryPoints: string[];
  /** Output directory */
  outDir: string;
  /** Assets input directory */
  assetsInputDir?: string | undefined;
  /** Assets output directory */
  assetsOutputDir?: string | undefined;
  /** Input HTML file path */
  inputHTMLFilePath: string;
  /** Output HTML file path */
  outputHTMLFilePath: string;
  /** Whether in production mode */
  isProd: boolean;
  /** Whether to start dev server */
  serve: boolean;
  /** Whether to use gzip/brotli compression */
  useGzip: boolean;
  /** Whether to fail the build on type errors (default: false = warn only) */
  strictTypeCheck?: boolean | undefined;
}
