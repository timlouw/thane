import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { CLIOptions, BuildConfig, ThaneBuildOptions, ThaneConfigFile } from './types.js';
import { runBuild } from './build.js';
import { runAnalyzer } from './analyzer/index.js';

const COMMANDS = new Set(['build', 'dev', 'serve', 'analyze']);

const DEFAULT_OPTIONS: CLIOptions = {
  command: 'build',
  prod: false,
  gzip: false,
  app: 'client',
  serve: false,
  compare: false,
  analyzerPort: 4300,
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
    ...(cfg.analyzerPort != null && { analyzerPort: cfg.analyzerPort }),
    ...(cfg.compare != null && { compare: cfg.compare }),
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
  if (hasFlag(args, '--compare')) merged.compare = true;
  if (hasValueFlag(args, '--app') && parsedCLI.app) merged.app = parsedCLI.app;
  if (hasValueFlag(args, '--entry') && parsedCLI.entry) merged.entry = parsedCLI.entry;
  if (hasValueFlag(args, '--out') && parsedCLI.outDir) merged.outDir = parsedCLI.outDir;
  if (hasValueFlag(args, '--assets') && parsedCLI.assetsDir) merged.assetsDir = parsedCLI.assetsDir;
  if (hasValueFlag(args, '--html') && parsedCLI.htmlTemplate) merged.htmlTemplate = parsedCLI.htmlTemplate;
  if (hasValueFlag(args, '--port')) merged.analyzerPort = parsedCLI.analyzerPort;
  if (hasValueFlag(args, '--config') && parsedCLI.configPath) {
    merged.configPath = toAbsoluteIfRelative(parsedCLI.configPath, process.cwd());
  }

  return applyCommandModeDefaults(merged);
};

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = { ...DEFAULT_OPTIONS };

  const knownFlags = new Set([
    '--prod', '-p', '--gzip', '--app', '--entry', '--out',
    '--assets', '--html', '--help', '-h', '--version', '-v',
    '--compare', '--port', '--config',
  ]);
  const flagsWithValue = new Set(['--app', '--entry', '--out', '--assets', '--html', '--port', '--config']);

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
      case '--compare':
        options.compare = true;
        break;
      case '--port':
        options.analyzerPort = parseInt(args[++i] || '4300', 10) || 4300;
        break;
      case '--config':
        options.configPath = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      case '--version':
      case '-v':
        printVersion();
        process.exit(0);
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
  analyze     Interactive bundle analysis with treemap & dep graph

Options:
  --prod, -p          Production build (default: development)
  --gzip              Enable gzip compression (production only)
  --app <name>        Application name (default: client)
  --entry <path>      Custom entry point (default: ./src/main.ts)
  --out <dir>         Output directory (default: ./dist)
  --assets <dir>      Assets directory (default: ./src/assets)
  --html <path>       HTML template file (default: ./index.html)
  --config <path>     Path to thane config file (default: ./thane.config.json or .jsonc)
  --compare           Compare dev and prod builds (analyze only)
  --port <number>     Analyzer server port (default: 4300)
  --help, -h          Show this help message
  --version, -v       Show version number

Examples:
  thane dev                    Start dev server
  thane build --prod           Production build
  thane serve --prod --gzip    Production build with gzip and server
  thane analyze                Analyze dev bundle
  thane analyze --prod         Analyze prod bundle
  thane analyze --compare      Compare dev vs prod bundles
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
  };
}

export function resolveCLIOptions(args: string[]): CLIOptions {
  const parsedCLI = parseArgs(args);
  return mergeCLIAndConfig(args, parsedCLI);
}

export async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const cliOptions = resolveCLIOptions(args);

  if (cliOptions.command === 'analyze') {
    const buildConfig = createBuildConfig(cliOptions);
    await runAnalyzer({
      entryPoints: buildConfig.entryPoints,
      outDir: buildConfig.outDir,
      isProd: cliOptions.prod,
      compare: cliOptions.compare,
      port: cliOptions.analyzerPort,
      inputHTMLFilePath: buildConfig.inputHTMLFilePath,
      assetsInputDir: buildConfig.assetsInputDir,
    });
    return;
  }

  const buildConfig = createBuildConfig(cliOptions);
  await runBuild(buildConfig);
}
