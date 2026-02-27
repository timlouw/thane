import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { CLIOptions, BuildConfig, ThaneBuildOptions, ThaneConfigFile } from './types.js';
import { runBuild } from './build.js';
import { logger } from '../utils/index.js';

const COMMANDS = new Set(['build', 'dev', 'serve']);

const DEFAULT_OPTIONS: CLIOptions = {
  command: 'build',
  prod: false,
  gzip: false,
  app: 'client',
  serve: false,
  logLevel: 'normal',
};

const toAbsoluteIfRelative = (value: string, baseDir: string): string =>
  isAbsolute(value) ? value : resolve(baseDir, value);

const getPositionalCommand = (args: string[], flagsWithValue: Set<string>): CLIOptions['command'] | null => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (flagsWithValue.has(arg)) {
      i++; // skip the value
      continue;
    }
    if (!arg.startsWith('-') && COMMANDS.has(arg)) {
      return arg as CLIOptions['command'];
    }
  }
  return null;
};

const hasFlag = (args: string[], ...flags: string[]): boolean => {
  const set = new Set(flags);
  return args.some((a) => set.has(a));
};

const hasValueFlag = (args: string[], flag: string): boolean => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      return i + 1 < args.length && !args[i + 1]?.startsWith('-');
    }
  }
  return false;
};

const applyCommandModeDefaults = (options: CLIOptions): CLIOptions => {
  if (options.command === 'dev') {
    return { ...options, serve: true, prod: false };
  }
  if (options.command === 'serve') {
    return { ...options, serve: true };
  }
  return options;
};

const coerceConfigToCLIOptions = (cfg: ThaneBuildOptions | undefined): Partial<CLIOptions> => {
  if (!cfg) return {};
  return {
    ...(cfg.prod != null && { prod: cfg.prod }),
    ...(cfg.gzip != null && { gzip: cfg.gzip }),
    ...(cfg.app != null && { app: cfg.app }),
    ...(cfg.entry != null && { entry: cfg.entry }),
    ...(cfg.outDir != null && { outDir: cfg.outDir }),
    ...(cfg.assetsDir != null && { assetsDir: cfg.assetsDir }),
    ...(cfg.htmlTemplate != null && { htmlTemplate: cfg.htmlTemplate }),
    ...(cfg.dropConsole != null && { dropConsole: cfg.dropConsole }),
    ...(cfg.dropDebugger != null && { dropDebugger: cfg.dropDebugger }),
    ...(cfg.sourcemap != null && { sourcemap: cfg.sourcemap }),
    ...(cfg.strictTypeCheck != null && { strictTypeCheck: cfg.strictTypeCheck }),
    ...(cfg.port != null && { port: cfg.port }),
    ...(cfg.open != null && { open: cfg.open }),
    ...(cfg.host != null && { host: cfg.host }),
    ...(cfg.base != null && { base: cfg.base }),
    ...(cfg.target != null && { target: cfg.target }),
    ...(cfg.hashFileNames != null && { hashFileNames: cfg.hashFileNames }),
    ...(cfg.define != null && { define: cfg.define }),
    ...(cfg.envPrefix != null && { envPrefix: cfg.envPrefix }),
    ...(cfg.emptyOutDir != null && { emptyOutDir: cfg.emptyOutDir }),
    ...(cfg.splitting != null && { splitting: cfg.splitting }),
    ...(cfg.legalComments != null && { legalComments: cfg.legalComments }),
    ...(cfg.analyze != null && { analyze: cfg.analyze }),
  };
};

const absolutizeConfigPaths = (opts: Partial<CLIOptions>, baseDir: string): Partial<CLIOptions> => {
  return {
    ...opts,
    ...(opts.entry ? { entry: toAbsoluteIfRelative(opts.entry, baseDir) } : {}),
    ...(opts.outDir ? { outDir: toAbsoluteIfRelative(opts.outDir, baseDir) } : {}),
    ...(opts.assetsDir ? { assetsDir: toAbsoluteIfRelative(opts.assetsDir, baseDir) } : {}),
    ...(opts.htmlTemplate ? { htmlTemplate: toAbsoluteIfRelative(opts.htmlTemplate, baseDir) } : {}),
  };
};

