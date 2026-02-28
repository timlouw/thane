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
  /** Root HTML file (default: ./index.html) */
  html?: string | undefined;
  /** Start dev server after build */
  serve: boolean;
  /** Logging verbosity: 'silent' | 'normal' | 'verbose' */
  logLevel: import('../types.js').LogLevel;
  /** Optional config file path passed via --config */
  configPath?: string | undefined;
  /** Strip console.* calls (default: true in prod, false in dev) */
  dropConsole?: boolean | undefined;
  /** Strip debugger statements (default: true in prod, false in dev) */
  dropDebugger?: boolean | undefined;
  /** Generate source maps (default: true in dev, false in prod) */
  sourcemap?: boolean | undefined;
  /** Fail build on TypeScript type errors (default: false — warn only) */
  strictTypeCheck?: boolean | undefined;
  /** Dev server port (default: 4200) */
  port?: number | undefined;
  /** Auto-open browser on dev server start (default: false) */
  open?: boolean | undefined;
  /** Dev server host address. true or '0.0.0.0' for LAN access (default: 'localhost') */
  host?: string | boolean | undefined;
  /** Public base path for deployed assets (default: '/') */
  base?: string | undefined;
  /** Override browser/JS targets for esbuild (default: Thane defaults) */
  target?: string[] | undefined;
  /** Include content hashes in output filenames (default: true) */
  hashFileNames?: boolean | undefined;
  /** Compile-time global constant replacements (esbuild define) */
  define?: Record<string, string> | undefined;
  /** Only env vars with this prefix are injected as defines (default: 'THANE_') */
  envPrefix?: string | undefined;
  /** Clear output directory before building (default: true) */
  emptyOutDir?: boolean | undefined;
  /** Enable code splitting (default: true) */
  splitting?: boolean | undefined;
  /** How to handle legal/license comments: 'none' | 'eof' | 'linked' | 'external' (default: 'none') */
  legalComments?: 'none' | 'eof' | 'linked' | 'external' | undefined;
  /** Write esbuild metafile to dist for bundle analysis (default: false) */
  analyze?: boolean | undefined;
  /** Set when --help or --version is passed; caller should print and exit */
  exitRequested?: 'help' | 'version' | undefined;
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
  /** Root HTML file (default: ./index.html) */
  html?: string | undefined;
  /** Strip console.* calls (default: true in prod, false in dev) */
  dropConsole?: boolean | undefined;
  /** Strip debugger statements (default: true in prod, false in dev) */
  dropDebugger?: boolean | undefined;
  /** Generate source maps (default: true in dev, false in prod) */
  sourcemap?: boolean | undefined;
  /** Fail build on TypeScript type errors (default: false — warn only) */
  strictTypeCheck?: boolean | undefined;
  /** Dev server port (default: 4200) */
  port?: number | undefined;
  /** Auto-open browser on dev server start (default: false) */
  open?: boolean | undefined;
  /** Dev server host address. true or '0.0.0.0' for LAN access (default: 'localhost') */
  host?: string | boolean | undefined;
  /** Public base path for deployed assets (default: '/') */
  base?: string | undefined;
  /** Override browser/JS targets for esbuild */
  target?: string[] | undefined;
  /** Include content hashes in output filenames (default: true) */
  hashFileNames?: boolean | undefined;
  /** Compile-time global constant replacements (esbuild define) */
  define?: Record<string, string> | undefined;
  /** Only env vars with this prefix are injected as defines (default: 'THANE_') */
  envPrefix?: string | undefined;
  /** Clear output directory before building (default: true) */
  emptyOutDir?: boolean | undefined;
  /** Enable code splitting (default: true) */
  splitting?: boolean | undefined;
  /** How to handle legal/license comments: 'none' | 'eof' | 'linked' | 'external' (default: 'none') */
  legalComments?: 'none' | 'eof' | 'linked' | 'external' | undefined;
  /** Write esbuild metafile to dist for bundle analysis (default: false) */
  analyze?: boolean | undefined;
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
  /** Whether to strip console.* calls from the bundle */
  dropConsole: boolean;
  /** Whether to strip debugger statements from the bundle */
  dropDebugger: boolean;
  /** Whether to generate source maps */
  sourcemap: boolean;
  /** Whether to fail the build on type errors (default: false = warn only) */
  strictTypeCheck: boolean;
  /** Dev server port */
  port: number;
  /** Auto-open browser on dev server start */
  open: boolean;
  /** Dev server host address */
  host: string;
  /** Public base path for deployed assets */
  base: string;
  /** esbuild browser/JS targets */
  target: string[];
  /** Include content hashes in output filenames */
  hashFileNames: boolean;
  /** Compile-time global constant replacements */
  define: Record<string, string>;
  /** Env var prefix for automatic define injection */
  envPrefix: string;
  /** Clear output directory before building */
  emptyOutDir: boolean;
  /** Enable code splitting */
  splitting: boolean;
  /** Legal/license comment handling */
  legalComments: 'none' | 'eof' | 'linked' | 'external';
  /** Write esbuild metafile to dist for bundle analysis */
  analyze: boolean;
}
