/**
 * CLI Types for Thane Build Tool
 */

export interface CLIOptions {
  /** Command to execute */
  command: 'build' | 'dev' | 'serve';
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
  /** Logging verbosity: 'silent' | 'normal' | 'verbose' */
  logLevel: import('../types.js').LogLevel;
  /** Optional config file path passed via --config */
  configPath?: string | undefined;
}

/**
 * Build options supported in thane config files.
 */
export interface ThaneBuildOptions {
  /** Production mode */
  prod?: boolean | undefined;
  /** Enable gzip compression */
  gzip?: boolean | undefined;
  /** Application name */
  app?: string | undefined;
  /** Entry point file */
  entry?: string | undefined;
  /** Output directory */
  outDir?: string | undefined;
  /** Assets source directory */
  assetsDir?: string | undefined;
  /** HTML template file */
  htmlTemplate?: string | undefined;
}

/**
 * Config file schema for thane.
 *
 * Supports:
 * - Top-level defaults (`entry`, `outDir`, etc.)
 * - Per-command overrides in `commands`.
 *
 * Precedence: CLI flags > command overrides > top-level config > built-in defaults.
 */
export interface ThaneConfigFile extends ThaneBuildOptions {
  commands?:
    | {
        build?: ThaneBuildOptions | undefined;
        dev?: ThaneBuildOptions | undefined;
        serve?: ThaneBuildOptions | undefined;
      }
    | undefined;
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