const loadConfigFile = (configPath?: string): { path: string; config: ThaneConfigFile } | null => {
  const cwd = process.cwd();
  const resolvedPath = configPath
    ? toAbsoluteIfRelative(configPath, cwd)
    : [resolve(cwd, 'thane.config.json'), resolve(cwd, 'thane.config.jsonc')].find((p) => existsSync(p));

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return null;
  }

  const read = ts.readConfigFile(resolvedPath, ts.sys.readFile);
  if (read.error) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, '\n');
    throw new Error(`Invalid config file at ${resolvedPath}: ${message}`);
  }

  const value = read.config;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid config file at ${resolvedPath}: expected a JSON object.`);
  }

  return { path: resolvedPath, config: value as ThaneConfigFile };
};

const mergeCLIAndConfig = (args: string[], parsedCLI: CLIOptions): CLIOptions => {
  const loaded = loadConfigFile(parsedCLI.configPath);
  if (!loaded) {
    return applyCommandModeDefaults(parsedCLI);
  }

  const cfgDir = dirname(loaded.path);
  const topLevel = absolutizeConfigPaths(coerceConfigToCLIOptions(loaded.config), cfgDir);
  const perCommand = absolutizeConfigPaths(
    coerceConfigToCLIOptions(loaded.config.commands?.[parsedCLI.command]),
    cfgDir,
  );

  let merged: CLIOptions = {
    ...DEFAULT_OPTIONS,
    ...topLevel,
    ...perCommand,
    command: parsedCLI.command,
    configPath: loaded.path,
  };

  // CLI overrides config (Angular/React-style precedence)
  if (hasFlag(args, '--prod', '-p')) merged.prod = true;
  if (hasFlag(args, '--gzip')) merged.gzip = true;
  if (hasFlag(args, '--verbose', '-V')) merged.logLevel = 'verbose';
  if (hasFlag(args, '--quiet', '-q')) merged.logLevel = 'silent';
  if (hasValueFlag(args, '--app') && parsedCLI.app) merged.app = parsedCLI.app;
  if (hasValueFlag(args, '--entry') && parsedCLI.entry) merged.entry = parsedCLI.entry;
  if (hasValueFlag(args, '--out') && parsedCLI.outDir) merged.outDir = parsedCLI.outDir;
  if (hasValueFlag(args, '--assets') && parsedCLI.assetsDir) merged.assetsDir = parsedCLI.assetsDir;
  if (hasValueFlag(args, '--html') && parsedCLI.htmlTemplate) merged.htmlTemplate = parsedCLI.htmlTemplate;
  if (hasValueFlag(args, '--config') && parsedCLI.configPath) {
    merged.configPath = toAbsoluteIfRelative(parsedCLI.configPath, process.cwd());
  }
  if (hasFlag(args, '--drop-console')) merged.dropConsole = true;
  if (hasFlag(args, '--no-drop-console')) merged.dropConsole = false;
  if (hasFlag(args, '--drop-debugger')) merged.dropDebugger = true;
  if (hasFlag(args, '--no-drop-debugger')) merged.dropDebugger = false;
  if (hasFlag(args, '--sourcemap')) merged.sourcemap = true;
  if (hasFlag(args, '--no-sourcemap')) merged.sourcemap = false;
  if (hasFlag(args, '--strict-type-check')) merged.strictTypeCheck = true;
  if (hasFlag(args, '--open')) merged.open = true;
  if (hasFlag(args, '--no-open')) merged.open = false;
  if (hasFlag(args, '--hash-file-names')) merged.hashFileNames = true;
  if (hasFlag(args, '--no-hash-file-names')) merged.hashFileNames = false;
  if (hasFlag(args, '--empty-out-dir')) merged.emptyOutDir = true;
  if (hasFlag(args, '--no-empty-out-dir')) merged.emptyOutDir = false;
  if (hasFlag(args, '--splitting')) merged.splitting = true;
  if (hasFlag(args, '--no-splitting')) merged.splitting = false;
  if (hasFlag(args, '--analyze')) merged.analyze = true;
  if (hasFlag(args, '--no-analyze')) merged.analyze = false;
  if (hasValueFlag(args, '--port') && parsedCLI.port != null) merged.port = parsedCLI.port;
  if (hasValueFlag(args, '--host') && parsedCLI.host != null) merged.host = parsedCLI.host;
  if (hasValueFlag(args, '--base') && parsedCLI.base != null) merged.base = parsedCLI.base;
  if (hasValueFlag(args, '--target') && parsedCLI.target != null) merged.target = parsedCLI.target;
  if (hasValueFlag(args, '--env-prefix') && parsedCLI.envPrefix != null) merged.envPrefix = parsedCLI.envPrefix;
  if (hasValueFlag(args, '--legal-comments') && parsedCLI.legalComments != null) merged.legalComments = parsedCLI.legalComments;

  return applyCommandModeDefaults(merged);
};

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = { ...DEFAULT_OPTIONS };

  const knownFlags = new Set([
    '--prod',
    '-p',
    '--gzip',
    '--app',
    '--entry',
    '--out',
    '--assets',
    '--html',
    '--help',
    '-h',
    '--version',
    '-v',
    '--verbose',
    '-V',
    '--quiet',
    '-q',
    '--config',
    '--drop-console',
    '--no-drop-console',
    '--drop-debugger',
    '--no-drop-debugger',
    '--sourcemap',
    '--no-sourcemap',
    '--strict-type-check',
    '--port',
    '--open',
    '--no-open',
    '--host',
    '--base',
    '--target',
    '--hash-file-names',
    '--no-hash-file-names',
    '--env-prefix',
    '--empty-out-dir',
    '--no-empty-out-dir',
    '--splitting',
    '--no-splitting',
    '--legal-comments',
    '--analyze',
    '--no-analyze',
  ]);
  const flagsWithValue = new Set([
    '--app',
    '--entry',
    '--out',
    '--assets',
    '--html',
    '--config',
    '--port',
    '--host',
    '--base',
    '--target',
    '--env-prefix',
    '--legal-comments',
  ]);

  const commandArg = getPositionalCommand(args, flagsWithValue);
  if (commandArg) {
    options.command = commandArg;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--prod':
      case '-p':
        options.prod = true;
        break;
      case '--gzip':
        options.gzip = true;
        break;
      case '--app':
        options.app = args[++i] || 'client';
        break;
      case '--entry':
        options.entry = args[++i];
        break;
      case '--out':
        options.outDir = args[++i];
        break;
      case '--assets':
        options.assetsDir = args[++i];
        break;
      case '--html':
        options.htmlTemplate = args[++i];
        break;
      case '--config':
        options.configPath = args[++i];
        break;
      case '--drop-console':
        options.dropConsole = true;
        break;
      case '--no-drop-console':
        options.dropConsole = false;
        break;
      case '--drop-debugger':
        options.dropDebugger = true;
        break;
      case '--no-drop-debugger':
        options.dropDebugger = false;
        break;
      case '--sourcemap':
        options.sourcemap = true;
        break;
      case '--no-sourcemap':
        options.sourcemap = false;
        break;
      case '--strict-type-check':
        options.strictTypeCheck = true;
        break;
      case '--port':
        options.port = parseInt(args[++i] || '4200', 10);
        break;
      case '--open':
        options.open = true;
        break;
      case '--no-open':
        options.open = false;
        break;
      case '--host':
        options.host = args[++i] || '0.0.0.0';
        break;
      case '--base':
        options.base = args[++i] || '/';
        break;
      case '--target':
        options.target = (args[++i] || '').split(',').map((t) => t.trim()).filter(Boolean);
        break;
      case '--hash-file-names':
        options.hashFileNames = true;
        break;
      case '--no-hash-file-names':
        options.hashFileNames = false;
        break;
      case '--env-prefix':
        options.envPrefix = args[++i] || 'THANE_';
        break;
      case '--empty-out-dir':
        options.emptyOutDir = true;
        break;
      case '--no-empty-out-dir':
        options.emptyOutDir = false;
        break;
      case '--splitting':
        options.splitting = true;
        break;
      case '--no-splitting':
        options.splitting = false;
        break;
      case '--legal-comments':
        options.legalComments = (args[++i] || 'none') as CLIOptions['legalComments'];
        break;
      case '--analyze':
        options.analyze = true;
        break;
      case '--no-analyze':
        options.analyze = false;
        break;
      case '--verbose':
      case '-V':
        options.logLevel = 'verbose';
        break;
      case '--quiet':
      case '-q':
        options.logLevel = 'silent';
        break;
      case '--help':
      case '-h':
        options.exitRequested = 'help';
        break;
      case '--version':
      case '-v':
        options.exitRequested = 'version';
        break;
      default:
        if (arg && (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2))) {
          // Skip values consumed by flags with arguments
          const prevArg = args[i - 1];
          if (prevArg && flagsWithValue.has(prevArg)) break;
          if (!knownFlags.has(arg)) {
            console.warn(`Warning: Unknown flag '${arg}'. Run 'thane --help' to see available options.`);
          }
        }
        break;
    }
  }

  return applyCommandModeDefaults(options);
}

export function printHelp(): void {
  console.log(`
Thane CLI - Component Framework Build Tool

Usage:
  thane <command> [options]

Commands:
  build       Build the application
  dev         Start development server with watch mode
  serve       Build and serve the application

Options:
  --prod, -p          Production build (default: development)
  --gzip              Enable gzip compression (production only)
  --app <name>        Application name (default: client)
  --entry <path>      Custom entry point (default: ./src/main.ts)
  --out <dir>         Output directory (default: ./dist)
  --assets <dir>      Assets directory (default: ./src/assets)
  --html <path>       HTML template file (default: ./index.html)
  --config <path>     Path to thane config file (default: ./thane.config.json or .jsonc)
  --drop-console      Strip console.* calls from the bundle (default: on in prod)
  --no-drop-console   Keep console.* calls in the bundle (even in prod)
  --drop-debugger     Strip debugger statements (default: on in prod)
  --no-drop-debugger  Keep debugger statements (even in prod)
  --sourcemap         Generate source maps (default: on in dev)
  --no-sourcemap      Disable source maps (even in dev)
  --strict-type-check Fail build on TypeScript type errors (default: warn only)
  --port <number>     Dev server port (default: 4200)
  --open              Auto-open browser on dev server start
  --no-open           Do not auto-open browser
  --host <addr>       Dev server host address (default: localhost; use 0.0.0.0 for LAN)
  --base <path>       Public base path for deployed assets (default: /)
  --target <targets>  Comma-separated esbuild targets (e.g. es2022,chrome120)
  --hash-file-names   Include content hashes in output filenames (default: on)
  --no-hash-file-names  Disable content hashes in output filenames
  --env-prefix <pre>  Only env vars with this prefix are injected as defines (default: THANE_)
  --empty-out-dir     Clear output directory before building (default: on)
  --no-empty-out-dir  Keep existing output directory contents
  --splitting         Enable code splitting (default: on)
  --no-splitting      Disable code splitting (single bundle)
  --legal-comments <mode>  Handle license comments: none, eof, linked, external (default: none)
  --analyze           Write esbuild metafile to dist for bundle analysis
  --no-analyze        Do not write metafile (default)
  --verbose, -V       Verbose output (show debug info)
  --quiet, -q         Suppress all non-error output
  --help, -h          Show this help message
  --version, -v       Show version number

Examples:
  thane dev                    Start dev server
  thane build --prod           Production build
  thane serve --prod --gzip    Production build with gzip and server
  thane build --verbose        Build with detailed logging
`);
}

export function printVersion(): void {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packagePath = join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    console.log(`thane v${pkg.version}`);
  } catch {
    console.log('thane v0.0.0');
  }
}

export function createBuildConfig(options: CLIOptions): BuildConfig {
  const indexHTMLFileName = 'index.html';

  const distDir = options.outDir ?? './dist';
  const assetsInputDir = options.assetsDir ?? './src/assets';
  const assetsOutputDir = `${distDir}/assets`;
  const inputHTMLFilePath = options.htmlTemplate ?? `./${indexHTMLFileName}`;
  const outputHTMLFilePath = `${distDir}/${indexHTMLFileName}`;
  const entryPoints = options.entry ? [options.entry] : ['./src/main.ts'];

  // Collect THANE_* (or custom prefix) env vars as compile-time defines
  const envPrefix = options.envPrefix ?? 'THANE_';
  const envDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(envPrefix) && value !== undefined) {
      envDefines[`import.meta.env.${key}`] = JSON.stringify(value);
    }
  }

  return {
    entryPoints,
    outDir: distDir,
    assetsInputDir,
    assetsOutputDir,
    inputHTMLFilePath,
    outputHTMLFilePath,
    isProd: options.prod,
    serve: options.serve,
    useGzip: options.gzip,
    dropConsole: options.dropConsole ?? options.prod,
    dropDebugger: options.dropDebugger ?? options.prod,
    sourcemap: options.sourcemap ?? !options.prod,
    strictTypeCheck: options.strictTypeCheck ?? false,
    port: options.port ?? 4200,
    open: options.open ?? false,
    host: typeof options.host === 'boolean' ? (options.host ? '0.0.0.0' : 'localhost') : (options.host ?? 'localhost'),
    base: options.base ?? '/',
    target: options.target ?? [],
    hashFileNames: options.hashFileNames ?? true,
    define: { ...envDefines, ...(options.define ?? {}) },
    envPrefix,
    emptyOutDir: options.emptyOutDir ?? true,
    splitting: options.splitting ?? true,
    legalComments: options.legalComments ?? 'none',
    analyze: options.analyze ?? false,
  };
}

export function resolveCLIOptions(args: string[]): CLIOptions {
  const parsedCLI = parseArgs(args);
  return mergeCLIAndConfig(args, parsedCLI);
}

export async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const cliOptions = resolveCLIOptions(args);

  // Handle --help / --version (print and exit without building)
  if (cliOptions.exitRequested === 'help') {
    printHelp();
    return;
  }
  if (cliOptions.exitRequested === 'version') {
    printVersion();
    return;
  }

  // Wire log level from CLI flags
  logger.setLevel(cliOptions.logLevel);

  const buildConfig = createBuildConfig(cliOptions);
  await runBuild(buildConfig);
}
